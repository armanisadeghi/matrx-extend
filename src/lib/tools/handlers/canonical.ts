/**
 * Canonical tool routers — implements the unified tool shape from
 * `browser_tools_canonical.json` (computer / form_input / navigate / tabs /
 * downloads / memory / clipboard) on top of the extension's existing
 * specific handlers.
 *
 * Strategy: each router is a thin dispatcher. When the canonical caller
 * passes a `tabId` (string per canonical), we activate that tab first,
 * then delegate to the existing implicit-active-tab handler. This keeps
 * the migration small — every existing handler still works — at the cost
 * of one tab switch per cross-tab action. The user is watching their
 * browser, so the visual switch is expected.
 *
 * Tier resolution: routers declare `tierFor(args)` so a single tool
 * (`computer`, `tabs`) can mix read and action sub-actions correctly
 * under one name. The dispatcher consults `tierFor` before falling back
 * to `handler.tier`.
 */

import { uploadFile, downloadFileBytes } from '@/lib/api/routes/files';
import { extractPdfText } from '@/lib/api/routes/pdf';
import { log } from '@/lib/debug/log';
import {
  click_element,
  navigate_active_tab,
  scroll_page,
  set_clipboard,
  type_into_element,
  wait_for as legacy_wait_for,
} from '@/lib/tools/handlers/action';
import { list_downloads } from '@/lib/tools/handlers/browser-data';
import { cancel_download, download_url } from '@/lib/tools/handlers/downloads';
import {
  select_dropdown_option,
  set_checkbox,
  set_radio,
} from '@/lib/tools/handlers/forms';
import {
  blur_element,
  focus_element,
  hover_element,
  press_keys,
  right_click_element,
} from '@/lib/tools/handlers/keyboard';
import { take_screenshot } from '@/lib/tools/handlers/read';
import { getAssignedTab } from '@/lib/tools/handlers/_active-tab';
import {
  close_tab,
  duplicate_tab,
  get_tab_info,
  go_back,
  go_forward,
  list_open_tabs,
  move_tab,
  mute_tab,
  open_new_tab,
  pin_tab,
  reload_tab,
  set_tab_zoom,
  switch_to_tab,
} from '@/lib/tools/handlers/tabs';
import type { ToolHandler, ToolTier } from '@/lib/tools/types';
import { z } from 'zod';

/**
 * Activate a tab (so subsequent active-tab-implicit handlers target it).
 * Accepts canonical string tabId; coerces to chrome's int.
 */
