/**
 * Permission gate — the single entrypoint any feature uses to obtain an
 * optional Chrome permission. See `state/permission-prompts.ts` for the
 * design philosophy.
 *
 * ⚠️ DORMANT (2026-05-25): `ensurePermission` / `showPrompt` currently have
 * NO callers. The SW tool dispatcher gates optional permissions via
 * `hasOptionalPermissions` directly and returns a structured error rather than
 * prompting — because `chrome.permissions.request` may only be called from a
 * foreground user gesture (the sidepanel), NOT from the service worker where
 * the dispatcher runs. Wiring this requires a SW→sidepanel round-trip: the SW
 * signals "permission needed", the sidepanel runs `ensurePermission` inside a
 * gesture, then reports the result back so the dispatcher can resume. Until
 * that flow exists, this module + PermissionPromptModal + the prompt store are
 * intentionally inert (no user-visible control depends on them — the modal
 * renders null with no active prompt). Tracked in matrx-feedback; do not
 * delete without porting the frictionless-grant UX.
 *
 * Resolution order, in priority:
 *   1. If Chrome already reports the permission as granted → return true.
 *      The gate is invisible. (This covers the case where the user
 *      already granted broad host access in a prior session.)
 *   2. If the user's "autonomous" flag is on, OR they checked
 *      "always allow" for this specific permission → silently call
 *      chrome.permissions.request and return whatever it returns.
 *   3. Otherwise → render a 4-button modal in the sidepanel and await
 *      the user's verdict. Apply the verdict (request the perm if the
 *      user said yes, cache the always-flag if they said so).
 *
 * Result: never silently rejects. The only way the gate returns false
 * is if the user explicitly clicks Deny, OR Chrome rejected the
 * permission request (user dismissed Chrome's confirmation dialog).
 */

import { log } from '@/lib/debug/log';
import { hasOptionalPermissions, requestOptionalPermission } from '@/lib/permissions/optional';
import {
  type GatedPermission,
  type PermissionVerdict,
  keyOf,
  usePermissionPromptsStore,
} from '@/state/permission-prompts';

let nextId = 1;

export interface EnsurePermissionResult {
  granted: boolean;
  verdict: PermissionVerdict | 'preexisting';
}

export interface EnsurePermissionOptions {
  permission: GatedPermission;
  /** Short feature name shown as the modal title. */
  feature: string;
  /** One- or two-sentence reason. */
  reason: string;
}

/**
 * The single entrypoint. Returns `{ granted, verdict }`.
 *
 *   - granted = true  → the operation may proceed.
 *   - granted = false → the user explicitly denied, OR Chrome refused
 *                       the runtime request. The caller should abort
 *                       gracefully (no silent retries, no "go to settings"
 *                       redirects — the user just said no).
 */
export async function ensurePermission(
  opts: EnsurePermissionOptions,
): Promise<EnsurePermissionResult> {
  const { permission, feature, reason } = opts;

  // Step 1 — Chrome already reports it as granted.
  if (await isLiveGranted(permission)) {
    return { granted: true, verdict: 'preexisting' };
  }

  // Step 2 — user has previously chosen "Always" for this perm,
  // or "Autonomous" globally. Silently grant.
  const store = usePermissionPromptsStore.getState();
  const cacheKey = keyOf(permission);
  if (store.autonomous || store.alwaysAllow[cacheKey]) {
    const granted = await requestPermission(permission);
    return {
      granted,
      verdict: store.autonomous ? 'autonomous' : 'always',
    };
  }

  // Step 3 — show the modal. The PermissionPromptModal component (mounted
  // once in the sidepanel App) renders whatever's in `active` and calls
  // `resolveActive` when the user clicks a button.
  const verdict = await showPrompt({ permission, feature, reason });

  if (verdict === 'deny') {
    return { granted: false, verdict };
  }

  // 'allow' / 'always' / 'autonomous' all imply the user wants it.
  // Cache the user's preference BEFORE the Chrome dialog so a transient
  // rejection of the Chrome confirmation doesn't lose their intent.
  if (verdict === 'always') {
    store.setAlwaysAllow(cacheKey, true);
  } else if (verdict === 'autonomous') {
    store.setAutonomous(true);
  }

  const granted = await requestPermission(permission);
  return { granted, verdict };
}

/** Convenience: does the user need to be bothered, or do we already have it? */
export async function hasPermissionOrAlways(permission: GatedPermission): Promise<boolean> {
  if (await isLiveGranted(permission)) return true;
  const s = usePermissionPromptsStore.getState();
  return s.autonomous || !!s.alwaysAllow[keyOf(permission)];
}

async function isLiveGranted(permission: GatedPermission): Promise<boolean> {
  return hasOptionalPermissions([permission.name]);
}

async function requestPermission(permission: GatedPermission): Promise<boolean> {
  try {
    return await requestOptionalPermission(permission.name);
  } catch (err) {
    log.warn('sys', 'permission request threw', (err as Error).message);
    return false;
  }
}

function showPrompt(args: {
  permission: GatedPermission;
  feature: string;
  reason: string;
}): Promise<PermissionVerdict> {
  return new Promise<PermissionVerdict>((resolve) => {
    const id = `perm-${nextId++}-${Date.now().toString(36)}`;
    usePermissionPromptsStore.getState().enqueue({
      id,
      permission: args.permission,
      feature: args.feature,
      reason: args.reason,
      resolve,
    });
  });
}
