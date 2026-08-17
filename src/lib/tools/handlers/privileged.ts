/**
 * Tier: PRIVILEGED — always confirm, even in "Act without asking" mode.
 *
 *   inject_stylesheet   — inject CSS into the page (no script execution).
 *   desktop_run_command — invoke the matrx-local desktop bridge with an
 *                        arbitrary command. Capabilities depend on what
 *                        matrx-local exposes; only available when the bridge
 *                        is connected.
 */

import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

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

export const privileged_handlers = [inject_stylesheet, remove_stylesheet, desktop_run_command];

export const privileged_read_handlers: ToolHandler<never, unknown>[] = [];
