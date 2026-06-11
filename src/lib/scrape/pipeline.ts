/**
 * Scrape pipeline. Runs in the content script (has DOM).
 *
 * Order of operations:
 *   1. Try Defuddle (modern SPA-aware article extractor)
 *   2. Fall back to @mozilla/readability if defuddle isn't confident
 *   3. DOMPurify the article content
 *   4. Turndown → markdown
 *   5. Collect metadata, images, videos, links, audio, JSON-LD
 *
 * Returns a normalized SoupResult with everything the side panel needs.
 */

import {
  type CollectedAudio,
  type CollectedImage,
  type CollectedLink,
  type CollectedMetadata,
  type CollectedVideo,
  collectAudio,
  collectImages,
  collectJsonLd,
  collectLinks,
  collectMetadata,
  collectVideos,
} from '@/lib/scrape/collectors';
import { type SeoAudit, runAudit } from '@/lib/seo/audit';
import { gfm } from '@joplin/turndown-plugin-gfm';
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';

export interface SoupResult {
  url: string;
  capturedAt: number;
  metadata: CollectedMetadata;
  article: {
    title: string | null;
    byline: string | null;
    content_html_safe: string | null;
    content_markdown: string | null;
    excerpt: string | null;
    extractor: 'defuddle' | 'readability' | 'fallback';
    word_count: number | null;
    reading_time_minutes: number | null;
  };
  images: CollectedImage[];
  videos: CollectedVideo[];
  audio: CollectedAudio[];
  links: CollectedLink[];
  ld_json: unknown[];
  /**
   * SEO signals collected at the same moment as everything else, so when the
   * Scrape capture runs after a scroll, the SEO numbers (image count, missing
   * alt, word count, etc.) reflect the post-scroll DOM.
   */
  seo: SeoAudit;
  raw_html_size: number;
}

export interface ScrapeOptions {
  preferDefuddle: boolean;
  includeImages: boolean;
  includeVideos: boolean;
  includeAudio: boolean;
  includeLinks: boolean;
  includeStructured: boolean;
}

const DEFAULT_OPTS: ScrapeOptions = {
  preferDefuddle: true,
  includeImages: true,
  includeVideos: true,
  includeAudio: true,
  includeLinks: true,
  includeStructured: true,
};

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
});
turndown.use(gfm);

export async function runScrape(
  doc: Document = document,
  opts: Partial<ScrapeOptions> = {},
): Promise<SoupResult> {
  const o = { ...DEFAULT_OPTS, ...opts };

  // Thread `doc` to every collector — they defaulted to the GLOBAL document,
  // which equals `doc` in a content script but is the EMPTY offscreen page in
  // the fetch-and-parse path: fetch_url_as_markdown silently shipped wrong
  // metadata and empty links/images/json-ld for every fetched URL.
  const metadata = collectMetadata(doc);
  const article = await extractArticle(doc, o.preferDefuddle);

  return {
    url: doc.location?.href ?? '',
    capturedAt: Date.now(),
    metadata,
    article,
    images: o.includeImages ? collectImages(doc) : [],
    videos: o.includeVideos ? collectVideos(doc) : [],
    // gated on its own flag — it was keyed to includeImages by accident
    audio: o.includeAudio ? collectAudio(doc) : [],
    links: o.includeLinks ? collectLinks(doc) : [],
    ld_json: o.includeStructured ? collectJsonLd(doc) : [],
    seo: runAudit(doc),
    raw_html_size: doc.documentElement.outerHTML.length,
  };
}

/**
 * Block-level tags that MDX/Mintlify-style renderers emit as
 * `<span data-as="p">` / `<div data-as="h2">` etc. We only rename to a tag
 * on this allow-list — never to an arbitrary attacker-controlled value.
 */
const DATA_AS_BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'pre',
  'code',
  'em',
  'strong',
  'figure',
  'figcaption',
  'section',
  'article',
]);

/**
 * Best-effort language detection for a syntax-highlighted code block.
 * Mintlify puts it on `<pre language="json">` / `<code language="json">`;
 * Prism / highlight.js / Shiki use a `language-xxx` (or `lang-xxx`) class.
 */
