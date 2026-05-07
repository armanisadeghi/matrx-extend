/**
 * Browser tab + tab-group orchestration tools.
 *
 * Read tier: list_open_tabs, get_tab_groups, get_tab_info — informational, no
 *   prompts.
 * Action tier: open_new_tab, close_tab, switch_to_tab, duplicate_tab,
 *   pin_tab, mute_tab, reload_tab, go_back, go_forward, set_tab_zoom,
 *   create_tab_group, add_tabs_to_group, remove_tab_from_group,
 *   move_tab.
 *
 * The agent uses these to drive multi-tab research: open N reference pages,
 * group them, jump between them, and clean up when finished. The Pilot
 * surface is the heaviest user; the Assistant surface only ships the read-
 * tier subset.
 */

import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const NoArgs = z.object({}).default({});
type NoArgs = z.infer<typeof NoArgs>;

const ListTabsArgs = z
  .object({
    /** When true, return tabs in every window. Otherwise current window only. */
    all_windows: z.boolean().optional().default(true),
    /** Limit URL match (substring or "https://example.com/*"). */
    url: z.string().optional(),
    /** When true, only return tabs that are currently audible. */
    audible: z.boolean().optional(),
    /** When true, only return tabs that have completed loading. */
    loaded_only: z.boolean().optional(),
  })
  .default({});
type ListTabsArgs = z.infer<typeof ListTabsArgs>;

export const list_open_tabs: ToolHandler<ListTabsArgs, unknown> = {
  name: 'list_open_tabs',
  tier: 'read',
  description:
    'List all open browser tabs. Returns id, url, title, windowId, groupId, active flag, status. Use this to discover what the user is working with before deciding which tab to act on.',
  argsSchema: ListTabsArgs,
  run: async (args) => {
    const query: chrome.tabs.QueryInfo = {};
    if (!args.all_windows) query.currentWindow = true;
    if (args.url) query.url = args.url;
    if (args.audible !== undefined) query.audible = args.audible;
    if (args.loaded_only) query.status = 'complete';
    const tabs = await chrome.tabs.query(query);
    return {
      count: tabs.length,
      tabs: tabs.map((t) => ({
        id: t.id,
        window_id: t.windowId,
        group_id: t.groupId,
        index: t.index,
        url: t.url,
        title: t.title,
        active: t.active,
        pinned: t.pinned,
        status: t.status,
        // The agent is text-only; data: URI favicons (~600 chars each) are
        // pure noise and bloat the response massively on tab-heavy users.
        // Keep http(s) favicons since they're short and occasionally useful.
        favicon_url: t.favIconUrl?.startsWith('data:') ? null : t.favIconUrl,
        muted: t.mutedInfo?.muted ?? false,
        audible: t.audible ?? false,
        incognito: t.incognito,
      })),
    };
  },
};

export const get_tab_groups: ToolHandler<NoArgs, unknown> = {
  name: 'get_tab_groups',
  tier: 'read',
  supportedBrowsers: ['chrome'],
  description:
    'List every tab group across windows: id, title, color, collapsed flag, and the tab ids inside. Use after list_open_tabs to understand how the user has organized their work.',
  argsSchema: NoArgs,
  run: async () => {
    if (!chrome.tabGroups) return { ok: false, reason: 'tabGroups API unavailable' };
    const [groups, allTabs] = await Promise.all([
      chrome.tabGroups.query({}),
      chrome.tabs.query({}),
    ]);
    const tabsByGroup = new Map<number, chrome.tabs.Tab[]>();
    for (const t of allTabs) {
      if (typeof t.groupId === 'number' && t.groupId >= 0) {
        const arr = tabsByGroup.get(t.groupId) ?? [];
        arr.push(t);
        tabsByGroup.set(t.groupId, arr);
      }
    }
    return {
      count: groups.length,
      groups: groups.map((g) => ({
        id: g.id,
        title: g.title,
        color: g.color,
        collapsed: g.collapsed,
        window_id: g.windowId,
        tab_ids: (tabsByGroup.get(g.id) ?? []).map((t) => t.id),
      })),
    };
  },
};

const GetTabInfoArgs = z.object({ tab_id: z.number().int() });
type GetTabInfoArgs = z.infer<typeof GetTabInfoArgs>;

