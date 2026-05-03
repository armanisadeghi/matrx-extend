/**
 * Capture-with-fallback — robust replacement for the ad-hoc
 * `chrome.tabs.sendMessage(tabId, SCRAPE_CAPTURE, …)` calls scattered
 * around auto-scrape, the chat hook's pre-send refresh, and the manual
 * Scrape tab.
 *
 * Why this exists: `Could not establish connection. Receiving end does
 * not exist.` happens when a tab has no content script — the three
 * common causes are:
 *
 *   1. The extension was just installed; the tab was already open and
 *      Chrome doesn't retro-inject the declared content script.
 *   2. The tab is on a URL the content_script's `matches` doesn't cover
 *      (file://, view-source:, devtools://, restricted Chrome surfaces).
 *   3. The content script crashed or was unloaded.
 *
 * For (1) and (3) we can recover by injecting the script ourselves via
 * `chrome.scripting.executeScript` and retrying. For (2) we should skip
 * silently — there's no script to inject and screaming about it on every
 * page-load just adds noise.
 */

import { log } from '@/lib/debug/log';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { SoupResult } from '@/lib/scrape/pipeline';

/**
 * URL patterns the content script (per wxt.config / content.ts matches)
 * cannot reach. No injection attempt — just skip silently.
 */
const UNREACHABLE_URL_RE =
  /^(?:chrome|edge|brave|opera|chrome-extension|moz-extension|view-source|about|file|devtools|chrome-search|chrome-untrusted|chrome-error|webui):/i;

const NO_RECEIVER_RE = /Receiving end does not exist|Could not establish connection/i;

const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

export interface CaptureResult {
  ok: boolean;
  soup?: SoupResult;
  /** Stable code so callers can decide log level / messaging. */
  reason?:
    | 'unreachable-url'
    | 'no-content-script'
    | 'inject-failed'
    | 'capture-error'
    | 'page-changed'
    | 'no-result';
  /** Free-form detail. */
  detail?: string;
}

function isUnreachable(url: string | null | undefined): boolean {
  if (!url) return true;
  return UNREACHABLE_URL_RE.test(url);
}

async function sendOnce(tabId: number): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, {
    __matrx: true,
    kind: CHANNELS.SCRAPE_CAPTURE,
    payload: { options: {} },
  });
}

async function tryInject(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });
    return true;
  } catch (err) {
    log.info('scrape', `content-script inject failed for tab ${tabId}`, {
      message: (err as Error).message,
    });
    return false;
  }
}

/**
 * Send SCRAPE_CAPTURE to the content script with auto-injection on the
 * first "no receiver" failure. Returns a structured result so callers can
 * decide whether to log warnings or stay silent.
 *
 * Never throws.
 */
export async function captureWithFallback(
  tabId: number,
  url: string | null | undefined,
): Promise<CaptureResult> {
  if (isUnreachable(url)) {
    return {
      ok: false,
      reason: 'unreachable-url',
      detail: `${url ?? '(no url)'} — content script does not run here`,
    };
  }

  // First attempt — fast path.
  let raw: unknown;
  try {
    raw = await sendOnce(tabId);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (!NO_RECEIVER_RE.test(msg)) {
      // Different failure (port closed mid-call, JSON serialization, etc.)
      // — caller should warn.
      return { ok: false, reason: 'capture-error', detail: msg };
    }
    // No content script. Try to inject + retry once.
    const injected = await tryInject(tabId);
    if (!injected) {
      return {
        ok: false,
        reason: 'inject-failed',
        detail: 'content script unreachable and inject failed (likely restricted URL)',
      };
    }
    try {
      raw = await sendOnce(tabId);
    } catch (err2) {
      const msg2 = (err2 as Error).message ?? String(err2);
      // If the second attempt still says "no receiver", something is
      // genuinely off (manifest mismatch, MAIN-world-only injection, etc.).
      // Keep this at warning level so a fresh symptom becomes visible.
      if (NO_RECEIVER_RE.test(msg2)) {
        return {
          ok: false,
          reason: 'no-content-script',
          detail: 'still unreachable after inject',
        };
      }
      return { ok: false, reason: 'capture-error', detail: msg2 };
    }
  }

  if (!raw) {
    return { ok: false, reason: 'no-result' };
  }
  if (typeof raw === 'object' && '__error' in raw) {
    return {
      ok: false,
      reason: 'capture-error',
      detail: String((raw as { __error?: unknown }).__error),
    };
  }
  return { ok: true, soup: raw as SoupResult };
}

export { isUnreachable };
