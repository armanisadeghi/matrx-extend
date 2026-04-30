/**
 * SEO audit collector. Runs in a content script via chrome.scripting.executeScript
 * (or in the main thread of the side panel against an offscreen DOMParser
 * snapshot). Output is JSON-LD-ish — easy to display, easy to ship to backend.
 */

export interface SeoAudit {
  url: string;
  fetched_at: number;
  title: { value: string; length: number };
  description: { value: string | null; length: number };
  canonical: string | null;
  robots: string | null;
  hreflang: { lang: string; href: string }[];
  og: Record<string, string>;
  twitter: Record<string, string>;
  schema_types: string[];
  headings: { level: number; text: string }[];
  links: { internal: number; external: number };
  images: { total: number; missing_alt: number };
  word_count: number;
  flesch_reading_ease: number | null;
  performance: {
    nav_type: string | null;
    duration_ms: number | null;
    transfer_size_bytes: number | null;
  };
}

export function runAudit(doc: Document = document): SeoAudit {
  const url = doc.location?.href ?? '';
  const titleEl = doc.querySelector<HTMLTitleElement>('title');
  const titleText = titleEl?.textContent ?? doc.title ?? '';
  const description =
    doc.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null;
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;
  const robots = doc.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content ?? null;

  const hreflang = Array.from(
    doc.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]'),
  ).map((l) => ({ lang: l.hreflang, href: l.href }));

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

  const schema_types = collectSchemaTypes(doc);

  const headings = Array.from(doc.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6'))
    .map((h) => ({ level: Number(h.tagName.slice(1)), text: (h.textContent ?? '').trim() }))
    .slice(0, 200);

  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  })();
  let internal = 0;
  let external = 0;
  doc.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    try {
      const u = new URL(a.href, url);
      if (u.host === host) internal++;
      else external++;
    } catch {
      /* skip mailto: tel: etc. */
    }
  });

  const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>('img'));
  const missing_alt = imgs.filter((i) => !i.alt || i.alt.trim().length === 0).length;

  const text = (doc.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
  const word_count = text ? text.split(/\s+/).length : 0;
  const sentence_count = (text.match(/[.!?]+\s/g) ?? []).length || 1;
  const syllables = countSyllables(text);
  const flesch =
    word_count > 0 && sentence_count > 0
      ? 206.835 -
        1.015 * (word_count / sentence_count) -
        84.6 * (syllables / Math.max(1, word_count))
      : null;

  const nav = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  return {
    url,
    fetched_at: Date.now(),
    title: { value: titleText, length: titleText.length },
    description: { value: description, length: description?.length ?? 0 },
    canonical,
    robots,
    hreflang,
    og,
    twitter,
    schema_types,
    headings,
    links: { internal, external },
    images: { total: imgs.length, missing_alt },
    word_count,
    flesch_reading_ease: flesch ? Math.round(flesch * 100) / 100 : null,
    performance: {
      nav_type: nav?.type ?? null,
      duration_ms: nav?.duration ? Math.round(nav.duration) : null,
      transfer_size_bytes: nav?.transferSize ?? null,
    },
  };
}

function collectSchemaTypes(doc: Document): string[] {
  const types = new Set<string>();
  doc.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]').forEach((s) => {
    try {
      const parsed = JSON.parse(s.textContent ?? '{}');
      walk(parsed, types);
    } catch {
      /* skip */
    }
  });
  doc.querySelectorAll('[itemtype]').forEach((el) => {
    const t = el.getAttribute('itemtype');
    if (t) types.add(t);
  });
  return Array.from(types);
}
function walk(node: unknown, out: Set<string>) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out);
    return;
  }
  const t = (node as Record<string, unknown>)['@type'];
  if (typeof t === 'string') out.add(t);
  else if (Array.isArray(t)) for (const tt of t) if (typeof tt === 'string') out.add(tt);
  for (const v of Object.values(node)) walk(v, out);
}

function countSyllables(text: string): number {
  // Cheap approximation. Decent enough for Flesch.
  const words = text.toLowerCase().split(/\s+/);
  let count = 0;
  for (const w of words) {
    const cleaned = w.replace(/[^a-z]/g, '');
    if (!cleaned) continue;
    const matches = cleaned.match(/[aeiouy]+/g);
    count += Math.max(1, matches ? matches.length : 1);
  }
  return count;
}
