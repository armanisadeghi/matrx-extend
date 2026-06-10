/**
 * Tier: PRIVILEGED — always confirm, even in "Act without asking" mode.
 *
 *   execute_javascript  — run arbitrary JS in the active tab's main world.
 *   inject_stylesheet   — inject CSS into the page (no script execution).
 *   set_extension_storage — write to our own chrome.storage.local namespace
 *                          (lets agents persist agent-state between runs).
 *   desktop_run_command — invoke the matrx-local desktop bridge with an
 *                        arbitrary command. Capabilities depend on what
 *                        matrx-local exposes; only available when the bridge
 *                        is connected.
 */

import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const ExecuteJsArgs = z.object({
  /**
   * JavaScript expression OR statement body. The function is invoked with
   * `arg` bound; return a value (sync or via Promise) and it's serialized
   * back. Throwing surfaces as an error result.
   */
  code: z.string().min(1),
  /** Optional argument passed in as `arg`. Must be JSON-serializable. */
  arg: z.unknown().optional(),
  /** Run in MAIN world (page's JS context) instead of ISOLATED. Default false. */
  main_world: z.boolean().optional().default(false),
  /** Tab to execute against; defaults to the active tab. */
  tab_id: z.number().int().optional(),
});
type ExecuteJsArgs = z.infer<typeof ExecuteJsArgs>;

export const execute_javascript: ToolHandler<ExecuteJsArgs, unknown> = {
  name: 'execute_javascript',
  tier: 'privileged',
  argsSchema: ExecuteJsArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId },
        world: args.main_world ? 'MAIN' : 'ISOLATED',
        func: async (code: string, arg: unknown) => {
          // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
          const fn = new Function('arg', `return (async () => { ${code} })();`) as (
            arg: unknown,
          ) => Promise<unknown>;
          try {
            const out = await fn(arg);
            return { ok: true, result: out };
          } catch (err) {
            return { ok: false, error: (err as Error).message };
          }
        },
        args: [args.code, args.arg ?? null],
      });
      const raw = first?.result ?? { ok: false, reason: 'no result' };
      // Cap + provenance-tag the value flowing back into the conversation
      // (audit P2-6). A MAIN-world script reads attacker-controlled page
      // state; un-capped, a hostile page could pump megabytes of
      // prompt-injection text straight into the model's context through
      // this one tool. 256KB is far beyond any legitimate scripted result.
      const MAX_RESULT_CHARS = 256_000;
      try {
        const serialized = JSON.stringify(raw);
        if (serialized && serialized.length > MAX_RESULT_CHARS) {
          return {
            ok: true,
            truncated: true,
            full_chars: serialized.length,
            note: 'result truncated at 256KB — page-origin data is untrusted; re-run with a narrower script if more is needed',
            result: serialized.slice(0, MAX_RESULT_CHARS),
          };
        }
      } catch {
        /* unserializable result — let it pass through; postResult handles it */
      }
      return raw;
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const InjectStylesheetArgs = z.object({
  css: z.string().min(1),
  tab_id: z.number().int().optional(),
  /**
   * Persist the stylesheet across navigations on this tab. Default false.
   * (When true, also returns an `id` you can pass to `remove_stylesheet`.)
   */
  persist: z.boolean().optional().default(false),
});
type InjectStylesheetArgs = z.infer<typeof InjectStylesheetArgs>;

