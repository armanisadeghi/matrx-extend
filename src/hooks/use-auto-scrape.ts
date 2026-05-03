/**
 * Auto-scrape on page load.
 *
 * Mounts at the root of the side panel. Watches the active tab; whenever a
 * page finishes loading (or the user switches to a tab where we don't have
 * a fresh capture), we wait a short settle delay then run a fast scrape and
 * stash it in `useAutoScrapeStore`. The chat hook reads from there on send.
 *
 * Behavior:
 *   - Skips: chrome:// pages, non-http(s) URLs, the same URL we already have
 *     a fresh capture for.
 *   - One run at a time (in-flight flag in the store).
 *   - 600ms settle after status='complete' before firing.
 *   - Manual scrapes from the Scrape tab take priority — we don't overwrite
 *     a deep capture with a fast one for the same URL.
 *
 * Disabled when `useSettingsStore.scrapeAutoOnLoad` is false.
 */

import { CHANNELS } from '@/lib/messaging/schemas';
import type { SoupResult } from '@/lib/scrape/pipeline';
import { useAutoScrapeStore } from '@/state/auto-scrape';
import { useSettingsStore } from '@/state/settings';
import { useEffect, useRef } from 'react';

const SETTLE_DELAY_MS = 600;
const FRESH_THRESHOLD_MS = 30_000;
const ALLOWED_URL_RE = /^https?:\/\//i;

export function useAutoScrape(): void {
  const enabled = useSettingsStore((s) => s.scrapeAutoOnLoad);
  const setRecord = useAutoScrapeStore((s) => s.set);
  const setInFlight = useAutoScrapeStore((s) => s.setInFlight);
  const setError = useAutoScrapeStore((s) => s.setLastError);
  const lastFiredRef = useRef<{ tabId: number; url: string } | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;

    // Schedule a capture for a tab once it's "complete". Debounced — if a
    // newer event arrives during the settle window, we replace the timer.
    function scheduleCapture(tab: chrome.tabs.Tab) {
      if (!tab.id || !tab.url || !ALLOWED_URL_RE.test(tab.url)) return;
      if (tab.status !== 'complete') return;
      const tabId = tab.id;
      const url = tab.url;
      const last = lastFiredRef.current;
      // Skip if this is the same tab+url we just captured.
      if (last && last.tabId === tabId && last.url === url) {
        const cur = useAutoScrapeStore.getState().current;
        if (cur && cur.url === url && Date.now() - cur.capturedAt < FRESH_THRESHOLD_MS) {
          return;
        }
      }
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        void runCapture(tabId, url);
      }, SETTLE_DELAY_MS);
    }

    async function runCapture(tabId: number, url: string) {
      const store = useAutoScrapeStore.getState();
      // If we already have a fresh capture for this URL, leave it alone —
      // especially important for full-scroll captures we want to preserve.
      if (store.current && store.current.url === url) {
        const age = Date.now() - store.current.capturedAt;
        if (age < FRESH_THRESHOLD_MS) return;
      }
      if (store.inFlight) return;
      setInFlight(true);
      setError(null);
      try {
        const result = (await chrome.tabs.sendMessage(tabId, {
          __matrx: true,
          kind: CHANNELS.SCRAPE_CAPTURE,
          payload: { options: {} },
        })) as SoupResult | { __error: string } | undefined;
        if (!result) {
          setError('No response from content script');
          return;
        }
        if ('__error' in result) {
          setError(result.__error);
          return;
        }
        if (result.url !== url) {
          // Page navigated mid-capture; drop and let the next event re-fire.
          return;
        }
        setRecord({
          url: result.url,
          capturedAt: Date.now(),
          usedFullScroll: false,
          soup: result,
        });
        lastFiredRef.current = { tabId, url };
      } catch (err) {
        setError((err as Error).message ?? 'auto-scrape failed');
      } finally {
        setInFlight(false);
      }
    }

    function onUpdated(
      tabId: number,
      info: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) {
      if (info.status !== 'complete' && info.url == null) return;
      if (!tab.active) return;
      scheduleCapture(tab);
    }

    function onActivated() {
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab) scheduleCapture(tab);
      });
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onActivated.addListener(onActivated);
    // Initial fire on mount.
    onActivated();
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onActivated.removeListener(onActivated);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, [enabled, setRecord, setInFlight, setError]);
}
