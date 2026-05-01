/**
 * Helpers for runtime-granted Chrome permissions.
 *
 * Many of our tools depend on permissions the user hasn't granted at install
 * time. The Settings UI surfaces a toggle per permission; flipping it on
 * calls `chrome.permissions.request`. The dispatcher checks whether the
 * permission is granted before running a tool that needs it, and returns a
 * structured error so the UI can prompt.
 */

export type OptionalPermission =
  | 'debugger'
  | 'cookies'
  | 'pageCapture'
  | 'userScripts'
  | 'proxy'
  | 'webRequest'
  | 'desktopCapture'
  | 'topSites'
  | 'management';

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
  userScripts: {
    title: 'User scripts',
    desc: 'Reserved — execute user-script style modifications (Tampermonkey-like).',
  },
  proxy: {
    title: 'Proxy',
    desc: 'Reserved — control the browser\'s proxy configuration.',
  },
  webRequest: {
    title: 'Web request observation',
    desc: 'Reserved — observe network requests for ad blocking / debugging.',
  },
  desktopCapture: {
    title: 'Desktop capture',
    desc: 'Reserved — capture screen / window for screen-sharing-style workflows.',
  },
  topSites: {
    title: 'Top sites',
    desc: 'Reserved — read the user\'s most-visited sites.',
  },
  management: {
    title: 'Extension management',
    desc: 'Reserved — list and manage other installed extensions.',
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
