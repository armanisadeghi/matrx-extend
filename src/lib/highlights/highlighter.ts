/**
 * On-page highlighter overlay — Shadow-DOM injected by the
 * highlighter.content.ts entrypoint (registered, injected on demand from the
 * Highlight side-panel tab via chrome.scripting.executeScript).
 *
 * Two capture modes:
 *   - text    — drag-select a passage; we paint non-destructive overlay rects
 *               over the selection's client rects (we never wrap the page DOM,
 *               so we can't break the host page) and capture a re-locatable
 *               text-quote anchor (exact + prefix/suffix) plus the container
 *               element's CSS path.
 *   - element — hover shows an outline; click captures the whole element as a
 *               stable CSS selector (+ the live data-matrx-ref if present,
 *               role, tag, text, rect) and paints a persistent box.
 *
 * A floating toolbar (top-center pill, à la "CLIP HIGHLIGHTS") shows the live
 * count, a Text/Element mode toggle, a trash button (clear this page) and a
 * close button. Every capture is sent to the side panel which owns the
 * Supabase write; the side panel replies with the saved id so the painted
 * overlay can map to a row (enabling later per-highlight removal / re-paint).
 *
 * Idempotent: re-injection is a no-op (guarded by window.__matrxHighlighter).
 */

import { elementPathSelector } from '@/lib/data-pattern/selector-resilience';
import type { HighlightAnchor, HighlightMode } from '@/lib/highlights/types';
import { CHANNELS } from '@/lib/messaging/schemas';

// Inlined (not imported from types.ts) so this content-script bundle doesn't
// pull zod into the page.
function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const HOST_ID = 'matrx-highlighter-host';
const QUOTE_PAD = 40; // chars of prefix/suffix context for the text anchor

interface CaptureDraft {
  mode: HighlightMode;
  url: string;
  domain: string;
  page_title: string | null;
  text: string | null;
  color: string;
  anchor: HighlightAnchor;
}

/** A highlight currently painted on the page (existing or freshly captured). */
interface PaintedItem {
  id: string | null; // server id once saved; null while pending
  mode: HighlightMode;
  color: string;
  range: Range | null; // text mode — for reposition
  element: Element | null; // element mode — for reposition
  boxes: HTMLDivElement[]; // overlay rects in the shadow root
}

interface HighlighterGlobals {
  unmount: () => void;
}

declare global {
  interface Window {
    __matrxHighlighter?: HighlighterGlobals;
  }
}

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let layer: HTMLElement | null = null; // absolutely-positioned overlay rects live here
let hoverBox: HTMLElement | null = null; // element-mode hover outline
let countEl: HTMLElement | null = null;
let mode: HighlightMode = 'text';
const painted: PaintedItem[] = [];
let repaintQueued = false;

const COLOR = {
  fill: 'rgba(250, 204, 21, 0.40)', // amber-400 @ 40%
  hoverBorder: 'rgb(37, 99, 235)', // blue-600
  hoverFill: 'rgba(37, 99, 235, 0.12)',
};

// ─── Mount / unmount ──────────────────────────────────────────────────────

