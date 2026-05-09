/**
 * Pre-flight microphone permission state for the chat composer's mic
 * button.
 *
 * Why this exists separately from `mic-recorder-offscreen.ts`: the recorder
 * lives in the offscreen document because Chrome MV3 side panels can't
 * reliably hold a `getUserMedia` MediaStream. But the side panel (where
 * the button lives) CAN call `navigator.permissions.query({name:
 * 'microphone'})` cheaply and synchronously, and the answer is enough to
 * decide whether to:
 *
 *   - 'granted'    → start recording immediately, no UX needed.
 *   - 'prompt'     → show the in-app explainer modal so the user knows
 *                    what's about to happen, THEN trigger getUserMedia
 *                    in the offscreen doc (which surfaces the native
 *                    Chrome prompt).
 *   - 'denied'     → show the "blocked, here's how to unblock" modal —
 *                    Chrome refuses to re-prompt programmatically once
 *                    denied, so we deep-link to the chrome://settings
 *                    page that holds the actual fix.
 *   - 'unsupported' → fall back to attempting getUserMedia anyway and
 *                    hope for the best (very rare path).
 */

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
