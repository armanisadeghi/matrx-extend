/**
 * Scroll-and-stitch full-page capture.
 *
 * Used by `take_screenshot` when `mode: 'full_page'`. Works without the
 * `debugger` permission — the only cost is the page's scroll position
 * being briefly visible to the user during capture.
 *
 * Trade-offs vs `cdp_full_page_screenshot`:
 *   - No `debugger` perm needed → works for non-admin users.
 *   - Slower: `chrome.tabs.captureVisibleTab` is rate-limited
 *     (default ~2 calls/sec), so a 10-screen page takes ~5 seconds.
 *   - position:sticky / position:fixed elements appear on every tile
 *     (a known pitfall — not addressed here).
 *   - Pages whose layout reflows on scroll (collapsing headers,
 *     virtualized lists) may produce visible seams.
 *
 * The helper restores the user's original scroll position even when a
 * tile capture throws.
 */

interface PageMetrics {
  scrollX: number;
  scrollY: number;
  innerWidth: number;
  innerHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  devicePixelRatio: number;
}

const TILE_SETTLE_MS = 250;
const POST_TILE_DELAY_MS = 350;
const RETRY_DELAY_MS = 600;
const MAX_TILES = 30;

async function getPageMetrics(tabId: number): Promise<PageMetrics> {
  const [first] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
      scrollHeight: Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
      ),
      devicePixelRatio: window.devicePixelRatio || 1,
    }),
  });
  if (!first?.result) throw new Error('Failed to read page metrics');
  return first.result as PageMetrics;
}

async function setScroll(tabId: number, x: number, y: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (xv: number, yv: number) => {
      window.scrollTo({ left: xv, top: yv, behavior: 'instant' as ScrollBehavior });
    },
    args: [x, y],
  });
}

export interface FullPageCaptureResult {
  /** Stitched full-page PNG as a data URL (consumed by processScreenshot). */
  dataUrl: string;
  /** Final stitched image dimensions in image pixels (× devicePixelRatio). */
  width: number;
  height: number;
  /** Source CSS-pixel dimensions of the page content. */
  cssWidth: number;
  cssHeight: number;
  /** Number of tiles captured. */
  tileCount: number;
  /** True when the page was taller than MAX_TILES screens — bottom is cropped. */
  truncated: boolean;
}

export async function captureFullPage(tab: chrome.tabs.Tab): Promise<FullPageCaptureResult> {
  if (tab.id == null || tab.windowId == null) {
    throw new Error('Tab missing id/windowId');
  }
  const tabId = tab.id;
  const winId = tab.windowId;

  const metrics = await getPageMetrics(tabId);
  const {
    scrollX: origX,
    scrollY: origY,
    innerHeight,
    scrollHeight,
    devicePixelRatio: dpr,
  } = metrics;

  const totalH = Math.max(scrollHeight, innerHeight);
  const rawTiles = Math.max(1, Math.ceil(totalH / innerHeight));
  const tileCount = Math.min(rawTiles, MAX_TILES);
  const truncated = rawTiles > MAX_TILES;
  const effectiveTotalH = truncated ? tileCount * innerHeight : totalH;

  const captures: Array<{ y: number; bitmap: ImageBitmap }> = [];
  let firstTileWidth = 0;

  try {
    for (let i = 0; i < tileCount; i++) {
      // Final tile aligns to the bottom of the effective range so the
      // last viewport always lands flush — avoids a partial unscrolled
      // tail tile that overlaps the previous tile awkwardly.
      const targetY =
        i === tileCount - 1 ? Math.max(0, effectiveTotalH - innerHeight) : i * innerHeight;
      await setScroll(tabId, origX, targetY);
      await new Promise((r) => setTimeout(r, TILE_SETTLE_MS));

      let dataUrl: string;
      try {
        dataUrl = await chrome.tabs.captureVisibleTab(winId, { format: 'png' });
      } catch {
        // Almost always the captureVisibleTab rate limit. Wait longer and retry once.
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        dataUrl = await chrome.tabs.captureVisibleTab(winId, { format: 'png' });
      }
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const bitmap = await createImageBitmap(blob);
      if (i === 0) firstTileWidth = bitmap.width;
      captures.push({ y: targetY, bitmap });

      if (i < tileCount - 1) {
        await new Promise((r) => setTimeout(r, POST_TILE_DELAY_MS));
      }
    }
  } finally {
    try {
      await setScroll(tabId, origX, origY);
    } catch {
      /* best-effort restore */
    }
  }

  if (captures.length === 0) throw new Error('No tiles captured');

  const stitchedW = firstTileWidth;
  const stitchedH = Math.round(effectiveTotalH * dpr);
  const canvas = new OffscreenCanvas(stitchedW, stitchedH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  for (const cap of captures) {
    ctx.drawImage(cap.bitmap, 0, Math.round(cap.y * dpr));
    cap.bitmap.close();
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  const base64 = btoa(bin);
  return {
    dataUrl: `data:image/png;base64,${base64}`,
    width: stitchedW,
    height: stitchedH,
    cssWidth: metrics.innerWidth,
    cssHeight: effectiveTotalH,
    tileCount: captures.length,
    truncated,
  };
}
