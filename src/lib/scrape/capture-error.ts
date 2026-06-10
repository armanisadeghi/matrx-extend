/**
 * Classify why a page-capture attempt failed (or would fail) so the UI can
 * show a friendly message + the right recovery action. Shared between the
 * Scrape tab and agent tools (read_active_page) so every caller benefits
 * from the same diagnostics.
 */

export type CaptureErrorClass =
  /** Tab URL is on Chrome's hard-blocked list (chrome://, web store, etc.). */
  | 'restricted-url'
  /** Content script not present — usually fixed by reloading the tab. */
  | 'no-receiver'
  /** The tab id we had no longer exists. */
  | 'no-tab'
  /** Host permission missing or denied for this URL. */
  | 'no-host-permission'
  /** Anything else. */
  | 'unknown';

export type CaptureErrorAction = 'reload-tab' | 'try-again';

export interface CaptureError {
  class: CaptureErrorClass;
  /** Short, human-readable; safe to show as a card title. */
  title: string;
  /** One-or-two-sentence explanation. */
  description: string;
  /** Original Chrome error message, if any. */
  rawMessage: string | null;
  /** URL that was being captured when the error happened. */
  url: string | null;
  /** Tab id that was being captured. */
  tabId: number | null;
  /** Suggested recovery actions, in priority order. Empty = no recovery. */
  actions: CaptureErrorAction[];
  /** Whether the user can recover (vs hard-blocked by Chrome). */
  recoverable: boolean;
  /** ISO timestamp of failure. */
  at: string;
}

interface RestrictedPattern {
  test: (url: string) => boolean;
  reason: string;
}

const RESTRICTED_URL_PATTERNS: RestrictedPattern[] = [
  { test: (u) => u.startsWith('chrome://'), reason: 'a Chrome internal page (chrome://)' },
  { test: (u) => u.startsWith('chrome-extension://'), reason: 'an extension page' },
  { test: (u) => u.startsWith('chrome-search://'), reason: "Chrome's search interface" },
  { test: (u) => u.startsWith('edge://'), reason: 'an Edge internal page' },
  { test: (u) => u.startsWith('about:'), reason: 'a browser about: page' },
  { test: (u) => u.startsWith('view-source:'), reason: 'a view-source: URL' },
  { test: (u) => u.startsWith('devtools://'), reason: 'the DevTools UI' },
  { test: (u) => u.startsWith('data:'), reason: 'a data: URL' },
  {
    test: (u) =>
      /^https:\/\/(?:chrome\.google\.com\/webstore|chromewebstore\.google\.com)\b/.test(u),
    reason: 'the Chrome Web Store (Google blocks extensions here)',
  },
];

/** Check whether a URL is on Chrome's hard-blocked list. */
export function classifyTabUrl(url: string | null | undefined): {
  blocked: boolean;
  reason: string | null;
} {
  if (!url) return { blocked: false, reason: null };
  for (const pattern of RESTRICTED_URL_PATTERNS) {
    if (pattern.test(url)) return { blocked: true, reason: pattern.reason };
  }
  return { blocked: false, reason: null };
}

/**
 * Classify a captureWithFallback result into a CaptureError.
 */
