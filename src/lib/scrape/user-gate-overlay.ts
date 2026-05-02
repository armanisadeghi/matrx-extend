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
        CHANNELS.TASKS_USER_DEAD,
        CHANNELS.TASKS_USER_EXPECT_THIN,
        CHANNELS.TASKS_USER_GATED,
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
  deadKind: string,
  expectThinKind: string,
  gatedKind: string,
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
    'min-width:300px',
    'max-width:360px',
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

  const allButtons: HTMLButtonElement[] = [];

  const send = (kind: string) => {
    try {
      chrome.runtime.sendMessage({
        __matrx: true,
        kind,
        payload: { topicId, sourceId },
      });
    } catch {
      /* runtime may be gone */
    }
  };

  const lockButtons = (clickedLabel: string) => {
    for (const b of allButtons) {
      b.disabled = true;
      if (b.textContent === clickedLabel) {
        b.textContent = clickedLabel.includes('Capture') ? 'Capturing…' : 'Submitting…';
      } else {
        b.style.opacity = '0.4';
      }
    }
  };

  const makeBtn = (
    label: string,
    kind: string,
    style: 'primary' | 'secondary' | 'ghost' | 'danger',
  ): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    const base = [
      'border:none',
      'border-radius:999px',
      'padding:6px 12px',
      'font-size:12px',
      'cursor:pointer',
      'font-weight:500',
    ];
    const variants: Record<typeof style, string[]> = {
      primary: ['background:#10b981', 'color:#fff', 'font-weight:600'],
      secondary: ['background:rgba(255,255,255,0.1)', 'color:#e5e7eb'],
      ghost: ['background:transparent', 'color:#d1d5db', 'border:1px solid rgba(255,255,255,0.15)'],
      danger: ['background:rgba(239,68,68,0.15)', 'color:#fca5a5', 'border:1px solid rgba(239,68,68,0.3)'],
    };
    b.style.cssText = [...base, ...variants[style]].join(';');
    b.addEventListener('click', () => {
      send(kind);
      lockButtons(label);
      // Cancel removes the overlay synchronously; the others wait for the
      // sidepanel handler to call removeCaptureOverlay.
      if (kind === cancelKind) document.getElementById(overlayId)?.remove();
    });
    allButtons.push(b);
    return b;
  };

  // Two-row layout. Top row = primary actions (Capture / Expect thin).
  // Bottom row = pre-decided verdicts (404 / gated) and Cancel.
  const topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap';
  topRow.appendChild(makeBtn('Expect thin content', expectThinKind, 'secondary'));
  topRow.appendChild(makeBtn('Capture page', goKind, 'primary'));

  const bottomRow = document.createElement('div');
  bottomRow.style.cssText =
    'display:flex;gap:6px;justify-content:flex-end;align-items:center;margin-top:8px;flex-wrap:wrap';
  bottomRow.appendChild(makeBtn('Cancel', cancelKind, 'ghost'));
  bottomRow.appendChild(makeBtn('Gated (login/paywall)', gatedKind, 'secondary'));
  bottomRow.appendChild(makeBtn('Page is 404 / dead', deadKind, 'danger'));

  root.appendChild(topRow);
  root.appendChild(bottomRow);
  document.documentElement.appendChild(root);
}

function inPageUnmount(overlayId: string): void {
  document.getElementById(overlayId)?.remove();
}
