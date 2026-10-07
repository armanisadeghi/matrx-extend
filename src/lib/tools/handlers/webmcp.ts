/**
 * WebMCP — `document.modelContext` imperative API integration.
 *
 * Two-way:
 *   1. The PAGE side can register tools via `document.modelContext.registerTool`.
 *      We expose tools to enumerate them and invoke them on the agent's behalf.
 *   2. The EXTENSION side can register matrx-extend's tools via the same API
 *      so OTHER agents (in the page or other extensions) can call them.
 *      That's a separate file (`src/lib/webmcp/register.ts`).
 *
 * Feature-detected — these tools report `unavailable` when the browser or
 * document does not expose the imperative API.
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
  argsSchema: NoArgs,
  run: async (_args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async () => {
          const mc = (
            document as Document & {
              modelContext?: { getTools?: () => Promise<unknown[]> };
            }
          ).modelContext;
          if (typeof mc?.getTools !== 'function') return { available: false, tool_count: 0 };
          const tools = await mc.getTools();
          return { available: true, tool_count: tools.length };
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
  argsSchema: NoArgs,
  run: async (_args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async () => {
          const mc = (
            document as Document & {
              modelContext?: {
                getTools?: () => Promise<
                  Array<{
                    name: string;
                    description?: string;
                    inputSchema?: unknown;
                  }>
                >;
              };
            }
          ).modelContext;
          if (typeof mc?.getTools !== 'function')
            return { ok: false, reason: 'WebMCP unavailable' };
          const list = await mc.getTools();
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
  argsSchema: CallPageToolArgs,
  run: async (args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (toolName: string, toolArgs: unknown) => {
          const mc = (
            document as Document & {
              modelContext?: {
                getTools?: () => Promise<Array<{ name: string }>>;
                executeTool?: (tool: { name: string }, input: object) => Promise<unknown>;
              };
            }
          ).modelContext;
          if (typeof mc?.getTools !== 'function' || typeof mc.executeTool !== 'function')
            return { ok: false, reason: 'WebMCP unavailable' };
          if (toolArgs !== null && (typeof toolArgs !== 'object' || Array.isArray(toolArgs)))
            return { ok: false, reason: 'WebMCP arguments must be an object' };
          const tools = await mc.getTools();
          const tool = tools.find((candidate) => candidate.name === toolName);
          if (!tool) {
            return { ok: false, reason: `tool "${toolName}" not found on page` };
          }
          try {
            const out = await mc.executeTool(tool, toolArgs ?? {});
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
