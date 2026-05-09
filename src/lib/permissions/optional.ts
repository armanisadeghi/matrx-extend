/**
 * Helpers for runtime-granted Chrome permissions.
 *
 * Many of our tools depend on permissions the user hasn't granted at install
 * time. The Settings UI surfaces a toggle per permission; flipping it on
 * calls `chrome.permissions.request`. The dispatcher checks whether the
 * permission is granted before running a tool that needs it, and returns a
 * structured error so the UI can prompt.
 *
 * Two flavors:
 *   - API permissions (the `OptionalPermission` union below) — entries in
 *     `optional_permissions` in the manifest. e.g. `cookies`, `pageCapture`.
 *   - Host permissions (the `OptionalHostPermission` union) — entries in
 *     `optional_host_permissions`. Currently just `<all_urls>` (roadmap
 *     item #10: moved out of base host_permissions so the install prompt
 *     stays minimal). The grant call passes `{ origins: [...] }` instead
 *     of `{ permissions: [...] }`.
 */

// Active optional permissions. Each entry here MUST also appear in
// `optional_permissions` in wxt.config.ts — otherwise Chrome silently
// rejects the runtime permission request and the Settings → Advanced
// toggle for it will fail.
export type OptionalPermission =
  | 'debugger'
  | 'cookies'
  | 'pageCapture'
  | 'clipboardRead'
  | 'tabCapture';

// ─── Reserved for future capabilities ────────────────────────────────────
// These were previously declared but had no corresponding chrome.<api>
// usage in code, so they were removed from the manifest to avoid Chrome
// Web Store "declared but unused" review flags and broken Settings toggles.
//
// To re-enable one, do all THREE in lock-step:
//   1. Add the literal to the OptionalPermission union above.
//   2. Add an entry to OPTIONAL_PERMISSION_LABELS below.
//   3. Add the string to optional_permissions in wxt.config.ts.
//
// Reserved literals (keep this list in sync with wxt.config.ts comments):
//   'userScripts'    — execute user-script style modifications
//   'proxy'          — control the browser's proxy configuration
//   'webRequest'     — observe network requests for ad blocking / debugging
//   'desktopCapture' — capture screen / window for screen-sharing flows
//   'topSites'       — read the user's most-visited sites
//   'management'     — list and manage other installed extensions
// ─────────────────────────────────────────────────────────────────────────

export const OPTIONAL_PERMISSION_LABELS: Record<OptionalPermission, { title: string; desc: string }> = {
  debugger: {
    title: 'DevTools Protocol',
    desc: 'Enables CDP-powered tools: full-page screenshots, accessibility tree dumps, network capture, coordinate-based clicks. Chrome shows a "is being debugged" banner while attached.',
  },
  cookies: {
    title: 'Cookies',
    desc: 'Read, set, and delete cookies for any site. Required for session-aware automation.',
  },
  pageCapture: {
    title: 'Page archive (MHTML)',
    desc: 'Snapshot a page as a self-contained MHTML archive (HTML + every resource inlined).',
  },
  clipboardRead: {
    title: 'Clipboard read',
    desc: 'Read the system clipboard. Required by the get_clipboard tool so the agent can use whatever the user just copied.',
  },
  tabCapture: {
    title: 'Tab video capture',
    desc: 'Record video (and optionally audio) of the active tab via MediaRecorder. Required by the record_tab_video tool and the Tools tab Recorder.',
  },
};

export async function hasOptionalPermissions(perms: OptionalPermission[]): Promise<boolean> {
  if (perms.length === 0) return true;
  return chrome.permissions.contains({ permissions: perms });
}

export async function requestOptionalPermission(perm: OptionalPermission): Promise<boolean> {
  return chrome.permissions.request({ permissions: [perm] });
}

export async function removeOptionalPermission(perm: OptionalPermission): Promise<boolean> {
  return chrome.permissions.remove({ permissions: [perm] });
}

