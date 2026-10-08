/**
 * The ONE way the extension obtains microphone permission. Chrome cannot show its permission prompt
 * inside a side panel or an offscreen document, so the grant is asked in a small popup window
 * (`mic-grant.html`, a normal browser context); once granted for the extension origin every
 * extension context inherits it. The popup reports its outcome on `CHANNELS.MIC_GRANT_RESULT`.
 *
 * Both chats use this: the extension's own chat (ChatView) opens the window and retries on the
 * result message; the package chat (`features/package-chat/host.ts`) hands `requestMicrophoneGrant`
 * to the package as its `microphone` port.
 */

import { log } from '@/lib/debug/log';
import { CHANNELS } from '@/lib/messaging/schemas';

/** Open the grant window. Throws if Chrome refuses to create it. */
export async function openMicGrantWindow(): Promise<void> {
  await chrome.windows.create({
    url: chrome.runtime.getURL('mic-grant.html'),
    type: 'popup',
    width: 400,
    height: 280,
    focused: true,
  });
}

/** How long the person has to answer Chrome's prompt before the request counts as declined. */
export const MIC_GRANT_TIMEOUT_MS = 120_000;

/** Open the grant window and resolve `true` once the person allowed it, `false` if they declined or never answered. */
export function requestMicrophoneGrant(timeoutMs: number = MIC_GRANT_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (granted: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(listener);
      resolve(granted);
    };
    const listener = (msg: unknown): boolean => {
      const m = msg as { __matrx?: unknown; kind?: unknown; payload?: { granted?: unknown } } | null;
      if (m && m.__matrx === true && m.kind === CHANNELS.MIC_GRANT_RESULT) {
        finish(m.payload?.granted === true);
      }
      return false;
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.runtime.onMessage.addListener(listener);
    openMicGrantWindow().catch((error: unknown) => {
      log.error('audio', 'mic-grant: failed to open the grant window', error);
      finish(false);
    });
  });
}
