/**
 * The injected "Save to swipe file" pill (shadow DOM, bottom-right).
 *
 * One floating control instead of a button hooked into each site's DOM: those
 * DOMs change weekly, a fixed pill keyed on the page URL does not. It appears
 * only on a URL `swipeTargetFromUrl` accepts, follows SPA navigation, and
 * talks to the service worker over one port (host.ts).
 */

import { SWIPE_PORT, type SwipeClientMsg, type SwipeHostMsg } from '@/lib/swipe-file/host';
import { swipeTargetFromUrl } from '@/lib/swipe-file/urls';

const NEW = '__new__';

export function mountSwipePill(): void {
  if ((window as unknown as { __matrxSwipePill?: boolean }).__matrxSwipePill) return;
  (window as unknown as { __matrxSwipePill?: boolean }).__matrxSwipePill = true;

  const host = document.createElement('div');
  host.id = 'matrx-swipe-pill';
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  .card{font:13px/1.35 system-ui,sans-serif;background:#111827;color:#f9fafb;border-radius:10px;
    box-shadow:0 4px 18px rgba(0,0,0,.35);padding:8px;display:flex;flex-direction:column;gap:6px;min-width:230px;max-width:300px}
  .row{display:flex;gap:6px;align-items:center}
  select,input{flex:1;min-width:0;background:#1f2937;color:#f9fafb;border:1px solid #374151;border-radius:6px;padding:5px 6px;font:inherit}
  button{background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer;white-space:nowrap}
  button:disabled{opacity:.6;cursor:default}
  .msg{font-size:12px;color:#d1d5db;word-break:break-word}
  .ok{color:#86efac}.warn{color:#fcd34d}.bad{color:#fca5a5}
  [hidden]{display:none!important}
</style>
<div class="card" part="card">
  <div class="row"><select id="col" aria-label="Collection"></select><button id="save">Save to swipe file</button></div>
  <div class="row" id="newrow" hidden><input id="newname" placeholder="Collection name" aria-label="New collection name"></div>
  <div class="msg" id="msg" role="status" aria-live="polite" hidden></div>
</div>`;
  const $ = <T extends HTMLElement>(id: string) => root.getElementById(id) as T;
  const col = $<HTMLSelectElement>('col');
  const save = $<HTMLButtonElement>('save');
  const newrow = $<HTMLDivElement>('newrow');
  const newname = $<HTMLInputElement>('newname');
  const msg = $<HTMLDivElement>('msg');

  let port: chrome.runtime.Port | null = null;
  let loaded = false;
  let currentUrl: string | null = null;

  const say = (text: string, cls = '') => {
    msg.hidden = !text;
    msg.className = `msg ${cls}`;
    msg.textContent = text;
  };

  function send(m: SwipeClientMsg) {
    try {
      if (!port) {
        port = chrome.runtime.connect({ name: SWIPE_PORT });
        port.onMessage.addListener(onHost);
        port.onDisconnect.addListener(() => {
          port = null;
          if (save.disabled) {
            save.disabled = false;
            say('Lost contact with Matrx. Try again.', 'bad');
          }
        });
      }
      port.postMessage(m);
    } catch {
      say('Matrx was updated. Reload this page to save.', 'bad');
    }
  }

  function onHost(m: SwipeHostMsg) {
    if (m.t === 'collections') {
      loaded = true;
      col.innerHTML = '';
      for (const c of m.collections) col.add(new Option(c.name, c.id));
      col.add(new Option('New collection…', NEW));
      col.value =
        m.lastId && m.collections.some((c) => c.id === m.lastId)
          ? m.lastId
          : (m.collections[0]?.id ?? NEW);
      newrow.hidden = col.value !== NEW;
    } else if (m.t === 'collections_error') {
      col.innerHTML = '';
      col.add(new Option('New collection…', NEW));
      newrow.hidden = false;
      say(m.reason, 'bad');
    } else if (m.t === 'progress') {
      say(`${m.label}…`);
    } else if (m.t === 'result') {
      save.disabled = false;
      const o = m.outcome;
      if (o.status === 'failed') say(`Not saved: ${o.reason}`, 'bad');
      else {
        say(
          `${o.status === 'saved' ? 'Saved' : 'Already saved'}${o.notice ? ` — ${o.notice}` : ''}`,
          o.notice ? 'warn' : 'ok',
        );
        send({ t: 'list' }); // pick up a freshly created collection and the new last-used
      }
    }
  }

  col.addEventListener('change', () => {
    newrow.hidden = col.value !== NEW;
  });
  save.addEventListener('click', () => {
    if (!currentUrl) return;
    const isNew = col.value === NEW;
    const name = newname.value.trim();
    if (isNew && !name) {
      say('Name the new collection first.', 'warn');
      return;
    }
    save.disabled = true;
    say('Starting…');
    send({
      t: 'save',
      url: currentUrl,
      collectionId: isNew ? null : col.value,
      ...(isNew ? { newCollectionName: name } : {}),
    });
  });

  function refresh() {
    const target = swipeTargetFromUrl(location.href);
    const next = target?.url ?? null;
    if (next === currentUrl && host.isConnected === !!next) return;
    currentUrl = next;
    if (!next) {
      host.remove();
      return;
    }
    say('');
    save.textContent = 'Save to swipe file';
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (!loaded) send({ t: 'list' });
  }

  refresh();
  window.addEventListener('popstate', refresh);
  setInterval(refresh, 1000); // SPA route changes fire no event we can rely on across sites
}
