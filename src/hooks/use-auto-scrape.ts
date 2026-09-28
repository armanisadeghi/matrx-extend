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
  const captureOwnerRef = useRef<{ pageKey: string; run: number } | null>(null);

  useEffect(() => {
    const run = ++runRef.current;
    const store = useAutoScrapeStore.getState();
    if (store.current?.pageKey !== tab.pageKey) store.clear();
    store.cancelCaptureUnlessPage(tab.pageKey);
    if (
      !enabled ||
      !tab.id ||
      !tab.url ||
      !tab.documentId ||
      !tab.pageKey ||
      !/^https?:\/\//i.test(tab.url)
    ) {
      return;
    }
    if (
      store.current?.pageKey === tab.pageKey &&
      Date.now() - store.current.capturedAt < FRESH_THRESHOLD_MS
    )
      return;
    const tabId = tab.id;
    const url = tab.url;
    const documentId = tab.documentId;
    const pageKey = tab.pageKey;
    const timer = setTimeout(() => {
      if (run !== runRef.current || !isCurrentPageIdentity(pageKey)) return;
      // A user-requested pre-send capture of this document owns its run;
      // background capture must not supersede it after the settle timer.
      if (useAutoScrapeStore.getState().captureOwner?.pageKey === pageKey) return;
      void (async () => {
        const deep = useSettingsStore.getState().scrapeAutoMode === 'scroll-capture';
        const captureStore = useAutoScrapeStore.getState();
        const captureRun = captureStore.beginCapture(pageKey);
        captureOwnerRef.current = { pageKey, run: captureRun };
        try {
          if (deep) await scrollToLoadLazy(tabId, { documentId });
          if (run !== runRef.current || !isCurrentPageIdentity(pageKey)) return;
          const result = await captureWithFallback(tabId, url, documentId);
          if (
            run !== runRef.current ||
            !isCurrentPageIdentity(pageKey) ||
            !captureStore.ownsCapture(pageKey, captureRun)
          )
            return;
          if (!result.ok || !result.soup) {
            if (result.reason !== 'unreachable-url' && result.reason !== 'inject-failed') {
              captureStore.setCaptureError(
                pageKey,
                captureRun,
                result.detail ?? result.reason ?? 'Auto capture failed',
              );
            }
            return;
          }
          if (result.soup.url !== url) return;
          captureStore.set({
            url,
            pageKey,
            capturedAt: Date.now(),
            usedFullScroll: deep,
            soup: result.soup,
          });
        } catch (error) {
          if (run === runRef.current && isCurrentPageIdentity(pageKey)) {
            captureStore.setCaptureError(
              pageKey,
              captureRun,
              error instanceof Error ? error.message : 'Auto capture failed',
            );
          }
        } finally {
          captureStore.finishCapture(pageKey, captureRun);
          if (captureOwnerRef.current?.run === captureRun) captureOwnerRef.current = null;
        }
      })();
    }, SETTLE_DELAY_MS);
    return () => {
      ++runRef.current;
      clearTimeout(timer);
      if (captureOwnerRef.current) {
        store.finishCapture(captureOwnerRef.current.pageKey, captureOwnerRef.current.run);
        captureOwnerRef.current = null;
      }
    };
  }, [enabled, tab.pageKey, tab.id, tab.url, tab.documentId]);
}
