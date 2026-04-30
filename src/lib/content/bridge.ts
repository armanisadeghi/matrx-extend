/**
 * Content-script bridge. Lives on every page (matches: ['<all_urls>']).
 *
 * Responsibilities:
 *   - Listen for scrape:capture-page from the side panel → runs the pipeline
 *     and returns the SoupResult
 *   - Notify SW on history-state changes (SPA navigations) via webext-bridge
 *   - Stay tiny — heavier libs (defuddle, readability) lazy-load on demand
 */

import { CHANNELS } from '@/lib/messaging/schemas';
import { onMessage } from 'webext-bridge/content-script';

interface ContentCtx {
  isInvalid?: boolean;
}

export function mountContentBridge(_ctx: ContentCtx): void {
  onMessage(CHANNELS.SCRAPE_CAPTURE, async ({ data }) => {
    const { runScrape } = await import('@/lib/scrape/pipeline');
    const opts = (data as { options?: Record<string, unknown> }).options ?? {};
    const result = await runScrape(document, opts);
    return result;
  });

  // SPA navigation hint — useful for Data tab pattern matching + recognition.
  let lastUrl = location.href;
  const sendNav = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    void chrome.runtime.sendMessage({
      __matrx: true,
      kind: CHANNELS.PAGE_NAVIGATED,
      url: location.href,
    });
  };
  // Cover both pushState/replaceState (SPA) and full nav.
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) {
    const r = origPush.apply(this, args);
    sendNav();
    return r;
  };
  history.replaceState = function (...args) {
    const r = origReplace.apply(this, args);
    sendNav();
    return r;
  };
  window.addEventListener('popstate', sendNav);
}
