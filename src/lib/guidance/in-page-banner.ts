/**
 * In-page recording banner.
 *
 * Mirrors `src/lib/scrape/user-gate-overlay.ts` — injects a small fixed
 * banner into the recorded tab so the user can see "Recording active …
 * click to stop" without having to switch back to the sidepanel.
 *
 * The banner is purely cosmetic + a stop button. It posts back via
 * `chrome.runtime.sendMessage` on a dedicated channel so the sidepanel
 * can react when the user clicks Stop in the page itself.
 */

import { CHANNELS } from '@/lib/messaging/schemas';
import { log } from '@/lib/debug/log';

const BANNER_ID = '__matrx_guidance_recording_banner__';

export type BannerKind = 'demo' | 'gif';

export async function showRecordingBanner(
  tabId: number,
  kind: BannerKind,
  initialStepCount = 0,
): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: inPageMount,
      args: [BANNER_ID, kind, initialStepCount, CHANNELS.GUIDANCE_BANNER_STOP],
    });
  } catch (err) {
    log.warn('sw', `showRecordingBanner tab=${tabId} failed`, err);
  }
}

export async function updateRecordingBanner(
  tabId: number,
  stepCount: number,
): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: inPageUpdate,
      args: [BANNER_ID, stepCount],
    });
  } catch {
    /* tab may have navigated; banner will re-mount on next tick */
  }
}

export async function hideRecordingBanner(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: inPageUnmount,
      args: [BANNER_ID],
    });
  } catch {
    /* tab might be closed already */
  }
}

// ───────────────────────────────────────────────────────────────────────
// In-page functions — run in the target tab's world. They cannot close
// over module state; pass everything as args.
// ───────────────────────────────────────────────────────────────────────

function inPageMount(
  bannerId: string,
  kind: BannerKind,
  initialStepCount: number,
  stopChannel: string,
): void {
  if (document.getElementById(bannerId)) return;

  const root = document.createElement('div');
  root.id = bannerId;
  Object.assign(root.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '2147483647',
    padding: '8px 12px',
    background: kind === 'demo' ? 'rgba(220, 38, 38, 0.94)' : 'rgba(217, 119, 6, 0.94)',
    color: 'white',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '13px',
    fontWeight: '500',
    borderRadius: '8px',
    boxShadow: '0 6px 16px rgba(0,0,0,0.25)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    pointerEvents: 'auto',
    userSelect: 'none',
  } as Partial<CSSStyleDeclaration>);

  const dot = document.createElement('span');
  Object.assign(dot.style, {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'white',
    animation: 'matrx-pulse 1.2s ease-in-out infinite',
  } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('span');
  label.id = `${bannerId}__label`;
  label.textContent =
    kind === 'demo' ? `Recording demo · ${initialStepCount} steps` : 'Recording GIF';

  const stop = document.createElement('button');
  stop.textContent = 'Stop';
  Object.assign(stop.style, {
    border: '1px solid rgba(255,255,255,0.5)',
    background: 'transparent',
    color: 'white',
    padding: '3px 10px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);
  stop.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ __matrx: true, kind: stopChannel, payload: { bannerKind: kind } });
    } catch {
      /* SW may have died; the sidepanel still has its own stop button */
    }
  });

  root.append(dot, label, stop);

  // Inject keyframes once.
  const style = document.createElement('style');
  style.id = `${bannerId}__style`;
  style.textContent = `
    @keyframes matrx-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.55; transform: scale(0.85); }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(root);
}

function inPageUpdate(bannerId: string, stepCount: number): void {
  const label = document.getElementById(`${bannerId}__label`);
  if (label) label.textContent = `Recording demo · ${stepCount} steps`;
}

function inPageUnmount(bannerId: string): void {
  document.getElementById(bannerId)?.remove();
  document.getElementById(`${bannerId}__style`)?.remove();
}
