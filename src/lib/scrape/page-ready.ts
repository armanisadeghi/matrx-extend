/**
 * Page-readiness helpers, parameterized so manual and automated callers can
 * tune them independently without coupling.
 *
 * Two primitives:
 *   - settlePage(tabId, opts)    — wait for DOM mutations to quiet
 *   - scrollToLoadLazy(tabId, opts) — top→bottom scroll to fire lazy loaders
 *
 * Each call site picks its own option set:
 *   - Manual Scrape "Scroll & capture": skips settlePage, fast scroll (100ms),
 *     short cap (4s), with live progress callback wired to the button.
 *   - Automated Tasks: keeps both, conservative timings (defaults below).
 *
 * Tuning one call site CANNOT change the other. The algorithm is shared but
 * each behavior knob is a parameter.
 */

import { log } from '@/lib/debug/log';

interface SettlePageOptions {
  /** No mutations for this many ms → settled. */
  quietMs?: number;
  /** Hard cap regardless of quiescence. */
  maxMs?: number;
}

/**
 * Wait for the page DOM to stop mutating. Returns when there have been no
 * mutations for `quietMs`, or when `maxMs` elapses (whichever first).
 *
 * Used ONLY by the automated Tasks flow. The manual Scroll & capture button
 * skips this — by the time the user clicks, the page has been visible long
 * enough that settling adds no value, only latency.
 */
export async function settlePage(
  tabId: number,
  { quietMs = 800, maxMs = 6000 }: SettlePageOptions = {},
): Promise<void> {
  log.info('scrape', `settlePage tab=${tabId} quiet=${quietMs}ms max=${maxMs}ms`);
  const start = performance.now();
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (quiet: number, max: number) =>
        new Promise<void>((resolve) => {
          const startObserver = () => {
            let lastChange = Date.now();
            const startedAt = Date.now();
            const observer = new MutationObserver(() => {
              lastChange = Date.now();
            });
            observer.observe(document.documentElement, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true,
            });
            const tick = () => {
              const now = Date.now();
              if (now - lastChange >= quiet || now - startedAt >= max) {
                observer.disconnect();
                resolve();
                return;
              }
              setTimeout(tick, 100);
            };
            tick();
          };
          if (document.readyState === 'complete') {
            startObserver();
          } else {
            window.addEventListener('load', startObserver, { once: true });
            setTimeout(startObserver, Math.max(0, max - quiet));
          }
        }),
      args: [quietMs, maxMs],
    });
    const ms = Math.round(performance.now() - start);
    log.success('scrape', `settlePage done in ${ms}ms`);
  } catch (err) {
    log.warn('scrape', 'settlePage failed', err);
  }
}

interface ScrollProgress {
  /** 1-indexed step we just completed. */
  step: number;
  /** Estimated total steps. May overshoot if we hit bottom early. */
  total: number;
  /** Current scrollY as fraction of max scroll (0..1). */
  fraction: number;
}

interface ScrollOptions {
  /** Pixels per scroll step as a fraction of viewport height. */
  stepRatio?: number;
  /** Pause between steps to let lazy loaders fire. */
  delayMs?: number;
  /** Hard cap on total time spent scrolling. */
  maxMs?: number;
  /** Return the page to the top when done (default true). */
  restoreScroll?: boolean;
  /**
   * Called from the side panel each time the in-page loop emits a progress
   * event. Useful for "Scrolling 3/8…" UI. Leave undefined for silent runs.
   */
  onProgress?: (p: ScrollProgress) => void;
}

const SCROLL_PROGRESS_KIND = '__matrx_scroll_progress__';

interface ScrollResult {
  steps: number;
  bottom: boolean;
  stuck: boolean;
  timedOut: boolean;
}

