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
  /**
   * The page's resolved final URL. REQUIRED when `doc` came from DOMParser —
   * such a Document has `location === null` in Chrome, so without this the
   * result's `url` was '' and the SEO audit judged every link external.
   * A content script scraping the live document can omit it.
   */
  baseUrl?: string;
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

  const url = o.baseUrl ?? doc.location?.href ?? '';

  return {
    url,
    capturedAt: Date.now(),
    metadata,
    article,
    images: o.includeImages ? collectImages(doc) : [],
    videos: o.includeVideos ? collectVideos(doc) : [],
    // gated on its own flag — it was keyed to includeImages by accident
    audio: o.includeAudio ? collectAudio(doc) : [],
    links: o.includeLinks ? collectLinks(doc) : [],
    ld_json: o.includeStructured ? collectJsonLd(doc) : [],
    seo: runAudit(doc, url || undefined),
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
export function normalizeSemanticMarkup(
  doc: Document,
  figureSvgGeometry?: FigureSvgGeometry,
): void {
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

  // 3. Turn content SVGs into ordinary images before Defuddle and the
  //    HTML-only DOMPurify profile see them. Defuddle keeps the SVG markup,
  //    but DOMPurify deliberately removes it; Turndown therefore used to see
  //    an empty <figure>. A data-image remains inert, survives sanitization,
  //    and has a native Markdown representation. Scope this to <figure> so
  //    navigation/logo/button icons do not become article images.
  protectInlineSvgFigures(doc, figureSvgGeometry);
}

/** Base64 keeps large SVGs smaller than percent encoding and Markdown-safe. */
function svgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function numericSvgDimension(svg: Element, attribute: 'width' | 'height'): number | null {
  const direct = Number.parseFloat(svg.getAttribute(attribute) ?? '');
  if (Number.isFinite(direct) && direct > 0) return direct;
  const viewBox = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const fromViewBox = (attribute === 'width' ? viewBox[2] : viewBox[3]) ?? Number.NaN;
  return Number.isFinite(fromViewBox) && fromViewBox > 0 ? fromViewBox : null;
}

interface SvgLayerGeometry {
  x: number;
  y: number;
  rotation: -90 | 0 | 90 | 180;
}

type FigureSvgGeometry = Array<Array<SvgLayerGeometry | null>>;

const VECTOR_GRAPHIC_SELECTOR = 'path[d], line, polyline, polygon, rect, circle, ellipse';
const VECTOR_GRAPHIC_ATTRIBUTES = [
  'd',
  'points',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'stroke',
  'stroke-width',
  'fill',
  'fill-opacity',
  'opacity',
  'transform',
] as const;

function normalizedVectorAttribute(attribute: string, value: string): string {
  // DOMPurify normalizes SVG path/list attributes (notably dropping a leading
  // space from JSXGraph's `d`). Whitespace only separates SVG tokens here, so
  // trim/collapse it before comparing semantic drawing instructions.
  if (attribute === 'd' || attribute === 'points' || attribute === 'transform') {
    return value.trim().replace(/\s+/g, ' ');
  }
  return value;
}

function vectorGraphicSignatures(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll(VECTOR_GRAPHIC_SELECTOR))
    .map((element) => {
      const attrs = VECTOR_GRAPHIC_ATTRIBUTES.map(
        (attribute) =>
          `${attribute}=${normalizedVectorAttribute(attribute, element.getAttribute(attribute) ?? '')}`,
      ).join('|');
      return `${element.tagName.toLowerCase()}|${attrs}`;
    })
    .sort();
}

function hasMatchingVectorGraphics(doc: Document, source: Element, sanitized: string): boolean {
  const sourceGraphics = vectorGraphicSignatures(source);
  if (sourceGraphics.length === 0) return false;
  const container = doc.createElement('div');
  container.innerHTML = sanitized;
  const sanitizedGraphics = vectorGraphicSignatures(container);
  return (
    sourceGraphics.length === sanitizedGraphics.length &&
    sourceGraphics.every((graphic, index) => graphic === sanitizedGraphics[index])
  );
}

function hasUnsupportedFigureGraphics(source: Element): boolean {
  // foreignObject and embedded images need HTML/external-resource rendering.
  // An empty foreignObject is a common inert Mathspace interaction overlay,
  // not visual content, so it does not make the vector graph incomplete.
  const visualForeignObject = Array.from(source.querySelectorAll('foreignObject')).some(
    (foreignObject) =>
      foreignObject.children.length > 0 || (foreignObject.textContent ?? '').trim().length > 0,
  );
  return visualForeignObject || source.querySelector('image') !== null;
}

