/**
 * Pre-send page-context refresh.
 *
 * Called once per `send()` from the chat hook. Decides — based on the user's
 * settings + whatever's in `useAutoScrapeStore` — whether the page should be
 * re-captured before the message goes out, and how:
 *
 *   - **Already fresh + no full-scroll requested** → no-op.
 *   - **Stale (or no capture)** → fast capture (no scrolling).
 *   - **First submit on a new URL + `autoFullScrollOnFirstSubmit` is on**:
 *     read the user's current scrollY, scroll top→bottom (4s cap, fires
 *     IntersectionObserver / lazy-load callbacks), capture, then restore the
 *     user's original scroll position. Marks the cache `usedFullScroll: true`
 *     so subsequent submits reuse it.
 *
 * The flow runs in the side panel context. Heavy DOM reads happen via
 * `chrome.scripting.executeScript` against the active tab.
 *
 * Returns immediately (synchronously) if there's no active tab, no http(s)
 * URL, or the page is on a known-blocked surface.
 */

import { log } from '@/lib/debug/log';
import { classifyTabUrl } from '@/lib/scrape/capture-error';
import { captureWithFallback } from '@/lib/scrape/capture-with-fallback';
import { scrollToLoadLazy } from '@/lib/scrape/page-ready';
import type { SoupResult } from '@/lib/scrape/pipeline';
import { type AutoScrapeRecord, useAutoScrapeStore } from '@/state/auto-scrape';

const FAST_FRESH_MS = 8_000;

export interface RefreshDecision {
  /** What we did this round — for the caller's logs / UI. */
  action: 'noop' | 'fast' | 'deep';
  /** Final cached record after the refresh (may be the previous one if noop). */
  record: AutoScrapeRecord | null;
  /** Reason — surfaced in debug. */
  reason: string;
}

interface RefreshOptions {
  /** True = perform a full top→bottom scroll on a fresh page before capturing. */
  autoFullScrollOnFirstSubmit: boolean;
}

async function getScrollY(tabId: number): Promise<number | null> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.scrollY,
    });
    const y = first?.result;
    return typeof y === 'number' ? y : null;
  } catch {
    return null;
  }
}

async function setScrollY(tabId: number, y: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (top: number) => window.scrollTo({ top, behavior: 'instant' as ScrollBehavior }),
      args: [y],
    });
  } catch {
    /* best-effort */
  }
}

async function captureSoup(
  tabId: number,
  url: string | null | undefined,
): Promise<SoupResult | null> {
  const r = await captureWithFallback(tabId, url);
  if (r.ok && r.soup) return r.soup;
  // Skip silently when the page is genuinely unreachable (chrome://, file://,
  // extension pages). Warn for any other failure so genuine breakage stays
  // visible.
  if (r.reason !== 'unreachable-url' && r.reason !== 'inject-failed') {
    log.warn('scrape', `captureSoup ${r.reason}`, { detail: r.detail });
  }
  return null;
}

/**
 * Run the right capture for the active tab, given current cache state +
 * settings. Side-effects: updates `useAutoScrapeStore`. Idempotent within a
 * single invocation: if a capture is already in flight, returns the existing
 * record without firing another.
 */
export async function refreshPageContextBeforeSend(
  opts: RefreshOptions,
): Promise<RefreshDecision> {
  const store = useAutoScrapeStore.getState();
  if (store.inFlight) {
    return { action: 'noop', record: store.current, reason: 'capture in flight' };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    return { action: 'noop', record: store.current, reason: 'no active tab' };
  }
  const tabId = tab.id;
  const url = tab.url;
  const urlClass = classifyTabUrl(url);
  if (urlClass.blocked) {
    return { action: 'noop', record: store.current, reason: `blocked url (${urlClass.reason})` };
  }
  // Host access is granted at install via base `<all_urls>` host_permissions.
  // Nothing to gate here; chrome://blocklist URLs are caught by classifyTabUrl
  // above.

  const cur = store.current;
  const haveFresh =
    cur && cur.url === url && Date.now() - cur.capturedAt < FAST_FRESH_MS;
  const haveDeep = cur && cur.url === url && cur.usedFullScroll;
  const wantsDeep = opts.autoFullScrollOnFirstSubmit && !haveDeep;

  if (haveFresh && !wantsDeep) {
    return {
      action: 'noop',
      record: cur,
      reason: `cache fresh (${Math.round((Date.now() - cur.capturedAt) / 1000)}s)`,
    };
  }

  store.setInFlight(true);
  store.setLastError(null);
  try {
    if (wantsDeep) {
      const startY = await getScrollY(tabId);
      log.info('scrape', `pre-send deep capture: scrollY=${startY ?? '?'}`);
      try {
        await scrollToLoadLazy(tabId, { delayMs: 100, maxMs: 4000 });
      } catch (err) {
        log.warn('scrape', 'scrollToLoadLazy failed', err);
      }
      const soup = await captureSoup(tabId, url);
      // Always try to restore — even if capture failed.
      if (typeof startY === 'number') {
        await setScrollY(tabId, startY);
      }
      if (!soup || soup.url !== url) {
        store.setLastError('deep capture failed or URL changed mid-scroll');
        return {
          action: 'noop',
          record: cur,
          reason: 'deep capture failed',
        };
      }
      const record: AutoScrapeRecord = {
        url: soup.url,
        capturedAt: Date.now(),
        usedFullScroll: true,
        initialScrollY: startY ?? null,
        soup,
      };
      store.set(record);
      return { action: 'deep', record, reason: 'fresh deep capture' };
    }

    // Fast path: re-capture without scrolling.
    const soup = await captureSoup(tabId, url);
    if (!soup || soup.url !== url) {
      return { action: 'noop', record: cur, reason: 'fast capture failed' };
    }
    const record: AutoScrapeRecord = {
      // Preserve usedFullScroll if we previously had a deep capture for this URL —
      // we shouldn't downgrade. (Won't happen in practice since haveDeep blocks
      // the wantsDeep branch, but defensive against future tweaks.)
      url: soup.url,
      capturedAt: Date.now(),
      usedFullScroll: !!(cur && cur.url === url && cur.usedFullScroll),
      initialScrollY: cur && cur.url === url ? cur.initialScrollY ?? null : null,
      soup,
    };
    store.set(record);
    return { action: 'fast', record, reason: 'fresh fast capture' };
  } finally {
    store.setInFlight(false);
  }
}
