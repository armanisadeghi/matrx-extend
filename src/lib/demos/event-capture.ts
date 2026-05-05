/**
 * Event-capture function injected into the page during demo recording.
 *
 * This function is **self-contained** — it crosses the chrome.scripting
 * boundary as a `func:` payload, so it cannot import anything from the
 * extension context. Selector-chain logic is duplicated inline (small
 * cost, large benefit: one round-trip per event instead of two).
 *
 * Listeners are attached to `document` with `capture: true` so we see
 * events before the page handles them. They live until the page
 * navigates / unloads; SW re-injects after each navigation while the
 * recording is active.
 *
 * 📝 Notes:
 *    .research/demo-system-design-notes.md
 */

/** Payload sent to SW via chrome.runtime.sendMessage. */
export interface CapturedEventEnvelope {
  __matrx: true;
  kind: 'demos:event';
  payload: CapturedEvent;
}

export type CapturedEvent =
  | {
      kind: 'click';
      url: string;
      ts: number;
      selector_chain: ReturnType<typeof inPageBuildSelectorChain>;
      element_snapshot: ReturnType<typeof inPageSnapshotElement>;
    }
  | {
      kind: 'type';
      url: string;
      ts: number;
      selector_chain: ReturnType<typeof inPageBuildSelectorChain>;
      element_snapshot: ReturnType<typeof inPageSnapshotElement>;
      text: string;
      is_sensitive: boolean;
    }
  | {
      kind: 'check';
      url: string;
      ts: number;
      selector_chain: ReturnType<typeof inPageBuildSelectorChain>;
      element_snapshot: ReturnType<typeof inPageSnapshotElement>;
      checked: boolean;
    }
  | {
      kind: 'select';
      url: string;
      ts: number;
      selector_chain: ReturnType<typeof inPageBuildSelectorChain>;
      element_snapshot: ReturnType<typeof inPageSnapshotElement>;
      value: string;
    }
  | {
      kind: 'submit';
      url: string;
      ts: number;
      selector_chain: ReturnType<typeof inPageBuildSelectorChain>;
      element_snapshot: ReturnType<typeof inPageSnapshotElement>;
    }
  | {
      kind: 'press_key';
      url: string;
      ts: number;
      key_combo: string;
      selector_chain?: ReturnType<typeof inPageBuildSelectorChain>;
      element_snapshot?: ReturnType<typeof inPageSnapshotElement>;
    }
  | {
      kind: 'scroll';
      url: string;
      ts: number;
      x: number;
      y: number;
    }
  | {
      kind: 'navigate';
      url: string;
      ts: number;
    };

/** Type aliases for the inline payload shape. Kept identical to types.ts. */
type InlineSelectorStrategy = {
  kind: 'matrx-ref' | 'id' | 'data-testid' | 'name-attr' | 'aria' | 'text' | 'css-path';
  selector: string;
  match_text?: string;
  role?: string;
};

type InlineElementSnapshot = {
  tag: string;
  role?: string;
  accessible_name?: string;
  visible_text?: string;
  bounding_rect?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, string>;
};

// Forward decls for the type-only references above.
declare function inPageBuildSelectorChain(el: Element): InlineSelectorStrategy[];
declare function inPageSnapshotElement(el: Element): InlineElementSnapshot;

/**
 * THE function that's serialized into the page. Returns the unique
 * marker string so subsequent injections can detect that listeners are
 * already attached and skip re-attachment (idempotent).
 */
