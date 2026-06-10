/**
 * Canonical tool routers — implements the unified tool shape from
 * `browser_tools_canonical.json` (computer / form_input / navigate / tabs /
 * downloads / scratchpad / clipboard) on top of the extension's existing
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

import { downloadFileBytes, uploadFile } from '@/lib/api/routes/files';
import { extractPdfText } from '@/lib/api/routes/pdf';
import { log } from '@/lib/debug/log';
import { getAssignedTab } from '@/lib/tools/handlers/_active-tab';
import {
  click_element,
  wait_for as legacy_wait_for,
  navigate_active_tab,
  scroll_page,
  set_clipboard,
  type_into_element,
} from '@/lib/tools/handlers/action';
import { list_downloads } from '@/lib/tools/handlers/browser-data';
import { cancel_download, download_url } from '@/lib/tools/handlers/downloads';
import { select_dropdown_option, set_checkbox, set_radio } from '@/lib/tools/handlers/forms';
import {
  blur_element,
  focus_element,
  hover_element,
  press_keys,
  right_click_element,
} from '@/lib/tools/handlers/keyboard';
import { take_screenshot } from '@/lib/tools/handlers/read';
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
import { delegate } from '@/lib/tools/types';
import { z } from 'zod';

/**
 * Activate a tab (so subsequent active-tab-implicit handlers target it).
 * Accepts canonical string tabId; coerces to chrome's int.
 */
