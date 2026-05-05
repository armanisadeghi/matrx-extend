/**
 * Helpers for runtime-granted Chrome permissions.
 *
 * Many of our tools depend on permissions the user hasn't granted at install
 * time. The Settings UI surfaces a toggle per permission; flipping it on
 * calls `chrome.permissions.request`. The dispatcher checks whether the
 * permission is granted before running a tool that needs it, and returns a
 * structured error so the UI can prompt.
 */

// Active optional permissions. Each entry here MUST also appear in
// `optional_permissions` in wxt.config.ts — otherwise Chrome silently
// rejects the runtime permission request and the Settings → Advanced
// toggle for it will fail.
export type OptionalPermission =
  | 'debugger'
  | 'cookies'
  | 'pageCapture'
  | 'clipboardRead';

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