export function mountRecorderInPage(): string {
  // Idempotency guard — re-injection on every navigation is the design,
  // but if a single load somehow runs us twice (race on injectImmediately
  // + onCompleted), we don't want double-fire.
  const SENTINEL = '__matrx_demo_recorder_mounted';
  const w = window as unknown as Record<string, unknown>;
  if (w[SENTINEL] === true) return 'already-mounted';
  w[SENTINEL] = true;

  // ─── inline helpers (selector-chain + snapshot) ───────────────────────
  function cssEscape(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
    return value.replace(/(["\\])/g, '\\$1');
  }
  function isStableId(id: string): boolean {
    if (id.length > 32) return false;
    if (/^(react|ember|svelte|vue)-?[\d_]+/i.test(id)) return false;
    if (/^[a-f0-9]{16,}$/i.test(id)) return false;
    if (/^\d+$/.test(id)) return false;
    if (/^_[\w]+_[a-f0-9]{6,}/i.test(id)) return false;
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
      default:
        return null;
    }
  }
  function accessibleName(el: Element): string | null {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = document.getElementById(labelledBy);
      if (t) return (t.textContent ?? '').trim();
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      const id = (el as HTMLElement).id;
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
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(node);
          part += `:nth-of-type(${idx + 1})`;
        }
      }
      parts.unshift(part);
      node = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  function buildSelectorChain(el: Element): InlineSelectorStrategy[] {
    const chain: InlineSelectorStrategy[] = [];
    const matrxRef = el.getAttribute('data-matrx-ref');
    if (matrxRef) chain.push({ kind: 'matrx-ref', selector: `[data-matrx-ref="${cssEscape(matrxRef)}"]` });
    const id = el.getAttribute('id');
    if (id && isStableId(id)) chain.push({ kind: 'id', selector: `#${cssEscape(id)}` });
    const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test') ?? el.getAttribute('data-cy');
    if (testId) chain.push({ kind: 'data-testid', selector: `[data-testid="${cssEscape(testId)}"]` });
    const name = el.getAttribute('name');
    if (name && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
      chain.push({ kind: 'name-attr', selector: `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]` });
    }
    const role = el.getAttribute('role') ?? implicitRole(el);
    const aname = accessibleName(el);
    if (role && aname) chain.push({ kind: 'aria', selector: `[role="${cssEscape(role)}"]`, role, match_text: aname });
    const visible = (el.textContent ?? '').trim();
    if (visible && visible.length <= 80) chain.push({ kind: 'text', selector: el.tagName.toLowerCase(), match_text: visible });
    chain.push({ kind: 'css-path', selector: cssPath(el) });
    return chain;
  }

  function snapshotElement(el: Element): InlineElementSnapshot {
    const r = el.getBoundingClientRect();
    const role = el.getAttribute('role') ?? implicitRole(el);
    const out: InlineElementSnapshot = {
      tag: el.tagName.toLowerCase(),
      role: role ?? undefined,
      accessible_name: accessibleName(el) ?? undefined,
      visible_text: ((el.textContent ?? '').trim() || undefined)?.slice(0, 200),
      bounding_rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    };
    const interesting = ['type', 'name', 'placeholder', 'href', 'aria-label', 'title'];
    const attrs: Record<string, string> = {};
    for (const a of interesting) {
      const v = el.getAttribute(a);
      if (v) attrs[a] = v;
    }
    if (Object.keys(attrs).length) out.attrs = attrs;
    return out;
  }

  // ─── event posting ────────────────────────────────────────────────────
  function post(payload: CapturedEvent) {
    const env: CapturedEventEnvelope = { __matrx: true, kind: 'demos:event', payload };
    try {
      chrome.runtime.sendMessage(env).catch(() => {});
    } catch {
      // SW gone — recording will detect on next event and re-establish.
    }
  }

  // ─── click ────────────────────────────────────────────────────────────
  document.addEventListener(
    'click',
    (ev) => {
      const target = (ev.target as Element | null)?.closest(
        'a, button, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [onclick], input[type="submit"], input[type="button"], summary, label',
      );
      const el = target ?? (ev.target as Element | null);
      if (!el) return;
      post({
        kind: 'click',
        url: location.href,
        ts: Date.now(),
        selector_chain: buildSelectorChain(el),
        element_snapshot: snapshotElement(el),
      });
    },
    { capture: true },
  );

  // ─── input (type) ─────────────────────────────────────────────────────
  // We don't fire on every keystroke — too noisy. We coalesce on blur.
  const pendingType = new WeakMap<Element, { value: string; sensitive: boolean }>();
  document.addEventListener(
    'input',
    (ev) => {
      const t = ev.target as HTMLInputElement | HTMLTextAreaElement | null;
      if (!t) return;
      if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') return;
      const inputType = (t as HTMLInputElement).type ?? '';
      const sensitive =
        inputType === 'password' ||
        /(cc-|password|secret|token|auth)/i.test(t.getAttribute('autocomplete') ?? '');
      pendingType.set(t, { value: t.value, sensitive });
    },
    { capture: true },
  );
  document.addEventListener(
    'blur',
    (ev) => {
      const t = ev.target as HTMLInputElement | HTMLTextAreaElement | null;
      if (!t) return;
      const pending = pendingType.get(t);
      if (!pending) return;
      pendingType.delete(t);
      const inputType = (t as HTMLInputElement).type ?? '';
      if (inputType === 'checkbox' || inputType === 'radio') {
        post({
          kind: 'check',
          url: location.href,
          ts: Date.now(),
          selector_chain: buildSelectorChain(t),
          element_snapshot: snapshotElement(t),
          checked: (t as HTMLInputElement).checked,
        });
        return;
      }
      post({
        kind: 'type',
        url: location.href,
        ts: Date.now(),
        selector_chain: buildSelectorChain(t),
        element_snapshot: snapshotElement(t),
        text: pending.value,
        is_sensitive: pending.sensitive,
      });
    },
    { capture: true },
  );

  // ─── change (select / checkbox / radio when not blurred) ──────────────
  document.addEventListener(
    'change',
    (ev) => {
      const t = ev.target as HTMLElement | null;
      if (!t) return;
      if (t.tagName === 'SELECT') {
        const sel = t as HTMLSelectElement;
        post({
          kind: 'select',
          url: location.href,
          ts: Date.now(),
          selector_chain: buildSelectorChain(sel),
          element_snapshot: snapshotElement(sel),
          value: sel.value,
        });
        return;
      }
      if (t.tagName === 'INPUT') {
        const inp = t as HTMLInputElement;
        if (inp.type === 'checkbox' || inp.type === 'radio') {
          pendingType.delete(inp);
          post({
            kind: 'check',
            url: location.href,
            ts: Date.now(),
            selector_chain: buildSelectorChain(inp),
            element_snapshot: snapshotElement(inp),
            checked: inp.checked,
          });
        }
      }
    },
    { capture: true },
  );

  // ─── submit ───────────────────────────────────────────────────────────
  document.addEventListener(
    'submit',
    (ev) => {
      const form = ev.target as HTMLFormElement | null;
      if (!form) return;
      post({
        kind: 'submit',
        url: location.href,
        ts: Date.now(),
        selector_chain: buildSelectorChain(form),
        element_snapshot: snapshotElement(form),
      });
    },
    { capture: true },
  );

  // ─── key combos (Enter, Esc, named Cmd/Ctrl chords) ───────────────────
  document.addEventListener(
    'keydown',
    (ev) => {
      const interesting =
        ev.key === 'Enter' || ev.key === 'Escape' || ev.key === 'Tab' || ev.metaKey || ev.ctrlKey;
      if (!interesting) return;
      const parts: string[] = [];
      if (ev.metaKey) parts.push('Meta');
      if (ev.ctrlKey) parts.push('Ctrl');
      if (ev.altKey) parts.push('Alt');
      if (ev.shiftKey) parts.push('Shift');
      parts.push(ev.key);
      const target = ev.target as Element | null;
      post({
        kind: 'press_key',
        url: location.href,
        ts: Date.now(),
        key_combo: parts.join('+'),
        selector_chain: target ? buildSelectorChain(target) : undefined,
        element_snapshot: target ? snapshotElement(target) : undefined,
      });
    },
    { capture: true },
  );

  // ─── scroll (debounced) ───────────────────────────────────────────────
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  document.addEventListener(
    'scroll',
    () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        post({
          kind: 'scroll',
          url: location.href,
          ts: Date.now(),
          x: window.scrollX,
          y: window.scrollY,
        });
      }, 250);
    },
    { capture: true, passive: true },
  );

  // ─── navigations triggered by SPA / pushState ─────────────────────────
  // Initial page-load navigate (so the recording always opens with a
  // navigate step, even when the script attaches mid-flow).
  post({ kind: 'navigate', url: location.href, ts: Date.now() });

  return 'mounted';
}
