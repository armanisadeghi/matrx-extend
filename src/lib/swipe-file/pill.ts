/** Branded social capture control, isolated from site styles with open shadow DOM. */
import { SWIPE_PORT, type SwipeClientMsg, type SwipeHostMsg } from '@/lib/swipe-file/host';
import { SWIPE_OPEN_KEY, swipePostWebUrl } from '@/lib/swipe-file/navigation';
import { captureReceiptSummary } from '@/lib/swipe-file/receipt';
import type { SwipeOutcome } from '@/lib/swipe-file/save';
import { swipeTargetFromUrl } from '@/lib/swipe-file/urls';

const NEW = '__new__';
const option = (name: string, value: string) => {
  const el = document.createElement('option');
  el.textContent = name;
  el.value = value;
  return el;
};

export function mountSwipePill(): void {
  if ((window as unknown as { __matrxSwipePill?: boolean }).__matrxSwipePill) return;
  (window as unknown as { __matrxSwipePill?: boolean }).__matrxSwipePill = true;
  const host = document.createElement('div');
  host.id = 'matrx-swipe-pill';
  host.setAttribute('aria-label', 'Matrx swipe file');
  host.style.cssText =
    'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646;max-width:calc(100vw - 32px);';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
:host{color-scheme:dark}*{box-sizing:border-box}
.card{font:13px/1.4 system-ui,sans-serif;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:12px;box-shadow:0 8px 30px #0006;padding:10px;width:320px;max-width:calc(100vw - 32px);display:flex;flex-direction:column;gap:8px}
.row{display:flex;gap:8px;align-items:center;min-width:0}.logo{width:24px;height:24px;flex:none}.controls{display:flex;gap:6px;min-width:0;flex:1}
select,input{min-width:0;background:#1f2937;color:#f9fafb;border:1px solid #4b5563;border-radius:6px;padding:6px;font:inherit}select{flex:1;width:0}input{width:100%}
button,a{font:inherit}button{background:#2563eb;color:#fff;border:0;border-radius:6px;padding:7px 9px;cursor:pointer;white-space:nowrap}button:disabled{opacity:.6;cursor:default}
.feedback{border-top:1px solid #374151;padding-top:8px;display:flex;flex-direction:column;gap:5px;min-width:0}.status{display:flex;align-items:flex-start;gap:6px;font-weight:600}.mark{flex:none}.msg,.summary,.notice{overflow-wrap:anywhere}.summary{font-size:12px;color:#d1d5db}.notice{font-size:12px;color:#fcd34d;max-height:100px;overflow:auto}.ok{color:#86efac}.warn{color:#fcd34d}.bad{color:#fca5a5}
.links{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding-top:3px}.links button{padding:0;background:none;color:#93c5fd}.links a{color:#93c5fd;text-decoration:none}.links a:hover,.links button:hover{text-decoration:underline}
:focus-visible{outline:2px solid #93c5fd;outline-offset:2px}[hidden]{display:none!important}
</style>
<section class="card" aria-label="Matrx swipe file">
 <div class="row"><img class="logo" alt="Matrx" /><div class="controls"><select id="col" aria-label="Collection"></select><button id="save">Save to swipe file</button></div></div>
 <input id="newname" placeholder="Collection name" aria-label="New collection name" hidden />
 <div id="feedback" class="feedback" hidden>
  <div class="status" role="status" aria-live="polite"><span id="mark" class="mark" aria-hidden="true"></span><span id="msg" class="msg"></span></div>
  <div id="summary" class="summary" hidden></div><div id="notice" class="notice" hidden></div>
  <div id="links" class="links" hidden><button id="review">View in extension</button><a id="web" target="_blank" rel="noopener noreferrer">Open in Matrx ↗</a></div>
 </div>
</section>`;
  const $ = <T extends HTMLElement>(id: string) => root.getElementById(id) as T;
  root.querySelector<HTMLImageElement>('.logo')!.src = chrome.runtime.getURL('icon/48.png');
  const col = $<HTMLSelectElement>('col');
  const save = $<HTMLButtonElement>('save');
  const newname = $<HTMLInputElement>('newname');
  const feedback = $('feedback');
  const msg = $('msg');
  const mark = $('mark');
  const summary = $('summary');
  const notice = $('notice');
  const links = $('links');
  const web = $<HTMLAnchorElement>('web');
  let port: chrome.runtime.Port | null = null;
  let loaded = false;
  let currentUrl: string | null = null;
  let savingUrl: string | null = null;
  let saved: Extract<SwipeOutcome, { status: 'saved' | 'already_saved' }> | null = null;

  function say(text: string, cls = '', symbol = '') {
    feedback.hidden = !text;
    msg.textContent = text;
    msg.className = `msg ${cls}`;
    mark.textContent = symbol;
    mark.className = `mark ${cls}`;
  }
  function clearResult() {
    saved = null;
    summary.hidden = notice.hidden = links.hidden = true;
    web.removeAttribute('href');
  }
  function send(message: SwipeClientMsg) {
    try {
      if (!port) {
        port = chrome.runtime.connect({ name: SWIPE_PORT });
        port.onMessage.addListener(onHost);
        port.onDisconnect.addListener(() => {
          port = null;
          if (save.disabled) {
            save.disabled = false;
            say('Connection lost. Check Swipe file before retrying.', 'bad', '!');
          }
        });
      }
      port.postMessage(message);
    } catch {
      save.disabled = false;
      say('Matrx was updated. Reload this page.', 'bad', '!');
    }
  }
  function onHost(message: SwipeHostMsg) {
    if (message.t === 'collections') {
      loaded = true;
      const selected = col.value;
      col.replaceChildren();
      for (const c of message.collections) col.add(option(c.name, c.id));
      col.add(option('New collection…', NEW));
      col.value = message.collections.some((c) => c.id === selected)
        ? selected
        : message.lastId && message.collections.some((c) => c.id === message.lastId)
          ? message.lastId
          : (message.collections[0]?.id ?? NEW);
      newname.hidden = col.value !== NEW;
    } else if (message.t === 'collections_error') {
      col.replaceChildren(option('New collection…', NEW));
      newname.hidden = false;
      say(message.reason, 'bad', '!');
    } else if (message.t === 'progress') {
      if (savingUrl === currentUrl) say(`${message.label}…`, '', '◌');
    } else if (message.t === 'result') {
      save.disabled = false;
      if (savingUrl !== currentUrl) return;
      savingUrl = null;
      const outcome = message.outcome;
      if (outcome.status === 'failed') say(`Not saved: ${outcome.reason}`, 'bad', '!');
      else {
        saved = outcome;
        say(
          outcome.status === 'saved' ? 'Saved to collection' : 'Already in collection',
          outcome.notice ? 'warn' : 'ok',
          '✓',
        );
        summary.textContent = captureReceiptSummary(outcome.receipt);
        summary.hidden = false;
        notice.textContent = outcome.notice;
        notice.hidden = !outcome.notice;
        web.href = swipePostWebUrl(outcome.postId, outcome.receipt.organizationId);
        links.hidden = false;
        send({ t: 'list' });
      }
    }
  }
  col.addEventListener('change', () => {
    newname.hidden = col.value !== NEW;
  });
  save.addEventListener('click', () => {
    if (!currentUrl || save.disabled) return;
    const isNew = col.value === NEW;
    const name = newname.value.trim();
    if (isNew && !name) {
      say('Name the new collection first.', 'warn', '!');
      return;
    }
    clearResult();
    save.disabled = true;
    savingUrl = currentUrl;
    say('Starting…', '', '◌');
    send({
      t: 'save',
      url: currentUrl,
      collectionId: isNew ? null : col.value,
      ...(isNew ? { newCollectionName: name } : {}),
    });
  });
  $('review').addEventListener('click', () => {
    if (!saved) return;
    chrome.runtime
      .sendMessage({
        channel: SWIPE_OPEN_KEY,
        postId: saved.postId,
        collectionId: saved.collectionId,
        organizationId: saved.receipt.organizationId,
      })
      .then((result: { ok?: boolean; reason?: string } | undefined) => {
        if (!result?.ok) {
          notice.hidden = false;
          notice.textContent = result?.reason ?? 'Open Matrx and choose Swipe file.';
        }
      })
      .catch(() => {
        notice.hidden = false;
        notice.textContent = 'Open Matrx and choose Swipe file.';
      });
  });
  function refresh() {
    const next = swipeTargetFromUrl(location.href)?.url ?? null;
    if (next === currentUrl && host.isConnected === !!next) return;
    currentUrl = next;
    clearResult();
    say('');
    if (!next) {
      host.remove();
      return;
    }
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (!loaded) send({ t: 'list' });
  }
  refresh();
  window.addEventListener('popstate', refresh);
  setInterval(refresh, 1000);
}
