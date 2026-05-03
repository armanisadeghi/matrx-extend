/**
 * Page-ready signal — answers "is it safe to read or screenshot right now?"
 *
 * Runs a 300ms MutationObserver alongside instant DOM-state checks. Cheap
 * relative to the cloud round-trip; fires in parallel with the probe so
 * total chat-send latency is unchanged.
 *
 * Cross-cutting fix: addresses the lazy-loaded-content failure mode noted
 * in the field research and BrowserArena testing — agents reading or
 * screenshotting before content has hydrated.
 */

import { log } from '@/lib/debug/log';

export interface PageReadySignal {
  /** document.readyState at probe time. */
  document: 'loading' | 'interactive' | 'complete';
  /** No mutations + no skeletons + no pending images = trustworthy snapshot. */
  observed_idle: boolean;
  /** Direct-child mutations seen during the 300ms observation window. */
  mutation_count: number;
  /** Visible loading indicators: skeletons, spinners, [aria-busy="true"]. */
  loading_indicators: number;
  /** Images still loading. */
  pending_images: number;
  /** Time the page took to fire `load`. 0 = hasn't fired yet. */
  load_event_ms: number;
}

export async function checkPageReady(tabId: number): Promise<PageReadySignal | null> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (): Promise<PageReadySignal> => {
        const documentState = document.readyState as PageReadySignal['document'];

        // Mutation observer over the document body's direct children — broad
        // enough to catch route changes / hydration / lazy injection but
        // narrow enough to ignore the constant micro-mutations from tooltips,
        // hover effects, and ripple animations.
        let mutationCount = 0;
        const observer = new MutationObserver((records) => {
          for (const r of records) mutationCount += r.addedNodes.length + r.removedNodes.length;
        });
        if (document.body) {
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: false,
            attributes: false,
          });
        }
        await new Promise((r) => setTimeout(r, 300));
        observer.disconnect();

        // Instant signals — no wait.
        const loadingIndicators = document.querySelectorAll(
          '[aria-busy="true"], [role="progressbar"]:not([aria-valuenow]), [class*="skeleton" i], [class*="placeholder" i]:not([role="textbox"]), [class*="spinner" i], [class*="loader" i]',
        ).length;

        const pendingImages = Array.from(document.querySelectorAll('img')).filter((img) => {
          const i = img as HTMLImageElement;
          return !i.complete && i.getAttribute('loading') !== 'lazy';
        }).length;

        let loadEventMs = 0;
        try {
          const nav = performance.getEntriesByType('navigation')[0] as
            | PerformanceNavigationTiming
            | undefined;
          if (nav?.loadEventEnd && nav.loadEventEnd > 0) {
            loadEventMs = Math.round(nav.loadEventEnd);
          }
        } catch {
          /* ignore */
        }

        // "Idle" tolerates a small number of mutations to absorb noise from
        // tooltips/animations. The hard fail conditions are loud activity
        // (>10 mutations in 300ms) or visible loading indicators.
        const observedIdle =
          documentState === 'complete' &&
          mutationCount < 10 &&
          loadingIndicators === 0 &&
          pendingImages === 0;

        return {
          document: documentState,
          observed_idle: observedIdle,
          mutation_count: mutationCount,
          loading_indicators: loadingIndicators,
          pending_images: pendingImages,
          load_event_ms: loadEventMs,
        };
      },
    });
    return (first?.result as PageReadySignal | undefined) ?? null;
  } catch (err) {
    log.warn('scrape', 'checkPageReady failed', err);
    return null;
  }
}
