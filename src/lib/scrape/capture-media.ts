/**
 * Collect browser-measured image data from a tab at capture time, sent
 * alongside the raw HTML to /extension-content.
 *
 * The research server overlays each image's real `naturalWidth`/`naturalHeight`
 * onto its HTML-parsed images, so the media gallery gets EXACT dimensions
 * without re-downloading every image server-side. The browser already knows
 * these numbers for free — we were throwing them away. See the server contract
 * in aidream/research/media/FEATURE.md.
 *
 * This mirrors `collectImages()` in collectors.ts but is inlined, because
 * `chrome.scripting.executeScript` cannot close over module imports — the
 * injected `func` is serialized and runs in the page's own world.
 *
 * Best-effort: any failure returns [] (the server still resolves dimensions
 * via HTML attrs / URL patterns / a byte-probe without this).
 */

import { log } from '@/lib/debug/log';

export interface CaptureImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export async function getCaptureImages(tabId: number): Promise<CaptureImage[]> {
  const start = performance.now();
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const abs = (raw: string): string | null => {
          try {
            return new URL(raw, document.baseURI).toString();
          } catch {
            return null;
          }
        };
        const out: {
          src: string;
          alt: string | null;
          width: number | null;
          height: number | null;
        }[] = [];
        const seen = new Set<string>();
        document.querySelectorAll('img').forEach((img) => {
          // currentSrc = the URL the browser actually loaded (post-lazy-load,
          // post-srcset selection); naturalWidth/Height = true intrinsic size.
          const raw = img.currentSrc || img.src;
          const src = raw ? abs(raw) : null;
          if (!src || seen.has(src)) return;
          seen.add(src);
          out.push({
            src,
            alt: img.alt || null,
            width: img.naturalWidth || img.width || null,
            height: img.naturalHeight || img.height || null,
          });
        });
        return out;
      },
    });
    const images = (result?.[0]?.result as CaptureImage[] | undefined) ?? [];
    const ms = Math.round(performance.now() - start);
    log.success('scrape', `getCaptureImages tab=${tabId} ${images.length} images (${ms}ms)`);
    return images;
  } catch (err) {
    log.error('scrape', `getCaptureImages tab=${tabId} failed`, err);
    return [];
  }
}