export const get_tab_info: ToolHandler<GetTabInfoArgs, unknown> = {
  name: 'get_tab_info',
  tier: 'read',
  description:
    'Get full information about a specific tab by id. Same fields as list_open_tabs but for a single tab. Returns { ok:false, reason } if the tab is gone.',
  argsSchema: GetTabInfoArgs,
  run: async (args) => {
    try {
      const t = await chrome.tabs.get(args.tab_id);
      return {
        id: t.id,
        window_id: t.windowId,
        group_id: t.groupId,
        index: t.index,
        url: t.url,
        title: t.title,
        active: t.active,
        pinned: t.pinned,
        status: t.status,
        favicon_url: t.favIconUrl?.startsWith('data:') ? null : t.favIconUrl,
        muted: t.mutedInfo?.muted ?? false,
        audible: t.audible ?? false,
        incognito: t.incognito,
      };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const OpenNewTabArgs = z.object({
  url: z.string().url(),
  /** Open in the foreground (focus the new tab). Default true. */
  active: z.boolean().optional().default(true),
  /** Pin the new tab. */
  pinned: z.boolean().optional().default(false),
  /** Open in a specific window; default = current window. */
  window_id: z.number().int().optional(),
  /** Place the tab at this index inside the window. */
  index: z.number().int().min(0).optional(),
});
type OpenNewTabArgs = z.infer<typeof OpenNewTabArgs>;

export const open_new_tab: ToolHandler<OpenNewTabArgs, unknown> = {
  name: 'open_new_tab',
  tier: 'action',
  description:
    'Open a new tab pointing at a URL. Returns the new tab id, window id, and final URL once load begins. Use active=false to background-load reference pages.',
  argsSchema: OpenNewTabArgs,
  run: async (args) => {
    const tab = await chrome.tabs.create({
      url: args.url,
      active: args.active,
      pinned: args.pinned,
      windowId: args.window_id,
      index: args.index,
    });
    return { tab_id: tab.id, window_id: tab.windowId, url: tab.url };
  },
};

const CloseTabArgs = z.object({
  tab_ids: z.union([z.number().int(), z.array(z.number().int()).min(1)]),
});
type CloseTabArgs = z.infer<typeof CloseTabArgs>;

export const close_tab: ToolHandler<CloseTabArgs, unknown> = {
  name: 'close_tab',
  tier: 'action',
  description:
    'Close one or more tabs by id. Pass a single id or an array. Cleaning up reference tabs at the end of a research run is a common use.',
  argsSchema: CloseTabArgs,
  run: async (args) => {
    const ids = Array.isArray(args.tab_ids) ? args.tab_ids : [args.tab_ids];
    await chrome.tabs.remove(ids);
    return { ok: true, closed: ids.length };
  },
};

const SwitchToTabArgs = z.object({ tab_id: z.number().int() });
type SwitchToTabArgs = z.infer<typeof SwitchToTabArgs>;

export const switch_to_tab: ToolHandler<SwitchToTabArgs, unknown> = {
  name: 'switch_to_tab',
  tier: 'action',
  description:
    'Activate (focus) a specific tab and bring its window forward. Use this before per-tab actions that operate on the active tab (click, type, etc).',
  argsSchema: SwitchToTabArgs,
  run: async (args) => {
    const t = await chrome.tabs.update(args.tab_id, { active: true });
    if (t?.windowId !== undefined) {
      await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    }
    return { ok: true, url: t?.url, title: t?.title };
  },
};

const DuplicateTabArgs = z.object({ tab_id: z.number().int() });
type DuplicateTabArgs = z.infer<typeof DuplicateTabArgs>;

export const duplicate_tab: ToolHandler<DuplicateTabArgs, unknown> = {
  name: 'duplicate_tab',
  tier: 'action',
  description:
    'Duplicate an existing tab. Returns the new tab id. Useful for branching experiments without losing the original page.',
  argsSchema: DuplicateTabArgs,
  run: async (args) => {
    const t = await chrome.tabs.duplicate(args.tab_id);
    return { tab_id: t?.id, window_id: t?.windowId, url: t?.url };
  },
};

const PinTabArgs = z.object({
  tab_id: z.number().int(),
  pinned: z.boolean(),
});
type PinTabArgs = z.infer<typeof PinTabArgs>;

export const pin_tab: ToolHandler<PinTabArgs, unknown> = {
  name: 'pin_tab',
  tier: 'action',
  description: 'Pin or unpin a tab. Pinned tabs are smaller and live at the front of the strip.',
  argsSchema: PinTabArgs,
  run: async (args) => {
    await chrome.tabs.update(args.tab_id, { pinned: args.pinned });
    return { ok: true };
  },
};

const MuteTabArgs = z.object({
  tab_id: z.number().int(),
  muted: z.boolean(),
});
type MuteTabArgs = z.infer<typeof MuteTabArgs>;

export const mute_tab: ToolHandler<MuteTabArgs, unknown> = {
  name: 'mute_tab',
  tier: 'action',
  description: 'Mute or unmute a tab.',
  argsSchema: MuteTabArgs,
  run: async (args) => {
    await chrome.tabs.update(args.tab_id, { muted: args.muted });
    return { ok: true };
  },
};

const ReloadTabArgs = z
  .object({
    tab_id: z.number().int().optional(),
    /** Reload bypassing the disk cache (hard refresh). */
    bypass_cache: z.boolean().optional().default(false),
  })
  .default({});
type ReloadTabArgs = z.infer<typeof ReloadTabArgs>;

export const reload_tab: ToolHandler<ReloadTabArgs, unknown> = {
  name: 'reload_tab',
  tier: 'action',
  description: 'Reload a tab (default: the active tab). Pass bypass_cache=true for a hard refresh.',
  argsSchema: ReloadTabArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    await chrome.tabs.reload(tabId, { bypassCache: args.bypass_cache });
    return { ok: true, tab_id: tabId };
  },
};

const NavigateBackForwardArgs = z
  .object({
    tab_id: z.number().int().optional(),
  })
  .default({});
type NavigateBackForwardArgs = z.infer<typeof NavigateBackForwardArgs>;

export const go_back: ToolHandler<NavigateBackForwardArgs, unknown> = {
  name: 'go_back',
  tier: 'action',
  description: 'Navigate the active tab (or specified tab) one entry back in its session history.',
  argsSchema: NavigateBackForwardArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    await chrome.tabs.goBack(tabId);
    return { ok: true };
  },
};

export const go_forward: ToolHandler<NavigateBackForwardArgs, unknown> = {
  name: 'go_forward',
  tier: 'action',
  description:
    'Navigate the active tab (or specified tab) one entry forward in its session history.',
  argsSchema: NavigateBackForwardArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    await chrome.tabs.goForward(tabId);
    return { ok: true };
  },
};

