/**
 * Synthetic keyboard / mouse interactions for cases where click_element +
 * type_into_element aren't enough.
 *
 *   press_keys      (action) — Send a keyboard sequence to the focused element
 *                              (or a target selector). Supports modifiers and
 *                              named keys (Enter, Escape, Tab, ArrowDown, …).
 *   hover_element   (action) — Trigger mouseenter/mouseover on an element so
 *                              hover-only menus/tooltips appear.
 *   focus_element   (action) — Move document focus to a selector.
 *   blur_element    (action) — Remove focus from a selector (or active el).
 *   right_click     (action) — Synthesize a contextmenu event on a selector.
 */

import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

const PressKeysArgs = z.object({
  /**
   * Sequence to type. May be a literal string ("hello world") or named
   * keys / chords separated by spaces ("Enter", "Control+Shift+K", "Tab",
   * "ArrowDown ArrowDown Enter"). Multi-char tokens are interpreted as keys
   * if they match a known KeyboardEvent.code/key (Enter, Escape, Tab,
   * ArrowUp/Down/Left/Right, Backspace, Delete, Home, End, PageUp,
   * PageDown, Space, F1-F12).
   */
  keys: z.string().min(1),
  /** Optional selector to focus first. Otherwise sent to currently focused el. */
  selector: z.string().optional(),
  /** Per-key delay in ms. Default 30. */
  delay_ms: z.number().int().min(0).max(1000).optional().default(30),
});
type PressKeysArgs = z.infer<typeof PressKeysArgs>;

export const press_keys: ToolHandler<PressKeysArgs, unknown> = {
  name: 'press_keys',
  tier: 'action',
  description:
    'Send keyboard input to a page. Pass either a literal string ("hello world") or named keys/chords ("Enter", "Control+A", "Tab", "ArrowDown ArrowDown Enter"). When `selector` is provided the tool focuses that element first. Useful for triggering submit-on-Enter, navigating menus, dismissing dialogs, and using app keyboard shortcuts.',
  argsSchema: PressKeysArgs,
  run: async (args) => {
    const tabId = await activeTabId();
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (rawKeys: string, targetSelector: string | undefined, delayMs: number) => {
        const NAMED_KEYS = new Set([
          'Enter',
          'Escape',
          'Tab',
          'Backspace',
          'Delete',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Home',
          'End',
          'PageUp',
          'PageDown',
          'Space',
          'F1',
          'F2',
          'F3',
          'F4',
          'F5',
          'F6',
          'F7',
          'F8',
          'F9',
          'F10',
          'F11',
          'F12',
        ]);
        const MOD_KEYS: Record<string, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'> = {
          Control: 'ctrlKey',
          Ctrl: 'ctrlKey',
          Alt: 'altKey',
          Shift: 'shiftKey',
          Meta: 'metaKey',
          Command: 'metaKey',
          Cmd: 'metaKey',
        };

        let target: HTMLElement | null = null;
        if (targetSelector) {
          target = document.querySelector(targetSelector) as HTMLElement | null;
          if (!target) return { ok: false, reason: `No element at ${targetSelector}` };
          target.focus();
        } else {
          target = (document.activeElement as HTMLElement | null) ?? document.body;
        }

        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const tokens = rawKeys.trim().split(/\s+/);
        const sentEvents: string[] = [];

        for (const token of tokens) {
          const parts = token.split('+');
          const mods: Record<string, boolean> = {};
          let key: string | null = null;
          for (const p of parts) {
            if (MOD_KEYS[p]) {
              mods[MOD_KEYS[p]] = true;
              continue;
            }
            key = p;
          }
          if (!key) continue;

          if (NAMED_KEYS.has(key)) {
            const code =
              key === 'Space'
                ? 'Space'
                : key.startsWith('Arrow')
                  ? key
                  : key === 'PageUp' || key === 'PageDown'
                    ? key
                    : key;
            const init: KeyboardEventInit = {
              key: key === 'Space' ? ' ' : key,
              code,
              bubbles: true,
              cancelable: true,
              ...mods,
            };
            target?.dispatchEvent(new KeyboardEvent('keydown', init));
            target?.dispatchEvent(new KeyboardEvent('keyup', init));
            sentEvents.push(token);
          } else if (parts.length > 1) {
            // Modifier + character chord (e.g. Ctrl+A). Single char.
            const init: KeyboardEventInit = {
              key,
              code: `Key${key.toUpperCase()}`,
              bubbles: true,
              cancelable: true,
              ...mods,
            };
            target?.dispatchEvent(new KeyboardEvent('keydown', init));
            target?.dispatchEvent(new KeyboardEvent('keyup', init));
            sentEvents.push(token);
          } else {
            // Literal characters — type each one.
            for (const ch of key) {
              const init: KeyboardEventInit = {
                key: ch,
                code: `Key${ch.toUpperCase()}`,
                bubbles: true,
                cancelable: true,
              };
              target?.dispatchEvent(new KeyboardEvent('keydown', init));
              target?.dispatchEvent(new KeyboardEvent('keypress', init));
              // Also append to value if the active element is an input.
              if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
                const proto = Object.getPrototypeOf(target);
                const desc = Object.getOwnPropertyDescriptor(proto, 'value');
                const setter = desc?.set;
                const next = (target.value ?? '') + ch;
                if (setter) setter.call(target, next);
                else target.value = next;
                target.dispatchEvent(new Event('input', { bubbles: true }));
              } else if (target?.isContentEditable) {
                target.textContent = (target.textContent ?? '') + ch;
                target.dispatchEvent(new Event('input', { bubbles: true }));
              }
              target?.dispatchEvent(new KeyboardEvent('keyup', init));
              sentEvents.push(ch);
              if (delayMs > 0) await sleep(delayMs);
            }
            continue;
          }
          if (delayMs > 0) await sleep(delayMs);
        }
        return { ok: true, sent: sentEvents.length, target_tag: target?.tagName.toLowerCase() };
      },
      args: [args.keys, args.selector, args.delay_ms],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

