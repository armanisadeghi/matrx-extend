/**
 * Host-access gating for tool handlers.
 *
 * Roadmap item #10 moved `<all_urls>` from base host_permissions to
 * optional_host_permissions. Many tools rely on broad host access — they
 * `executeScript` on the assigned tab, fetch arbitrary URLs, or rely on
 * content scripts that declare `matches: ['<all_urls>']`. Without a grant,
 * Chrome silently rejects those calls (or the content script never
 * injects) and the user sees an opaque failure.
 *
 * Helpers here let handlers detect "broad host access not granted" up
 * front and return a structured remediation error pointing the user at
 * Settings → Advanced agent capabilities → "All sites access".
 *
 * The check is cheap (a single `chrome.permissions.contains` call on a
 * known origin pattern), so handlers can call it on every invocation
 * without caching.
 */

import { hasOptionalHostPermissions } from '@/lib/permissions/optional';

export interface HostAccessError {
  ok: false;
  error: 'host_access_required';
  reason: string;
  remediation: string;
}

/**
 * Return a structured error if `<all_urls>` host access isn't granted.
 * Returns `null` when access is fine — handler should proceed.
 *
 * Use sparingly — only on handlers that genuinely need broad host access
 * (executeScript on arbitrary URLs, fetch through content scripts, etc.).
 * Don't gate handlers that work fine on the explicit hosts already in
 * base host_permissions (server.app.matrxserver.com, aimatrx.com, etc.).
 */
export async function requireAllUrlsHostAccess(): Promise<HostAccessError | null> {
  const granted = await hasOptionalHostPermissions(['<all_urls>']);
  if (granted) return null;
  return {
    ok: false,
    error: 'host_access_required',
    reason:
      'This tool needs broad host access (<all_urls>) to operate on arbitrary websites, but the user has not granted it.',
    remediation:
      'Open Settings → Advanced agent capabilities → "All sites access" and toggle it on. Chrome will prompt to confirm.',
  };
}

/**
 * Check whether a specific origin / URL is covered by current host
 * permissions. Returns null when granted, a structured error otherwise.
 *
 * Pass the URL of the tab the handler is about to operate on. Chrome's
 * `permissions.contains` accepts both match patterns and concrete URLs.
 */
export async function requireHostAccessFor(url: string | null | undefined): Promise<
  HostAccessError | null
> {
  if (!url) return null;
  // chrome:// and chrome-extension:// URLs aren't gated by host permissions.
  if (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://') ||
    url.startsWith('devtools://')
  ) {
    return null;
  }
  let granted = false;
  try {
    granted = await chrome.permissions.contains({ origins: [url] });
  } catch {
    // Bad URL pattern → fall through; handler will see the API-level error
    // and report it. No need to block prematurely.
    return null;
  }
  if (granted) return null;
  return {
    ok: false,
    error: 'host_access_required',
    reason: `Host access not granted for ${url}.`,
    remediation:
      'Open Settings → Advanced agent capabilities → "All sites access" and toggle it on. Chrome will prompt to confirm.',
  };
}