function detectCodeLang(pre: Element): string | null {
  const code = pre.querySelector('code');
  const fromAttr = pre.getAttribute('language') ?? code?.getAttribute('language');
  if (fromAttr?.trim()) return fromAttr.trim().toLowerCase();
  const cls = `${pre.className} ${code?.className ?? ''}`;
  const m = cls.match(/(?:language|lang)-([\w+#-]+)/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/**
 * Normalize non-standard semantic markup that defeats Readability / Defuddle
 * / Turndown. Two patterns, both seen on Mintlify/MDX docs (e.g. Cartesia's):
 *
 *   1. Paragraphs and headings rendered as `<span data-as="p">` instead of
 *      real `<p>`. Turndown treats `<span>` as INLINE, so adjacent paragraphs
 *      get concatenated with a single space — every paragraph on the page
 *      collapses into one blob. We rename each `[data-as]` node to the real
 *      block tag it stands for. This also lets Readability/Defuddle score the
 *      content region correctly (no `<p>` tags → bad content detection →
 *      whole sections, including code, get pruned).
 *
 *   2. Syntax-highlighted code (Shiki/Prism/highlight.js) where the source is
 *      split across dozens of colored `<span>`s nested inside copy/feedback
 *      button chrome (`.code-block > … > pre.shiki > code > span.line > span`).
 *      Extractors routinely prune the whole wrapper, dropping the code. We
 *      rebuild each `<pre><code>` as a clean text-only node (preserving
 *      newlines via `textContent`) with a `language-*` class so it survives
 *      extraction and Turndown fences it with the right language tag.
 *
 * Always runs on a CLONE — never the live document.
 */
export function normalizeSemanticMarkup(doc: Document): void {
  // 1. Rename `[data-as]` block elements to their real tag.
  for (const el of Array.from(doc.querySelectorAll('[data-as]'))) {
    const tag = (el.getAttribute('data-as') ?? '').toLowerCase().trim();
    if (!DATA_AS_BLOCK_TAGS.has(tag)) continue;
    if (el.tagName.toLowerCase() === tag) {
      el.removeAttribute('data-as');
      continue;
    }
    const replacement = doc.createElement(tag);
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'data-as') continue;
      replacement.setAttribute(attr.name, attr.value);
    }
    while (el.firstChild) replacement.appendChild(el.firstChild);
    el.replaceWith(replacement);
  }

  // 2. Flatten highlighted code blocks to clean <pre><code>text</code></pre>.
  //    Critically, replace the *whole wrapper* (e.g. Mintlify's
  //    `.code-block.not-prose` with copy/feedback button chrome), not just
  //    the inner <pre> — defuddle/readability score those button-laden
  //    wrappers as non-content and prune the entire subtree, taking the code
  //    with it. Hoisting the clean <pre> up to where the wrapper sat keeps
  //    the code inside the extracted content. (Verified against Cartesia's
  //    Shiki docs: in-place replace → code dropped; hoisted → code kept.)
  for (const pre of Array.from(doc.querySelectorAll('pre'))) {
    const codeEl = pre.querySelector('code') ?? pre;
    const text = (codeEl.textContent ?? '').replace(/\n+$/, '');
    if (!text.trim()) continue;
    const lang = detectCodeLang(pre);
    const newPre = doc.createElement('pre');
    const newCode = doc.createElement('code');
    if (lang) newCode.className = `language-${lang}`;
    newCode.textContent = text;
    newPre.appendChild(newCode);
    codeBlockWrapper(pre, text).replaceWith(newPre);
  }
}

/** Class hints that mark a code-block chrome wrapper across common renderers. */
const CODE_WRAPPER_CLASS = /code-?block|codeblock|highlight|code-snippet|shiki/i;

/**
 * Find the outermost ancestor that wraps ONLY this code block (button chrome
 * like copy / feedback buttons carries no text, so it doesn't count). That
 * wrapper is what we replace, so the surrounding non-content chrome that
 * confuses extractors goes with it. Stops at any element with an `id`, at
 * structural landmarks, or as soon as an ancestor holds more than this one
 * code block — so we never swallow real sibling content.
 */
function codeBlockWrapper(pre: Element, codeText: string): Element {
  const want = codeText.trim();
  let target: Element = pre;
  let parent = pre.parentElement;
  while (parent) {
    if (parent.id) break;
    if (['BODY', 'MAIN', 'ARTICLE', 'SECTION'].includes(parent.tagName)) break;
    if (parent.querySelectorAll('pre').length !== 1) break;
    const cls = typeof parent.className === 'string' ? parent.className : '';
    const isChrome = CODE_WRAPPER_CLASS.test(cls);
    const onlyThisCode = (parent.textContent ?? '').trim() === want;
    if (!isChrome && !onlyThisCode) break;
    target = parent;
    parent = parent.parentElement;
  }
  return target;
}

async function extractArticle(
  doc: Document,
  preferDefuddle: boolean,
): Promise<SoupResult['article']> {
  // Normalize once on a clone so MDX/Mintlify markup (span-paragraphs,
  // span-wrapped code) is converted to standard HTML before extraction.
  // Never mutate the caller's document — on the Scrape tab `doc` is live.
  const normalized = doc.cloneNode(true) as Document;
  normalizeSemanticMarkup(normalized);

  if (preferDefuddle) {
    try {
      const result = await defuddleExtract(normalized);
      if (result) return result;
    } catch (err) {
      console.warn('[matrx-extend] defuddle failed, falling back to readability', err);
    }
  }

  const result = readabilityExtract(normalized);
  if (result) return result;

  return {
    title: doc.title || null,
    byline: null,
    content_html_safe: null,
    content_markdown: null,
    excerpt: null,
    extractor: 'fallback',
    word_count: null,
    reading_time_minutes: null,
  };
}

async function defuddleExtract(doc: Document): Promise<SoupResult['article'] | null> {
  // Lazy-import so the pipeline pays for it only when used (defuddle pulls
  // additional grammar packs). The default export's API: new Defuddle(doc).parse() → { title, content, ... }
  const mod = await import('defuddle');
  // Defuddle ships both a class and helper. We use the class for richer output.
  const DefuddleCtor = (
    mod as unknown as { default: new (d: Document) => { parse: () => unknown } }
  ).default;
  if (!DefuddleCtor) return null;
  const inst = new DefuddleCtor(doc);
  const parsed = inst.parse() as
    | {
        title?: string;
        author?: string;
        content?: string;
        description?: string;
        wordCount?: number;
      }
    | null
    | undefined;
  if (!parsed?.content) return null;
  const safe = DOMPurify.sanitize(parsed.content, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style'],
  });
  const md = turndown.turndown(safe);
  const wc = parsed.wordCount ?? md.split(/\s+/).filter(Boolean).length;
  return {
    title: parsed.title ?? doc.title ?? null,
    byline: parsed.author ?? null,
    content_html_safe: safe,
    content_markdown: md,
    excerpt: parsed.description ?? null,
    extractor: 'defuddle',
    word_count: wc,
    reading_time_minutes: Math.max(1, Math.round(wc / 220)),
  };
}

/**
 * Tokens that Readability's `_getClassWeight` penalizes (-25 per match).
 * The full Readability regex is much broader; this list is the subset
 * we've seen drop value-carrying micro-elements in practice. Removing
 * just these tokens (leaving other classes intact) keeps Readability's
 * other heuristics functioning while neutralizing the worst false
 * positives.
 */
const READABILITY_NEGATIVE_TOKENS = /\b(meta|comment|footnote|footer|byline|hidden|hid|sidebar)\b/i;

/**
 * Pre-pass mutating a CLONED Readability input so short value-bearing
 * elements survive `_cleanConditionally`. Two passes:
 *
 *   1. Strip negative-weight tokens from the className of ancestors of
 *      <time>, <data>, <meter>, <address>. Keeps other classes intact.
 *
 *   2. Lift the `aria-label` or `title` text of those micro-elements
 *      into the inner text of their parent so it counts toward
 *      Readability's content-length checks (PyPI's <time> carries the
 *      precise timestamp in `title="…"`; the inner text is just a
 *      short relative date).
 *
 * Always runs on the clone — never touches the live document.
 */
function protectMicroData(doc: Document): void {
  const micro = doc.querySelectorAll('time, data, meter, address');
  for (const el of Array.from(micro)) {
    let ancestor: Element | null = el.parentElement;
    while (ancestor && ancestor !== doc.body) {
      const cls = ancestor.className;
      if (typeof cls === 'string' && READABILITY_NEGATIVE_TOKENS.test(cls)) {
        const stripped = cls
          .split(/\s+/)
          .filter((c) => !READABILITY_NEGATIVE_TOKENS.test(c))
          .join(' ');
        ancestor.className = stripped;
      }
      ancestor = ancestor.parentElement;
    }
    const inner = (el.textContent ?? '').trim();
    const longer =
      el.getAttribute('aria-label') ??
      el.getAttribute('title') ??
      el.getAttribute('datetime') ??
      null;
    if (longer && longer.trim() && longer.trim() !== inner) {
      // Append, don't replace — keep the human-friendly label visible.
      // Use the cloned doc's createTextNode so the node belongs to the
      // right owner document.
      const owner = el.ownerDocument ?? doc;
      el.append(owner.createTextNode(` (${longer.trim()})`));
    }
  }
}

function readabilityExtract(doc: Document): SoupResult['article'] | null {
  // Clone — Readability mutates the document.
  const cloned = doc.cloneNode(true) as Document;
  if (!isProbablyReaderable(cloned)) return null;
  // Protect value-carrying micro-elements (<time>, <data>, <meter>,
  // <address>) from Readability's `_cleanConditionally` heuristic, which
  // tends to drop short ancestors whose class names match its negative
  // regex ("meta", "comment", "footer", "byline", etc.). PyPI's
  // <p class="package-snippet__meta">Last released <time>…</time></p>
  // is a textbook example. See `protectMicroData` below.
  protectMicroData(cloned);
  const reader = new Readability(cloned);
  const parsed = reader.parse();
  if (!parsed) return null;
  const safe = DOMPurify.sanitize(parsed.content ?? '', {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style'],
  });
  const md = turndown.turndown(safe);
  const wc = parsed.length ? Math.round(parsed.length / 5) : md.split(/\s+/).filter(Boolean).length;
  return {
    title: parsed.title ?? doc.title ?? null,
    byline: parsed.byline ?? null,
    content_html_safe: safe,
    content_markdown: md,
    excerpt: parsed.excerpt ?? null,
    extractor: 'readability',
    word_count: wc,
    reading_time_minutes: Math.max(1, Math.round(wc / 220)),
  };
}