async function activateTab(tabId: string): Promise<{ ok: true; id: number } | { ok: false; reason: string }> {
  const id = Number.parseInt(tabId, 10);
  if (!Number.isFinite(id)) return { ok: false, reason: `Invalid tabId: ${tabId}` };
  try {
    const tab = await chrome.tabs.get(id);
    if (!tab.active) {
      await chrome.tabs.update(id, { active: true });
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    }
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: `Tab ${id} not found: ${(err as Error).message}` };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// computer — mouse/keyboard/screenshot (canonical action enum)
// ────────────────────────────────────────────────────────────────────────────

const ComputerArgs = z.object({
  tabId: z.string(),
  action: z.enum([
    'left_click',
    'right_click',
    'double_click',
    'triple_click',
    'type',
    'key',
    'scroll',
    'hover',
    'screenshot',
    'left_click_drag',
    'scroll_to',
    'focus',
    'blur',
  ]),
  coordinate: z.array(z.number()).length(2).optional(),
  ref: z.string().optional(),
  text: z.string().optional(),
  repeat: z.number().int().min(1).max(100).default(1),
  modifiers: z.string().optional(),
  scroll_direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  scroll_amount: z.number().int().min(1).max(10).default(3),
  start_coordinate: z.array(z.number()).length(2).optional(),
});
type ComputerArgs = z.infer<typeof ComputerArgs>;

const COMPUTER_READ_ACTIONS = new Set(['screenshot', 'hover']);

export const computer: ToolHandler<ComputerArgs, unknown> = {
  name: 'computer',
  tier: 'action',
  tierFor: (args): ToolTier => (COMPUTER_READ_ACTIONS.has(args.action) ? 'read' : 'action'),
  description:
    "Mouse, keyboard, and screenshot interactions. Prefer 'ref' over 'coordinate' when targeting elements; coordinates survive poorly across scrolls and layout changes. The 'screenshot' action persists the image to cloud and returns {file_id, file_url, width, height, mime_type} — use that file_id with upload_file or drop_file later. Use wait_for for synchronization, NOT a fixed sleep.",
  argsSchema: ComputerArgs,
  run: async (args, ctx) => {
    const act = await activateTab(args.tabId);
    if (!act.ok) return { ok: false, reason: act.reason };
    switch (args.action) {
      case 'left_click': {
        if (args.coordinate && !args.ref) {
          return clickAtCoord(act.id, args.coordinate[0]!, args.coordinate[1]!);
        }
        return click_element.run(
          { ref: args.ref, selector: undefined, nth: 0 } as never,
          ctx,
        );
      }
      case 'right_click':
        return right_click_element.run({ ref: args.ref, selector: undefined } as never, ctx);
      case 'double_click':
        return clickWithDetail(act.id, args, 2);
      case 'triple_click':
        return clickWithDetail(act.id, args, 3);
      case 'type': {
        if (args.text == null) return { ok: false, reason: "'text' is required for action='type'" };
        if (args.ref) {
          return type_into_element.run(
            { ref: args.ref, text: args.text, clear: true, dispatch_events: true } as never,
            ctx,
          );
        }
        // No ref → type into whatever currently has focus.
        return typeIntoFocused(act.id, args.text);
      }
      case 'key': {
        if (args.text == null) return { ok: false, reason: "'text' is required for action='key'" };
        // Construct a shape that matches PressKeysArgs exactly. We're calling
        // press_keys.run() directly (bypassing the Zod parse that would have
        // applied .default()), so we have to supply real values — never
        // `undefined` — for fields that ship as args to executeScript.
        return press_keys.run(
          { keys: args.text, selector: undefined, ref: undefined, delay_ms: 30 } as never,
          ctx,
        );
      }
      case 'scroll': {
        if (!args.scroll_direction)
          return { ok: false, reason: "'scroll_direction' is required for action='scroll'" };
        const delta = args.scroll_amount * 100; // ~1 wheel tick = 100px
        if (args.scroll_direction === 'up') return scroll_page.run({ direction: 'by', delta_y: -delta } as never, ctx);
        if (args.scroll_direction === 'down') return scroll_page.run({ direction: 'by', delta_y: delta } as never, ctx);
        // left/right: fall through to scripted axis scroll
        return scrollAxis(act.id, args.scroll_direction, delta);
      }
      case 'scroll_to':
        if (!args.ref) return { ok: false, reason: "'ref' is required for action='scroll_to'" };
        return scroll_page.run({ direction: 'into-view', ref: args.ref } as never, ctx);
      case 'hover':
        return hover_element.run({ ref: args.ref, selector: undefined } as never, ctx);
      case 'focus':
        return focus_element.run({ ref: args.ref, selector: undefined } as never, ctx);
      case 'blur':
        return blur_element.run({ ref: args.ref, selector: undefined } as never, ctx);
      case 'screenshot':
        return doScreenshot(args.tabId, ctx);
      case 'left_click_drag':
        if (!args.start_coordinate || !args.coordinate) {
          return { ok: false, reason: "'start_coordinate' and 'coordinate' are required for left_click_drag" };
        }
        return dragFromTo(
          act.id,
          [args.start_coordinate[0]!, args.start_coordinate[1]!],
          [args.coordinate[0]!, args.coordinate[1]!],
        );
      default:
        return { ok: false, reason: `Unknown computer action: ${(args as { action: string }).action}` };
    }
  },
};

async function clickAtCoord(tabId: number, x: number, y: number) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (cx: number, cy: number) => {
      const el = document.elementFromPoint(cx, cy);
      if (!(el instanceof HTMLElement)) return { ok: false, reason: 'No element at point' };
      el.click();
      return { ok: true, tag: el.tagName.toLowerCase() };
    },
    args: [x, y],
  });
  return r?.result ?? { ok: false, reason: 'click failed' };
}

async function clickWithDetail(tabId: number, args: ComputerArgs, detail: 2 | 3) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (refSel: string | null, coord: [number, number] | null, det: number) => {
      let el: Element | null = null;
      if (refSel) {
        el = document.querySelector(refSel);
      } else if (coord) {
        el = document.elementFromPoint(coord[0], coord[1]);
      }
      if (!(el instanceof HTMLElement)) return { ok: false, reason: 'No target' };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const init = { bubbles: true, cancelable: true, view: window, detail: det };
      el.dispatchEvent(new MouseEvent('mousedown', init));
      el.dispatchEvent(new MouseEvent('mouseup', init));
      el.dispatchEvent(new MouseEvent('click', init));
      if (det >= 2) el.dispatchEvent(new MouseEvent('dblclick', init));
      return { ok: true, detail: det };
    },
    args: [
      args.ref ? `[data-matrx-ref="${args.ref.replace(/^ref:/, '')}"]` : null,
      args.coordinate ? [args.coordinate[0]!, args.coordinate[1]!] : null,
      detail,
    ],
  });
  return r?.result ?? { ok: false, reason: 'click failed' };
}

async function typeIntoFocused(tabId: number, text: string) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (s: string) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return { ok: false, reason: 'No focused element' };
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        const setter = desc?.set;
        if (setter) setter.call(el, s);
        else el.value = s;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      }
      if (el.isContentEditable) {
        el.textContent = s;
        return { ok: true };
      }
      return { ok: false, reason: 'Focused element is not editable' };
    },
    args: [text],
  });
  return r?.result ?? { ok: false, reason: 'type failed' };
}

