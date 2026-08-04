/**
 * Selector chain — multi-strategy element finding for self-healing replay.
 *
 * Recording produces an *ordered* list of selector strategies per step,
 * cheapest/most-stable first. Replay tries them in order; first one that
 * resolves a single visible element wins. If they all miss, the step
 * fails and the replayer reports which strategies were tried + what was
 * found.
 *
 * Strategy ranking (best → worst):
 *   1. matrx-ref       (only useful during recording; ephemeral)
 *   2. id              (only when `id` looks human-meaningful — see heuristic)
 *   3. data-testid     (explicit test markers, very stable)
 *   4. name-attr       (form fields by `name=`)
 *   5. aria            (role + accessible name; resilient to DOM churn)
 *   6. text            (visible text + tag; resilient when ARIA is absent)
 *   7. css-path        (last resort, ancestral CSS path with siblings)
 *
 * 📝 Notes:
 *    .research/demo-system-design-notes.md
 */
import type { ElementSnapshot, SelectorStrategy } from '@/lib/demos/types';

/**
 * Build the ordered chain for a captured element.
 *
 * Designed to run inside the page (content-script context), so it has
 * direct DOM access. Pure-function-of-element style for testability.
 */
export function buildSelectorChain(el: Element): SelectorStrategy[] {
  const chain: SelectorStrategy[] = [];

  const matrxRef = el.getAttribute('data-matrx-ref');
  if (matrxRef) {
    chain.push({ kind: 'matrx-ref', selector: `[data-matrx-ref="${cssEscape(matrxRef)}"]` });
  }

  const id = el.getAttribute('id');
  if (id && isStableId(id)) {
    chain.push({ kind: 'id', selector: `#${cssEscape(id)}` });
  }

  const testId =
    el.getAttribute('data-testid') ?? el.getAttribute('data-test') ?? el.getAttribute('data-cy');
  if (testId) {
    chain.push({ kind: 'data-testid', selector: `[data-testid="${cssEscape(testId)}"]` });
  }

  const name = el.getAttribute('name');
  if (name && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
    chain.push({
      kind: 'name-attr',
      selector: `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`,
    });
  }

  const ariaRole = el.getAttribute('role') ?? implicitRole(el);
  const ariaName = accessibleName(el);
  if (ariaRole && ariaName) {
    chain.push({
      kind: 'aria',
      selector: `[role="${cssEscape(ariaRole)}"]`,
      role: ariaRole,
      match_text: ariaName,
    });
  }

  const visibleText = (el.textContent ?? '').trim();
  if (visibleText && visibleText.length <= 80) {
    chain.push({
      kind: 'text',
      selector: el.tagName.toLowerCase(),
      match_text: visibleText,
    });
  }

  chain.push({ kind: 'css-path', selector: cssPath(el) });

  return chain;
}

export function snapshotElement(el: Element): ElementSnapshot {
  const rect = el.getBoundingClientRect();
  const role = el.getAttribute('role') ?? implicitRole(el);
  const accessibleNameValue = accessibleName(el);
  const visibleTextValue = (el.textContent ?? '').trim().slice(0, 200);
  const out: ElementSnapshot = {
    tag: el.tagName.toLowerCase(),
    ...(role !== null && { role }),
    ...(accessibleNameValue !== null && { accessible_name: accessibleNameValue }),
    ...(visibleTextValue !== '' && { visible_text: visibleTextValue }),
    bounding_rect: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    },
  };
  const interestingAttrs = [
    'type',
    'name',
    'placeholder',
    'href',
    'aria-label',
    'aria-labelledby',
    'title',
  ];
  const attrs: Record<string, string> = {};
  for (const a of interestingAttrs) {
    const v = el.getAttribute(a);
    if (v) attrs[a] = v;
  }
  if (Object.keys(attrs).length) out.attrs = attrs;
  return out;
}