/**
 * Scroll the page top→bottom in stepped chunks, pausing between each so
 * IntersectionObserver-based lazy loaders fire. Bounded on:
 *   - bottom reached
 *   - no progress between two consecutive steps (infinite-scroll trap)
 *   - maxMs total elapsed
 *
 * If `onProgress` is provided, the in-page loop emits chrome.runtime.sendMessage
 * progress events that this function listens for and forwards.
 */
export async function scrollToLoadLazy(
  tabId: number,
  {
    stepRatio = 0.85,
    delayMs = 250,
    maxMs = 6000,
    restoreScroll = true,
    onProgress,
  }: ScrollOptions = {},
): Promise<void> {
  log.info('scrape', `scrollToLoadLazy tab=${tabId} delay=${delayMs}ms max=${maxMs}ms`);
  const start = performance.now();

  // Wire up the progress relay only if the caller asked for it.
  let listener: ((msg: unknown) => void) | null = null;
  if (onProgress) {
    listener = (msg) => {
      if (
        msg &&
        typeof msg === 'object' &&
        (msg as Record<string, unknown>).__matrx === true &&
        (msg as Record<string, unknown>).kind === SCROLL_PROGRESS_KIND
      ) {
        const p = msg as { step: number; total: number; fraction: number };
        onProgress({ step: p.step, total: p.total, fraction: p.fraction });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  }

  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (
        stepRatioArg: number,
        delayMsArg: number,
        maxMsArg: number,
        restoreScrollArg: boolean,
        reportProgressArg: boolean,
        progressKind: string,
      ): Promise<ScrollResult> =>
        new Promise<ScrollResult>((resolve) => {
          const startedAt = Date.now();
          const originalY = window.scrollY;
          const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

          const docHeight = () =>
            Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
          const maxYNow = () => Math.max(0, docHeight() - window.innerHeight);
          const stepPx = () => Math.max(50, window.innerHeight * stepRatioArg);

          // Estimate total steps up-front so the UI gets a stable denominator.
          const estimatedTotal = Math.max(1, Math.ceil(maxYNow() / stepPx()));

          (async () => {
            let stepsTaken = 0;
            let lastY = -1;
            let bottom = false;
            let stuck = false;
            let timedOut = false;

            while (true) {
              if (Date.now() - startedAt > maxMsArg) {
                timedOut = true;
                break;
              }
              const y = window.scrollY;
              const maxY = maxYNow();
              if (y >= maxY - 1) {
                bottom = true;
                break;
              }
              if (y === lastY && stepsTaken > 1) {
                stuck = true;
                break;
              }
              lastY = y;
              window.scrollTo({ top: Math.min(maxY, y + stepPx()) });
              stepsTaken++;

              if (reportProgressArg) {
                try {
                  chrome.runtime.sendMessage({
                    __matrx: true,
                    kind: progressKind,
                    step: stepsTaken,
                    total: estimatedTotal,
                    fraction: maxY > 0 ? Math.min(1, window.scrollY / maxY) : 1,
                  });
                } catch {
                  /* ignore — page may be navigating away */
                }
              }

              await sleep(delayMsArg);
            }

            if (restoreScrollArg) {
              window.scrollTo({ top: originalY });
              await sleep(50);
            }

            resolve({ steps: stepsTaken, bottom, stuck, timedOut });
          })();
        }),
      args: [stepRatio, delayMs, maxMs, restoreScroll, !!onProgress, SCROLL_PROGRESS_KIND],
    });
    const summary = result?.[0]?.result as ScrollResult | undefined;
    const ms = Math.round(performance.now() - start);
    log.success(
      'scrape',
      `scrollToLoadLazy done in ${ms}ms${
        summary
          ? ` (steps=${summary.steps}${summary.bottom ? ' bottom' : ''}${summary.stuck ? ' stuck' : ''}${summary.timedOut ? ' timed-out' : ''})`
          : ''
      }`,
      summary,
    );
  } catch (err) {
    log.warn('scrape', 'scrollToLoadLazy failed', err);
  } finally {
    if (listener) chrome.runtime.onMessage.removeListener(listener);
  }
}
