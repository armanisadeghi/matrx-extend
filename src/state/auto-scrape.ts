/**
 * Background page-context cache.
 *
 * Whenever the active tab finishes loading and settles, we run a fast scrape
 * (no scrolling) and stash the result here keyed by URL. The chat hook reads
 * this on send to inject the page's content/SEO/structured data into the
 * agent's context — without forcing the user to click Scrape first.
 *
 * Optional "deep" upgrade: on first submit, if the user has enabled
 * `autoFullScrollOnFirstSubmit` in the composer settings, we scroll the page
 * top→bottom (triggering lazy-loaders), capture, then restore the user's
 * scroll position. The result replaces the fast capture for that URL and is
 * marked `usedFullScroll: true` so we don't repeat.
 *
 * Only ONE entry is kept (the active URL). When the user navigates, the
 * previous entry is cleared. Memory pressure stays bounded.
 */

import type { SoupResult } from '@/lib/scrape/pipeline';
import { create } from 'zustand';

export interface AutoScrapeRecord {
  url: string;
  /** Shared top-frame identity at capture time; absent legacy records are never live. */
  pageKey?: string;
  /** ms epoch — when the soup was captured. */
  capturedAt: number;
  /**
   * True if we ran top→bottom scroll before capturing (catches lazy loaders,
   * infinite-scroll content). False = "fast" capture of the visible DOM.
   */
  usedFullScroll: boolean;
  /**
   * If we did a full scroll, this is the user's scrollY at the moment we
   * intercepted, so a future tool can restore it. Null otherwise.
   */
  initialScrollY?: number | null;
  /** The page snapshot. */
  soup: SoupResult;
}

interface AutoScrapeState {
  /** Currently-cached scrape (for the active URL only). */
  current: AutoScrapeRecord | null;
  /** True while a background capture is in flight. */
  inFlight: boolean;
  /** Last error from a background capture, if any. */
  lastError: string | null;
  /** The page and run currently allowed to change shared capture status. */
  captureOwner: { pageKey: string; run: number } | null;
  beginCapture: (pageKey: string) => number;
  ownsCapture: (pageKey: string, run: number) => boolean;
  finishCapture: (pageKey: string, run: number) => void;
  setCaptureError: (pageKey: string, run: number, error: string | null) => void;
  cancelCaptureUnlessPage: (pageKey: string | null) => void;
  set: (r: AutoScrapeRecord | null) => void;
  setInFlight: (b: boolean) => void;
  setLastError: (s: string | null) => void;
  /**
   * Clear the cache when the user has clearly moved on — different URL with
   * no fresh capture, or auto-capture disabled in settings.
   */
  clear: () => void;
}

let nextCaptureRun = 0;
export const useAutoScrapeStore = create<AutoScrapeState>((set, get) => ({
  current: null,
  inFlight: false,
  lastError: null,
  captureOwner: null,
  beginCapture: (pageKey) => {
    const run = ++nextCaptureRun;
    set({ captureOwner: { pageKey, run }, inFlight: true, lastError: null });
    return run;
  },
  ownsCapture: (pageKey, run) =>
    get().captureOwner?.pageKey === pageKey && get().captureOwner?.run === run,
  finishCapture: (pageKey, run) => {
    if (get().ownsCapture(pageKey, run)) set({ captureOwner: null, inFlight: false });
  },
  setCaptureError: (pageKey, run, lastError) => {
    if (get().ownsCapture(pageKey, run)) set({ lastError });
  },
  cancelCaptureUnlessPage: (pageKey) => {
    if (get().captureOwner && get().captureOwner?.pageKey !== pageKey) {
      set({ captureOwner: null, inFlight: false, lastError: null });
    }
  },
  set: (current) => set({ current, lastError: null }),
  setInFlight: (inFlight) => set({ inFlight }),
  setLastError: (lastError) => set({ lastError }),
  clear: () => set({ current: null, lastError: null }),
}));

/** True if we have a fresh capture matching the URL within the last `maxAgeMs`. */
export function hasFreshCapture(
  record: AutoScrapeRecord | null,
  url: string,
  maxAgeMs = 30_000,
): boolean {
  if (!record) return false;
  if (record.url !== url) return false;
  if (Date.now() - record.capturedAt > maxAgeMs) return false;
  return true;
}
