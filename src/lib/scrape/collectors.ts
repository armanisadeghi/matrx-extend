/**
 * Collectors for media + structured data — pure DOM traversal, no deps.
 *
 * Runs in the content script. Returns absolute URLs (resolved against
 * document.baseURI) so the panel can render thumbnails directly.
 */

export interface CollectedImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface CollectedVideo {
  src: string;
  poster: string | null;
  duration: number | null;
}

export interface CollectedLink {
  href: string;
  text: string;
  rel: string | null;
}

export interface CollectedAudio {
  src: string;
  type: string | null;
}

export interface CollectedMetadata {
  title: string;
  description: string | null;
  canonical: string | null;
  lang: string | null;
  og: Record<string, string>;
  twitter: Record<string, string>;
  schemaTypes: string[];
  /**
   * Publish / last-modified timestamps, ISO-8601 or null. The research server's
   * `_structured_dates` (aidream `research/multisource.py`) reads exactly these
   * two key names FIRST and only falls back to JSON-LD `datePublished` /
   * `dateModified` — so a page with OG article dates and no JSON-LD stored no
   * dates at all until these were collected.
   *
   * Only strictly-ISO values are kept (see `normalizeIsoDate`): the server pipes
   * them straight into a timestamptz column via `_valid_iso`, and a wrong date
   * is worse than no date. Ambiguous formats (`08/09/2026`, `August 9, 2026`)
   * are dropped rather than guessed at.
   */
  published_time: string | null;
  modified_time: string | null;
}

/**
 * Strict ISO-8601 gate. Returns the ORIGINAL string (offset preserved) when it
 * is unambiguously ISO and represents a real instant, else null.
 *
 * Deliberately NOT `new Date(raw)` — that parser is lenient enough to turn
 * locale-formatted or partial strings into a confidently wrong instant. The
 * shape must match first; `Date.parse` then only rejects impossible dates
 * (`2026-13-45`).
 */
const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function normalizeIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!ISO_DATE_RE.test(text)) return null;
  return Number.isNaN(Date.parse(text)) ? null : text;
}

/**
 * Ordered selector lists for the two dates. Every entry is an EXPLICIT semantic
 * marker for the page's own publish/modify time — no generic `article time`,
 * which routinely matches a related-post or comment timestamp instead.
 *
 * Kept as data so the inline copy in capture-media.ts can mirror it verbatim.
 */
export const PUBLISHED_TIME_SELECTORS = [
  ['meta[property="article:published_time"]', 'content'],
  ['meta[property="og:article:published_time"]', 'content'],
  ['meta[itemprop="datePublished"]', 'content'],
  ['meta[name="datePublished"]', 'content'],
  ['meta[name="date"]', 'content'],
  ['time[itemprop="datePublished"][datetime]', 'datetime'],
] as const;

export const MODIFIED_TIME_SELECTORS = [
  ['meta[property="article:modified_time"]', 'content'],
  ['meta[property="og:updated_time"]', 'content'],
  ['meta[itemprop="dateModified"]', 'content'],
  ['meta[name="dateModified"]', 'content'],
  ['meta[name="last-modified"]', 'content'],
  ['time[itemprop="dateModified"][datetime]', 'datetime'],
] as const;

function firstIsoDate(
  doc: Document,
  selectors: ReadonlyArray<readonly [string, string]>,
): string | null {
  for (const [selector, attr] of selectors) {
    for (const el of Array.from(doc.querySelectorAll(selector))) {
      const value = normalizeIsoDate(el.getAttribute(attr));
      if (value) return value;
    }
  }
  return null;
}

/**
 * ⚠️ Resolving is NOT validating. `new URL()` only throws on a value it cannot
 * parse AT ALL — `javascript:void(0)`, `mailto:a@b.c`, `tel:+1`, `data:` and
 * `blob:` all parse fine (they just have an empty host). A bare
 * `try { new URL(x) } catch { reject }` therefore accepts every one of them.
 * That is why there is no generic `abs()` here any more: each caller states the
 * scheme rule for its own medium — `absNavigable` for anything treated as a
 * page link, `absMedia` for anything fetched/rendered as bytes.
 */

/**
 * Link gate — http(s) with a real host, nothing else.
 *
 * Mirrors the canonical server-side rule exactly, from the link loop in
 * `aidream/packages/matrx-scraper/matrx_scraper/seo_audit.py`:
 *
 *   if not host or not u.startswith(("http://", "https://")): continue
 *
 * This matters because `collectLinks`' output is not cosmetic: it becomes the
 * `page_links` context key the agent receives every turn, and `SoupResult.links`
 * which is submitted to the research capture sink and stored as
 * `extracted_links` (and from there into the server's link graph). An agent
 * handed `javascript:void(0)` as a link will try to navigate to it.
 *
 * Note a same-page `#fragment` anchor DOES survive — it resolves against
 * baseURI to the page's own http(s) URL plus a hash, exactly as `urljoin` does
 * server-side. It is a real navigable target, not a pseudo-scheme.
 */
const absNavigable = (raw: string, doc: Document): string | null => {
  let u: URL;
  try {
    u = new URL(raw, doc.baseURI);
  } catch {
    return null;
  }
  if (!u.host) return null;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.toString();
};