const HoverArgs = z.object({ selector: z.string().min(1) });
type HoverArgs = z.infer<typeof HoverArgs>;

export const hover_element: ToolHandler<HoverArgs, unknown> = {
  name: 'hover_element',
  tier: 'action',
  description:
    'Trigger hover on an element by dispatching mouseenter/mouseover/mousemove events. Use this to reveal hover-only tooltips, dropdown menus, or sub-navigation that only appear when the cursor is over a parent.',
  argsSchema: HoverArgs,
  run: async (args) => {
    const tabId = await activeTabId();
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return { ok: false, reason: `No element at ${selector}` };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const rect = el.getBoundingClientRect();
        const init: MouseEventInit = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        };
        el.dispatchEvent(new MouseEvent('mouseover', init));
        el.dispatchEvent(new MouseEvent('mouseenter', init));
        el.dispatchEvent(new MouseEvent('mousemove', init));
        return { ok: true, tag: el.tagName.toLowerCase() };
      },
      args: [args.selector],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

const FocusArgs = z.object({ selector: z.string().min(1) });
type FocusArgs = z.infer<typeof FocusArgs>;

export const focus_element: ToolHandler<FocusArgs, unknown> = {
  name: 'focus_element',
  tier: 'action',
  description:
    'Move keyboard focus to an element (calls .focus() and scrolls it into view). Use before press_keys when no selector is supplied.',
  argsSchema: FocusArgs,
  run: async (args) => {
    const tabId = await activeTabId();
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return { ok: false, reason: `No element at ${selector}` };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.focus();
        return { ok: true, focused: document.activeElement === el };
      },
      args: [args.selector],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

const BlurArgs = z.object({ selector: z.string().optional() }).default({});
type BlurArgs = z.infer<typeof BlurArgs>;

export const blur_element: ToolHandler<BlurArgs, unknown> = {
  name: 'blur_element',
  tier: 'action',
  description:
    'Remove focus from an element. With no selector, blurs whatever currently has focus. Useful before press_keys when shortcuts must hit document instead of an input.',
  argsSchema: BlurArgs,
  run: async (args) => {
    const tabId = await activeTabId();
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector: string | undefined) => {
        const el =
          (selector
            ? (document.querySelector(selector) as HTMLElement | null)
            : (document.activeElement as HTMLElement | null)) ?? null;
        if (!el || typeof el.blur !== 'function') return { ok: false, reason: 'no focused el' };
        el.blur();
        return { ok: true };
      },
      args: [args.selector],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

const RightClickArgs = z.object({ selector: z.string().min(1) });
type RightClickArgs = z.infer<typeof RightClickArgs>;

export const right_click_element: ToolHandler<RightClickArgs, unknown> = {
  name: 'right_click_element',
  tier: 'action',
  description:
    "Dispatch a contextmenu event on an element (synthetic right-click). Note: most apps respond by showing their own custom menu in the page DOM. Chrome's native context menu cannot be opened by extension scripts.",
  argsSchema: RightClickArgs,
  run: async (args) => {
    const tabId = await activeTabId();
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return { ok: false, reason: `No element at ${selector}` };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const rect = el.getBoundingClientRect();
        const init: MouseEventInit = {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 2,
          buttons: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        };
        el.dispatchEvent(new MouseEvent('contextmenu', init));
        return { ok: true };
      },
      args: [args.selector],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

export const keyboard_handlers = [
  press_keys,
  hover_element,
  focus_element,
  blur_element,
  right_click_element,
];