export async function listGrantedOptional(): Promise<OptionalPermission[]> {
  const got = await chrome.permissions.getAll();
  const granted = (got.permissions ?? []) as string[];
  return granted.filter((p): p is OptionalPermission =>
    Object.prototype.hasOwnProperty.call(OPTIONAL_PERMISSION_LABELS, p),
  );
}

export const ALL_OPTIONAL: OptionalPermission[] = Object.keys(
  OPTIONAL_PERMISSION_LABELS,
) as OptionalPermission[];

// ─── Optional host permissions ───────────────────────────────────────────
// Mirror of `optional_host_permissions` in wxt.config.ts. Roadmap item #10
// moved `<all_urls>` here so the install dialog only asks for the narrow
// set of hosts the extension truly needs at boot. All-sites access becomes
// a runtime grant from Settings → Advanced agent capabilities.
//
// To add a new optional host pattern, do all THREE in lock-step:
//   1. Add the literal to the OptionalHostPermission union below.
//   2. Add an entry to OPTIONAL_HOST_PERMISSION_LABELS.
//   3. Add the pattern to optional_host_permissions in wxt.config.ts.

export type OptionalHostPermission = '<all_urls>';

export const OPTIONAL_HOST_PERMISSION_LABELS: Record<
  OptionalHostPermission,
  { title: string; desc: string }
> = {
  '<all_urls>': {
    title: 'All sites access',
    desc: "Lets the agent read and act on any page you visit. Required for tools that work on arbitrary websites (read_page, click_element, type_into_element, etc.) and for content scripts (data picker, list picker). Without this, those tools only work on AI Matrx's own domains.",
  },
};

export const ALL_OPTIONAL_HOSTS: OptionalHostPermission[] = Object.keys(
  OPTIONAL_HOST_PERMISSION_LABELS,
) as OptionalHostPermission[];

/**
 * Check whether a set of host patterns are currently granted. Pass match
 * patterns Chrome accepts (e.g. `<all_urls>`, `https://example.com/*`).
 */
export async function hasOptionalHostPermissions(
  origins: string[],
): Promise<boolean> {
  if (origins.length === 0) return true;
  return chrome.permissions.contains({ origins });
}

/** Prompt for one host pattern. Returns true on grant. */
export async function requestOptionalHostPermission(
  origin: OptionalHostPermission,
): Promise<boolean> {
  return chrome.permissions.request({ origins: [origin] });
}

/** Revoke one host pattern. Returns true on success. */
export async function removeOptionalHostPermission(
  origin: OptionalHostPermission,
): Promise<boolean> {
  return chrome.permissions.remove({ origins: [origin] });
}

/** List which optional host patterns are currently granted. */
export async function listGrantedOptionalHosts(): Promise<OptionalHostPermission[]> {
  const got = await chrome.permissions.getAll();
  const granted = (got.origins ?? []) as string[];
  return ALL_OPTIONAL_HOSTS.filter((p) => granted.includes(p));
}

/**
 * Convenience: do we have `<all_urls>` granted right now?
 *
 * Used by tool handlers that need broad host access (executeScript on
 * arbitrary URLs, fetch through a content script, etc.) to short-circuit
 * with a structured "permission required" error before attempting the
 * Chrome API call.
 */
export async function hasAllUrlsHostAccess(): Promise<boolean> {
  return hasOptionalHostPermissions(['<all_urls>']);
}

/**
 * Is this specific URL covered by any of our currently-granted host
 * permissions (base OR optional)?
 *
 * Used by the permission gate to decide whether a prompt is needed —
 * if the URL is already covered (e.g., because it's on a Matrx-owned
 * host listed in base host_permissions, or because <all_urls> was
 * previously granted), we skip the prompt and silently proceed.
 *
 * Chrome's `permissions.contains({origins})` answers this exactly.
 */
export async function isUrlAlreadyCovered(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const origin = `${u.protocol}//${u.host}/*`;
    return await chrome.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}
