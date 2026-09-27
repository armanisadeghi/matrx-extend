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

import type { ListPickerWindow } from './list-picker-session';
import type { ListPickerSeed } from './list-picker-session';
import {
  type ListPatternCandidate,
  inferListPatternCandidates,
  relativeFieldSelector,
} from './selector-resilience';

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
let sessionId: string | null = null;
let scopeCandidates: ListPatternCandidate[] = [];

export function mountListPicker(id: string, seed?: ListPickerSeed | null): void {
  // Re-entry mounts FRESH: a previous overlay may be orphaned (sidepanel
  // unmounted mid-pick) or mid-phase-2 — stale state must not leak into a
  // new session. Also remove any DOM remnant from an older script context.
  if (host) unmountListPicker();
  // Reinjection creates a new module context. Removing the old host alone
  // leaves its document capture listeners intercepting all page clicks.
  const pickerWindow = window as ListPickerWindow;
  pickerWindow.__matrxListPickerTeardown?.();
  document.getElementById(HOST_ID)?.remove();
  sessionId = id;
  pickerWindow.__matrxListPickerTeardown = unmountListPicker;
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
      .scope-choices { display: grid; gap: 5px; margin: 8px 0; }
      .scope-choices button { display: block; width: calc(100% - 20px); text-align: left; }
      .scope-choices small { display: block; color: #aaa; overflow-wrap: anywhere; }
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
      <div class="scope-choices" id="scope-choices"></div>
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
  // Sidepanel-driven cancel: the Showcase tab executes a tiny script that
  // calls this hook (same ISOLATED world), so a stuck pick is recoverable
  // without touching the page UI.
  pickerWindow.__matrxListPickerCancel = (targetSession) => {
    if (targetSession === sessionId) finish('cancel');
  };
  if (seed?.list_root && seed.item_selector) {
    try {
      const root = document.querySelector(seed.list_root);
      const items = root ? Array.from(root.querySelectorAll(seed.item_selector)) : [];
      const firstItem = items[0];
      if (firstItem) {
        selectScope(
          {
            listRoot: seed.list_root,
            itemSelector: seed.item_selector,
            itemCount: items.length,
            sampleItem: firstItem,
          },
          false,
        );
        setHint(
          `${items.length} matching items. Click a field inside any highlighted item, then Done.`,
        );
      } else {
        flashHint('The earlier list is no longer on this page. Click a new example item.', 'warn');
      }
    } catch {
      flashHint('The earlier list selector is invalid. Click a new example item.', 'warn');
    }
  }
}

export function unmountListPicker(): void {
  const pickerWindow = window as ListPickerWindow;
  if (pickerWindow.__matrxListPickerTeardown === unmountListPicker) {
    delete pickerWindow.__matrxListPickerCancel;
    delete pickerWindow.__matrxListPickerTeardown;
  }
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
  scopeCandidates = [];
  sessionId = null;
}

function isOurNode(t: Element | null): boolean {
  return !!t && (host?.contains(t) || shadow?.contains(t) || (t as HTMLElement).id === HOST_ID);
}

function itemContaining(target: Element): Element | null {
  if (!listRootSel || !itemSel) return null;
  try {
    const root = document.querySelector(listRootSel);
    return (
      Array.from(root?.querySelectorAll(itemSel) ?? []).find(
        (item) => item === target || item.contains(target),
      ) ?? null
    );
  } catch {
    return null;
  }
}

function selectScope(candidate: ListPatternCandidate, announce: boolean) {
  scopeCandidates = [];
  shadow?.querySelector('#scope-choices')?.replaceChildren();
  listRootSel = candidate.listRoot;
  itemSel = candidate.itemSelector;
  sampleItem = candidate.sampleItem;
  phase = 'fields';
  highlightSiblings();
  setBadge(`${candidate.itemCount} items`);
  if (announce) {
    flashHint(
      `${candidate.itemCount} matching items selected. Click fields inside one item, then Done.`,
      'ok',
    );
    void chrome.runtime.sendMessage({
      __matrx: true,
      kind: 'data:list-picker-item-detected',
      payload: {
        session_id: sessionId,
        list_root: listRootSel,
        item_selector: itemSel,
        item_count: candidate.itemCount,
      },
    });
  }
}

function showScopeChoices(candidates: ListPatternCandidate[]) {
  scopeCandidates = candidates;
  setHint('Several groups repeat here. Choose which group you want to extract.');
  const container = shadow?.querySelector('#scope-choices');
  if (!container) return;
  container.replaceChildren();
  for (const [index, candidate] of scopeCandidates.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.scopeChoice = String(index);
    const kind = candidate.sampleItem.tagName.toLowerCase() === 'li' ? 'list items' : 'cards';
    const sample = (candidate.sampleItem.textContent ?? '').trim().slice(0, 48);
    button.textContent = `${candidate.itemCount} ${kind} (${candidate.itemSelector})`;
    const detail = document.createElement('small');
    detail.textContent = `${candidate.listRoot}${sample ? ` · ${sample}` : ''}`;
    button.appendChild(detail);
    button.addEventListener('click', () => selectScope(candidate, true));
    container.appendChild(button);
  }
}

function onHover(e: Event) {
  const t = e.target;
  if (!(t instanceof Element) || isOurNode(t)) return;
  // A field may be chosen from any repeated item, not just the first sample.
  if (phase === 'fields' && !itemContaining(t)) {
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
    const candidates = inferListPatternCandidates(t);
    if (candidates.length === 0) {
      flashHint(
        'No similar siblings found. Try clicking a higher-level wrapper (the whole card, not text inside it).',
        'warn',
      );
      return;
    }
    const soleCandidate = candidates.length === 1 ? candidates[0] : undefined;
    if (soleCandidate) selectScope(soleCandidate, true);
    else showScopeChoices(candidates);
    return;
  }

  if (phase === 'fields' && sampleItem) {
    const item = itemContaining(t);
    if (!item) return;
    sampleItem = item;
    const rel = relativeFieldSelector(t, item);
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

/** Briefly flash the hint to make state changes obvious. */
function flashHint(text: string, kind: 'ok' | 'warn') {
  if (!shadow) return;
  const hint = shadow.querySelector('#hint') as HTMLElement | null;
  if (!hint) return;
  hint.textContent = text;
  hint.style.transition = 'background 200ms, color 200ms';
  hint.style.padding = '4px 6px';
  hint.style.borderRadius = '6px';
  hint.style.color = kind === 'ok' ? '#9aff9a' : '#ffd58f';
  hint.style.background = kind === 'ok' ? 'rgba(80,180,80,0.15)' : 'rgba(220,150,40,0.15)';
  setTimeout(() => {
    if (!hint) return;
    hint.style.background = 'transparent';
    hint.style.color = '#888';
  }, 1600);
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
    nodes = Array.from(root.querySelectorAll(itemSel)).filter((n) => n.parentElement === root);
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
  scopeCandidates = [];
  shadow?.querySelector('#scope-choices')?.replaceChildren();
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
            session_id: sessionId,
            list_root: listRootSel,
            item_selector: itemSel,
            field_paths: picked.map((p) => ({ name: p.name, rel_selector: p.rel_selector })),
          }
        : { session_id: sessionId },
  });
  unmountListPicker();
}
