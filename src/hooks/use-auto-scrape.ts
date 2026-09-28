/** Background capture follows the shared top-frame identity, including same-URL reloads. */
import { isCurrentPageIdentity, useActiveTab } from '@/hooks/use-active-tab';
import { captureWithFallback } from '@/lib/scrape/capture-with-fallback';
import { scrollToLoadLazy } from '@/lib/scrape/page-ready';
import { useAutoScrapeStore } from '@/state/auto-scrape';
import { useSettingsStore } from '@/state/settings';
import { useEffect, useRef } from 'react';

const SETTLE_DELAY_MS = 600;
const FRESH_THRESHOLD_MS = 30_000;

export function useAutoScrape(): void {
  const enabled = useSettingsStore((s) => s.scrapeAutoOnLoad);
  const tab = useActiveTab();
  const runRef = useRef(0);

  useEffect(() => {
    const run = ++runRef.current;
    const store = useAutoScrapeStore.getState();
    if (store.current?.pageKey !== tab.pageKey) store.clear();
    if (!enabled || !tab.id || !tab.url || !tab.documentId || !tab.pageKey || !/^https?:\/\//i.test(tab.url)) {
      store.setInFlight(false);
      return;
    }
    if (store.current?.pageKey === tab.pageKey && Date.now() - store.current.capturedAt < FRESH_THRESHOLD_MS) return;
    const tabId = tab.id;
    const url = tab.url;
    const documentId = tab.documentId;
    const pageKey = tab.pageKey;
    const timer = setTimeout(() => {
      if (run !== runRef.current || !isCurrentPageIdentity(pageKey)) return;
      void (async () => {
        const deep = useSettingsStore.getState().scrapeAutoMode === 'scroll-capture';
        useAutoScrapeStore.getState().setInFlight(true);
        useAutoScrapeStore.getState().setLastError(null);
        try {
          if (deep) await scrollToLoadLazy(tabId, { documentId });
          if (run !== runRef.current || !isCurrentPageIdentity(pageKey)) return;
          const result = await captureWithFallback(tabId, url, documentId);
          if (run !== runRef.current || !isCurrentPageIdentity(pageKey)) return;
          if (!result.ok || !result.soup) {
            if (result.reason !== 'unreachable-url' && result.reason !== 'inject-failed') {
              useAutoScrapeStore.getState().setLastError(result.detail ?? result.reason ?? 'Auto capture failed');
            }
            return;
          }
          if (result.soup.url !== url) return;
          useAutoScrapeStore.getState().set({
            url,
            pageKey,
            capturedAt: Date.now(),
            usedFullScroll: deep,
            soup: result.soup,
          });
        } catch (error) {
          if (run === runRef.current && isCurrentPageIdentity(pageKey)) {
            useAutoScrapeStore.getState().setLastError(error instanceof Error ? error.message : 'Auto capture failed');
          }
        } finally {
          if (run === runRef.current) useAutoScrapeStore.getState().setInFlight(false);
        }
      })();
    }, SETTLE_DELAY_MS);
    return () => {
      ++runRef.current;
      clearTimeout(timer);
    };
  }, [enabled, tab.pageKey, tab.id, tab.url, tab.documentId]);
}
