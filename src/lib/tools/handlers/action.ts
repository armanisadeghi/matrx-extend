/**
 * Tier: ACTION — mutating tools. In "Ask" permission mode they prompt the
 * user; in "Act" mode they run immediately.
 *
 * All operate on the active tab in v1. Multi-tab / tab-group operation
 * arrives once we add the `tabs` + `tabGroups` permissions to the manifest.
 */

import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const NavigateArgs = z.object({
  url: z.string().url(),
});
type NavigateArgs = z.infer<typeof NavigateArgs>;

export const navigate_active_tab: ToolHandler<NavigateArgs, unknown> = {
  name: 'navigate_active_tab',
  tier: 'action',
  description:
    'Navigate the active tab to a URL. Waits for status=complete before resolving (timeout 30s). Returns { url, title, status }.',
  argsSchema: NavigateArgs,
  run: async (args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    await chrome.tabs.update(tabId, { url: args.url });
    await waitForLoad(tabId, 30_000);
    const tab = await chrome.tabs.get(tabId);
    return { url: tab.url, title: tab.title, status: tab.status };
  },
};

/**
 * Resolve a selector|ref pair to a concrete CSS selector. Refs are
 * `data-matrx-ref` attributes attached by `read_page`; passing a ref is
 * preferred over a selector when you've just read the page.
 */
function resolveRef(args: { selector?: string; ref?: string }): string | null {
  if (args.ref) {
    const n = args.ref.startsWith('ref:') ? args.ref.slice(4) : args.ref;
    return `[data-matrx-ref="${n.replace(/"/g, '\\"')}"]`;
  }
  return args.selector ?? null;
}

const ClickArgs = z
  .object({
    selector: z.string().min(1).optional(),
    /** Reference id from read_page (e.g. "ref:42"). Preferred over selector. */
    ref: z.string().min(1).optional(),
    /** When multiple match, click the Nth (default 0). */
    nth: z.number().int().min(0).optional().default(0),
  })
  .refine((d) => d.selector || d.ref, {
    message: 'must provide either `selector` or `ref`',
  });
type ClickArgs = z.infer<typeof ClickArgs>;

