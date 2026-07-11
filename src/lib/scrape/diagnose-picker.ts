/**
 * Diagnose-picker overlay — single-pick variant of the field picker.
 *
 * Shadow-DOM injected by `src/entrypoints/diagnose-picker.content.ts`. The
 * user is taken into "pick one thing" mode: hover highlights, single click
 * picks, ESC or the Cancel button bails. The picked element flows through
 * `capturePickPayload` and then back to the side panel via
 * `CHANNELS.DIAGNOSE_PICKER_RESULT`.
 *
 * Intentionally separate from `data-pattern/picker.ts` (which is multi-pick
 * and tailored to building extraction patterns). Shared shape, different
 * intent — and the two should be free to evolve independently.
 */

import { CHANNELS } from '@/lib/messaging/schemas';
import { type DiagnosePickPayload, capturePickPayload } from '@/lib/scrape/diagnose-bundle';

const HOST_ID = 'matrx-diagnose-picker-host';

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let highlight: HTMLElement | null = null;
let mode: 'missing' | 'unwanted' = 'missing';

export function mountDiagnosePicker(initialMode: 'missing' | 'unwanted'): void {
  if (host) return;
  mode = initialMode;
  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all: initial; position: fixed; z-index: 2147483647; inset: 0; pointer-events: none;';
  shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  const modeLabel =
    mode === 'missing'
      ? 'Click the element that SHOULD be in the scrape'
      : "Click the element that SHOULDN'T be in the scrape";

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .banner {
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
        max-width: 520px; pointer-events: auto;
        background: #0c0c0c; color: #f5f5f5; font-family: ui-sans-serif, system-ui;
        font-size: 13px; border-radius: 999px; padding: 8px 14px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4); border: 1px solid #2a2a2a;
        display: flex; align-items: center; gap: 10px;
      }
      .banner .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .banner button {
        all: unset; cursor: pointer; padding: 4px 10px; border-radius: 999px;
        background: #2a2a2a; color: #fff; font-size: 12px;
      }
      .banner button:hover { background: #3a3a3a; }
      .banner .dot {
        width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0;
        background: ${mode === 'missing' ? 'oklch(0.75 0.18 145)' : 'oklch(0.75 0.18 25)'};
      }
      .hl {
        position: fixed; pointer-events: none;
        border: 2px solid ${mode === 'missing' ? 'oklch(0.7 0.2 145)' : 'oklch(0.7 0.2 25)'};
        background: ${mode === 'missing' ? 'oklch(0.7 0.2 145 / 0.15)' : 'oklch(0.7 0.2 25 / 0.15)'};
        border-radius: 4px; transition: all 60ms;
      }
    </style>
    <div class="banner">
      <span class="dot"></span>
      <span class="label">${escapeHtml(modeLabel)}</span>
      <button id="cancel">Cancel (Esc)</button>
    </div>
    <div class="hl" id="hl" style="display:none"></div>
  `;

  highlight = shadow.querySelector('#hl');

  document.addEventListener('mouseover', onHover, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  shadow.querySelector('#cancel')?.addEventListener('click', () => finish(null));
}

export function unmountDiagnosePicker(): void {
  document.removeEventListener('mouseover', onHover, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKey, true);
  host?.remove();
  host = null;
  shadow = null;
  highlight = null;
}

function onHover(e: Event) {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (host?.contains(t) || (t as HTMLElement).id === HOST_ID) return;
  const rect = t.getBoundingClientRect();
  if (highlight) {
    highlight.style.display = 'block';
    highlight.style.top = `${rect.top}px`;
    highlight.style.left = `${rect.left}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  }
}

function onClick(e: Event) {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (host?.contains(t)) return;
  e.preventDefault();
  e.stopPropagation();
  let payload: DiagnosePickPayload | null = null;
  try {
    payload = capturePickPayload(t);
  } catch (err) {
    console.warn('[matrx-extend] diagnose capture failed', err);
  }
  finish(payload);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    finish(null);
  }
}

function finish(payload: DiagnosePickPayload | null) {
  const kind = payload ? CHANNELS.DIAGNOSE_PICKER_RESULT : CHANNELS.DIAGNOSE_PICKER_EXIT;
  void chrome.runtime.sendMessage({
    __matrx: true,
    kind,
    payload: payload ? { ...payload, mode } : { mode },
  });
  unmountDiagnosePicker();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
