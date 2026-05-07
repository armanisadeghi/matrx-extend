/**
 * WebMCP — `navigator.modelContext.registerTool` integration.
 *
 * Two-way:
 *   1. The PAGE side can register tools via `navigator.modelContext.registerTool`.
 *      We expose tools to enumerate them and invoke them on the agent's behalf.
 *   2. The EXTENSION side can register matrx-extend's tools via the same API
 *      so OTHER agents (in the page or other extensions) can call them.
 *      That's a separate file (`src/lib/webmcp/register.ts`).
 *
 * WebMCP shipped in Chrome 146 (Feb 2026). Feature-detected — these tools
 * report `unavailable` on older Chromes.
 *
 * Admin-only initially while the API stabilizes.
 */

import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const NoArgs = z.object({}).default({});
type NoArgs = z.infer<typeof NoArgs>;

export const webmcp_check_availability: ToolHandler<NoArgs, unknown> = {
  name: 'webmcp_check_availability',
  tier: 'read',
  admin_only: true,
  description:
    'Check whether WebMCP (`navigator.modelContext.registerTool`) is available in the user\'s Chrome and whether the active tab has registered any tools. Use this once before calling webmcp_list_page_tools / webmcp_call_page_tool.',
  argsSchema: NoArgs,
  run: async (_args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          const mc = (navigator as unknown as { modelContext?: { tools?: unknown[] } })
            .modelContext;
          return {
            available: !!mc,
            tool_count: Array.isArray(mc?.tools) ? mc.tools.length : 0,
          };
        },
      });
      return first?.result ?? { available: false, tool_count: 0 };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

export const webmcp_list_page_tools: ToolHandler<NoArgs, unknown> = {
  name: 'webmcp_list_page_tools',
  tier: 'read',
  admin_only: true,
  description:
    'List tools the active tab has registered via `navigator.modelContext.registerTool`. Each entry includes { name, description, inputSchema }. Use these to discover what the page offers before calling webmcp_call_page_tool.',
  argsSchema: NoArgs,
  run: async (_args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          const mc = (navigator as unknown as {
            modelContext?: {
              tools?: Array<{
                name: string;
                description?: string;
                inputSchema?: unknown;
              }>;
              getTools?: () => Array<{
                name: string;
                description?: string;
                inputSchema?: unknown;
              }>;
            };
          }).modelContext;
          if (!mc) return { ok: false, reason: 'WebMCP unavailable' };
          const list = typeof mc.getTools === 'function' ? mc.getTools() : (mc.tools ?? []);
          return {
            ok: true,
            count: list.length,
            tools: list.map((t) => ({
              name: t.name,
              description: t.description ?? null,
              input_schema: t.inputSchema ?? null,
            })),
          };
        },
      });
      return first?.result ?? { ok: false, reason: 'no result' };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const CallPageToolArgs = z.object({
  name: z.string().min(1),
  arguments: z.unknown().optional(),
});
type CallPageToolArgs = z.infer<typeof CallPageToolArgs>;

export const webmcp_call_page_tool: ToolHandler<CallPageToolArgs, unknown> = {
  name: 'webmcp_call_page_tool',
  tier: 'action',
  admin_only: true,
  description:
    'Invoke a tool registered by the active page via `navigator.modelContext`. Pass the tool name and an arguments object (must match the page\'s declared input schema). Returns the page tool\'s result.',
  argsSchema: CallPageToolArgs,
  run: async (args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (toolName: string, toolArgs: unknown) => {
          const mc = (navigator as unknown as {
            modelContext?: {
              callTool?: (name: string, args?: unknown) => Promise<unknown>;
              tools?: Array<{
                name: string;
                run?: (args?: unknown) => Promise<unknown>;
              }>;
            };
          }).modelContext;
          if (!mc) return { ok: false, reason: 'WebMCP unavailable' };
          // Spec landed under callTool; older builds expose .tools[i].run.
          if (typeof mc.callTool === 'function') {
            try {
              const out = await mc.callTool(toolName, toolArgs);
              return { ok: true, result: out };
            } catch (err) {
              return { ok: false, reason: (err as Error).message };
            }
          }
          const t = (mc.tools ?? []).find((x) => x.name === toolName);
          if (!t || typeof t.run !== 'function') {
            return { ok: false, reason: `tool "${toolName}" not found on page` };
          }
          try {
            const out = await t.run(toolArgs);
            return { ok: true, result: out };
          } catch (err) {
            return { ok: false, reason: (err as Error).message };
          }
        },
        args: [args.name, args.arguments ?? null],
      });
      return first?.result ?? { ok: false, reason: 'no result' };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

export const webmcp_handlers = [
  webmcp_check_availability,
  webmcp_list_page_tools,
  webmcp_call_page_tool,
];
