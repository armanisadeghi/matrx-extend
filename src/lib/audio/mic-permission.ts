/**
 * Mic permission helpers for the chat composer's mic button.
 *
 * Design rule (Arman, May 2026 — no claims about prior state):
 *
 *   - The user clicks → we ATTEMPT the live operation (`getUserMedia`).
 *     Outcome of the live attempt drives UI. We NEVER consult
 *     `navigator.permissions.query` — its result for extension mic
 *     state is unreliable across contexts (SW vs sidepanel vs offscreen)
 *     and not actionable. The only authoritative answer is the live
 *     attempt itself.
 *   - When the user has approved at least once, persist that fact so we
 *     don't show the in-app explainer again. We never persist a denial —
 *     the next click always tries again.
 *   - When `getUserMedia` rejects with NotAllowedError after a click, we
 *     pop the recovery modal whose primary CTA opens the settings page
 *     programmatically. The user is never told to type a chrome:// URL.
 *
 * `getMicPermissionState` was REMOVED in 2026-05-09 because its result
 * was the source of a false-positive "Microphone access blocked" modal
 * shown to a user whose Chrome settings showed the extension was NOT
 * blocked. Do not re-introduce it. The live `getUserMedia` is the only
 * trustworthy signal.
 */

const APPROVED_KEY = 'matrx.audio.userApprovedMic';

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
