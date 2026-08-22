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

declare global {
  interface Window {
    __matrx_bridge_mounted?: boolean;
  }
}

// chrome.runtime.sendMessage throws *synchronously* when the extension
// context is gone (dev reload, update, disable). The returned-promise
// .catch() never runs in that case, so unguarded calls escape as
// "Uncaught Error: Extension context invalidated" — especially loud on
// SPAs (Gmail) that fire constant history/scroll events into orphaned
// content scripts. chrome.runtime?.id is undefined once invalidated.
const safeSend = (env: Envelope): void => {
  try {
    if (!chrome.runtime?.id) return;
    chrome.runtime.sendMessage(env).catch(() => undefined);
  } catch {
    // orphaned content script — nothing to do
  }
};

export function mountContentBridge(_ctx: ContentCtx): void {
  // Guard against double-mounting. Without this, programmatic re-injection
  // (a likely future fallback for "Receiving end does not exist") would
  // double-wrap history.pushState/replaceState — every nav would recurse —
  // and register two onMessage listeners, producing double responses.
  if (window.__matrx_bridge_mounted) return;
  window.__matrx_bridge_mounted = true;

  // Scroll sync state. The side panel turns the listener on when the
  // user enables "Sync scroll" on the Scrape tab; off when they disable it
  // or close the panel. We use a refcount so multiple subscribers (an
  // upcoming Pilot tab, a future scroll heatmap, etc.) compose cleanly.
  let scrollSubs = 0;
  let rafPending = false;
  const onScroll = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const docHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
      );
      const maxScroll = Math.max(0, docHeight - window.innerHeight);
      const env: Envelope<{ y: number; max: number; viewport: number }> = {
        __matrx: true,
        kind: CHANNELS.PAGE_SCROLL,
        payload: {
          y: window.scrollY,
          max: maxScroll,
          viewport: window.innerHeight,
        },
      };
      safeSend(env);
    });
  };
  const enableScrollEmit = () => {
    if (scrollSubs === 0) {
      window.addEventListener('scroll', onScroll, { passive: true });
      // Send one immediately so a freshly-subscribed listener gets the
      // current position without waiting for the user to scroll.
      onScroll();
    }
    scrollSubs++;
  };
  const disableScrollEmit = () => {
    if (scrollSubs === 0) return;
    scrollSubs--;
    if (scrollSubs === 0) window.removeEventListener('scroll', onScroll);
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isEnvelope(msg)) return false;
    if (msg.kind === CHANNELS.CREDENTIAL_CAPTURE_PROMPT) {
      // Metadata only (host / username / existing login names) — the SW never
      // sends a value back to a page. Lazy so the toast code loads on demand.
      void import('@/lib/credentials/capture-prompt').then(({ showCapturePrompt }) => {
        showCapturePrompt(msg.payload as Parameters<typeof showCapturePrompt>[0]);
        sendResponse({ ok: true });
      });
      return true;
    }
    if (msg.kind === CHANNELS.PAGE_SCROLL_SUBSCRIBE) {
      enableScrollEmit();
      sendResponse({ ok: true });
      return false;
    }
    if (msg.kind === CHANNELS.PAGE_SCROLL_UNSUBSCRIBE) {
      disableScrollEmit();
      sendResponse({ ok: true });
      return false;
    }
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

  // "Save this login?" detector — only where a password box can exist. Top
  // frame only (this script is allFrames:false). Loaded lazily and only once
  // a password input shows up, so ordinary pages never pay for it.
  let detectorMounted = false;
  const mountDetector = () => {
    if (detectorMounted) return;
    detectorMounted = true;
    void import('@/lib/credentials/capture-detector').then(({ mountCaptureDetector }) =>
      mountCaptureDetector(),
    );
  };
  if (document.querySelector('input[type="password"]')) {
    mountDetector();
  } else {
    // Mount on the first focus into a password field — covers SPA logins that
    // render the form later, without observing the whole DOM.
    document.addEventListener(
      'focusin',
      (e) => {
        if (e.target instanceof HTMLInputElement && e.target.type === 'password') mountDetector();
      },
      true,
    );
  }

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
    safeSend(env);
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