/**
 * Resolve a selector chain to a single element. Tries each strategy in
 * order; returns the first resolved-and-visible element along with the
 * strategy that worked.
 */
export function resolveSelectorChain(
  chain: SelectorStrategy[],
):
  | { ok: true; element: Element; resolved_via: SelectorStrategy['kind'] }
  | { ok: false; tried: SelectorStrategy['kind'][] } {
  const tried: SelectorStrategy['kind'][] = [];
  for (const strat of chain) {
    tried.push(strat.kind);
    const el = resolveOne(strat);
    if (el && isInteractable(el)) {
      return { ok: true, element: el, resolved_via: strat.kind };
    }
  }
  return { ok: false, tried };
}

function resolveOne(strat: SelectorStrategy): Element | null {
  if (strat.kind === 'aria') {
    const all = Array.from(document.querySelectorAll(strat.selector));
    const want = (strat.match_text ?? '').toLowerCase();
    return all.find((el) => (accessibleName(el) ?? '').toLowerCase() === want) ?? null;
  }
  if (strat.kind === 'text') {
    const all = Array.from(document.querySelectorAll<HTMLElement>(strat.selector));
    const want = (strat.match_text ?? '').toLowerCase();
    return all.find((el) => (el.textContent ?? '').trim().toLowerCase() === want) ?? null;
  }
  try {
    return document.querySelector(strat.selector);
  } catch {
    return null;
  }
}

function isInteractable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;
  if (el.hidden) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

// ─── helpers ──────────────────────────────────────────────────────────────
function isStableId(id: string): boolean {
  // Reject IDs that look auto-generated: long random hex, react-* prefixes,
  // ember-* prefixes, all-caps fingerprints, numeric-only, etc.
  if (id.length > 32) return false;
  if (/^(react|ember|svelte|vue)-?[\d_]+/i.test(id)) return false;
  if (/^[a-f0-9]{16,}$/i.test(id)) return false;
  if (/^\d+$/.test(id)) return false;
  if (/^_[\w]+_[a-f0-9]{6,}/i.test(id)) return false; // CSS-modules-style hashes
  return true;
}

function implicitRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'button':
      return 'button';
    case 'a':
      return el.hasAttribute('href') ? 'link' : null;
    case 'input': {
      const type = (el as HTMLInputElement).type;
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button') return 'button';
      if (type === 'search') return 'searchbox';
      return 'textbox';
    }
    case 'textarea':
      return 'textbox';
    case 'select':
      return 'combobox';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'nav':
      return 'navigation';
    case 'main':
      return 'main';
    case 'header':
      return 'banner';
    case 'footer':
      return 'contentinfo';
    case 'form':
      return 'form';
    default:
      return null;
  }
}

function accessibleName(el: Element): string | null {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const target = document.getElementById(labelledBy);
    if (target) return (target.textContent ?? '').trim();
  }
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    const id = el.id;
    if (id) {
      const lbl = document.querySelector<HTMLLabelElement>(`label[for="${cssEscape(id)}"]`);
      if (lbl) return (lbl.textContent ?? '').trim();
    }
    const wrapping = el.closest('label');
    if (wrapping) return (wrapping.textContent ?? '').trim();
    const placeholder = (el as HTMLInputElement).placeholder;
    if (placeholder) return placeholder.trim();
  }
  const title = el.getAttribute('title');
  if (title) return title.trim();
  const text = (el.textContent ?? '').trim();
  if (text && text.length <= 80) return text;
  return null;
}

function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node.nodeType === 1 && depth < 4) {
    let part = node.tagName.toLowerCase();
    if (node.id && isStableId(node.id)) {
      parts.unshift(`${part}#${cssEscape(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    const current: Element = node;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current);
        part += `:nth-of-type(${idx + 1})`;
      }
    }
    parts.unshift(part);
    node = parent;
    depth++;
  }
  return parts.join(' > ');
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/(["\\])/g, '\\$1');
}