async function scrollAxis(tabId: number, direction: 'left' | 'right', delta: number) {
  const dx = direction === 'right' ? delta : -delta;
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (deltaX: number) => {
      window.scrollBy({ left: deltaX, behavior: 'auto' });
      return { ok: true };
    },
    args: [dx],
  });
  return r?.result ?? { ok: false, reason: 'scroll failed' };
}

async function dragFromTo(tabId: number, from: [number, number], to: [number, number]) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (fx: number, fy: number, tx: number, ty: number) => {
      const start = document.elementFromPoint(fx, fy);
      const end = document.elementFromPoint(tx, ty);
      if (!(start instanceof HTMLElement)) return { ok: false, reason: 'No element at start_coordinate' };
      const init = (x: number, y: number) => ({
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        clientX: x,
        clientY: y,
      });
      start.dispatchEvent(new MouseEvent('mousedown', init(fx, fy)));
      start.dispatchEvent(new MouseEvent('mousemove', init(tx, ty)));
      (end ?? start).dispatchEvent(new MouseEvent('mouseup', init(tx, ty)));
      return { ok: true };
    },
    args: [from[0]!, from[1]!, to[0]!, to[1]!],
  });
  return r?.result ?? { ok: false, reason: 'drag failed' };
}

async function doScreenshot(tabIdStr: string, ctx: Parameters<typeof take_screenshot.run>[1]) {
  // Reuse the existing capture logic. `take_screenshot` itself now
  // uploads to cld_files + indexes in wbx_screenshot via the shared
  // persistScreenshot helper, so the canonical wrapper just unwraps
  // the file_id/file_url it returns. No extra upload round-trip.
  const result = await take_screenshot.run(
    {
      profile: 'auto',
      format: undefined,
      quality: undefined,
      max_dimension: undefined,
      persist: true,
      capture_source: 'agent',
    } as never,
    ctx,
  );
  const r = result as unknown as Record<string, unknown>;
  if (r.ok !== true) return result;
  const mime = (r.media_type as string) ?? 'image/jpeg';
  // Happy path — read.ts persisted to cld_files for us.
  if (typeof r.file_id === 'string') {
    return {
      ok: true,
      file_id: r.file_id,
      file_url: (r.file_url as string | null) ?? null,
      width: r.width,
      height: r.height,
      mime_type: mime,
      tabId: tabIdStr,
    };
  }
  // Fallback — persistence was skipped or failed but we still have the
  // inline image. Mirror the legacy behaviour: re-upload here so
  // upload_file/drop_file consumers get a usable file_id.
  if (typeof r.image_base64 !== 'string') return result;
  const ext = mime.includes('png') ? 'png' : 'jpg';
  const filename = `screenshot-${Date.now()}.${ext}`;
  try {
    const bytes = Uint8Array.from(atob(r.image_base64 as string), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: mime });
    const upload = await uploadFile(blob, filename, {
      path: `browser-agent/screenshots/${filename}`,
    });
    return {
      ok: true,
      file_id: upload.file_id,
      file_url: upload.url ?? upload.cdn_url ?? null,
      width: r.width,
      height: r.height,
      mime_type: mime,
      tabId: tabIdStr,
    };
  } catch (err) {
    log.error('sw', 'screenshot upload failed; returning inline image', err);
    return result;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// form_input — set a form element's value (text / boolean / option)
// ────────────────────────────────────────────────────────────────────────────

const FormInputArgs = z.object({
  tabId: z.string(),
  ref: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
type FormInputArgs = z.infer<typeof FormInputArgs>;

export const form_input: ToolHandler<FormInputArgs, unknown> = {
  name: 'form_input',
  tier: 'action',
  description:
    "Set the value of a form element by reference. Use string for text inputs, boolean for checkboxes/radios, value or visible label for selects. The handler dispatches on element type — you don't need to specify it.",
  argsSchema: FormInputArgs,
  run: async (args, ctx) => {
    const act = await activateTab(args.tabId);
    if (!act.ok) return { ok: false, reason: act.reason };
    // Resolve the element type so we can route to the right specialist.
    const refSelector = `[data-matrx-ref="${args.ref.replace(/^ref:/, '')}"]`;
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId: act.id },
      func: (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return { kind: 'missing' as const };
        const tag = el.tagName.toLowerCase();
        if (tag === 'select') return { kind: 'select' as const };
        if (tag === 'textarea') return { kind: 'text' as const };
        if (tag === 'input') {
          const t = (el as HTMLInputElement).type;
          if (t === 'checkbox') return { kind: 'checkbox' as const };
          if (t === 'radio') return { kind: 'radio' as const };
          return { kind: 'text' as const };
        }
        if ((el as HTMLElement).isContentEditable) return { kind: 'text' as const };
        return { kind: 'unknown' as const };
      },
      args: [refSelector],
    });
    const kind = (probe?.result as { kind: string } | undefined)?.kind ?? 'missing';
    if (kind === 'missing') return { ok: false, reason: `No element for ${args.ref}` };
    if (kind === 'select') {
      return select_dropdown_option.run(
        { ref: args.ref, value: typeof args.value === 'string' ? args.value : String(args.value) } as never,
        ctx,
      );
    }
    if (kind === 'checkbox') {
      return set_checkbox.run({ ref: args.ref, checked: Boolean(args.value) } as never, ctx);
    }
    if (kind === 'radio') {
      return set_radio.run({ ref: args.ref, value: String(args.value) } as never, ctx);
    }
    if (kind === 'text') {
      return type_into_element.run(
        {
          ref: args.ref,
          text: typeof args.value === 'string' ? args.value : String(args.value),
          clear: true,
          dispatch_events: true,
        } as never,
        ctx,
      );
    }
    return { ok: false, reason: `Unsupported form element kind: ${kind}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// navigate — URL or back/forward
// ────────────────────────────────────────────────────────────────────────────

const NavigateArgs = z.object({
  tabId: z.string(),
  url: z.string(),
  force: z.boolean().default(false),
});
type NavigateArgs = z.infer<typeof NavigateArgs>;

export const navigate: ToolHandler<NavigateArgs, unknown> = {
  name: 'navigate',
  tier: 'action',
  description:
    "Navigate a tab to a URL, or move through history with 'back'/'forward'. Protocol defaults to https:// if omitted. After navigating, refs from prior read_page calls are invalidated — call read_page again before referencing elements.",
  argsSchema: NavigateArgs,
  run: async (args, ctx) => {
    const act = await activateTab(args.tabId);
    if (!act.ok) return { ok: false, reason: act.reason };
    if (args.url === 'back') return go_back.run({} as never, ctx);
    if (args.url === 'forward') return go_forward.run({} as never, ctx);
    let url = args.url;
    if (!/^[a-z]+:\/\//i.test(url) && !url.startsWith('//')) url = `https://${url}`;
    return navigate_active_tab.run({ url } as never, ctx);
  },
};

// ────────────────────────────────────────────────────────────────────────────
// tabs — list / create / close / switch / reload
// ────────────────────────────────────────────────────────────────────────────

const TabsArgs = z.object({
  action: z.enum([
    'list',
    'create',
    'close',
    'switch',
    'reload',
    'active',
    'info',
    'pin',
    'mute',
    'duplicate',
    'move',
    'zoom',
  ]),
  tabId: z.string().optional(),
  url: z.string().optional(),
  /** For 'pin'/'mute' — set or unset (default true). */
  on: z.boolean().optional(),
  /** For 'move' — destination index in window. */
  index: z.number().int().optional(),
  /** For 'move' — destination window id. Defaults to current window. */
  window_id: z.number().int().optional(),
  /** For 'zoom' — zoom factor (e.g. 1.0 = 100%, 1.5 = 150%). */
  zoom_factor: z.number().positive().optional(),
});
type TabsArgs = z.infer<typeof TabsArgs>;

const TABS_READ_ACTIONS = new Set(['list', 'active', 'info']);

export const tabs: ToolHandler<TabsArgs, unknown> = {
  name: 'tabs',
  tier: 'action',
  tierFor: (args): ToolTier => (TABS_READ_ACTIONS.has(args.action) ? 'read' : 'action'),
  description:
    "Manage browser tabs. Actions: 'list' (all tabs in current window), 'create' (opens new tab; pass url to open at a URL), 'close', 'switch' (brings tab to foreground), 'reload', 'active' (returns the currently active tab — call when you don't know your tabId), 'info' (full info for a specific tabId), 'pin' (toggle pin via `on`), 'mute' (toggle mute via `on`), 'duplicate', 'move' (to `index` and optionally `window_id`), 'zoom' (set `zoom_factor`, e.g. 1.5 for 150%). tabId required for close/switch/reload/info/pin/mute/duplicate/move/zoom.",
  argsSchema: TabsArgs,
  run: async (args, ctx) => {
    if (args.action === 'list') return list_open_tabs.run({} as never, ctx);
    if (args.action === 'create') {
      return open_new_tab.run({ url: args.url, active: true } as never, ctx);
    }
    if (args.action === 'active') {
      const tab = await getAssignedTab(ctx);
      if (!tab) return { ok: false, reason: 'No active tab' };
      return {
        ok: true,
        id: tab.id,
        window_id: tab.windowId,
        index: tab.index,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        pinned: tab.pinned,
        muted: tab.mutedInfo?.muted ?? false,
        status: tab.status,
      };
    }
    const id = args.tabId ? Number.parseInt(args.tabId, 10) : NaN;
    if (!Number.isFinite(id))
      return { ok: false, reason: `tabId required for action='${args.action}'` };
    if (args.action === 'close') return close_tab.run({ tab_id: id } as never, ctx);
    if (args.action === 'switch') return switch_to_tab.run({ tab_id: id } as never, ctx);
    if (args.action === 'reload') return reload_tab.run({ tab_id: id } as never, ctx);
    if (args.action === 'info') return get_tab_info.run({ tab_id: id } as never, ctx);
    if (args.action === 'pin')
      return pin_tab.run({ tab_id: id, pinned: args.on ?? true } as never, ctx);
    if (args.action === 'mute')
      return mute_tab.run({ tab_id: id, muted: args.on ?? true } as never, ctx);
    if (args.action === 'duplicate') return duplicate_tab.run({ tab_id: id } as never, ctx);
    if (args.action === 'move') {
      if (args.index == null) return { ok: false, reason: "'index' required for action='move'" };
      return move_tab.run(
        { tab_id: id, index: args.index, window_id: args.window_id } as never,
        ctx,
      );
    }
    if (args.action === 'zoom') {
      if (args.zoom_factor == null)
        return { ok: false, reason: "'zoom_factor' required for action='zoom'" };
      return set_tab_zoom.run({ tab_id: id, zoom_factor: args.zoom_factor } as never, ctx);
    }
    return { ok: false, reason: `Unknown tabs action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// downloads — list / confirm / cancel
// ────────────────────────────────────────────────────────────────────────────

const DownloadsArgs = z.object({
  action: z.enum(['list', 'confirm', 'cancel', 'download_url']),
  downloadId: z.string().optional(),
  url: z.string().optional(),
  filename: z.string().optional(),
});
type DownloadsArgs = z.infer<typeof DownloadsArgs>;

export const downloads: ToolHandler<DownloadsArgs, unknown> = {
  name: 'downloads',
  tier: 'action',
  tierFor: (args): ToolTier => (args.action === 'list' ? 'read' : 'action'),
  description:
    "Manage file downloads. Actions: 'list' (returns recent downloads with id/filename/url/state/bytes), 'cancel' (aborts a pending download), 'confirm' (no-op acknowledgment for canonical compatibility — Chrome auto-completes downloads), 'download_url' (extension-only extension: trigger a download from a URL; canonical doesn't yet have this but it's the most common workflow primitive). downloadId is required for confirm/cancel; url is required for download_url.",
  argsSchema: DownloadsArgs,
  run: async (args, ctx) => {
    if (args.action === 'list') return list_downloads.run({} as never, ctx);
    if (args.action === 'cancel') {
      const id = args.downloadId ? Number.parseInt(args.downloadId, 10) : NaN;
      if (!Number.isFinite(id))
        return { ok: false, reason: "downloadId required for action='cancel'" };
      return cancel_download.run({ download_id: id } as never, ctx);
    }
    if (args.action === 'confirm') {
      // Canonical surfaces this as a user-permission step. In our extension,
      // downloads complete on their own; we no-op and surface what the agent
      // already saw via 'list'.
      const id = args.downloadId ? Number.parseInt(args.downloadId, 10) : NaN;
      if (!Number.isFinite(id))
        return { ok: false, reason: "downloadId required for action='confirm'" };
      try {
        const [item] = await chrome.downloads.search({ id });
        return { ok: true, download: item ?? null };
      } catch (err) {
        return { ok: false, reason: (err as Error).message };
      }
    }
    if (args.action === 'download_url') {
      if (!args.url) return { ok: false, reason: "url required for action='download_url'" };
      return download_url.run({ url: args.url, filename: args.filename } as never, ctx);
    }
    return { ok: false, reason: `Unknown downloads action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// memory — session-scoped scratchpad (separate from chrome.storage)
// ────────────────────────────────────────────────────────────────────────────

const MemoryArgs = z.object({
  action: z.enum(['set', 'get', 'list', 'delete']),
  key: z.string().optional(),
  value: z.string().optional(),
});
type MemoryArgs = z.infer<typeof MemoryArgs>;

const SESSION_MEMORY = new Map<string, string>();
const MEMORY_VALUE_CAP = 8 * 1024;
const MEMORY_KEY_CAP = 100;

export const memory: ToolHandler<MemoryArgs, unknown> = {
  name: 'memory',
  tier: 'read',
  description:
    "Session-scoped scratchpad for stashing structured notes across turns without burning context tokens. Actions: 'set' (write a value to a key), 'get' (read by key), 'list' (all keys), 'delete' (remove a key). Values are stringified — stringify objects before passing. Caps: 8 KB per value, 100 keys per session. Cleared at session end (SW restart).",
  argsSchema: MemoryArgs,
  run: async (args) => {
    if (args.action === 'list') {
      return { ok: true, keys: Array.from(SESSION_MEMORY.keys()), count: SESSION_MEMORY.size };
    }
    if (!args.key) return { ok: false, reason: "key required for action='" + args.action + "'" };
    if (args.action === 'get') {
      const v = SESSION_MEMORY.get(args.key);
      return { ok: true, key: args.key, value: v ?? null, found: v !== undefined };
    }
    if (args.action === 'delete') {
      const had = SESSION_MEMORY.delete(args.key);
      return { ok: true, key: args.key, deleted: had };
    }
    if (args.action === 'set') {
      if (args.value == null) return { ok: false, reason: "value required for action='set'" };
      if (args.value.length > MEMORY_VALUE_CAP) {
        return { ok: false, reason: `value exceeds ${MEMORY_VALUE_CAP} bytes; trim before storing` };
      }
      if (!SESSION_MEMORY.has(args.key) && SESSION_MEMORY.size >= MEMORY_KEY_CAP) {
        return { ok: false, reason: `memory at ${MEMORY_KEY_CAP}-key cap; delete a key first` };
      }
      SESSION_MEMORY.set(args.key, args.value);
      return { ok: true, key: args.key, size: args.value.length };
    }
    return { ok: false, reason: `Unknown memory action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// clipboard — read / write
// ────────────────────────────────────────────────────────────────────────────

const ClipboardArgs = z.object({
  action: z.enum(['read', 'write']),
  text: z.string().optional(),
});
type ClipboardArgs = z.infer<typeof ClipboardArgs>;

export const clipboard: ToolHandler<ClipboardArgs, unknown> = {
  name: 'clipboard',
  tier: 'action',
  tierFor: (args): ToolTier => (args.action === 'read' ? 'read' : 'action'),
  description:
    "Read from or write to the system clipboard. Actions: 'read' (returns current clipboard text), 'write' (sets clipboard text — pass `text`). Useful for 'copy this for the user' and 'paste what I just copied' workflows.",
  argsSchema: ClipboardArgs,
  run: async (args, ctx) => {
    if (args.action === 'write') {
      if (args.text == null) return { ok: false, reason: "text required for action='write'" };
      return set_clipboard.run({ text: args.text } as never, ctx);
    }
    // Read: try navigator.clipboard inside the agent's assigned tab. The
    // clipboard API requires a Document context, so we run it via
    // executeScript.
    const tab = await getAssignedTab(ctx);
    if (!tab?.id) return { ok: false, reason: 'No active tab to read clipboard from' };
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        try {
          const text = await navigator.clipboard.readText();
          return { ok: true, text } as const;
        } catch (err) {
          return { ok: false, reason: (err as Error).message } as const;
        }
      },
    });
    return r?.result ?? { ok: false, reason: 'clipboard read failed' };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// wait_for — canonical condition-based wait (replaces the old shape)
// ────────────────────────────────────────────────────────────────────────────

const WaitForArgs = z
  .object({
    tabId: z.string(),
    condition: z.enum(['element', 'text', 'url', 'network_idle']),
    target: z.string().optional(),
    scroll: z.boolean().default(false),
    timeout_ms: z.number().int().positive().default(10000),
  })
  .refine(
    (a) => a.condition === 'network_idle' || (a.target != null && a.target.length > 0),
    { message: 'target is required for condition=element|text|url' },
  );
type WaitForArgs = z.infer<typeof WaitForArgs>;

export const wait_for: ToolHandler<WaitForArgs, unknown> = {
  name: 'wait_for',
  tier: 'read',
  description:
    "Poll until a condition is met or timeout. Use after navigation or actions that trigger async loads — far more reliable than fixed sleeps. Conditions: 'element' (ref or selector exists and is visible; pass scroll=true to scroll the page while polling — handles infinite scroll), 'text' (text appears anywhere on page), 'url' (tab URL matches substring or regex), 'network_idle' (no in-flight requests for ~500ms).",
  argsSchema: WaitForArgs,
  run: async (args, ctx) => {
    const act = await activateTab(args.tabId);
    if (!act.ok) return { ok: false, reason: act.reason };
    if (args.condition === 'element') {
      const isRef = args.target!.startsWith('ref:');
      const selector = isRef
        ? `[data-matrx-ref="${args.target!.slice(4)}"]`
        : args.target!;
      return waitForElement(act.id, selector, args.timeout_ms, args.scroll);
    }
    if (args.condition === 'text') {
      return waitForText(act.id, args.target!, args.timeout_ms);
    }
    if (args.condition === 'url') {
      return waitForUrl(act.id, args.target!, args.timeout_ms);
    }
    if (args.condition === 'network_idle') {
      return legacy_wait_for.run(
        { ready_state: 'complete', timeout_ms: args.timeout_ms } as never,
        ctx,
      );
    }
    return { ok: false, reason: `Unknown condition: ${args.condition as string}` };
  },
};

async function waitForElement(tabId: number, selector: string, timeoutMs: number, scroll: boolean) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (sel: string, timeout: number, autoScroll: boolean) => {
      const start = Date.now();
      const isVisible = (el: Element): boolean => {
        const rect = (el as HTMLElement).getBoundingClientRect?.();
        if (!rect) return false;
        if (rect.width === 0 || rect.height === 0) return false;
        const cs = window.getComputedStyle(el as HTMLElement);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
      };
      while (Date.now() - start < timeout) {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) {
          return { ok: true, elapsed_ms: Date.now() - start } as const;
        }
        if (autoScroll) window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 200));
      }
      return { ok: false, reason: 'timeout', elapsed_ms: Date.now() - start } as const;
    },
    args: [selector, timeoutMs, scroll],
  });
  return r?.result ?? { ok: false, reason: 'no result' };
}

async function waitForText(tabId: number, text: string, timeoutMs: number) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (q: string, timeout: number) => {
      const start = Date.now();
      const lower = q.toLowerCase();
      while (Date.now() - start < timeout) {
        if ((document.body?.innerText ?? '').toLowerCase().includes(lower)) {
          return { ok: true, elapsed_ms: Date.now() - start } as const;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return { ok: false, reason: 'timeout', elapsed_ms: Date.now() - start } as const;
    },
    args: [text, timeoutMs],
  });
  return r?.result ?? { ok: false, reason: 'no result' };
}

async function waitForUrl(tabId: number, pattern: string, timeoutMs: number) {
  let regex: RegExp | null = null;
  try {
    regex = new RegExp(pattern);
  } catch {
    regex = null;
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url ?? '';
      if (regex ? regex.test(url) : url.includes(pattern)) {
        return { ok: true, url, elapsed_ms: Date.now() - start };
      }
    } catch {
      /* tab gone */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: false, reason: 'timeout', elapsed_ms: Date.now() - start };
}

// ────────────────────────────────────────────────────────────────────────────
// upload_file — canonical file_id → bytes → set_input_files
// ────────────────────────────────────────────────────────────────────────────

const UploadFileArgs = z.object({
  tabId: z.string(),
  ref: z.string(),
  file_ids: z.array(z.string().min(1)).min(1),
});
type UploadFileArgs = z.infer<typeof UploadFileArgs>;

export const upload_file: ToolHandler<UploadFileArgs, unknown> = {
  name: 'upload_file',
  tier: 'action',
  description:
    "Upload one or more files to a <input type='file'> element by reference. Pass file_ids — these are MediaRef IDs (e.g. from a previous /files/upload, or from computer.action=screenshot). The handler resolves each file_id to bytes and sets the input. Do NOT click file inputs — that opens a native picker the agent cannot see. For drag-and-drop targets, use drop_file instead.",
  argsSchema: UploadFileArgs,
  run: async (args) => {
    const act = await activateTab(args.tabId);
    if (!act.ok) return { ok: false, reason: act.reason };
    // Fetch bytes for each file_id from cld_files; we materialize them in
    // the SW, base64-encode, and pass into the page where DataTransfer
    // builds File objects. (Files cannot cross the SW/page boundary as
    // objects — only as serializable data.)
    const files: Array<{ filename: string; mime: string; base64: string }> = [];
    for (const id of args.file_ids) {
      try {
        const { blob, filename, mimeType } = await downloadFileBytes(id);
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
        }
        files.push({ filename, mime: mimeType, base64: btoa(bin) });
      } catch (err) {
        return { ok: false, reason: `failed to fetch file_id=${id}: ${(err as Error).message}` };
      }
    }
    const refSelector = `[data-matrx-ref="${args.ref.replace(/^ref:/, '')}"]`;
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: act.id },
      func: (sel: string, payload: typeof files) => {
        const input = document.querySelector(sel) as HTMLInputElement | null;
        if (!input || input.tagName !== 'INPUT' || input.type !== 'file') {
          return { ok: false, reason: 'Target is not an <input type="file">' };
        }
        const dt = new DataTransfer();
        for (const f of payload) {
          const bin = atob(f.base64);
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          dt.items.add(new File([buf], f.filename, { type: f.mime }));
        }
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, file_count: payload.length };
      },
      args: [refSelector, files],
    });
    return r?.result ?? { ok: false, reason: 'upload failed' };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// drop_file — synthesize DragEvent with a single file
// ────────────────────────────────────────────────────────────────────────────

const DropFileArgs = z
  .object({
    tabId: z.string(),
    file_id: z.string(),
    ref: z.string().optional(),
    coordinate: z.array(z.number()).length(2).optional(),
    filename: z.string().optional(),
  })
  .refine((a) => a.ref || a.coordinate, { message: 'ref or coordinate required' });
type DropFileArgs = z.infer<typeof DropFileArgs>;

export const drop_file: ToolHandler<DropFileArgs, unknown> = {
  name: 'drop_file',
  tier: 'action',
  description:
    "Synthesize a drag-and-drop of a single file onto a target element or coordinate. Use for drop zones that aren't backed by <input type='file'>. Provide ref OR coordinate. file_id is a MediaRef (e.g. from a prior screenshot or upload).",
  argsSchema: DropFileArgs,
  run: async (args) => {
    const act = await activateTab(args.tabId);
    if (!act.ok) return { ok: false, reason: act.reason };
    let blob: Blob;
    let resolvedFilename: string;
    let mime: string;
    try {
      const fetched = await downloadFileBytes(args.file_id);
      blob = fetched.blob;
      resolvedFilename = args.filename ?? fetched.filename;
      mime = fetched.mimeType;
    } catch (err) {
      return { ok: false, reason: `failed to fetch file_id=${args.file_id}: ${(err as Error).message}` };
    }
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    }
    const base64 = btoa(bin);
    const refSelector = args.ref ? `[data-matrx-ref="${args.ref.replace(/^ref:/, '')}"]` : null;
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: act.id },
      func: (
        sel: string | null,
        coord: [number, number] | null,
        b64: string,
        fn: string,
        m: string,
      ) => {
        let target: Element | null = null;
        if (sel) target = document.querySelector(sel);
        else if (coord) target = document.elementFromPoint(coord[0], coord[1]);
        if (!(target instanceof HTMLElement)) return { ok: false, reason: 'No drop target' };
        const binStr = atob(b64);
        const arr = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) arr[i] = binStr.charCodeAt(i);
        const file = new File([arr], fn, { type: m });
        const dt = new DataTransfer();
        dt.items.add(file);
        const rect = target.getBoundingClientRect();
        const cx = coord?.[0] ?? rect.left + rect.width / 2;
        const cy = coord?.[1] ?? rect.top + rect.height / 2;
        const init = {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: cx,
          clientY: cy,
        };
        target.dispatchEvent(new DragEvent('dragenter', init));
        target.dispatchEvent(new DragEvent('dragover', init));
        target.dispatchEvent(new DragEvent('drop', init));
        return { ok: true };
      },
      args: [refSelector, args.coordinate ? [args.coordinate[0]!, args.coordinate[1]!] : null, base64, resolvedFilename, mime],
    });
    return r?.result ?? { ok: false, reason: 'drop failed' };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// read_pdf — text extraction via server's /pdf/extract-text
// ────────────────────────────────────────────────────────────────────────────

const ReadPdfArgs = z
  .object({
    tabId: z.string().optional(),
    file_id: z.string().optional(),
    page_start: z.number().int().positive().optional(),
    page_end: z.number().int().positive().optional(),
    max_chars: z.number().int().positive().default(50_000),
  })
  .refine((a) => a.tabId || a.file_id, { message: 'tabId or file_id is required' });
type ReadPdfArgs = z.infer<typeof ReadPdfArgs>;

export const read_pdf: ToolHandler<ReadPdfArgs, unknown> = {
  name: 'read_pdf',
  tier: 'read',
  description:
    "Extract text and structure from a PDF — either one loaded in a browser tab, or one already in cld_files (pass file_id). Returns text by page with optional page range. Use file_id when you have a MediaRef in hand (e.g. from a prior download); use tabId when the PDF is open in the browser.",
  argsSchema: ReadPdfArgs,
  run: async (args) => {
    let fileId = args.file_id;
    // If only tabId was given, capture the PDF bytes from the tab's URL and
    // upload to cld_files first so the server's /pdf/extract-text endpoint
    // can take its preferred MediaRef shape.
    if (!fileId && args.tabId) {
      const id = Number.parseInt(args.tabId, 10);
      if (!Number.isFinite(id)) return { ok: false, reason: 'Invalid tabId' };
      try {
        const tab = await chrome.tabs.get(id);
        const pdfUrl = tab.url ?? '';
        if (!/\.pdf(\?|$)/i.test(pdfUrl)) {
          return { ok: false, reason: 'Tab URL does not look like a PDF; pass file_id instead.' };
        }
        const res = await fetch(pdfUrl, { credentials: 'include' });
        if (!res.ok) return { ok: false, reason: `Failed to fetch PDF: ${res.status}` };
        const blob = await res.blob();
        const filename = pdfUrl.split('/').pop()?.split('?')[0] ?? `tab-${id}.pdf`;
        const upload = await uploadFile(blob, filename, {
          path: `browser-agent/pdfs/${filename}`,
        });
        fileId = upload.file_id;
      } catch (err) {
        return { ok: false, reason: `Failed to ingest tab PDF: ${(err as Error).message}` };
      }
    }
    if (!fileId) return { ok: false, reason: 'Could not resolve PDF source' };
    const r = await extractPdfText({
      fileId,
      pageStart: args.page_start,
      pageEnd: args.page_end,
    });
    if (!r.ok) return { ok: false, reason: r.error };
    let text = r.data.text ?? '';
    let truncated = false;
    if (text.length > args.max_chars) {
      text = text.slice(0, args.max_chars);
      truncated = true;
    }
    return {
      ok: true,
      file_id: fileId,
      page_count: r.data.page_count ?? null,
      text,
      truncated,
      pages: r.data.pages ?? null,
    };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Bundle export
// ────────────────────────────────────────────────────────────────────────────

export const canonical_handlers = [
  computer,
  form_input,
  navigate,
  tabs,
  downloads,
  memory,
  clipboard,
  wait_for,
  upload_file,
  drop_file,
  read_pdf,
];