const SetZoomArgs = z.object({
  tab_id: z.number().int().optional(),
  /** Zoom factor — 1.0 = 100%, 1.25 = 125%, etc. */
  zoom_factor: z.number().min(0.25).max(5),
});
type SetZoomArgs = z.infer<typeof SetZoomArgs>;

export const set_tab_zoom: ToolHandler<SetZoomArgs, unknown> = {
  name: 'set_tab_zoom',
  tier: 'action',
  description: 'Set the zoom level on a tab. 1.0 = 100%, 1.5 = 150%, 0.75 = 75%.',
  argsSchema: SetZoomArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    await chrome.tabs.setZoom(tabId, args.zoom_factor);
    return { ok: true, zoom_factor: args.zoom_factor };
  },
};

const MoveTabArgs = z.object({
  tab_id: z.number().int(),
  /** Where to drop it inside the destination window. -1 = end. */
  index: z.number().int().min(-1),
  /** Optional destination window. Defaults to the tab's current window. */
  window_id: z.number().int().optional(),
});
type MoveTabArgs = z.infer<typeof MoveTabArgs>;

export const move_tab: ToolHandler<MoveTabArgs, unknown> = {
  name: 'move_tab',
  tier: 'action',
  description: 'Reorder a tab (and optionally move it to another window).',
  argsSchema: MoveTabArgs,
  run: async (args) => {
    const t = await chrome.tabs.move(args.tab_id, {
      index: args.index,
      windowId: args.window_id,
    });
    const moved = Array.isArray(t) ? t[0] : t;
    return { ok: true, index: moved?.index, window_id: moved?.windowId };
  },
};

const CreateGroupArgs = z.object({
  tab_ids: z.array(z.number().int()).min(1),
  /** Display title for the group. */
  title: z.string().optional(),
  /** Group color. */
  color: z
    .enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
    .optional(),
  /** Window in which to create the group. */
  window_id: z.number().int().optional(),
  /** Start collapsed. */
  collapsed: z.boolean().optional(),
});
type CreateGroupArgs = z.infer<typeof CreateGroupArgs>;

