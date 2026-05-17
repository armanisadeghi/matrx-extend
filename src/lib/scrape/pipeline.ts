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
  includeLinks: boolean;
  includeStructured: boolean;
}

const DEFAULT_OPTS: ScrapeOptions = {
  preferDefuddle: true,
  includeImages: true,
  includeVideos: true,
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

  const metadata = collectMetadata();
  const article = await extractArticle(doc, o.preferDefuddle);

  return {
    url: doc.location?.href ?? '',
    capturedAt: Date.now(),
    metadata,
    article,
    images: o.includeImages ? collectImages() : [],
    videos: o.includeVideos ? collectVideos() : [],
    audio: o.includeImages ? collectAudio() : [],
    links: o.includeLinks ? collectLinks() : [],
    ld_json: o.includeStructured ? collectJsonLd() : [],
    seo: runAudit(doc),
    raw_html_size: doc.documentElement.outerHTML.length,
  };
}

async function extractArticle(
  doc: Document,
  preferDefuddle: boolean,
): Promise<SoupResult['article']> {
  if (preferDefuddle) {
    try {
      const result = await defuddleExtract(doc);
      if (result) return result;
    } catch (err) {
      console.warn('[matrx-extend] defuddle failed, falling back to readability', err);
    }
  }

  const result = readabilityExtract(doc);
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
const READABILITY_NEGATIVE_TOKENS =
  /\b(meta|comment|footnote|footer|byline|hidden|hid|sidebar)\b/i;

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