export const click_element: ToolHandler<ClickArgs, unknown> = {
  name: 'click_element',
  tier: 'action',
  requires_broad_host_access: true,
  description:
    'Click an element on the active tab. Pass `ref` from read_page (preferred — stable across DOM mutations) OR a CSS `selector`. When multiple match a selector, use `nth`. Returns { ok, tag, text } or { ok:false, reason }.',
  argsSchema: ClickArgs,
  run: async (args, ctx) => {
    const selector = resolveRef(args);
    if (!selector) return { ok: false, reason: 'must provide selector or ref' };
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel: string, nth: number) => {
        const list = document.querySelectorAll(sel);
        const el = list[nth] as HTMLElement | undefined;
        if (!el) return { ok: false, reason: `No element at index ${nth} for selector ${sel}` };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.click();
        return {
          ok: true,
          tag: el.tagName.toLowerCase(),
          text: (el.innerText ?? '').slice(0, 200),
        };
      },
      args: [selector, args.nth],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

const TypeArgs = z
  .object({
    selector: z.string().min(1).optional(),
    /** Reference id from read_page (e.g. "ref:42"). Preferred over selector. */
    ref: z.string().min(1).optional(),
    text: z.string(),
    /** Clear the input first. Default true. */
    clear: z.boolean().optional().default(true),
    /** Dispatch input/change events so React/Vue/etc. apps see the change. Default true. */
    dispatch_events: z.boolean().optional().default(true),
  })
  .refine((d) => d.selector || d.ref, {
    message: 'must provide either `selector` or `ref`',
  });
type TypeArgs = z.infer<typeof TypeArgs>;

export const type_into_element: ToolHandler<TypeArgs, unknown> = {
  name: 'type_into_element',
  tier: 'action',
  requires_broad_host_access: true,
  description:
    'Set the value of an input / textarea / contenteditable. Pass `ref` from read_page (preferred) OR a CSS `selector`. By default clears the field first and dispatches input + change events so React/Vue see the update.',
  argsSchema: TypeArgs,
  run: async (args, ctx) => {
    const selector = resolveRef(args);
    if (!selector) return { ok: false, reason: 'must provide selector or ref' };
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel: string, text: string, clear: boolean, dispatchEvents: boolean) => {
        const el = document.querySelector(sel) as
          | HTMLInputElement
          | HTMLTextAreaElement
          | HTMLElement
          | null;
        if (!el) return { ok: false, reason: `No element for selector ${sel}` };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        if (
          'value' in el &&
          (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
        ) {
          // React tracks the underlying value setter, bypass with the native one.
          const proto = Object.getPrototypeOf(el);
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          const nativeSetter = desc?.set;
          const next = clear ? text : (el.value ?? '') + text;
          if (nativeSetter) nativeSetter.call(el, next);
          else el.value = next;
        } else if (el.isContentEditable) {
          if (clear) el.textContent = '';
          el.textContent = (el.textContent ?? '') + text;
        } else {
          return { ok: false, reason: 'Element is not editable' };
        }
        if (dispatchEvents) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return { ok: true, tag: el.tagName.toLowerCase() };
      },
      args: [selector, args.text, args.clear, args.dispatch_events],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

const ScrollArgs = z.object({
  /** Either 'top' / 'bottom' / 'into-view' (with selector or ref) / 'by' (with delta_y). */
  direction: z.enum(['top', 'bottom', 'into-view', 'by']),
  selector: z.string().optional(),
  /** Ref from read_page (alternative to selector for 'into-view'). */
  ref: z.string().optional(),
  delta_y: z.number().optional(),
});
type ScrollArgs = z.infer<typeof ScrollArgs>;

export const scroll_page: ToolHandler<ScrollArgs, unknown> = {
  name: 'scroll_page',
  tier: 'action',
  requires_broad_host_access: true,
  description:
    'Scroll the active tab. direction="top"/"bottom" go to extremes; "into-view" scrolls a selector or `ref` (from read_page) into view; "by" scrolls by delta_y pixels.',
  argsSchema: ScrollArgs,
  run: async (args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const sel = resolveRef(args);
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (direction: string, selector: string | null, deltaY: number | null) => {
        if (direction === 'top') {
          window.scrollTo({ top: 0 });
        } else if (direction === 'bottom') {
          window.scrollTo({ top: document.documentElement.scrollHeight });
        } else if (direction === 'into-view') {
          if (!selector) return { ok: false, reason: 'selector or ref required' };
          const el = document.querySelector(selector) as HTMLElement | null;
          if (!el) return { ok: false, reason: `No element for ${selector}` };
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
        } else if (direction === 'by') {
          if (deltaY === null) return { ok: false, reason: 'delta_y required' };
          window.scrollBy({ top: deltaY });
        }
        return { ok: true, scrollY: window.scrollY };
      },
      args: [args.direction, sel, args.delta_y ?? null],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

const WaitArgs = z.object({
  /** Wait until the given selector exists. */
  selector: z.string().optional(),
  /** Wait until the page reports readyState='complete'. */
  ready_state: z.boolean().optional(),
  /** Hard cap (ms). */
  timeout_ms: z.number().int().positive().max(60_000).optional().default(10_000),
});
type WaitArgs = z.infer<typeof WaitArgs>;

export const wait_for: ToolHandler<WaitArgs, unknown> = {
  name: 'wait_for',
  tier: 'action',
  requires_broad_host_access: true,
  description:
    'Wait for a condition on the active tab — either the page to fully load (ready_state=true) and/or a selector to appear. Returns { ok, waited_ms }.',
  argsSchema: WaitArgs,
  run: async (args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const start = Date.now();
    if (args.ready_state) await waitForLoad(tabId, args.timeout_ms);
    if (args.selector) {
      const remaining = args.timeout_ms - (Date.now() - start);
      const [first] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (selector: string, max: number) =>
          new Promise<{ ok: boolean }>((resolve) => {
            const startedAt = Date.now();
            const tick = () => {
              if (document.querySelector(selector)) return resolve({ ok: true });
              if (Date.now() - startedAt > max) return resolve({ ok: false });
              setTimeout(tick, 100);
            };
            tick();
          }),
        args: [args.selector, Math.max(0, remaining)],
      });
      const r = first?.result as { ok: boolean } | undefined;
      if (!r?.ok) return { ok: false, reason: `selector ${args.selector} did not appear` };
    }
    return { ok: true, waited_ms: Date.now() - start };
  },
};

function waitForLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(handler);
      resolve();
    };
    const handler = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(handler);
    setTimeout(finish, timeoutMs);
  });
}

const ClipboardArgs = z.object({ text: z.string() });
type ClipboardArgs = z.infer<typeof ClipboardArgs>;

export const set_clipboard: ToolHandler<ClipboardArgs, unknown> = {
  name: 'set_clipboard',
  tier: 'action',
  description: 'Write text to the system clipboard.',
  argsSchema: ClipboardArgs,
  run: async (args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (text: string) => {
        try {
          await navigator.clipboard.writeText(text);
          return { ok: true };
        } catch (err) {
          return { ok: false, reason: (err as Error).message };
        }
      },
      args: [args.text],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

// ─── sleep ────────────────────────────────────────────────────────────────

const SleepArgs = z
  .object({
    /** How long to pause, in milliseconds. Capped at 5 minutes. */
    ms: z.number().int().min(50).max(300_000),
    /** Optional human-readable reason — surfaces in the timeline. */
    reason: z.string().max(200).optional(),
  })
  .strict();
type SleepArgs = z.infer<typeof SleepArgs>;

export const sleep: ToolHandler<SleepArgs, unknown> = {
  name: 'sleep',
  tier: 'action',
  description:
    'Pause the agent for `ms` milliseconds (50ms–5min). Use when waiting for time-based things the page does on its own — a video to play before capturing transcript, an animation to finish, a debounced search to settle, a rate-limit window to clear. The server is non-blocking during the pause; only the agent waits. Prefer `wait_for` when you have a concrete condition (selector or readyState) — `sleep` is for unconditional waits. Returns { ok, slept_ms }.',
  argsSchema: SleepArgs,
  run: async (args) => {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, args.ms));
    return { ok: true, slept_ms: Date.now() - start, reason: args.reason ?? null };
  },
};

export const action_handlers = [
  navigate_active_tab,
  click_element,
  type_into_element,
  scroll_page,
  wait_for,
  set_clipboard,
  sleep,
];
