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

import { type ScreenshotDocument, assertScreenshotDocument, captureForDocument } from './document';

interface PageMetrics {
  scrollX: number;
  scrollY: number;
  innerWidth: number;
  innerHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  viewportHeight: number;
  scrollPath: number[] | null;
  clip: { x: number; y: number; width: number; height: number } | null;
}

const TILE_SETTLE_MS = 250;
const POST_TILE_DELAY_MS = 350;
const RETRY_DELAY_MS = 600;
const MAX_TILES = 30;

async function getPageMetrics(tabId: number, documentId: string): Promise<PageMetrics> {
  const [first] = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [documentId] },
    func: () => {
      const viewportHeight = window.innerHeight;
      const rootHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
      );
      let pane: HTMLElement | null = null;
      let area = 0;
      // App shells often scroll their main pane while the document itself fits the viewport.
      if (rootHeight <= viewportHeight + 1) {
        for (const element of document.querySelectorAll<HTMLElement>('*')) {
          if (element.scrollHeight <= element.clientHeight || element.clientHeight === 0) continue;
          const overflow = getComputedStyle(element).overflowY;
          if (!['auto', 'scroll', 'overlay'].includes(overflow)) continue;
          const rect = element.getBoundingClientRect();
          if (
            rect.top < 0 ||
            rect.bottom > viewportHeight ||
            rect.left < 0 ||
            rect.right > window.innerWidth
          )
            continue;
          const visibleArea = rect.width * rect.height;
          if (visibleArea > area) {
            pane = element;
            area = visibleArea;
          }
        }
      }
      const scrollPath: number[] | null = pane ? [] : null;
      if (pane && scrollPath) {
        let node: Element = pane;
        while (node !== document.documentElement) {
          const parent = node.parentElement;
          if (!parent) throw new Error('The scrolling pane was removed during screenshot capture.');
          scrollPath.unshift(Array.from(parent.children).indexOf(node));
          node = parent;
        }
      }
      const rect = pane?.getBoundingClientRect();
      return {
        scrollX: pane?.scrollLeft ?? window.scrollX,
        scrollY: pane?.scrollTop ?? window.scrollY,
        innerWidth: window.innerWidth,
        innerHeight: pane?.clientHeight ?? viewportHeight,
        scrollWidth: Math.max(
          document.documentElement.scrollWidth,
          document.body?.scrollWidth ?? 0,
        ),
        scrollHeight: pane?.scrollHeight ?? rootHeight,
        viewportHeight,
        scrollPath,
        clip:
          pane && rect
            ? {
                x: rect.left + pane.clientLeft,
                y: rect.top + pane.clientTop,
                width: pane.clientWidth,
                height: pane.clientHeight,
              }
            : null,
      };
    },
  });
  if (!first?.result) throw new Error('Failed to read page metrics');
  return first.result as PageMetrics;
}

async function setScroll(
  tabId: number,
  documentId: string,
  path: number[] | null,
  x: number,
  y: number,
): Promise<number> {
  const [first] = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [documentId] },
    func: (indices: number[] | null, xv: number, yv: number) => {
      if (indices === null) {
        window.scrollTo({ left: xv, top: yv, behavior: 'instant' as ScrollBehavior });
        return window.scrollY;
      }
      let element: Element | undefined = document.documentElement;
      for (const index of indices) element = element?.children[index];
      if (!(element instanceof HTMLElement))
        throw new Error('The scrolling pane changed during screenshot capture.');
      element.scrollTo({ left: xv, top: yv, behavior: 'instant' as ScrollBehavior });
      return element.scrollTop;
    },
    args: [path, x, y],
  });
  if (typeof first?.result !== 'number')
    throw new Error('Failed to scroll the page for screenshot capture.');
  return first.result;
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

