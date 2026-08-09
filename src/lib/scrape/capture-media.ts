/**
 * Collect browser-measured page data from a tab at capture time, sent alongside
 * the raw HTML to /extension-content.
 *
 * The research server already parses `<video>`/`<audio>`/iframe players, PDF/doc
 * links, JSON-LD, and image dimensions out of the raw HTML we send. But the
 * server only sees the HTML — it can't see what the page's JS injected after
 * load, nor resolve `currentSrc` / `naturalWidth`/`naturalHeight`. This runs in
 * the LIVE DOM and hands the server the extras it can't compute:
 *   - images  — `currentSrc` (post-lazy-load, post-srcset) + true intrinsic size.
 *               Overlaid onto the server's HTML-parsed images by exact `src`, so
 *               the gallery gets exact dims without re-downloading. (Shipped first
 *               in RESEARCH_MEDIA_CAPTURE.md.)
 *   - media   — JS-injected `<video>`/`<audio>` + YouTube/Vimeo iframes the HTML
 *               scan misses.
 *   - structured — clean OpenGraph/Twitter metadata + parsed JSON-LD blocks.
 * See docs/RESEARCH_ENRICHMENT.md §4.
 *
 * Verified against the live server 2026-08-09 (`research/multisource.py`
 * `process_extension_content`) — this is still an OVERLAY, not a second parse:
 *   - `images` → `apply_measured_dimensions(extracted_images, measured_images)`
 *     merges width/height onto the server's own HTML-parsed images BY EXACT
 *     `src`. Ours never replaces the server's list.
 *   - `videos`/`audio` → appended to `extracted_videos`/`extracted_audios` and
 *     run through the same `classify_resource_url` + `collect_page_resources`
 *     writer as the HTML-parsed media. Additive only.
 *   - `structured` → consumed narrowly for `published_at`/`modified_at` and the
 *     source title/description. The server re-parses JSON-LD from the same HTML
 *     regardless, so our `jsonLd` is redundant for a static page — it is kept
 *     because the live DOM is the ONLY place a JS-injected `<script
 *     type="application/ld+json">` (Next.js/Nuxt hydration) exists at all, which
 *     is exactly the "what the DOM uniquely knows" case. It is not re-derivation.
 * Known gap: `_structured_dates` prefers `metadata.published_time` /
 * `metadata.modified_time` and only falls back to JSON-LD. We send neither —
 * `article:published_time` is a `property=` meta that does not start with `og:`,
 * so the filter below drops it. Tracked in docs/KNOWN_ISSUES.md § Research capture.
 *
 * This INLINES the logic from collectors.ts (collectImages/Videos/Audio/Metadata/
 * JsonLd) into a single `chrome.scripting.executeScript` injection — one
 * round-trip for everything. The inline copy is unavoidable: the injected `func`
 * is serialized and runs in the page's own world, so it cannot close over module
 * imports. The TS types are imported from collectors.ts so the two can't drift.
 *
 * Best-effort: any failure returns empty data (the server still resolves
 * everything from the HTML it already has — this is a pure enhancement).
 */

import { log } from '@/lib/debug/log';
import type {
  CollectedAudio,
  CollectedImage,
  CollectedMetadata,
  CollectedVideo,
} from '@/lib/scrape/collectors';

export interface CapturePageData {
  images: CollectedImage[];
  videos: CollectedVideo[];
  audio: CollectedAudio[];
  /** Null only when the injection failed entirely. */
  metadata: CollectedMetadata | null;
  jsonLd: unknown[];
}

const EMPTY: CapturePageData = {
  images: [],
  videos: [],
  audio: [],
  metadata: null,
  jsonLd: [],
};

export async function getCapturePageData(tabId: number): Promise<CapturePageData> {
  const start = performance.now();
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectPageDataInPage,
    });
    const data = (result?.[0]?.result as CapturePageData | undefined) ?? EMPTY;
    const ms = Math.round(performance.now() - start);
    log.success(
      'scrape',
      `getCapturePageData tab=${tabId} ${data.images.length}img ${data.videos.length}vid ${data.audio.length}aud ${data.jsonLd.length}jsonld (${ms}ms)`,
    );
    return data;
  } catch (err) {
    log.error('scrape', `getCapturePageData tab=${tabId} failed`, err);
    return EMPTY;
  }
}

