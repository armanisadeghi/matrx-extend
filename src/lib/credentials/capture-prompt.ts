/**
 * In-page "Save this login?" toast — CONTENT SCRIPT side. Shown when the
 * service worker sends `CHANNELS.CREDENTIAL_CAPTURE_PROMPT` to this tab after
 * the detector (capture-detector.ts) reported a submitted login.
 *
 * It renders METADATA only (site host, the username the user typed, the names
 * of existing saved logins) inside a closed Shadow DOM — the page cannot reach
 * in, and no credential value exists on this side any more. Every button posts
 * a value-free decision back to the SW and shows the SW's fixed reply copy.
 *
 * Plain DOM + inline styles on purpose: this is part of the content bundle
 * (no React, no Tailwind, no zod).
 */

import { CHANNELS } from '@/lib/messaging/schemas';
import type { CaptureDecision, CaptureDecisionResult, CapturePromptMeta } from './capture-types';

const HOST_ID = 'matrx-login-capture-host';
/** Leave the toast alone after this long — the side-panel card still offers it. */
const AUTO_HIDE_MS = 25_000;

let current: { host: HTMLElement; timer: number | null } | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.setAttribute('style', style);
  if (text !== undefined) node.textContent = text;
  return node;
}

const BTN =
  'font:500 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;padding:7px 10px;border-radius:6px;border:1px solid rgba(0,0,0,.12);cursor:pointer;background:#fff;color:#111;';
const BTN_PRIMARY = `${BTN}background:#111;color:#fff;border-color:#111;`;
const BTN_GHOST = `${BTN}background:transparent;border-color:transparent;color:#555;`;

export function dismissCapturePrompt(): void {
  if (!current) return;
  if (current.timer !== null) window.clearTimeout(current.timer);
  current.host.remove();
  current = null;
}

async function decide(decision: CaptureDecision): Promise<CaptureDecisionResult> {
  try {
    const r = (await chrome.runtime.sendMessage({
      __matrx: true,
      kind: CHANNELS.CREDENTIAL_CAPTURE_DECISION,
      payload: decision,
    })) as CaptureDecisionResult | undefined;
    return r ?? { ok: false, status: 'error', message: 'Matrx did not answer. Try again.' };
  } catch {
    return { ok: false, status: 'error', message: 'Matrx did not answer. Try again.' };
  }
}

/** Mount (or replace) the toast for `meta`. Idempotent per candidate. */
export function showCapturePrompt(meta: CapturePromptMeta): void {
  dismissCapturePrompt();
  if (!document.body) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('style', 'position:fixed;top:12px;right:12px;z-index:2147483647;all:initial;');
  const shadow = host.attachShadow({ mode: 'closed' }); /* closed: page can't reach in */

  const card = el(
    'div',
    'box-sizing:border-box;width:320px;max-width:calc(100vw - 24px);padding:12px 12px 10px;border-radius:10px;background:#fff;color:#111;box-shadow:0 8px 30px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.06);font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;',
  );
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Save login to Matrx Vault');

  const title = el(
    'div',
    'font-weight:600;font-size:13px;margin-bottom:2px;',
    'Save this login to your Matrx Vault?',
  );
  const sub = el(
    'div',
    'color:#555;font-size:12px;margin-bottom:10px;word-break:break-all;',
    meta.username ? `${meta.host} · ${meta.username}` : meta.host,
  );
  const actions = el('div', 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;');
  const status = el('div', 'margin-top:8px;color:#555;font-size:12px;min-height:0;');

  let busy = false;
  const finish = async (decision: CaptureDecision, pendingCopy: string) => {
    if (busy) return;
    busy = true;
    status.textContent = pendingCopy;
    for (const b of Array.from(actions.querySelectorAll('button'))) b.disabled = true;
    const result = await decide(decision);
    status.textContent = result.message;
    if (result.ok || result.status === 'expired') {
      window.setTimeout(dismissCapturePrompt, 1800);
    } else {
      busy = false;
      for (const b of Array.from(actions.querySelectorAll('button'))) b.disabled = false;
    }
  };

  if (meta.existing.length > 0) {
    // One existing login → "Update <name>"; several → one button each.
    for (const item of meta.existing.slice(0, 3)) {
      const b = el('button', BTN_PRIMARY, `Update ${item.display_name}`);
      b.addEventListener(
        'click',
        () =>
          void finish(
            { candidateId: meta.candidateId, action: 'update', itemId: item.item_id },
            'Updating…',
          ),
      );
      actions.appendChild(b);
    }
    const asNew = el('button', BTN, 'Save as new');
    asNew.addEventListener(
      'click',
      () => void finish({ candidateId: meta.candidateId, action: 'save' }, 'Saving…'),
    );
    actions.appendChild(asNew);
  } else {
    const save = el('button', BTN_PRIMARY, 'Save');
    save.addEventListener(
      'click',
      () => void finish({ candidateId: meta.candidateId, action: 'save' }, 'Saving…'),
    );
    actions.appendChild(save);
  }

  const notNow = el('button', BTN_GHOST, 'Not now');
  notNow.addEventListener('click', () => {
    void decide({ candidateId: meta.candidateId, action: 'dismiss' });
    dismissCapturePrompt();
  });
  actions.appendChild(notNow);

  const never = el('button', BTN_GHOST, 'Never for this site');
  never.addEventListener(
    'click',
    () => void finish({ candidateId: meta.candidateId, action: 'never' }, 'Okay…'),
  );
  actions.appendChild(never);

  card.appendChild(title);
  card.appendChild(sub);
  card.appendChild(actions);
  card.appendChild(status);
  shadow.appendChild(card);
  document.body.appendChild(host);

  current = { host, timer: window.setTimeout(dismissCapturePrompt, AUTO_HIDE_MS) };
}