export const create_tab_group: ToolHandler<CreateGroupArgs, unknown> = {
  name: 'create_tab_group',
  tier: 'action',
  supportedBrowsers: ['chrome'],
  description:
    "Group a set of tabs together. Returns the new group id. Use this to keep an agent run's sandboxed tabs visually separate from the user's other work.",
  argsSchema: CreateGroupArgs,
  run: async (args) => {
    const groupId = await chrome.tabs.group({
      tabIds: args.tab_ids,
      createProperties: args.window_id ? { windowId: args.window_id } : undefined,
    });
    if (chrome.tabGroups && (args.title || args.color || args.collapsed !== undefined)) {
      await chrome.tabGroups.update(groupId, {
        title: args.title,
        color: args.color,
        collapsed: args.collapsed,
      });
    }
    return { ok: true, group_id: groupId };
  },
};

const AddToGroupArgs = z.object({
  group_id: z.number().int(),
  tab_ids: z.array(z.number().int()).min(1),
});
type AddToGroupArgs = z.infer<typeof AddToGroupArgs>;

export const add_tabs_to_group: ToolHandler<AddToGroupArgs, unknown> = {
  name: 'add_tabs_to_group',
  tier: 'action',
  supportedBrowsers: ['chrome'],
  description: 'Add tabs to an existing tab group.',
  argsSchema: AddToGroupArgs,
  run: async (args) => {
    await chrome.tabs.group({ tabIds: args.tab_ids, groupId: args.group_id });
    return { ok: true };
  },
};

const RemoveFromGroupArgs = z.object({
  tab_ids: z.array(z.number().int()).min(1),
});
type RemoveFromGroupArgs = z.infer<typeof RemoveFromGroupArgs>;

export const remove_tabs_from_group: ToolHandler<RemoveFromGroupArgs, unknown> = {
  name: 'remove_tabs_from_group',
  tier: 'action',
  supportedBrowsers: ['chrome'],
  description: 'Detach tabs from whatever group they currently belong to.',
  argsSchema: RemoveFromGroupArgs,
  run: async (args) => {
    await chrome.tabs.ungroup(args.tab_ids);
    return { ok: true };
  },
};

const UpdateGroupArgs = z.object({
  group_id: z.number().int(),
  title: z.string().optional(),
  color: z
    .enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
    .optional(),
  collapsed: z.boolean().optional(),
});
type UpdateGroupArgs = z.infer<typeof UpdateGroupArgs>;

export const update_tab_group: ToolHandler<UpdateGroupArgs, unknown> = {
  name: 'update_tab_group',
  tier: 'action',
  supportedBrowsers: ['chrome'],
  description: 'Rename, recolor, or collapse/expand a tab group.',
  argsSchema: UpdateGroupArgs,
  run: async (args) => {
    if (!chrome.tabGroups) return { ok: false, reason: 'tabGroups API unavailable' };
    await chrome.tabGroups.update(args.group_id, {
      title: args.title,
      color: args.color,
      collapsed: args.collapsed,
    });
    return { ok: true };
  },
};

const ResizeWindowArgs = z.object({
  tab_id: z.number().int().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
type ResizeWindowArgs = z.infer<typeof ResizeWindowArgs>;

export const resize_window: ToolHandler<ResizeWindowArgs, unknown> = {
  name: 'resize_window',
  tier: 'action',
  description:
    "Resize the browser window containing a tab. Useful for responsive testing. If tab_id is omitted, resizes the active tab's window. Note: this changes the OS window size, which in turn changes the viewport.",
  argsSchema: ResizeWindowArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const t = await chrome.tabs.get(tabId);
    if (t.windowId == null) return { ok: false, reason: 'No window for tab' };
    const win = await chrome.windows.update(t.windowId, {
      width: args.width,
      height: args.height,
    });
    return { ok: true, window_id: win.id, width: win.width, height: win.height };
  },
};

export const tab_read_handlers = [list_open_tabs, get_tab_groups, get_tab_info];

export const tab_action_handlers = [
  open_new_tab,
  close_tab,
  switch_to_tab,
  duplicate_tab,
  pin_tab,
  mute_tab,
  reload_tab,
  go_back,
  go_forward,
  set_tab_zoom,
  move_tab,
  resize_window,
  create_tab_group,
  add_tabs_to_group,
  remove_tabs_from_group,
  update_tab_group,
];
