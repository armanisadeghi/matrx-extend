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
  /**
   * `<all_urls>` optional host permission is not granted, so we can't
   * inject content scripts or read the page on this URL. The fix is the
   * Settings → Advanced → "All sites access" toggle, surfaced as a
   * one-click `grant-all-sites` action below.
   */
  | 'needs-all-sites'
  /** Anything else. */
  | 'unknown';

export type CaptureErrorAction = 'reload-tab' | 'try-again' | 'grant-all-sites';

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
export function classifyTabUrl(
  url: string | null | undefined,
): { blocked: boolean; reason: string | null } {
  if (!url) return { blocked: false, reason: null };
  for (const pattern of RESTRICTED_URL_PATTERNS) {
    if (pattern.test(url)) return { blocked: true, reason: pattern.reason };
  }
  return { blocked: false, reason: null };
}

/**
 * Classify a captureWithFallback result into a CaptureError.
 *
 * The key reason this exists: when `<all_urls>` is not granted, the
 * sendMessage path errors with "Receiving end does not exist" (no
 * content script on the page), the inject fallback errors with
 * "Cannot access contents of url..." (no host permission), and either
 * one in isolation looks recoverable-by-reload-tab. They aren't —
 * reloading the tab does nothing about a missing optional permission.
 *
 * Callers should pass `allUrlsGranted` (already-resolved) so this stays
 * synchronous; the async permission check lives at the call site
 * because it usually races with a follow-up retry attempt.
 */
export function buildCaptureErrorFromResult({
  result,
  url,
  tabId,
  allUrlsGranted,
}: {
  result: { ok: false; reason?: string; detail?: string };
  url: string | null;
  tabId: number | null;
  allUrlsGranted: boolean;
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

  // The two failure shapes that point straight at the optional grant:
  //   - inject-failed (chrome.scripting refused — usually no host permission)
  //   - no-content-script (sendMessage and inject both refused)
  // If <all_urls> isn't granted, that's the real cause — say so loudly.
  if (
    (result.reason === 'inject-failed' || result.reason === 'no-content-script') &&
    !allUrlsGranted
  ) {
    return {
      class: 'needs-all-sites',
      title: 'All Sites access is needed for this page',
      description:
        'This extension only operates on Matrx-owned hosts by default. To use it on other websites, grant "All sites access" in Settings. One click — Chrome will prompt you to confirm.',
      rawMessage,
      url,
      tabId,
      actions: ['grant-all-sites', 'try-again'],
      recoverable: true,
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
      description:
        'The page responded but produced no content. Try reloading and capturing again.',
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
    // We moved `<all_urls>` to optional_host_permissions in v0.1.13.
    // Until the user toggles "All sites access" on, every URL outside
    // the explicit base host list (matrxserver / aimatrx / supabase /
    // localhost) hits this error. The fix is one click — surface that.
    return {
      class: 'needs-all-sites',
      title: 'All Sites access is needed for this page',
      description:
        'This extension only operates on Matrx-owned hosts by default. To use it on other websites, grant "All sites access" in Settings. One click — Chrome will prompt you to confirm.',
      rawMessage,
      url,
      tabId,
      actions: ['grant-all-sites', 'try-again'],
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
