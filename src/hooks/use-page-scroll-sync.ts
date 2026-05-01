/**
 * Sync a side-panel scroll container with the live page's scroll position.
 *
 * Use case: side-by-side comparison on the Scrape tab. The user scrolls the
 * actual page; the captured Article view follows proportionally so they can
 * spot mismatches between source and capture.
 *
 * Wire:
 *   side panel ──PAGE_SCROLL_SUBSCRIBE──▶ content script (active tab)
 *   content script ──PAGE_SCROLL──▶ side panel (rAF-throttled)
 *   side panel applies scrollTop = ratio × scrollHeight
 *
 * The hook is opt-in (driven by `enabled`) and unsubscribes on unmount or
 * when disabled — no zombie listeners, no scroll-event leaks across pages.
 */

import { CHANNELS } from '@/lib/messaging/schemas';
import { type RefObject, useEffect, useRef } from 'react';

interface ScrollPayload {
  /** window.scrollY of the source page. */
  y: number;
  /** scrollHeight - viewport (i.e. max scrollable distance). */
  max: number;
  /** window.innerHeight, in case we want viewport-aware sync later. */
  viewport: number;
}

interface ScrollEnvelope {
  __matrx: true;
  kind: string;
  payload: ScrollPayload;
}

const isScrollEnvelope = (m: unknown): m is ScrollEnvelope => {
  if (typeof m !== 'object' || m === null) return false;
  const o = m as Record<string, unknown>;
  return (
    o.__matrx === true &&
    o.kind === CHANNELS.PAGE_SCROLL &&
    typeof o.payload === 'object' &&
    o.payload !== null
  );
};

export function usePageScrollSync(
  enabled: boolean,
  containerRef: RefObject<HTMLElement | null>,
): void {
  // Track which tab we subscribed to so unmount/disable can target the right
  // content script even if the user has since switched tabs.
  const subscribedTabId = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (cancelled || !tab?.id) return;
        subscribedTabId.current = tab.id;
        await chrome.tabs
          .sendMessage(tab.id, { __matrx: true, kind: CHANNELS.PAGE_SCROLL_SUBSCRIBE })
          .catch(() => undefined);
      } catch {
        /* ignore — page may be on a restricted URL */
      }
    })();

    const onMessage = (msg: unknown) => {
      if (!isScrollEnvelope(msg)) return;
      const el = containerRef.current;
      if (!el) return;
      const { y, max } = msg.payload;
      const ratio = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      const containerMax = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = ratio * containerMax;
    };
    chrome.runtime.onMessage.addListener(onMessage);

    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(onMessage);
      const tabId = subscribedTabId.current;
      subscribedTabId.current = null;
      if (tabId != null) {
        chrome.tabs
          .sendMessage(tabId, { __matrx: true, kind: CHANNELS.PAGE_SCROLL_UNSUBSCRIBE })
          .catch(() => undefined);
      }
    };
  }, [enabled, containerRef]);
}
