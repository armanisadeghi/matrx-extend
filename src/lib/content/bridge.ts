/**
 * Content-script bridge. Lives on every page (matches: ['<all_urls>']).
 *
 * Responsibilities:
 *   - Respond to scrape:capture-page from the side panel (sent via
 *     chrome.tabs.sendMessage so it reaches THIS tab's content script).
 *   - Notify SW on history-state changes (SPA navigations).
 *   - Stay tiny — heavier libs (defuddle, readability) lazy-load on demand.
 */

import { CHANNELS } from '@/lib/messaging/schemas';

interface ContentCtx {
  isInvalid?: boolean;
}

interface Envelope<T = unknown> {
  __matrx: true;
  kind: string;
  payload: T;
}

const isEnvelope = (m: unknown): m is Envelope => {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as Record<string, unknown>).__matrx === true &&
    typeof (m as Record<string, unknown>).kind === 'string'
  );
};

export function mountContentBridge(_ctx: ContentCtx): void {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isEnvelope(msg)) return false;
    if (msg.kind !== CHANNELS.SCRAPE_CAPTURE) return false;
    void (async () => {
      try {
        const { runScrape } = await import('@/lib/scrape/pipeline');
        const opts = (msg.payload as { options?: Record<string, unknown> }).options ?? {};
        const result = await runScrape(document, opts);
        sendResponse(result);
      } catch (err) {
        sendResponse({ __error: (err as Error).message });
      }
    })();
    return true; // keeps the channel open for the async response
  });

  // SPA navigation hint — fire-and-forget envelope.
  let lastUrl = location.href;
  const sendNav = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const env: Envelope<{ url: string }> = {
      __matrx: true,
      kind: CHANNELS.PAGE_NAVIGATED,
      payload: { url: location.href },
    };
    chrome.runtime.sendMessage(env).catch(() => undefined);
  };

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
