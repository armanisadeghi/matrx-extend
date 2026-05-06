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
    'border:1px solid rgba(255,255,255,0.08)',
    'border-radius:10px',
    'box-shadow:0 10px 40px rgba(0,0,0,0.4)',
    'padding:14px',
    'width:340px',
    'font-size:13px',
    'line-height:1.4',
    'backdrop-filter:saturate(150%) blur(8px)',
  ].join(';');

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
      b.style.cursor = 'default';
      if (b.dataset.matrxLabel === clickedLabel) {
        if (b.dataset.matrxVariant !== 'icon') {
          b.textContent = clickedLabel.includes('Capture') ? 'Capturing…' : 'Submitting…';
        }
      } else {
        b.style.opacity = '0.35';
      }
    }
  };

  type Variant = 'primary' | 'secondary' | 'verdict' | 'verdictDanger' | 'icon';

  const makeBtn = (label: string, kind: string, variant: Variant): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = variant === 'icon' ? '×' : label;
    if (variant === 'icon') b.setAttribute('aria-label', label);
    b.dataset.matrxLabel = label;
    b.dataset.matrxVariant = variant;

    const variants: Record<Variant, string[]> = {
      primary: [
        'background:#10b981',
        'color:#fff',
        'border:1px solid #10b981',
        'padding:7px 14px',
        'font-weight:600',
        'font-size:12px',
        'border-radius:6px',
      ],
      secondary: [
        'background:rgba(255,255,255,0.06)',
        'color:#e5e7eb',
        'border:1px solid rgba(255,255,255,0.1)',
        'padding:7px 12px',
        'font-weight:500',
        'font-size:12px',
        'border-radius:6px',
      ],
      verdict: [
        'background:transparent',
        'color:#9ca3af',
        'border:1px solid rgba(255,255,255,0.12)',
        'padding:5px 10px',
        'font-weight:500',
        'font-size:11px',
        'border-radius:6px',
      ],
      verdictDanger: [
        'background:transparent',
        'color:#f87171',
        'border:1px solid rgba(239,68,68,0.25)',
        'padding:5px 10px',
        'font-weight:500',
        'font-size:11px',
        'border-radius:6px',
      ],
      icon: [
        'background:transparent',
        'color:#9ca3af',
        'border:none',
        'padding:0 6px',
        'font-size:18px',
        'line-height:1',
        'font-weight:400',
        'border-radius:4px',
      ],
    };
    b.style.cssText = ['cursor:pointer', ...variants[variant]].join(';');

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

  // ── Header: title + × cancel
  const headerRow = document.createElement('div');
  headerRow.style.cssText =
    'display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:12px';

  const titleWrap = document.createElement('div');
  titleWrap.style.cssText = 'flex:1;min-width:0';

  const heading = document.createElement('div');
  heading.style.cssText = 'font-weight:600;font-size:13px';
  heading.textContent = 'Matrx is ready to capture';
  titleWrap.appendChild(heading);

  const sub = document.createElement('div');
  sub.style.cssText = 'color:#9ca3af;font-size:11px;margin-top:2px';
  sub.textContent = `${topicName} · click past popups, then capture.`;
  titleWrap.appendChild(sub);

  headerRow.appendChild(titleWrap);
  headerRow.appendChild(makeBtn('Cancel', cancelKind, 'icon'));
  root.appendChild(headerRow);

  // ── Primary actions: capture (with optional thin-content hint)
  const primaryRow = document.createElement('div');
  primaryRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
  primaryRow.appendChild(makeBtn('Expect thin content', expectThinKind, 'secondary'));
  primaryRow.appendChild(makeBtn('Capture page', goKind, 'primary'));
  root.appendChild(primaryRow);

  // ── Verdicts: report this source as bad
  const verdictWrap = document.createElement('div');
  verdictWrap.style.cssText =
    'margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08)';

  const verdictLabel = document.createElement('div');
  verdictLabel.style.cssText =
    'color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px';
  verdictLabel.textContent = 'Or report this source as';
  verdictWrap.appendChild(verdictLabel);

  const verdictRow = document.createElement('div');
  verdictRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
  verdictRow.appendChild(makeBtn('Gated (login/paywall)', gatedKind, 'verdict'));
  verdictRow.appendChild(makeBtn('404 / dead', deadKind, 'verdictDanger'));
  verdictWrap.appendChild(verdictRow);

  root.appendChild(verdictWrap);
  document.documentElement.appendChild(root);
}

function inPageUnmount(overlayId: string): void {
  document.getElementById(overlayId)?.remove();
}
