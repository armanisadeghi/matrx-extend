/**
 * Two-phase list-pattern picker overlay.
 *
 * Phase 1 (item): user clicks one example item. We infer the list root +
 *   the item selector pattern, count siblings, highlight all of them, and
 *   advance to phase 2.
 * Phase 2 (fields): user clicks fields within the picked sample item. Each
 *   click records a field with a relative selector. Done sends the full
 *   pattern back to the sidepanel.
 *
 * Mirrors the structure of src/lib/data-pattern/picker.ts so the two pickers
 * share their visual idiom.
 */

import { inferListPattern, relativeFieldSelector } from './selector-resilience';

const HOST_ID = 'matrx-list-picker-host';

type Phase = 'item' | 'fields';

interface PickedField {
  name: string;
  rel_selector: string;
  preview: string;
}

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let highlight: HTMLElement | null = null;
let siblingHighlights: HTMLElement[] = [];
let phase: Phase = 'item';
let listRootSel: string | null = null;
let itemSel: string | null = null;
let sampleItem: Element | null = null;
const picked: PickedField[] = [];

export function mountListPicker(): void {
  if (host) return;
  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all: initial; position: fixed; z-index: 2147483647; inset: 0; pointer-events: none;';
  shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel { position: fixed; right: 16px; top: 16px; width: 320px; pointer-events: auto;
               background: #0c0c0c; color: #f5f5f5; font-family: ui-sans-serif, system-ui;
               font-size: 13px; border-radius: 12px; padding: 12px;
               box-shadow: 0 8px 32px rgba(0,0,0,0.4); border: 1px solid #2a2a2a; }
      .panel h2 { margin: 0 0 4px; font-size: 13px; font-weight: 600; }
      .panel .hint { color: #888; font-size: 11px; margin-bottom: 8px; }
      .panel button { all: unset; cursor: pointer; padding: 6px 10px; border-radius: 6px;
                      background: #2a2a2a; color: #fff; font-size: 12px; }
      .panel button:hover { background: #3a3a3a; }
      .panel button.primary { background: oklch(0.7 0.2 250); color: #000; }
      .panel button.primary:hover { background: oklch(0.75 0.2 250); }
      .picked { margin-top: 8px; max-height: 180px; overflow-y: auto; }
      .picked-item { padding: 6px 8px; border-radius: 6px; background: #161616;
                     margin-bottom: 4px; font-family: ui-monospace, monospace; font-size: 11px; }
      .badge { display: inline-block; background: oklch(0.7 0.2 250); color: #000;
               padding: 2px 8px; border-radius: 999px; font-weight: 600; font-size: 11px; }
      .hl { position: fixed; pointer-events: none; border: 2px solid oklch(0.7 0.2 250);
            background: oklch(0.7 0.2 250 / 0.15); border-radius: 4px; transition: all 60ms; }
      .hl-item { position: fixed; pointer-events: none; border: 2px dashed oklch(0.75 0.2 140);
                 background: oklch(0.75 0.2 140 / 0.08); border-radius: 4px; }
    </style>
    <div class="panel">
      <h2>Matrx List Picker</h2>
      <div class="hint" id="hint">Click one example item (e.g. one card)</div>
      <div style="display:flex; gap:6px;">
        <button id="done" class="primary">Done</button>
        <button id="cancel">Cancel</button>
        <button id="restart">Restart</button>
      </div>
      <div class="picked" id="picked"></div>
    </div>
    <div class="hl" id="hl" style="display:none"></div>
  `;

  highlight = shadow.querySelector('#hl');

  document.addEventListener('mouseover', onHover, true);
  document.addEventListener('click', onClick, true);
  shadow.querySelector('#done')?.addEventListener('click', () => finish('done'));
  shadow.querySelector('#cancel')?.addEventListener('click', () => finish('cancel'));
  shadow.querySelector('#restart')?.addEventListener('click', restart);
}

export function unmountListPicker(): void {
  document.removeEventListener('mouseover', onHover, true);
  document.removeEventListener('click', onClick, true);
  clearSiblingHighlights();
  host?.remove();
  host = null;
  shadow = null;
  highlight = null;
  phase = 'item';
  listRootSel = null;
  itemSel = null;
  sampleItem = null;
  picked.length = 0;
}

function isOurNode(t: Element | null): boolean {
  return !!t && (host?.contains(t) || (t as HTMLElement).id === HOST_ID);
}

function onHover(e: Event) {
  const t = e.target;
  if (!(t instanceof Element) || isOurNode(t)) return;
  // In fields phase, hover only highlights elements inside the sample item.
  if (phase === 'fields' && sampleItem && !sampleItem.contains(t)) {
    if (highlight) highlight.style.display = 'none';
    return;
  }
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
  if (!(t instanceof Element) || isOurNode(t)) return;
  e.preventDefault();
  e.stopPropagation();

  if (phase === 'item') {
    const inferred = inferListPattern(t);
    if (!inferred) {
      setHint('Could not infer a list from that element. Try clicking a different item.');
      return;
    }
    listRootSel = inferred.listRoot;
    itemSel = inferred.itemSelector;
    sampleItem = inferred.sampleItem;
    highlightSiblings();
    setHint(`${inferred.itemCount} similar items detected. Now click each field inside one item.`);
    setBadge(`${inferred.itemCount} items`);
    phase = 'fields';
    return;
  }

  if (phase === 'fields' && sampleItem) {
    if (!sampleItem.contains(t)) return;
    const rel = relativeFieldSelector(t, sampleItem);
    if (!rel) return;
    const text = (t.textContent ?? '').trim().slice(0, 80);
    picked.push({
      name: `field_${picked.length + 1}`,
      rel_selector: rel,
      preview: text,
    });
    renderPicked();
  }
}

function setHint(text: string) {
  if (!shadow) return;
  const hint = shadow.querySelector('#hint');
  if (hint) hint.textContent = text;
}

function setBadge(text: string) {
  if (!shadow) return;
  const h2 = shadow.querySelector('h2');
  if (!h2) return;
  let badge = h2.querySelector('.badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'badge';
    badge.setAttribute('style', 'margin-left: 8px;');
    h2.appendChild(badge);
  }
  badge.textContent = text;
}

function highlightSiblings() {
  clearSiblingHighlights();
  if (!listRootSel || !itemSel || !shadow) return;
  let nodes: Element[] = [];
  try {
    const root = document.querySelector(listRootSel);
    if (!root) return;
    nodes = Array.from(root.querySelectorAll(itemSel)).filter(
      (n) => n.parentElement === root,
    );
  } catch {
    return;
  }
  for (const n of nodes) {
    const r = n.getBoundingClientRect();
    const div = document.createElement('div');
    div.className = 'hl-item';
    div.setAttribute(
      'style',
      `position: fixed; top: ${r.top}px; left: ${r.left}px; width: ${r.width}px; height: ${r.height}px;`,
    );
    shadow.appendChild(div);
    siblingHighlights.push(div);
  }
}

function clearSiblingHighlights() {
  for (const h of siblingHighlights) h.remove();
  siblingHighlights = [];
}

function renderPicked() {
  if (!shadow) return;
  const list = shadow.querySelector('#picked');
  if (!list) return;
  list.innerHTML = '';
  picked.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'picked-item';
    div.textContent = `${i + 1}. ${p.name}: ${p.preview || p.rel_selector}`;
    list.appendChild(div);
  });
}

function restart() {
  clearSiblingHighlights();
  phase = 'item';
  listRootSel = null;
  itemSel = null;
  sampleItem = null;
  picked.length = 0;
  setHint('Click one example item (e.g. one card)');
  if (shadow) {
    const badge = shadow.querySelector('.badge');
    badge?.remove();
  }
  renderPicked();
}

function finish(reason: 'done' | 'cancel') {
  void chrome.runtime.sendMessage({
    __matrx: true,
    kind: reason === 'done' ? 'data:list-picker-result' : 'data:list-picker-exit',
    payload:
      reason === 'done' && listRootSel && itemSel
        ? {
            list_root: listRootSel,
            item_selector: itemSel,
            field_paths: picked.map((p) => ({ name: p.name, rel_selector: p.rel_selector })),
          }
        : null,
  });
  unmountListPicker();
}