export function buildCaptureErrorFromResult({
  result,
  url,
  tabId,
}: {
  result: { ok: false; reason?: string; detail?: string };
  url: string | null;
  tabId: number | null;
}): CaptureError {
  const at = new Date().toISOString();
  const rawMessage = result.detail ?? null;

  // Pre-flight URL block.
  const urlClass = classifyTabUrl(url);
  if (urlClass.blocked) {
    return {
      class: 'restricted-url',
      title: "This page can't be captured",
      description: `Chrome blocks extensions on ${urlClass.reason}. Open the page you want to capture and try again.`,
      rawMessage,
      url,
      tabId,
      actions: [],
      recoverable: false,
      at,
    };
  }

  if (result.reason === 'unreachable-url') {
    return {
      class: 'restricted-url',
      title: "This page can't be captured",
      description:
        'Chrome blocks extensions on this URL scheme. Open a regular http(s) page and try again.',
      rawMessage,
      url,
      tabId,
      actions: [],
      recoverable: false,
      at,
    };
  }

  if (result.reason === 'no-content-script') {
    return {
      class: 'no-receiver',
      title: 'Page needs a refresh',
      description:
        "We couldn't reach the page's helper script — usually because the extension was updated since this tab was opened. Reload the page and try again.",
      rawMessage,
      url,
      tabId,
      actions: ['reload-tab', 'try-again'],
      recoverable: true,
      at,
    };
  }

  if (result.reason === 'inject-failed') {
    return {
      class: 'no-host-permission',
      title: 'No permission for this page',
      description:
        "The extension couldn't inject its helper script here. The URL may be in a sandboxed origin Chrome doesn't allow.",
      rawMessage,
      url,
      tabId,
      actions: ['try-again'],
      recoverable: true,
      at,
    };
  }

  if (result.reason === 'no-result') {
    return {
      class: 'unknown',
      title: 'Capture returned nothing',
      description: 'The page responded but produced no content. Try reloading and capturing again.',
      rawMessage,
      url,
      tabId,
      actions: ['reload-tab', 'try-again'],
      recoverable: true,
      at,
    };
  }

  // capture-error or anything else
  return {
    class: 'unknown',
    title: 'Capture failed',
    description: rawMessage || 'Something went wrong while capturing the page.',
    rawMessage,
    url,
    tabId,
    actions: ['reload-tab', 'try-again'],
    recoverable: true,
    at,
  };
}

/** Build a CaptureError from a thrown error (or pre-flight URL check). */
export function buildCaptureError({
  err,
  url,
  tabId,
}: {
  err: unknown;
  url: string | null;
  tabId: number | null;
}): CaptureError {
  const rawMessage = err instanceof Error ? err.message : err == null ? null : String(err);
  const at = new Date().toISOString();

  const urlClass = classifyTabUrl(url);
  if (urlClass.blocked) {
    return {
      class: 'restricted-url',
      title: "This page can't be captured",
      description: `Chrome blocks extensions on ${urlClass.reason}. Open the page you want to capture and try again.`,
      rawMessage,
      url,
      tabId,
      actions: [],
      recoverable: false,
      at,
    };
  }

  const msg = (rawMessage ?? '').toLowerCase();

  if (
    msg.includes('receiving end does not exist') ||
    msg.includes('could not establish connection')
  ) {
    return {
      class: 'no-receiver',
      title: 'Page needs a refresh',
      description:
        "We couldn't reach the page's helper script — usually because the extension was updated since this tab was opened. Reload the page and try again.",
      rawMessage,
      url,
      tabId,
      actions: ['reload-tab', 'try-again'],
      recoverable: true,
      at,
    };
  }

  if (msg.includes('no tab with id')) {
    return {
      class: 'no-tab',
      title: 'Tab not found',
      description:
        'The tab we were trying to capture is no longer open. Switch to the page you want and try again.',
      rawMessage,
      url,
      tabId,
      actions: ['try-again'],
      recoverable: true,
      at,
    };
  }

  if (
    msg.includes('cannot access') ||
    msg.includes('extension manifest must request permission') ||
    msg.includes("'<all_urls>' or 'activetab' permission is required")
  ) {
    return {
      class: 'no-host-permission',
      title: 'No permission for this page',
      description:
        "Chrome blocked the extension from reading this page. The URL may be in a sandboxed origin Chrome doesn't allow.",
      rawMessage,
      url,
      tabId,
      actions: ['try-again'],
      recoverable: true,
      at,
    };
  }

  return {
    class: 'unknown',
    title: 'Capture failed',
    description: rawMessage || 'Something went wrong while capturing the page.',
    rawMessage,
    url,
    tabId,
    actions: ['reload-tab', 'try-again'],
    recoverable: true,
    at,
  };
}