function hasUnrenderedSvgLayer(source: Element): boolean {
  // JSXGraph creates a full-size SVG shell with defs and an empty
  // foreignObject before it asynchronously appends plotted paths/points.
  // Axes and grid in sibling layers make the composite look valid, so a
  // whole-figure shape count cannot detect this intermediate state.
  return Array.from(source.querySelectorAll('svg')).some(
    (svg) =>
      svg.querySelector('foreignObject') !== null && !svg.querySelector(VECTOR_GRAPHIC_SELECTOR),
  );
}

function finiteLayoutRect(svg: Element): DOMRect | null {
  const rect = svg.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function svgLayerRotation(svg: Element, figure: Element): -90 | 0 | 90 | 180 {
  for (
    let current: Element | null = svg;
    current && current !== figure;
    current = current.parentElement
  ) {
    const rotation = current.getAttribute('style')?.match(/rotate\(\s*(-?90|180)deg\s*\)/i)?.[1];
    if (rotation === '-90') return -90;
    if (rotation === '90') return 90;
    if (rotation === '180') return 180;
  }
  return 0;
}

/**
 * A cloned Document has no layout. Capture each live SVG's rectangle before
 * cloning so narrow overlays retain their placement inside the largest graph
 * layer; DOMParser documents simply return null and use the stable fallback.
 */
function captureFigureSvgGeometry(doc: Document): FigureSvgGeometry {
  return Array.from(doc.querySelectorAll('figure')).map((figure) => {
    const svgs = Array.from(figure.querySelectorAll('svg'));
    const rects = svgs.map(finiteLayoutRect);
    const canvas = rects.reduce<DOMRect | null>((largest, rect) => {
      if (!rect || (largest && largest.width * largest.height >= rect.width * rect.height)) {
        return largest;
      }
      return rect;
    }, null);
    if (!canvas) return svgs.map(() => null);

    return svgs.map((svg, index) => {
      const rect = rects[index];
      if (!rect) return null;
      return {
        x: rect.left - canvas.left,
        y: rect.top - canvas.top,
        rotation: svgLayerRotation(svg, figure),
      };
    });
  });
}

function svgNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function svgLayerTransform(layer: Element, geometry: SvgLayerGeometry): string | null {
  const width = numericSvgDimension(layer, 'width');
  const height = numericSvgDimension(layer, 'height');
  if (width === null || height === null) return null;
  const x = svgNumber(geometry.x);
  const y = svgNumber(geometry.y);
  if (geometry.rotation === 90) {
    return `translate(${svgNumber(geometry.x + height)} ${y}) rotate(90)`;
  }
  if (geometry.rotation === -90) {
    return `translate(${x} ${svgNumber(geometry.y + width)}) rotate(-90)`;
  }
  if (geometry.rotation === 180) {
    return `translate(${svgNumber(geometry.x + width)} ${svgNumber(geometry.y + height)}) rotate(180)`;
  }
  return `translate(${x} ${y})`;
}

/**
 * Preserve inline vector graphics through Defuddle -> DOMPurify -> Turndown.
 * SVG layers become one self-contained SVG image so coordinate grids and
 * plotted curves do not split apart. HTML labels remain in the figure. Layers
 * are deliberately not filtered by their dimensions: graph renderers commonly
 * add narrow arrow/axis SVGs alongside the full-size grid.
 */
function protectInlineSvgFigures(doc: Document, figureSvgGeometry?: FigureSvgGeometry): void {
  for (const [figureIndex, figure] of Array.from(doc.querySelectorAll('figure')).entries()) {
    const svgs = Array.from(figure.querySelectorAll('svg'));
    if (svgs.length === 0) continue;
    const firstSvg = svgs[0];
    if (!firstSvg) continue;
    const caption = (figure.querySelector('figcaption')?.textContent ?? '').trim();
    const labelled = svgs.map((svg) => (svg.getAttribute('aria-label') ?? '').trim()).find(Boolean);
    const titled = svgs
      .map((svg) => (svg.querySelector('title')?.textContent ?? '').trim())
      .find(Boolean);
    const described = svgs
      .map((svg) => (svg.querySelector('desc')?.textContent ?? '').trim())
      .find(Boolean);
    const alt = labelled || titled || described || caption || 'Inline figure graphic';
    const width = Math.max(...svgs.map((svg) => numericSvgDimension(svg, 'width') ?? 0));
    const height = Math.max(...svgs.map((svg) => numericSvgDimension(svg, 'height') ?? 0));

    let serialized: string;
    let compositeRoot: Element | null = null;
    let insertionPoint = firstSvg;
    if (svgs.length === 1) {
      const serializable = firstSvg.cloneNode(true) as Element;
      if (!serializable.hasAttribute('xmlns')) {
        serializable.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      serialized = serializable.outerHTML;
    } else {
      insertionPoint = firstSvg;
      const composite = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      compositeRoot = composite;
      composite.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      composite.setAttribute('width', String(width));
      composite.setAttribute('height', String(height));
      composite.setAttribute('viewBox', `0 0 ${width} ${height}`);
      // Keep every layer, including mixed-size overlay SVGs. When the source
      // document had layout, wrap each layer in its measured graph-relative
      // translation/quarter-turn so axes do not collapse at the composite's
      // origin. DOMParser captures have no layout and retain raw SVG fallback.
      for (const [layerIndex, layer] of svgs.entries()) {
        const clone = layer.cloneNode(true) as Element;
        const transform = figureSvgGeometry?.[figureIndex]?.[layerIndex]
          ? svgLayerTransform(
              layer,
              figureSvgGeometry[figureIndex]?.[layerIndex] as SvgLayerGeometry,
            )
          : null;
        if (!transform) {
          composite.appendChild(clone);
          continue;
        }
        const group = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('transform', transform);
        group.appendChild(clone);
        composite.appendChild(group);
      }
      serialized = composite.outerHTML;
    }

    // The encoded image bypasses DOMPurify's later markup walk, so sanitize
    // the SVG payload itself before putting it in a data URL.
    serialized = DOMPurify.sanitize(serialized, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'style', 'foreignObject'],
    });
    // DOMPurify returns the sanitized children when the input itself is an
    // SVG root. A single-layer figure is still a valid SVG fragment, but a
    // multi-layer figure needs the generated canvas root to retain one image
    // coordinate system. Re-wrap only with dimensions we computed as finite
    // numbers; the layer markup above has already passed the SVG sanitizer.
    if (compositeRoot) {
      serialized = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${serialized}</svg>`;
    }

    const complete =
      !hasUnsupportedFigureGraphics(figure) &&
      !hasUnrenderedSvgLayer(figure) &&
      hasMatchingVectorGraphics(doc, compositeRoot ?? firstSvg, serialized);
    if (!complete) {
      const fallback = doc.createElement('p');
      fallback.textContent = `${alt} was omitted because this capture could not preserve it completely.`;
      // Defuddle prunes an empty <figure>, so replace the figure itself with
      // an honest text result rather than leaving fallback text in SVG chrome.
      figure.replaceWith(fallback);
      continue;
    }

    const image = doc.createElement('img');
    image.setAttribute('src', svgDataUrl(serialized));
    image.setAttribute('alt', alt);
    if (width > 0) image.setAttribute('width', String(width));
    if (height > 0) image.setAttribute('height', String(height));

    if (svgs.length === 1) {
      const style = firstSvg.getAttribute('style');
      if (style !== null) image.setAttribute('style', style);
      firstSvg.replaceWith(image);
    } else {
      insertionPoint.replaceWith(image);
      for (const svg of svgs) if (svg.isConnected) svg.remove();
    }
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
  const figureSvgGeometry = captureFigureSvgGeometry(doc);
  const normalized = doc.cloneNode(true) as Document;
  normalizeSemanticMarkup(normalized, figureSvgGeometry);

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
  // Defuddle 0.19+ deliberately strips data-URL images. Our inline-SVG lane
  // has already sanitized and encoded those figures, so replace each with a
  // plain-text position token for extraction and restore the inert image into
  // the parsed HTML before the final sanitizer. The token keeps the original
  // article position and prevents a figure-only subtree from being pruned.
  const protectedSvgs = Array.from(
    doc.querySelectorAll<HTMLImageElement>('img[src^="data:image/svg+xml;base64,"]'),
  ).map((image, index) => {
    const token = `MATRXPROTECTEDSVG${index}END`;
    const html = image.outerHTML;
    const placeholder = doc.createElement('p');
    placeholder.textContent = token;
    const figure = image.closest('figure');
    if (figure) figure.replaceWith(placeholder);
    else image.replaceWith(placeholder);
    return { token, html };
  });
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
  let restoredContent = parsed.content;
  for (const { token, html } of protectedSvgs) {
    restoredContent = restoredContent.includes(token)
      ? restoredContent.replace(token, html)
      : `${restoredContent}\n${html}`;
  }
  const safe = DOMPurify.sanitize(restoredContent, {
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
