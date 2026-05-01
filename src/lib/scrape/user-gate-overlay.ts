/**
 * In-page overlay for Level 3 (user-gated) capture.
 *
 * After the extension navigates + scrolls a Level 3 source, we inject a small
 * fixed-position banner into the page itself with "Capture page" / "Cancel"
 * buttons. The user dismisses popups / signs in / clicks past whatever is in
 * the way, then clicks one of our buttons. The button posts back via
 * chrome.runtime.sendMessage and the side panel finishes the capture flow.
 *
 * Why in-page (not just a side panel button): the user is already focused on
 * the tab — making them switch back to the side panel to click "Go" wastes a
 * cognitive step, and they often forget which row they were on.
 */

import { CHANNELS } from '@/lib/messaging/schemas';
import { log } from '@/lib/debug/log';

const OVERLAY_ID = '__matrx_user_gate_overlay__';

export async function showCaptureOverlay(
  tabId: number,
  topicId: string,
  sourceId: string,
  topicName: string,
): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: inPageMount,
      args: [
        OVERLAY_ID,
        topicId,
        sourceId,
        topicName,
        CHANNELS.TASKS_USER_GO,
        CHANNELS.TASKS_USER_CANCEL,
      ],
    });
  } catch (err) {
    log.warn('scrape', `showCaptureOverlay tab=${tabId} failed`, err);
  }
}

export async function removeCaptureOverlay(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: inPageUnmount,
      args: [OVERLAY_ID],
    });
  } catch {
    /* tab may already be closed; nothing to do */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-page functions — these run in the target tab's world. They cannot close
// over module-level identifiers, so all values are passed as args.
// ─────────────────────────────────────────────────────────────────────────────

function inPageMount(
  overlayId: string,
  topicId: string,
  sourceId: string,
  topicName: string,
  goKind: string,
  cancelKind: string,
): void {
  // Idempotent: replace any existing overlay for this source.
  document.getElementById(overlayId)?.remove();

  const root = document.createElement('div');
  root.id = overlayId;
  root.setAttribute('data-matrx', 'user-gate');
  root.style.cssText = [
    'position:fixed',
    'top:16px',
    'right:16px',
    'z-index:2147483647',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'background:rgba(17,24,39,0.96)',
    'color:#fff',
    'border-radius:12px',
    'box-shadow:0 10px 40px rgba(0,0,0,0.35)',
    'padding:12px 14px',
    'min-width:280px',
    'max-width:340px',
    'font-size:13px',
    'line-height:1.4',
    'backdrop-filter:saturate(150%) blur(8px)',
  ].join(';');

  const heading = document.createElement('div');
  heading.style.cssText = 'font-weight:600;margin-bottom:2px';
  heading.textContent = 'Matrx is ready to capture';
  root.appendChild(heading);

  const sub = document.createElement('div');
  sub.style.cssText = 'color:#9ca3af;font-size:11px;margin-bottom:10px';
  sub.textContent = `${topicName} · click past popups, then capture.`;
  root.appendChild(sub);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.style.cssText = [
    'background:transparent',
    'color:#d1d5db',
    'border:1px solid rgba(255,255,255,0.15)',
    'border-radius:999px',
    'padding:6px 12px',
    'font-size:12px',
    'cursor:pointer',
  ].join(';');
  cancel.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({
        __matrx: true,
        kind: cancelKind,
        payload: { topicId, sourceId },
      });
    } catch {
      /* runtime may be gone */
    }
    document.getElementById(overlayId)?.remove();
  });
  row.appendChild(cancel);

  const go = document.createElement('button');
  go.type = 'button';
  go.textContent = 'Capture page';
  go.style.cssText = [
    'background:#10b981',
    'color:#fff',
    'border:none',
    'border-radius:999px',
    'padding:6px 14px',
    'font-size:12px',
    'font-weight:600',
    'cursor:pointer',
  ].join(';');
  go.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({
        __matrx: true,
        kind: goKind,
        payload: { topicId, sourceId },
      });
    } catch {
      /* runtime may be gone */
    }
    go.textContent = 'Capturing…';
    (go as HTMLButtonElement).disabled = true;
    cancel.style.opacity = '0.5';
  });
  row.appendChild(go);

  root.appendChild(row);
  document.documentElement.appendChild(root);
}

function inPageUnmount(overlayId: string): void {
  document.getElementById(overlayId)?.remove();
}