export function mountHighlighter(initialMode: HighlightMode = 'text'): void {
  if (window.__matrxHighlighter) return; // already mounted
  mode = initialMode;

  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all: initial; position: fixed; z-index: 2147483647; inset: 0; pointer-events: none;';
  shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .layer { position: fixed; inset: 0; pointer-events: none; }
      .box { position: fixed; border-radius: 3px; pointer-events: none; }
      .hover { position: fixed; pointer-events: none; border: 2px solid ${COLOR.hoverBorder};
               background: ${COLOR.hoverFill}; border-radius: 4px; transition: all 50ms;
               display: none; box-sizing: border-box; }
      .bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
             pointer-events: auto; display: flex; align-items: center; gap: 6px;
             background: #1e3a8a; color: #fff; font-family: ui-sans-serif, system-ui, sans-serif;
             font-size: 12px; font-weight: 600; letter-spacing: 0.03em;
             border-radius: 9999px; padding: 5px 8px 5px 12px;
             box-shadow: 0 6px 24px rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); }
      .bar .title { text-transform: uppercase; opacity: 0.95; }
      .bar .count { background: #6d28d9; border-radius: 9999px; min-width: 18px; height: 18px;
                    display: inline-flex; align-items: center; justify-content: center;
                    padding: 0 5px; font-size: 11px; }
      .bar .toggle { display: inline-flex; background: rgba(255,255,255,0.12);
                     border-radius: 9999px; overflow: hidden; }
      .bar .toggle button { all: unset; cursor: pointer; padding: 3px 9px; font-size: 11px;
                            text-transform: none; letter-spacing: 0; color: #dbeafe; }
      .bar .toggle button[data-on="1"] { background: #fff; color: #1e3a8a; font-weight: 700; }
      .bar .icon { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 9999px;
                   display: inline-flex; align-items: center; justify-content: center;
                   color: #dbeafe; font-size: 13px; }
      .bar .icon:hover { background: rgba(255,255,255,0.16); color: #fff; }
      .bar .sep { width: 1px; height: 16px; background: rgba(255,255,255,0.18); }
    </style>
    <div class="layer" id="layer"></div>
    <div class="hover" id="hover"></div>
    <div class="bar" id="bar">
      <span class="title">Highlights</span>
      <span class="count" id="count">0</span>
      <span class="toggle" id="toggle">
        <button data-mode="text">✎ Text</button>
        <button data-mode="element">⌖ Element</button>
      </span>
      <span class="sep"></span>
      <button class="icon" id="clear" title="Clear highlights on this page">🗑</button>
      <button class="icon" id="close" title="Stop highlighting">✕</button>
    </div>
  `;

  layer = shadow.getElementById('layer');
  hoverBox = shadow.getElementById('hover');
  countEl = shadow.getElementById('count');

  syncModeButtons();
  shadow.getElementById('toggle')?.addEventListener('click', onToggleClick, true);
  shadow.getElementById('clear')?.addEventListener('click', onClearClick, true);
  shadow.getElementById('close')?.addEventListener('click', () => requestStop(), true);

  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('mouseover', onHover, true);
  document.addEventListener('click', onElementClick, true);
  window.addEventListener('scroll', queueRepaint, true);
  window.addEventListener('resize', queueRepaint, true);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  window.__matrxHighlighter = { unmount: unmountHighlighter };
  emitState();
}

export function unmountHighlighter(): void {
  document.removeEventListener('mouseup', onMouseUp, true);
  document.removeEventListener('mouseover', onHover, true);
  document.removeEventListener('click', onElementClick, true);
  window.removeEventListener('scroll', queueRepaint, true);
  window.removeEventListener('resize', queueRepaint, true);
  try {
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  } catch {
    /* runtime gone */
  }
  host?.remove();
  host = null;
  shadow = null;
  layer = null;
  hoverBox = null;
  countEl = null;
  painted.length = 0;
  delete window.__matrxHighlighter;
}

// ─── Toolbar interactions ───────────────────────────────────────────────────

function syncModeButtons() {
  if (!shadow) return;
  shadow.querySelectorAll('#toggle button').forEach((b) => {
    const el = b as HTMLElement;
    el.dataset.on = el.dataset.mode === mode ? '1' : '0';
  });
  // Element mode: enable hover outline. Text mode: hide it.
  if (hoverBox && mode === 'text') hoverBox.style.display = 'none';
}

function onToggleClick(e: Event) {
  const t = e.target as HTMLElement;
  const next = t?.dataset?.mode as HighlightMode | undefined;
  if (next && (next === 'text' || next === 'element')) {
    mode = next;
    syncModeButtons();
    emitState();
  }
}

function onClearClick() {
  // Ask the side panel to soft-delete every highlight on this URL; it will
  // broadcast HIGHLIGHTS_CHANGED and we unpaint locally regardless.
  safeSend(CHANNELS.HIGHLIGHT_CLEAR_REQUEST, { url: location.href });
  for (const item of painted) for (const b of item.boxes) b.remove();
  painted.length = 0;
  updateCount();
  emitState();
}

function requestStop() {
  emitState(false);
  unmountHighlighter();
}

// ─── Capture: text mode ─────────────────────────────────────────────────────

function onMouseUp(e: Event) {
  if (mode !== 'text') return;
  if (insideHost(e.target)) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const exact = sel.toString().trim();
  if (exact.length < 2) return;

  const range = sel.getRangeAt(0).cloneRange();
  const container = commonAncestorElement(range);
  const anchor: HighlightAnchor = {
    css_path: container ? elementPathSelector(container) : undefined,
    text_quote: {
      exact,
      prefix: textBefore(range, QUOTE_PAD),
      suffix: textAfter(range, QUOTE_PAD),
    },
    role: container?.getAttribute('role') ?? undefined,
    tag: container?.tagName.toLowerCase(),
  };

  const item: PaintedItem = {
    id: null,
    mode: 'text',
    color: 'yellow',
    range,
    element: null,
    boxes: [],
  };
  painted.push(item);
  paintItem(item);
  sel.removeAllRanges();
  updateCount();

  void persist(item, {
    mode: 'text',
    text: exact.slice(0, 4000),
    color: 'yellow',
    anchor,
    ...pageMeta(),
  });
}

// ─── Capture: element mode ──────────────────────────────────────────────────

function onHover(e: Event) {
  if (mode !== 'element' || !hoverBox) return;
  const t = e.target;
  if (!(t instanceof Element) || insideHost(t)) {
    hoverBox.style.display = 'none';
    return;
  }
  const r = t.getBoundingClientRect();
  hoverBox.style.display = 'block';
  hoverBox.style.top = `${r.top}px`;
  hoverBox.style.left = `${r.left}px`;
  hoverBox.style.width = `${r.width}px`;
  hoverBox.style.height = `${r.height}px`;
}

function onElementClick(e: Event) {
  if (mode !== 'element') return;
  const t = e.target;
  if (!(t instanceof Element) || insideHost(t)) return;
  e.preventDefault();
  e.stopPropagation();

  const anchor: HighlightAnchor = {
    selector: elementPathSelector(t),
    ref: t.getAttribute('data-matrx-ref') ?? undefined,
    role: t.getAttribute('role') ?? undefined,
    tag: t.tagName.toLowerCase(),
    rect: rectOf(t),
    attrs: pickAttrs(t),
  };
  const text = (t.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000);

  const item: PaintedItem = {
    id: null,
    mode: 'element',
    color: 'yellow',
    range: null,
    element: t,
    boxes: [],
  };
  painted.push(item);
  paintItem(item);
  updateCount();

  void persist(item, {
    mode: 'element',
    text: text || null,
    color: 'yellow',
    anchor,
    ...pageMeta(),
  });
}

// ─── Painting ───────────────────────────────────────────────────────────────

function paintItem(item: PaintedItem) {
  if (!layer) return;
  for (const b of item.boxes) b.remove();
  item.boxes = [];
  const rects = item.range
    ? Array.from(item.range.getClientRects())
    : item.element
      ? [item.element.getBoundingClientRect()]
      : [];
  for (const r of rects) {
    if (r.width === 0 && r.height === 0) continue;
    const box = document.createElement('div');
    box.className = 'box';
    box.style.top = `${r.top}px`;
    box.style.left = `${r.left}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    if (item.mode === 'element') {
      box.style.outline = `2px solid ${COLOR.fill.replace('0.40', '0.9')}`;
      box.style.background = COLOR.fill.replace('0.40', '0.18');
    } else {
      box.style.background = COLOR.fill;
      box.style.mixBlendMode = 'multiply';
    }
    layer.appendChild(box);
    item.boxes.push(box);
  }
}

function queueRepaint() {
  if (repaintQueued) return;
  repaintQueued = true;
  requestAnimationFrame(() => {
    repaintQueued = false;
    for (const item of painted) paintItem(item);
  });
}

/** Paint a batch of previously-saved highlights (re-locate via anchor). */
function paintExisting(
  items: Array<{ id: string; mode: HighlightMode; color: string; anchor: HighlightAnchor }>,
) {
  for (const saved of items) {
    // Idempotent: the side panel may send PAINT more than once to beat a slow
    // first injection — never double-paint the same saved highlight.
    if (saved.id && painted.some((p) => p.id === saved.id)) continue;
    const located = relocate(saved.anchor, saved.mode);
    if (!located) continue;
    const item: PaintedItem = {
      id: saved.id,
      mode: saved.mode,
      color: saved.color,
      range: located.range,
      element: located.element,
      boxes: [],
    };
    painted.push(item);
    paintItem(item);
  }
  updateCount();
}

/** Best-effort re-location of a saved highlight on the current DOM. */
function relocate(
  anchor: HighlightAnchor,
  m: HighlightMode,
): { range: Range | null; element: Element | null } | null {
  if (m === 'element') {
    const el = anchor.selector ? safeQuery(anchor.selector) : null;
    return el ? { range: null, element: el } : null;
  }
  // text mode — find the exact quote inside the container (or document).
  const exact = anchor.text_quote?.exact;
  if (!exact) return null;
  const container = anchor.css_path ? safeQuery(anchor.css_path) : document.body;
  const root = container ?? document.body;
  const range = findTextRange(root, exact, anchor.text_quote?.prefix);
  return range ? { range, element: null } : null;
}

// ─── Persistence handshake ──────────────────────────────────────────────────

async function persist(item: PaintedItem, draft: CaptureDraft) {
  try {
    const res = (await chrome.runtime.sendMessage({
      __matrx: true,
      kind: CHANNELS.HIGHLIGHT_CAPTURED,
      payload: draft,
    })) as { id?: string } | undefined;
    if (res?.id) item.id = res.id;
  } catch {
    // Side panel closed / runtime gone — keep the local paint; it just isn't
    // synced. The user can re-toggle to recapture.
  }
  emitState();
}

// ─── Messaging from the side panel ──────────────────────────────────────────

function onRuntimeMessage(msg: unknown): undefined {
  if (!msg || typeof msg !== 'object') return;
  const env = msg as { __matrx?: boolean; kind?: string; payload?: unknown };
  if (env.__matrx !== true) return;
  if (env.kind === CHANNELS.HIGHLIGHT_STOP) {
    unmountHighlighter();
  } else if (env.kind === CHANNELS.HIGHLIGHT_SET_MODE) {
    const next = (env.payload as { mode?: HighlightMode } | undefined)?.mode;
    if (next === 'text' || next === 'element') {
      mode = next;
      syncModeButtons();
      emitState();
    }
  } else if (env.kind === CHANNELS.HIGHLIGHT_PAINT) {
    const items = (env.payload as { items?: Parameters<typeof paintExisting>[0] } | undefined)
      ?.items;
    if (Array.isArray(items)) paintExisting(items);
  }
  return undefined;
}

function emitState(mounted = true) {
  safeSend(CHANNELS.HIGHLIGHT_OVERLAY_STATE, {
    mounted,
    mode,
    count: painted.length,
    url: location.href,
  });
}

function updateCount() {
  if (countEl) countEl.textContent = String(painted.length);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function insideHost(t: EventTarget | null): boolean {
  return !!host && t instanceof Node && host.contains(t);
}

function safeSend(kind: string, payload: unknown) {
  try {
    if (!chrome.runtime?.id) return;
    void chrome.runtime.sendMessage({ __matrx: true, kind, payload });
  } catch {
    /* orphaned content script */
  }
}

function pageMeta() {
  return {
    url: location.href,
    domain: domainFromUrl(location.href),
    page_title: document.title || null,
  };
}

function rectOf(el: Element) {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left + window.scrollX),
    y: Math.round(r.top + window.scrollY),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

function pickAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['href', 'src', 'alt', 'title', 'type', 'name', 'value', 'aria-label']) {
    const v = el.getAttribute(name);
    if (v) out[name] = v.slice(0, 300);
  }
  return out;
}

function commonAncestorElement(range: Range): Element | null {
  let node: Node | null = range.commonAncestorContainer;
  while (node && node.nodeType !== 1) node = node.parentNode;
  return node as Element | null;
}

function textBefore(range: Range, n: number): string {
  const el = commonAncestorElement(range);
  const full = el?.textContent ?? '';
  const exact = range.toString();
  const idx = full.indexOf(exact);
  if (idx < 0) return '';
  return full.slice(Math.max(0, idx - n), idx);
}

function textAfter(range: Range, n: number): string {
  const el = commonAncestorElement(range);
  const full = el?.textContent ?? '';
  const exact = range.toString();
  const idx = full.indexOf(exact);
  if (idx < 0) return '';
  const end = idx + exact.length;
  return full.slice(end, end + n);
}

function safeQuery(sel: string): Element | null {
  try {
    return document.querySelector(sel);
  } catch {
    return null;
  }
}

/**
 * Find a Range matching `exact` text inside `root`, preferring an occurrence
 * preceded by `prefix` when given. Walks text nodes and spans the match across
 * node boundaries.
 */
function findTextRange(root: Element, exact: string, prefix?: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const nodes: Text[] = [];
  let total = '';
  let n = walker.nextNode();
  while (n) {
    const t = n as Text;
    nodes.push(t);
    total += t.data;
    n = walker.nextNode();
  }
  if (!total) return null;

  let searchFrom = 0;
  if (prefix) {
    const pIdx = total.indexOf(prefix + exact);
    if (pIdx >= 0) searchFrom = pIdx + prefix.length;
  }
  const idx = total.indexOf(exact, searchFrom);
  if (idx < 0) return null;

  const start = locate(nodes, idx);
  const end = locate(nodes, idx + exact.length);
  if (!start || !end) return null;
  try {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}

function locate(nodes: Text[], target: number): { node: Text; offset: number } | null {
  let acc = 0;
  for (const node of nodes) {
    const len = node.data.length;
    if (target <= acc + len) return { node, offset: target - acc };
    acc += len;
  }
  return null;
}
