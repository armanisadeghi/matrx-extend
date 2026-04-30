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
}

const abs = (raw: string): string | null => {
  try {
    return new URL(raw, document.baseURI).toString();
  } catch {
    return null;
  }
};

export function collectImages(): CollectedImage[] {
  const out: CollectedImage[] = [];
  document.querySelectorAll('img').forEach((img) => {
    const src = img.currentSrc || img.src;
    const resolved = src ? abs(src) : null;
    if (!resolved) return;
    out.push({
      src: resolved,
      alt: img.alt || null,
      width: img.naturalWidth || img.width || null,
      height: img.naturalHeight || img.height || null,
    });
  });
  // Background images via inline style — high-cardinality; keep the simple case.
  document.querySelectorAll('[style*="background-image"]').forEach((el) => {
    const style = (el as HTMLElement).style.backgroundImage;
    const m = style.match(/url\((['"]?)([^'")]+)\1\)/);
    if (!m) return;
    const url = m[2];
    if (!url) return;
    const resolved = abs(url);
    if (!resolved) return;
    out.push({ src: resolved, alt: null, width: null, height: null });
  });
  return dedupeBy(out, (i) => i.src);
}

export function collectVideos(): CollectedVideo[] {
  const out: CollectedVideo[] = [];
  document.querySelectorAll('video').forEach((v) => {
    const src = v.currentSrc || v.src || v.querySelector('source')?.src || '';
    const resolved = src ? abs(src) : null;
    if (!resolved) return;
    out.push({
      src: resolved,
      poster: v.poster ? abs(v.poster) : null,
      duration: Number.isFinite(v.duration) ? v.duration : null,
    });
  });
  document.querySelectorAll('iframe[src*="youtube"], iframe[src*="vimeo"]').forEach((f) => {
    const src = (f as HTMLIFrameElement).src;
    const resolved = src ? abs(src) : null;
    if (!resolved) return;
    out.push({ src: resolved, poster: null, duration: null });
  });
  return dedupeBy(out, (v) => v.src);
}

export function collectAudio(): CollectedAudio[] {
  const out: CollectedAudio[] = [];
  document.querySelectorAll('audio').forEach((a) => {
    const src = a.currentSrc || a.src || a.querySelector('source')?.src || '';
    const resolved = src ? abs(src) : null;
    if (!resolved) return;
    out.push({ src: resolved, type: a.querySelector('source')?.type ?? null });
  });
  return dedupeBy(out, (a) => a.src);
}

export function collectLinks(): CollectedLink[] {
  const out: CollectedLink[] = [];
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = abs(a.href);
    if (!href) return;
    out.push({
      href,
      text: (a.textContent ?? '').trim().slice(0, 240),
      rel: a.rel || null,
    });
  });
  return dedupeBy(out, (l) => `${l.href}|${l.text}`);
}

export function collectMetadata(): CollectedMetadata {
  const og: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  document.querySelectorAll<HTMLMetaElement>('meta').forEach((m) => {
    const property = m.getAttribute('property') ?? '';
    const name = m.getAttribute('name') ?? '';
    const content = m.getAttribute('content') ?? '';
    if (!content) return;
    if (property.startsWith('og:')) og[property] = content;
    if (name.startsWith('twitter:')) twitter[name] = content;
  });
  const schemaTypes = collectSchemaTypes();
  const description =
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null;
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;
  return {
    title: document.title,
    description,
    canonical,
    lang: document.documentElement.lang || null,
    og,
    twitter,
    schemaTypes,
  };
}

export function collectJsonLd(): unknown[] {
  const out: unknown[] = [];
  document
    .querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')
    .forEach((s) => {
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

function collectSchemaTypes(): string[] {
  const types = new Set<string>();
  for (const block of collectJsonLd()) {
    walkType(block, types);
  }
  document.querySelectorAll('[itemtype]').forEach((el) => {
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
