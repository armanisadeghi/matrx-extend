/**
 * Mic permission helpers for the chat composer's mic button.
 *
 * Design rule (Arman, May 2026 — "no terminal denied state"):
 *
 *   - The user clicks → we ATTEMPT the live operation (or live request).
 *     Outcome of the live attempt drives UI; never a stored "previously
 *     denied" flag.
 *   - When the user has approved at least once, persist that fact so we
 *     don't show the in-app explainer again. We never persist a denial —
 *     the next click always tries again.
 *   - When `getUserMedia` rejects with NotAllowedError after a click, we
 *     pop the recovery modal whose primary CTA opens the settings page
 *     programmatically. The user is never told to type a chrome:// URL.
 *
 * Why we still keep `getMicPermissionState`: as a hint to skip the
 * "Enable voice input?" explainer when Chrome already reports `granted`,
 * and to launch the explainer for first-time users. It is NEVER used to
 * refuse outright.
 */

const APPROVED_KEY = 'matrx.audio.userApprovedMic';

export type MicPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

/**
 * Return the current microphone permission state. Safe to call from any
 * context that has `navigator.permissions` (sidepanel, offscreen,
 * content scripts). Never throws.
 */
export async function getMicPermissionState(): Promise<MicPermissionState> {
  if (typeof navigator === 'undefined' || typeof navigator.permissions?.query !== 'function') {
    return 'unsupported';
  }
  try {
    const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (result.state === 'granted' || result.state === 'denied' || result.state === 'prompt') {
      return result.state;
    }
    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/**
 * Has the user previously approved mic access via our flow? When `true`,
 * future clicks skip the in-app explainer and try `getUserMedia` directly.
 * If that live attempt later fails (e.g. user revoked the permission via
 * Chrome settings) we surface the recovery modal — we NEVER refuse based
 * on this flag.
 */
export async function hasUserApprovedMic(): Promise<boolean> {
  try {
    const got = await chrome.storage?.local?.get?.(APPROVED_KEY);
    return Boolean(got?.[APPROVED_KEY]);
  } catch {
    return false;
  }
}

export async function rememberUserApprovedMic(): Promise<void> {
  try {
    await chrome.storage?.local?.set?.({ [APPROVED_KEY]: true });
  } catch {
    /* storage unavailable — best-effort */
  }
}
