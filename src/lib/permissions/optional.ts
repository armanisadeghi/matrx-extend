/**
 * Helpers for runtime-granted Chrome permissions.
 *
 * Some of our tools depend on permissions the user hasn't granted at install
 * time. The Settings UI surfaces a toggle per permission; flipping it on
 * calls `chrome.permissions.request`. The dispatcher checks whether the
 * permission is granted before running a tool that needs it, and returns a
 * structured error so the UI can prompt.
 *
 * (Optional host permissions are intentionally NOT supported — broad host
 * access lives in base `host_permissions` so the agent can read / interact
 * with any page without the user fighting a "go to Settings" dialog. See
 * the 2026-05-08 revert of roadmap item #10's `<all_urls>` opt-in.)
 */

// Chrome's debugger permission is required in the manifest: Chrome forbids it
// in optional_permissions and will not remove it at runtime. Keep it in the
// capability type for tool checks, but never offer it to request/remove.
export type OptionalPermission =
  | 'debugger'
  | 'cookies'
  | 'pageCapture'
  | 'clipboardRead'
  | 'tabCapture';

// Every runtime permission here MUST also appear in optional_permissions in
// wxt.config.ts. This type is the Settings switch/request/remove contract.
export type RuntimeOptionalPermission = Exclude<OptionalPermission, 'debugger'>;

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

export const OPTIONAL_PERMISSION_LABELS: Record<
  RuntimeOptionalPermission,
  { title: string; desc: string }
> = {
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

export async function requestOptionalPermission(perm: RuntimeOptionalPermission): Promise<boolean> {
  return chrome.permissions.request({ permissions: [perm] });
}

export async function removeOptionalPermission(perm: RuntimeOptionalPermission): Promise<boolean> {
  return chrome.permissions.remove({ permissions: [perm] });
}

export async function listGrantedOptional(): Promise<RuntimeOptionalPermission[]> {
  const got = await chrome.permissions.getAll();
  const granted = (got.permissions ?? []) as string[];
  return granted.filter((p): p is RuntimeOptionalPermission =>
    Object.prototype.hasOwnProperty.call(OPTIONAL_PERMISSION_LABELS, p),
  );
}

export const ALL_OPTIONAL: RuntimeOptionalPermission[] = Object.keys(
  OPTIONAL_PERMISSION_LABELS,
) as RuntimeOptionalPermission[];

/** Only permissions declared by this browser build may be offered as switches. */
export function declaredRuntimeOptionalPermissions(): RuntimeOptionalPermission[] {
  const declared = new Set(chrome.runtime.getManifest().optional_permissions ?? []);
  return ALL_OPTIONAL.filter((permission) => declared.has(permission));
}

/** Tool messaging and roster badges use this build's manifest as one source. */
export function classifyDeclaredPermissions(perms: string[]): {
  required: string[];
  optional: string[];
  unavailable: string[];
} {
  const manifest = chrome.runtime.getManifest();
  const required = new Set(manifest.permissions ?? []);
  const optional = new Set(manifest.optional_permissions ?? []);
  return {
    required: perms.filter((permission) => required.has(permission)),
    optional: perms.filter((permission) => optional.has(permission)),
    unavailable: perms.filter(
      (permission) => !required.has(permission) && !optional.has(permission),
    ),
  };
}

/** A concise badge that never calls an installation grant optional. */
export function permissionRequirementLabel(perms: string[]): string {
  const { required, optional, unavailable } = classifyDeclaredPermissions(perms);
  if (unavailable.length) return 'unavailable';
  if (required.length && optional.length) return 'mixed perms';
  if (required.length) return 'req-perm';
  return 'opt-perm';
}

/** Remediation follows the permission declarations in this browser build. */
export function missingPermissionRemedy(perms: string[]): string {
  const { required, optional, unavailable } = classifyDeclaredPermissions(perms);
  const remedies: string[] = [];
  if (required.length) {
    remedies.push(
      `Required Chrome permission(s) [${required.join(', ')}] cannot be enabled in Settings. Check this extension's access in Chrome or use a browser build that includes them.`,
    );
  }
  if (optional.length) {
    remedies.push(
      `Ask the user to enable optional permission(s) [${optional.join(', ')}] in Settings → Advanced agent capabilities, then retry.`,
    );
  }
  if (unavailable.length) {
    remedies.push(
      `Permission(s) [${unavailable.join(', ')}] are not declared by this browser build. Use a build that supports them.`,
    );
  }
  return remedies.join(' ');
}

/**
 * Is this specific URL covered by any of our currently-granted host
 * permissions?
 *
 * Used by the permission gate to decide whether a prompt is needed —
 * if the URL is already covered (it almost always is, since `<all_urls>`
 * is in base host_permissions), we skip the prompt and silently proceed.
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