async function activateTab(
  tabId: string,
): Promise<{ ok: true; id: number } | { ok: false; reason: string }> {
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
  tab_id: z.string(),
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
  argsSchema: ComputerArgs,
  run: async (args, ctx) => {
    const act = await activateTab(args.tab_id);
    if (!act.ok) return { ok: false, reason: act.reason };
    switch (args.action) {
      case 'left_click': {
        if (args.coordinate && !args.ref) {
          return clickAtCoord(act.id, args.coordinate[0]!, args.coordinate[1]!);
        }
        return delegate(click_element, { ref: args.ref, selector: undefined, nth: 0 }, ctx);
      }
      case 'right_click':
        return delegate(right_click_element, { ref: args.ref, selector: undefined }, ctx);
      case 'double_click':
        return clickWithDetail(act.id, args, 2);
      case 'triple_click':
        return clickWithDetail(act.id, args, 3);
      case 'type': {
        if (args.text == null) return { ok: false, reason: "'text' is required for action='type'" };
        if (args.ref) {
          return delegate(
            type_into_element,
            { ref: args.ref, text: args.text, clear: true, dispatch_events: true },
            ctx,
          );
        }
        // No ref → type into whatever currently has focus.
        return typeIntoFocused(act.id, args.text);
      }
      case 'key': {
        if (args.text == null) return { ok: false, reason: "'text' is required for action='key'" };
        // delegate() parses through PressKeysArgs, so .default() values
        // (delay_ms, etc.) apply — no more hand-mirroring leaf defaults.
        return delegate(press_keys, { keys: args.text }, ctx);
      }
      case 'scroll': {
        if (!args.scroll_direction)
          return { ok: false, reason: "'scroll_direction' is required for action='scroll'" };
        const delta = args.scroll_amount * 100; // ~1 wheel tick = 100px
        if (args.scroll_direction === 'up')
          return delegate(scroll_page, { direction: 'by', delta_y: -delta }, ctx);
        if (args.scroll_direction === 'down')
          return delegate(scroll_page, { direction: 'by', delta_y: delta }, ctx);
        // left/right: fall through to scripted axis scroll
        return scrollAxis(act.id, args.scroll_direction, delta);
      }
      case 'scroll_to':
        if (!args.ref) return { ok: false, reason: "'ref' is required for action='scroll_to'" };
        return delegate(scroll_page, { direction: 'into-view', ref: args.ref }, ctx);
      case 'hover':
        return delegate(hover_element, { ref: args.ref, selector: undefined }, ctx);
      case 'focus':
        return delegate(focus_element, { ref: args.ref, selector: undefined }, ctx);
      case 'blur':
        return delegate(blur_element, { ref: args.ref, selector: undefined }, ctx);
      case 'screenshot':
        return doScreenshot(args.tab_id, ctx);
      case 'left_click_drag':
        if (!args.start_coordinate || !args.coordinate) {
          return {
            ok: false,
            reason: "'start_coordinate' and 'coordinate' are required for left_click_drag",
          };
        }
        return dragFromTo(
          act.id,
          [args.start_coordinate[0]!, args.start_coordinate[1]!],
          [args.coordinate[0]!, args.coordinate[1]!],
        );
      default:
        return {
          ok: false,
          reason: `Unknown computer action: ${(args as { action: string }).action}`,
        };
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
      if (!(start instanceof HTMLElement))
        return { ok: false, reason: 'No element at start_coordinate' };
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
  const result = await delegate(
    take_screenshot,
    {
      profile: 'auto',
      format: undefined,
      quality: undefined,
      max_dimension: undefined,
      persist: true,
      capture_source: 'agent',
    },
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
      tab_id: tabIdStr,
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
      tab_id: tabIdStr,
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
  tab_id: z.string(),
  ref: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
type FormInputArgs = z.infer<typeof FormInputArgs>;

export const form_input: ToolHandler<FormInputArgs, unknown> = {
  name: 'form_input',
  tier: 'action',
  argsSchema: FormInputArgs,
  run: async (args, ctx) => {
    const act = await activateTab(args.tab_id);
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
      return delegate(
        select_dropdown_option,
        {
          ref: args.ref,
          value: typeof args.value === 'string' ? args.value : String(args.value),
        },
        ctx,
      );
    }
    if (kind === 'checkbox') {
      return delegate(set_checkbox, { ref: args.ref, checked: Boolean(args.value) }, ctx);
    }
    if (kind === 'radio') {
      return delegate(set_radio, { ref: args.ref, value: String(args.value) }, ctx);
    }
    if (kind === 'text') {
      return delegate(
        type_into_element,
        {
          ref: args.ref,
          text: typeof args.value === 'string' ? args.value : String(args.value),
          clear: true,
          dispatch_events: true,
        },
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
  tab_id: z.string(),
  url: z.string(),
  force: z.boolean().default(false),
});
type NavigateArgs = z.infer<typeof NavigateArgs>;

export const navigate: ToolHandler<NavigateArgs, unknown> = {
  name: 'navigate',
  tier: 'action',
  argsSchema: NavigateArgs,
  run: async (args, ctx) => {
    const act = await activateTab(args.tab_id);
    if (!act.ok) return { ok: false, reason: act.reason };
    if (args.url === 'back') return delegate(go_back, {}, ctx);
    if (args.url === 'forward') return delegate(go_forward, {}, ctx);
    let url = args.url;
    if (!/^[a-z]+:\/\//i.test(url) && !url.startsWith('//')) url = `https://${url}`;
    return delegate(navigate_active_tab, { url }, ctx);
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
  tab_id: z.string().optional(),
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
  argsSchema: TabsArgs,
  run: async (args, ctx) => {
    if (args.action === 'list') return delegate(list_open_tabs, {}, ctx);
    if (args.action === 'create') {
      return delegate(open_new_tab, { url: args.url, active: true }, ctx);
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
    const id = args.tab_id ? Number.parseInt(args.tab_id, 10) : Number.NaN;
    if (!Number.isFinite(id))
      return { ok: false, reason: `tab_id required for action='${args.action}'` };
    if (args.action === 'close') return delegate(close_tab, { tab_id: id }, ctx);
    if (args.action === 'switch') return delegate(switch_to_tab, { tab_id: id }, ctx);
    if (args.action === 'reload') return delegate(reload_tab, { tab_id: id }, ctx);
    if (args.action === 'info') return delegate(get_tab_info, { tab_id: id }, ctx);
    if (args.action === 'pin')
      return delegate(pin_tab, { tab_id: id, pinned: args.on ?? true }, ctx);
    if (args.action === 'mute')
      return delegate(mute_tab, { tab_id: id, muted: args.on ?? true }, ctx);
    if (args.action === 'duplicate') return delegate(duplicate_tab, { tab_id: id }, ctx);
    if (args.action === 'move') {
      if (args.index == null) return { ok: false, reason: "'index' required for action='move'" };
      return delegate(move_tab, { tab_id: id, index: args.index, window_id: args.window_id }, ctx);
    }
    if (args.action === 'zoom') {
      if (args.zoom_factor == null)
        return { ok: false, reason: "'zoom_factor' required for action='zoom'" };
      return delegate(set_tab_zoom, { tab_id: id, zoom_factor: args.zoom_factor }, ctx);
    }
    return { ok: false, reason: `Unknown tabs action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// downloads — list / confirm / cancel
// ────────────────────────────────────────────────────────────────────────────

const DownloadsArgs = z.object({
  action: z.enum(['list', 'confirm', 'cancel', 'download_url']),
  download_id: z.string().optional(),
  url: z.string().optional(),
  filename: z.string().optional(),
});
type DownloadsArgs = z.infer<typeof DownloadsArgs>;

export const downloads: ToolHandler<DownloadsArgs, unknown> = {
  name: 'downloads',
  tier: 'action',
  tierFor: (args): ToolTier => (args.action === 'list' ? 'read' : 'action'),
  argsSchema: DownloadsArgs,
  run: async (args, ctx) => {
    if (args.action === 'list') return delegate(list_downloads, {}, ctx);
    if (args.action === 'cancel') {
      const id = args.download_id ? Number.parseInt(args.download_id, 10) : Number.NaN;
      if (!Number.isFinite(id))
        return { ok: false, reason: "download_id required for action='cancel'" };
      return delegate(cancel_download, { download_id: id }, ctx);
    }
    if (args.action === 'confirm') {
      // Canonical surfaces this as a user-permission step. In our extension,
      // downloads complete on their own; we no-op and surface what the agent
      // already saw via 'list'.
      const id = args.download_id ? Number.parseInt(args.download_id, 10) : Number.NaN;
      if (!Number.isFinite(id))
        return { ok: false, reason: "download_id required for action='confirm'" };
      try {
        const [item] = await chrome.downloads.search({ id });
        return { ok: true, download: item ?? null };
      } catch (err) {
        return { ok: false, reason: (err as Error).message };
      }
    }
    if (args.action === 'download_url') {
      if (!args.url) return { ok: false, reason: "url required for action='download_url'" };
      return delegate(download_url, { url: args.url, filename: args.filename }, ctx);
    }
    return { ok: false, reason: `Unknown downloads action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// scratchpad — session-scoped, in-process kv (distinct from canonical `memory`)
// ────────────────────────────────────────────────────────────────────────────

const ScratchpadArgs = z.object({
  action: z.enum(['set', 'get', 'list', 'delete']),
  key: z.string().optional(),
  value: z.string().optional(),
});
type ScratchpadArgs = z.infer<typeof ScratchpadArgs>;

const SESSION_SCRATCHPAD = new Map<string, string>();
const SCRATCHPAD_VALUE_CAP = 8 * 1024;
const SCRATCHPAD_KEY_CAP = 100;

export const scratchpad: ToolHandler<ScratchpadArgs, unknown> = {
  name: 'scratchpad',
  tier: 'read',
  argsSchema: ScratchpadArgs,
  run: async (args) => {
    if (args.action === 'list') {
      return {
        ok: true,
        keys: Array.from(SESSION_SCRATCHPAD.keys()),
        count: SESSION_SCRATCHPAD.size,
      };
    }
    if (!args.key) return { ok: false, reason: "key required for action='" + args.action + "'" };
    if (args.action === 'get') {
      const v = SESSION_SCRATCHPAD.get(args.key);
      return { ok: true, key: args.key, value: v ?? null, found: v !== undefined };
    }
    if (args.action === 'delete') {
      const had = SESSION_SCRATCHPAD.delete(args.key);
      return { ok: true, key: args.key, deleted: had };
    }
    if (args.action === 'set') {
      if (args.value == null) return { ok: false, reason: "value required for action='set'" };
      if (args.value.length > SCRATCHPAD_VALUE_CAP) {
        return {
          ok: false,
          reason: `value exceeds ${SCRATCHPAD_VALUE_CAP} bytes; trim before storing`,
        };
      }
      if (!SESSION_SCRATCHPAD.has(args.key) && SESSION_SCRATCHPAD.size >= SCRATCHPAD_KEY_CAP) {
        return {
          ok: false,
          reason: `scratchpad at ${SCRATCHPAD_KEY_CAP}-key cap; delete a key first`,
        };
      }
      SESSION_SCRATCHPAD.set(args.key, args.value);
      return { ok: true, key: args.key, size: args.value.length };
    }
    return { ok: false, reason: `Unknown scratchpad action: ${args.action as string}` };
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
  argsSchema: ClipboardArgs,
  run: async (args, ctx) => {
    if (args.action === 'write') {
      if (args.text == null) return { ok: false, reason: "text required for action='write'" };
      return delegate(set_clipboard, { text: args.text }, ctx);
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
    tab_id: z.string(),
    condition: z.enum(['element', 'text', 'url', 'network_idle']),
    target: z.string().optional(),
    scroll: z.boolean().default(false),
    timeout_ms: z.number().int().positive().default(10000),
  })
  .refine((a) => a.condition === 'network_idle' || (a.target != null && a.target.length > 0), {
    message: 'target is required for condition=element|text|url',
  });
type WaitForArgs = z.infer<typeof WaitForArgs>;

export const wait_for: ToolHandler<WaitForArgs, unknown> = {
  name: 'wait_for',
  tier: 'read',
  argsSchema: WaitForArgs,
  run: async (args, ctx) => {
    const act = await activateTab(args.tab_id);
    if (!act.ok) return { ok: false, reason: act.reason };
    if (args.condition === 'element') {
      const isRef = args.target!.startsWith('ref:');
      const selector = isRef ? `[data-matrx-ref="${args.target!.slice(4)}"]` : args.target!;
      return waitForElement(act.id, selector, args.timeout_ms, args.scroll);
    }
    if (args.condition === 'text') {
      return waitForText(act.id, args.target!, args.timeout_ms);
    }
    if (args.condition === 'url') {
      return waitForUrl(act.id, args.target!, args.timeout_ms);
    }
    if (args.condition === 'network_idle') {
      return delegate(
        legacy_wait_for,
        { ready_state: 'complete', timeout_ms: args.timeout_ms },
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
  tab_id: z.string(),
  ref: z.string(),
  file_ids: z.array(z.string().min(1)).min(1),
});
type UploadFileArgs = z.infer<typeof UploadFileArgs>;

export const upload_file: ToolHandler<UploadFileArgs, unknown> = {
  name: 'upload_file',
  tier: 'action',
  argsSchema: UploadFileArgs,
  run: async (args) => {
    const act = await activateTab(args.tab_id);
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
    tab_id: z.string(),
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
  argsSchema: DropFileArgs,
  run: async (args) => {
    const act = await activateTab(args.tab_id);
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
      return {
        ok: false,
        reason: `failed to fetch file_id=${args.file_id}: ${(err as Error).message}`,
      };
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
      args: [
        refSelector,
        args.coordinate ? [args.coordinate[0]!, args.coordinate[1]!] : null,
        base64,
        resolvedFilename,
        mime,
      ],
    });
    return r?.result ?? { ok: false, reason: 'drop failed' };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// read_pdf — text extraction via server's /pdf/extract-text
// ────────────────────────────────────────────────────────────────────────────

const ReadPdfArgs = z
  .object({
    tab_id: z.string().optional(),
    file_id: z.string().optional(),
    page_start: z.number().int().positive().optional(),
    page_end: z.number().int().positive().optional(),
    max_chars: z.number().int().positive().default(50_000),
  })
  .refine((a) => a.tab_id || a.file_id, { message: 'tab_id or file_id is required' });
type ReadPdfArgs = z.infer<typeof ReadPdfArgs>;

export const read_pdf: ToolHandler<ReadPdfArgs, unknown> = {
  name: 'read_pdf',
  tier: 'read',
  argsSchema: ReadPdfArgs,
  run: async (args) => {
    let fileId = args.file_id;
    // If only tab_id was given, capture the PDF bytes from the tab's URL and
    // upload to cld_files first so the server's /pdf/extract-text endpoint
    // can take its preferred MediaRef shape.
    if (!fileId && args.tab_id) {
      const id = Number.parseInt(args.tab_id, 10);
      if (!Number.isFinite(id)) return { ok: false, reason: 'Invalid tab_id' };
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
  scratchpad,
  clipboard,
  wait_for,
  upload_file,
  drop_file,
  read_pdf,
];