export async function captureFullPage(
  document: ScreenshotDocument,
): Promise<FullPageCaptureResult> {
  const { tabId, windowId: winId, documentId } = document;

  await assertScreenshotDocument(document);
  const metrics = await getPageMetrics(tabId, documentId);
  const {
    scrollX: origX,
    scrollY: origY,
    innerHeight,
    scrollHeight,
    scrollPath,
    viewportHeight,
    clip,
  } = metrics;

  const totalH = Math.max(scrollHeight, innerHeight);
  const rawTiles = Math.max(1, Math.ceil(totalH / innerHeight));
  const tileCount = Math.min(rawTiles, MAX_TILES);
  const truncated = rawTiles > MAX_TILES;
  const effectiveTotalH = truncated ? tileCount * innerHeight : totalH;

  const captures: Array<{ y: number; bitmap: ImageBitmap }> = [];
  let firstTileWidth = 0;
  let imageScale = 1;

  try {
    for (let i = 0; i < tileCount; i++) {
      // Final tile aligns to the bottom of the effective range so the
      // last viewport always lands flush — avoids a partial unscrolled
      // tail tile that overlaps the previous tile awkwardly.
      const targetY =
        i === tileCount - 1 ? Math.max(0, effectiveTotalH - innerHeight) : i * innerHeight;
      const dataUrl = await captureForDocument(document, async () => {
        const actualY = await setScroll(tabId, documentId, scrollPath, origX, targetY);
        if (Math.abs(actualY - targetY) > 1) {
          throw new Error('The page did not scroll to the requested screenshot position.');
        }
        await new Promise((r) => setTimeout(r, TILE_SETTLE_MS));
        try {
          return await chrome.tabs.captureVisibleTab(winId, { format: 'png' });
        } catch {
          // Almost always the captureVisibleTab rate limit. Wait longer and retry once.
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          await assertScreenshotDocument(document);
          return chrome.tabs.captureVisibleTab(winId, { format: 'png' });
        }
      });
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const bitmap = await createImageBitmap(blob);
      if (i === 0) {
        firstTileWidth = bitmap.width;
        imageScale = bitmap.height / viewportHeight;
      }
      captures.push({ y: targetY, bitmap });

      if (i < tileCount - 1) {
        await new Promise((r) => setTimeout(r, POST_TILE_DELAY_MS));
      }
    }
  } catch (error) {
    for (const capture of captures) capture.bitmap.close();
    throw error;
  } finally {
    try {
      await setScroll(tabId, documentId, scrollPath, origX, origY);
    } catch {
      /* best-effort restore */
    }
  }

  if (captures.length === 0) throw new Error('No tiles captured');

  const stitchedW = firstTileWidth;
  const cssHeight = viewportHeight + effectiveTotalH - innerHeight;
  const stitchedH = Math.round(cssHeight * imageScale);
  const canvas = new OffscreenCanvas(stitchedW, stitchedH);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    for (const capture of captures) capture.bitmap.close();
    throw new Error('OffscreenCanvas 2d context unavailable');
  }
  for (const cap of captures) {
    if (clip) {
      // Keep the surrounding app chrome once; only the moving pane is repeated.
      if (cap.y === 0) ctx.drawImage(cap.bitmap, 0, 0);
      const sx = Math.round(clip.x * imageScale);
      const sy = Math.round(clip.y * imageScale);
      const sw = Math.round(clip.width * imageScale);
      const sh = Math.round(clip.height * imageScale);
      ctx.drawImage(
        cap.bitmap,
        sx,
        sy,
        sw,
        sh,
        sx,
        Math.round((clip.y + cap.y) * imageScale),
        sw,
        sh,
      );
      if (cap === captures[captures.length - 1]) {
        const footerY = Math.round((clip.y + clip.height) * imageScale);
        const footerH = cap.bitmap.height - footerY;
        if (footerH > 0)
          ctx.drawImage(
            cap.bitmap,
            0,
            footerY,
            stitchedW,
            footerH,
            0,
            stitchedH - footerH,
            stitchedW,
            footerH,
          );
      }
    } else {
      ctx.drawImage(cap.bitmap, 0, Math.round(cap.y * imageScale));
    }
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
    cssHeight,
    tileCount: captures.length,
    truncated,
  };
}
