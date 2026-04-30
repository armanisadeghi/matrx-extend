/**
 * Field picker overlay — Shadow-DOM injected by the data-picker.content.ts
 * entrypoint, which is registered in the manifest but NOT auto-mounted.
 *
 * v1: minimal. Implements the visual hover, click-to-select, and a small
 * panel showing the field stack. Pattern saving + advanced selectors come
 * in subsequent iterations.
 */

interface PickedField {
  selector: string;
  label: string;
  preview: string;
}

const HOST_ID = 'matrx-data-picker-host';

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let _panel: HTMLElement | null = null;
let highlight: HTMLElement | null = null;
const picked: PickedField[] = [];

export function mountPicker(): void {
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
      .panel h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
      .panel button { all: unset; cursor: pointer; padding: 6px 10px; border-radius: 6px;
                      background: #2a2a2a; color: #fff; font-size: 12px; }
      .panel button:hover { background: #3a3a3a; }
      .picked { margin-top: 8px; max-height: 200px; overflow-y: auto; }
      .picked-item { padding: 6px 8px; border-radius: 6px; background: #161616;
                     margin-bottom: 4px; font-family: ui-monospace, monospace; font-size: 11px; }
      .hl { position: fixed; pointer-events: none; border: 2px solid oklch(0.7 0.2 250);
            background: oklch(0.7 0.2 250 / 0.15); border-radius: 4px; transition: all 60ms; }
    </style>
    <div class="panel">
      <h2>Matrx Field Picker</h2>
      <div style="display:flex; gap:6px;">
        <button id="done">Done</button>
        <button id="cancel">Cancel</button>
        <button id="clear">Clear</button>
      </div>
      <div class="picked" id="picked"></div>
    </div>
    <div class="hl" id="hl" style="display:none"></div>
  `;

  _panel = shadow.querySelector('.panel');
  highlight = shadow.querySelector('#hl');

  document.addEventListener('mouseover', onHover, true);
  document.addEventListener('click', onClick, true);
  shadow.querySelector('#done')?.addEventListener('click', () => finish('done'));
  shadow.querySelector('#cancel')?.addEventListener('click', () => finish('cancel'));
  shadow.querySelector('#clear')?.addEventListener('click', clearPicked);
}

export function unmountPicker(): void {
  document.removeEventListener('mouseover', onHover, true);
  document.removeEventListener('click', onClick, true);
  host?.remove();
  host = null;
  shadow = null;
  _panel = null;
  highlight = null;
  picked.length = 0;
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
  const selector = uniqueSelector(t);
  const text = (t.textContent ?? '').trim().slice(0, 80);
  picked.push({
    selector,
    label: `field_${picked.length + 1}`,
    preview: text,
  });
  renderPicked();
}

function clearPicked() {
  picked.length = 0;
  renderPicked();
}

function renderPicked() {
  if (!shadow) return;
  const list = shadow.querySelector('#picked');
  if (!list) return;
  list.innerHTML = '';
  picked.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'picked-item';
    div.textContent = `${i + 1}. ${p.label}: ${p.preview || p.selector}`;
    list.appendChild(div);
  });
}

function finish(reason: 'done' | 'cancel') {
  void chrome.runtime.sendMessage({
    __matrx: true,
    kind: reason === 'done' ? 'data:picker-result' : 'data:picker-exit',
    payload: {
      fields: picked.map((p, i) => ({ name: `field_${i + 1}`, selector: p.selector })),
    },
  });
  unmountPicker();
}

/**
 * Generate a CSS selector that uniquely identifies an element. Cheap heuristic;
 * upgrade later with library if precision becomes a problem.
 */
function uniqueSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < 5) {
    const current: Element = node;
    let part = current.tagName.toLowerCase();
    if (current.classList.length > 0) {
      part += `.${Array.from(current.classList).slice(0, 2).map(CSS.escape).join('.')}`;
    }
    const parent: Element | null = current.parentElement;
    if (parent) {
      const sibs: Element[] = Array.from(parent.children).filter(
        (c: Element) => c.tagName === current.tagName,
      );
      if (sibs.length > 1) {
        const idx = sibs.indexOf(current) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}
