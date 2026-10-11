/**
 * Tier: PRIVILEGED — always confirm, even in "Act without asking" mode.
 *
 *   inject_stylesheet   — inject CSS into the page (no script execution).
 *   desktop_run_command — run a command on this computer's desktop app:
 *                        a Matrx 2 operation (`fs.list`) when Matrx 2 is
 *                        connected for the same account, otherwise a
 *                        matrx-local bridge command.
 */

import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const InjectStylesheetArgs = z.object({
  css: z.string().min(1),
  tab_id: z.number().int().optional(),
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
    // Matrx 2 first: when it is connected to this browser for the same account, a command that
    // names one of its operations (`fs.list`, `sysinfo.get`, …) runs there.
    const { getMatrx2Client } = await import('@/lib/desktop/matrx2/connection');
    const { OPS } = await import('@ai-matrx/desktop-protocol');
    const matrx2 = getMatrx2Client();
    if (matrx2 && Object.hasOwn(OPS, args.command)) {
      const spec = OPS[args.command as keyof typeof OPS];
      if (spec.kind !== 'unary') {
        return {
          ok: false,
          reason: `${args.command} streams; run it from Matrx 2 or an agent instead`,
        };
      }
      try {
        const data = await matrx2.request(args.command as never, (args.args ?? {}) as never);
        return { ok: true, data, via: 'matrx2' };
      } catch (err) {
        return { ok: false, reason: `Matrx 2: ${(err as Error).message}`, via: 'matrx2' };
      }
    }
    const { desktopRpc, getDesktopState } = await import('@/lib/desktop/bridge');
    const state = getDesktopState();
    if (state.transport === 'none') {
      return {
        ok: false,
        reason: matrx2
          ? `Matrx 2 has no operation named ${args.command}, and Matrx Local is not running`
          : 'No desktop app is connected: open Matrx 2 (or Matrx Local) on this computer',
      };
    }
    return desktopRpc({ command: args.command, args: args.args });
  },
};

export const privileged_handlers = [inject_stylesheet, remove_stylesheet, desktop_run_command];

export const privileged_read_handlers: ToolHandler<never, unknown>[] = [];
