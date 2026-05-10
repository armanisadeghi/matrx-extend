/**
 * Microphone permission grant page.
 *
 * Why this exists:
 *   In Chrome MV3, calling `navigator.mediaDevices.getUserMedia({audio:true})`
 *   from the side panel (or the offscreen document) does NOT reliably show
 *   Chrome's native permission prompt. The call rejects silently with
 *   `NotAllowedError`, leaving the user stranded — no Chrome UI ever
 *   appeared, so they have no way to grant access.
 *
 *   A real Chrome popup window (chrome.windows.create({type: 'popup'})) is
 *   a normal browser context. Its `getUserMedia` call shows the standard
 *   prompt next to the URL bar, exactly like a website would. Once granted
 *   for the extension origin, ALL extension contexts (sidepanel, offscreen)
 *   inherit the grant — they share `chrome-extension://<id>` as the origin.
 *
 * Flow:
 *   - User clicks "Allow microphone".
 *   - We call getUserMedia. Chrome shows its native prompt.
 *   - On grant: stop tracks (we don't record here), tell the side panel
 *     via runtime.sendMessage, auto-close after a short success message.
 *   - On reject: show the error, let the user manually close. No retry
 *     loop — they can re-trigger by clicking the mic again in the side
 *     panel.
 *
 * The page is intentionally tiny — fast to load, no React, no shared
 * runtime. Failing to render this page would block mic permission acquisition
 * entirely, so its dependency footprint is zero.
 */

import { CHANNELS } from '@/lib/messaging/schemas';

const allowBtn = document.getElementById('allow') as HTMLButtonElement | null;
const closeBtn = document.getElementById('close') as HTMLButtonElement | null;
const statusEl = document.getElementById('status') as HTMLDivElement | null;

function setStatus(text: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.remove('ok', 'err');
  if (kind === 'ok') statusEl.classList.add('ok');
  if (kind === 'err') statusEl.classList.add('err');
}

function notifySidePanel(payload: {
  granted: boolean;
  reason?: string;
  errorName?: string;
}): void {
  // Best-effort broadcast — if the side panel is closed when this fires, the
  // message goes nowhere and that's fine. The side panel only listens to drive
  // an automatic retry on grant; on the no-listener path it'll just no-op.
  try {
    void chrome.runtime.sendMessage({
      __matrx: true,
      kind: CHANNELS.MIC_GRANT_RESULT,
      payload,
    });
  } catch {
    // Ignore — the popup is closing anyway.
  }
}

async function requestMicPermission(): Promise<void> {
  if (!allowBtn) return;
  allowBtn.disabled = true;
  setStatus('Waiting for Chrome…', 'info');

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const e = err as DOMException;
    const denied =
      e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError';
    const noDevice =
      e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError';
    const reasonHuman = denied
      ? 'Permission denied. Click the mic icon in the address bar to change this, then close and retry.'
      : noDevice
        ? 'No microphone detected. Plug one in and try again.'
        : (e.message ?? 'Microphone access failed.');
    setStatus(reasonHuman, 'err');
    notifySidePanel({ granted: false, reason: reasonHuman, errorName: e.name });
    allowBtn.disabled = false;
    return;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }

  setStatus('Granted! Closing…', 'ok');
  notifySidePanel({ granted: true });
  setTimeout(() => {
    try {
      window.close();
    } catch {
      /* may be ignored if the window was opened differently */
    }
  }, 1500);
}

allowBtn?.addEventListener('click', () => {
  void requestMicPermission();
});

closeBtn?.addEventListener('click', () => {
  // Closing without acting counts as not-granted but we don't override an
  // earlier success message — only emit the cancel event when we never made
  // a real attempt.
  if (statusEl?.classList.contains('ok')) {
    window.close();
    return;
  }
  notifySidePanel({ granted: false, reason: 'cancelled' });
  window.close();
});