/**
 * Self-contained DOM scrape — runs in the page's own world. MUST NOT reference
 * anything outside its own body (no imports, no closures). Mirrors collectors.ts.
 */
function collectPageDataInPage(): CapturePageData {
  const abs = (raw: string): string | null => {
    try {
      return new URL(raw, document.baseURI).toString();
    } catch {
      return null;
    }
  };
  const dedupeBy = <T>(arr: T[], keyFn: (x: T) => string): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of arr) {
      const k = keyFn(item);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  };

  // ── images ──────────────────────────────────────────────────────────────
  const images: CollectedImage[] = [];
  document.querySelectorAll('img').forEach((img) => {
    const raw = img.currentSrc || img.src;
    const src = raw ? abs(raw) : null;
    if (!src) return;
    images.push({
      src,
      alt: img.alt || null,
      width: img.naturalWidth || img.width || null,
      height: img.naturalHeight || img.height || null,
    });
  });
  document.querySelectorAll('[style*="background-image"]').forEach((el) => {
    const style = (el as HTMLElement).style.backgroundImage;
    const m = style.match(/url\((['"]?)([^'")]+)\1\)/);
    const url = m?.[2];
    if (!url) return;
    const resolved = abs(url);
    if (!resolved) return;
    images.push({ src: resolved, alt: null, width: null, height: null });
  });

  // ── videos ──────────────────────────────────────────────────────────────
  const videos: CollectedVideo[] = [];
  document.querySelectorAll('video').forEach((v) => {
    const raw = v.currentSrc || v.src || v.querySelector('source')?.src || '';
    const src = raw ? abs(raw) : null;
    if (!src) return;
    videos.push({
      src,
      poster: v.poster ? abs(v.poster) : null,
      duration: Number.isFinite(v.duration) ? v.duration : null,
    });
  });
  document.querySelectorAll('iframe[src*="youtube"], iframe[src*="vimeo"]').forEach((f) => {
    const raw = (f as HTMLIFrameElement).src;
    const src = raw ? abs(raw) : null;
    if (!src) return;
    videos.push({ src, poster: null, duration: null });
  });

  // ── audio ───────────────────────────────────────────────────────────────
  const audio: CollectedAudio[] = [];
  document.querySelectorAll('audio').forEach((a) => {
    const raw = a.currentSrc || a.src || a.querySelector('source')?.src || '';
    const src = raw ? abs(raw) : null;
    if (!src) return;
    audio.push({ src, type: a.querySelector('source')?.type ?? null });
  });

  // ── jsonLd + schema types ────────────────────────────────────────────────
  const jsonLd: unknown[] = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    const text = s.textContent?.trim();
    if (!text) return;
    try {
      jsonLd.push(JSON.parse(text));
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  const schemaTypeSet = new Set<string>();
  const walkType = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) walkType(n);
      return;
    }
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string') schemaTypeSet.add(t);
    else if (Array.isArray(t))
      for (const tt of t) if (typeof tt === 'string') schemaTypeSet.add(tt);
    for (const val of Object.values(obj)) walkType(val);
  };
  for (const block of jsonLd) walkType(block);
  document.querySelectorAll('[itemtype]').forEach((el) => {
    const t = el.getAttribute('itemtype');
    if (t) schemaTypeSet.add(t);
  });

  // ── metadata (og / twitter / canonical / lang) ───────────────────────────
  const og: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  document.querySelectorAll('meta').forEach((m) => {
    const property = m.getAttribute('property') ?? '';
    const name = m.getAttribute('name') ?? '';
    const content = m.getAttribute('content') ?? '';
    if (!content) return;
    if (property.startsWith('og:')) og[property] = content;
    if (name.startsWith('twitter:')) twitter[name] = content;
  });
  const metadata: CollectedMetadata = {
    title: document.title,
    description:
      document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null,
    canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null,
    lang: document.documentElement.lang || null,
    og,
    twitter,
    schemaTypes: Array.from(schemaTypeSet),
  };

  return {
    images: dedupeBy(images, (i) => i.src),
    videos: dedupeBy(videos, (v) => v.src),
    audio: dedupeBy(audio, (a) => a.src),
    metadata,
    jsonLd,
  };
}