export const inject_stylesheet: ToolHandler<InjectStylesheetArgs, unknown> = {
  name: 'inject_stylesheet',
  tier: 'privileged',
  argsSchema: InjectStylesheetArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        css: args.css,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const RemoveStylesheetArgs = z.object({
  css: z.string().min(1),
  tab_id: z.number().int().optional(),
});
type RemoveStylesheetArgs = z.infer<typeof RemoveStylesheetArgs>;

export const remove_stylesheet: ToolHandler<RemoveStylesheetArgs, unknown> = {
  name: 'remove_stylesheet',
  tier: 'privileged',
  argsSchema: RemoveStylesheetArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    try {
      await chrome.scripting.removeCSS({
        target: { tabId },
        css: args.css,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const SetExtensionStorageArgs = z.object({
  /** Free-form key under the agent-storage namespace. */
  key: z.string().min(1),
  /** Any JSON-serializable value. */
  value: z.unknown(),
  /** 'session' (cleared on browser restart) or 'local' (persists). Default 'local'. */
  area: z.enum(['local', 'session']).optional().default('local'),
});
type SetExtensionStorageArgs = z.infer<typeof SetExtensionStorageArgs>;

const AGENT_NS = 'matrx.agent_storage.';

export const set_extension_storage: ToolHandler<SetExtensionStorageArgs, unknown> = {
  name: 'set_extension_storage',
  tier: 'privileged',
  argsSchema: SetExtensionStorageArgs,
  run: async (args) => {
    const area = args.area === 'session' ? chrome.storage.session : chrome.storage.local;
    if (!area) return { ok: false, reason: `${args.area} storage unavailable` };
    await area.set({ [`${AGENT_NS}${args.key}`]: args.value });
    return { ok: true };
  },
};

const GetExtensionStorageArgs = z.object({
  key: z.string().min(1),
  area: z.enum(['local', 'session']).optional().default('local'),
});
type GetExtensionStorageArgs = z.infer<typeof GetExtensionStorageArgs>;

export const get_extension_storage: ToolHandler<GetExtensionStorageArgs, unknown> = {
  name: 'get_extension_storage',
  tier: 'read',
  argsSchema: GetExtensionStorageArgs,
  run: async (args) => {
    const area = args.area === 'session' ? chrome.storage.session : chrome.storage.local;
    if (!area) return { ok: false, reason: `${args.area} storage unavailable` };
    const fullKey = `${AGENT_NS}${args.key}`;
    const got = await area.get([fullKey]);
    return { ok: true, exists: fullKey in got, value: got[fullKey] ?? null };
  },
};

const ListExtensionStorageArgs = z
  .object({
    area: z.enum(['local', 'session']).optional().default('local'),
    /** Optional prefix filter (under the agent namespace). */
    prefix: z.string().optional(),
  })
  .default({});
type ListExtensionStorageArgs = z.infer<typeof ListExtensionStorageArgs>;

export const list_extension_storage: ToolHandler<ListExtensionStorageArgs, unknown> = {
  name: 'list_extension_storage',
  tier: 'read',
  argsSchema: ListExtensionStorageArgs,
  run: async (args) => {
    const area = args.area === 'session' ? chrome.storage.session : chrome.storage.local;
    if (!area) return { ok: false, reason: `${args.area} storage unavailable` };
    const all = await area.get(null);
    const out: Record<string, unknown> = {};
    const prefix = `${AGENT_NS}${args.prefix ?? ''}`;
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith(prefix)) out[k.slice(AGENT_NS.length)] = v;
    }
    return { count: Object.keys(out).length, items: out };
  },
};

const DeleteExtensionStorageArgs = z.object({
  key: z.string().min(1),
  area: z.enum(['local', 'session']).optional().default('local'),
});
type DeleteExtensionStorageArgs = z.infer<typeof DeleteExtensionStorageArgs>;

export const delete_extension_storage: ToolHandler<DeleteExtensionStorageArgs, unknown> = {
  name: 'delete_extension_storage',
  tier: 'privileged',
  argsSchema: DeleteExtensionStorageArgs,
  run: async (args) => {
    const area = args.area === 'session' ? chrome.storage.session : chrome.storage.local;
    if (!area) return { ok: false, reason: `${args.area} storage unavailable` };
    const fullKey = `${AGENT_NS}${args.key}`;
    const got = await area.get([fullKey]);
    const existed = fullKey in got;
    await area.remove(fullKey);
    return { ok: true, deleted: existed };
  },
};

const DesktopCommandArgs = z.object({
  command: z.string().min(1),
  args: z.record(z.unknown()).optional(),
});
type DesktopCommandArgs = z.infer<typeof DesktopCommandArgs>;

export const desktop_run_command: ToolHandler<DesktopCommandArgs, unknown> = {
  name: 'desktop_run_command',
  tier: 'privileged',
  // Safari: native messaging is XPC-based and the host must be bundled inside
  // the wrapping macOS app (Safari Web Extension Handler). The Safari Native
  // XPC Bridge follow-up project (Appendix A of the Safari port plan) lifts
  // this restriction by routing through SafariWebExtensionHandler. Until then,
  // Safari users see this tool absent rather than failing with a confusing
  // "matrx-local is not running" error. Firefox uses Chrome's stdio shape so
  // the same connectNative path works there.
  supportedBrowsers: ['chrome', 'firefox'],
  argsSchema: DesktopCommandArgs,
  run: async (args) => {
    const { desktopRpc, getDesktopState } = await import('@/lib/desktop/bridge');
    const state = getDesktopState();
    if (state.transport === 'none') {
      return { ok: false, reason: 'desktop bridge unavailable — matrx-local is not running' };
    }
    return desktopRpc({ command: args.command, args: args.args });
  },
};

export const privileged_handlers = [
  execute_javascript,
  inject_stylesheet,
  remove_stylesheet,
  set_extension_storage,
  delete_extension_storage,
  desktop_run_command,
];

export const privileged_read_handlers = [get_extension_storage, list_extension_storage];