/**
 * Media gate — deliberately WIDER than `absNavigable`.
 *
 * `data:` and `blob:` are legitimate, extremely common image/video/audio
 * sources (inline SVG/PNG, canvas exports, MediaSource playback), so the
 * host-and-http(s) rule that is correct for links would throw away real media.
 * What is banned instead is the small set of schemes that can never carry
 * bytes — a `javascript:`/`mailto:`/`tel:`/`sms:` value in a `src` is either
 * page junk or an attempt to get an executable-looking string into a renderer,
 * and it will never resolve to an image either way.
 */
const NON_FETCHABLE_SCHEMES = new Set(['javascript:', 'mailto:', 'tel:', 'sms:', 'about:']);

const absMedia = (raw: string, doc: Document): string | null => {
  let u: URL;
  try {
    u = new URL(raw, doc.baseURI);
  } catch {
    return null;
  }
  if (NON_FETCHABLE_SCHEMES.has(u.protocol)) return null;
  return u.toString();
};

export function collectImages(doc: Document = document): CollectedImage[] {
  const out: CollectedImage[] = [];
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.currentSrc || img.src;
    const resolved = src ? absMedia(src, doc) : null;
    if (!resolved) return;
    out.push({
      src: resolved,
      alt: img.alt || null,
      width: img.naturalWidth || img.width || null,
      height: img.naturalHeight || img.height || null,
    });
  });
  // Background images via inline style — high-cardinality; keep the simple case.
  doc.querySelectorAll('[style*="background-image"]').forEach((el) => {
    const style = (el as HTMLElement).style.backgroundImage;
    const m = style.match(/url\((['"]?)([^'")]+)\1\)/);
    if (!m) return;
    const url = m[2];
    if (!url) return;
    const resolved = absMedia(url, doc);
    if (!resolved) return;
    out.push({ src: resolved, alt: null, width: null, height: null });
  });
  return dedupeBy(out, (i) => i.src);
}

export function collectVideos(doc: Document = document): CollectedVideo[] {
  const out: CollectedVideo[] = [];
  doc.querySelectorAll('video').forEach((v) => {
    const src = v.currentSrc || v.src || v.querySelector('source')?.src || '';
    const resolved = src ? absMedia(src, doc) : null;
    if (!resolved) return;
    out.push({
      src: resolved,
      poster: v.poster ? absMedia(v.poster, doc) : null,
      duration: Number.isFinite(v.duration) ? v.duration : null,
    });
  });
  doc.querySelectorAll('iframe[src*="youtube"], iframe[src*="vimeo"]').forEach((f) => {
    const src = (f as HTMLIFrameElement).src;
    const resolved = src ? absMedia(src, doc) : null;
    if (!resolved) return;
    out.push({ src: resolved, poster: null, duration: null });
  });
  return dedupeBy(out, (v) => v.src);
}

export function collectAudio(doc: Document = document): CollectedAudio[] {
  const out: CollectedAudio[] = [];
  doc.querySelectorAll('audio').forEach((a) => {
    const src = a.currentSrc || a.src || a.querySelector('source')?.src || '';
    const resolved = src ? absMedia(src, doc) : null;
    if (!resolved) return;
    out.push({ src: resolved, type: a.querySelector('source')?.type ?? null });
  });
  return dedupeBy(out, (a) => a.src);
}

export function collectLinks(doc: Document = document): CollectedLink[] {
  const out: CollectedLink[] = [];
  doc.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = absNavigable(a.href, doc);
    if (!href) return;
    out.push({
      href,
      text: (a.textContent ?? '').trim().slice(0, 240),
      rel: a.rel || null,
    });
  });
  return dedupeBy(out, (l) => `${l.href}|${l.text}`);
}

export function collectMetadata(doc: Document = document): CollectedMetadata {
  const og: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  doc.querySelectorAll<HTMLMetaElement>('meta').forEach((m) => {
    const property = m.getAttribute('property') ?? '';
    const name = m.getAttribute('name') ?? '';
    const content = m.getAttribute('content') ?? '';
    if (!content) return;
    if (property.startsWith('og:')) og[property] = content;
    if (name.startsWith('twitter:')) twitter[name] = content;
  });
  const schemaTypes = collectSchemaTypes(doc);
  const description =
    doc.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null;
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;
  return {
    title: doc.title,
    description,
    canonical,
    lang: doc.documentElement.lang || null,
    og,
    twitter,
    schemaTypes,
    published_time: firstIsoDate(doc, PUBLISHED_TIME_SELECTORS),
    modified_time: firstIsoDate(doc, MODIFIED_TIME_SELECTORS),
  };
}

export function collectJsonLd(doc: Document = document): unknown[] {
  const out: unknown[] = [];
  doc.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]').forEach((s) => {
    const text = s.textContent?.trim();
    if (!text) return;
    try {
      out.push(JSON.parse(text));
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  return out;
}

function collectSchemaTypes(doc: Document = document): string[] {
  const types = new Set<string>();
  for (const block of collectJsonLd(doc)) {
    walkType(block, types);
  }
  doc.querySelectorAll('[itemtype]').forEach((el) => {
    const t = el.getAttribute('itemtype');
    if (t) types.add(t);
  });
  return Array.from(types);
}

function walkType(node: unknown, types: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walkType(n, types);
    return;
  }
  const obj = node as Record<string, unknown>;
  const t = obj['@type'];
  if (typeof t === 'string') types.add(t);
  else if (Array.isArray(t)) for (const tt of t) if (typeof tt === 'string') types.add(tt);
  for (const v of Object.values(obj)) walkType(v, types);
}

function dedupeBy<T>(arr: T[], keyFn: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
