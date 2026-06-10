/**
 * Register matrx-extend's tools with `navigator.modelContext` on the active
 * tab so other agents (in the page itself, in other extensions, or in the
 * browser's own AI surfaces) can discover and call them.
 *
 * Two-way handshake:
 *   1. We call this from a content script or via chrome.scripting MAIN-world
 *      injection. The script registers each tool's name + description +
 *      input schema with `navigator.modelContext.registerTool`.
 *   2. When the page invokes a registered tool, the run-stub posts
 *      `{ __matrx_webmcp_call: true, callId, toolName, args }` to the
 *      window. The `webmcp-bridge` content script (see
 *      `src/entrypoints/webmcp-bridge.content.ts`) listens for these,
 *      forwards them to the SW via `chrome.runtime.sendMessage`, and
 *      replies with `{ __matrx_webmcp_result: true, callId, ok, result,
 *      error }` keyed by the same `callId`.
 *
 * Feature-gated: WebMCP shipped in Chrome 146 (Feb 2026). On older Chromes,
 * `registerToolsOnActiveTab` returns `{ ok: false, reason: 'WebMCP unavailable' }`.
 *
 * The race condition fix: each `run()` invocation generates a fresh
 * `callId` (via `crypto.randomUUID`) and the response listener keys on
 * `data.callId === ourCallId`. Multiple in-flight calls of the same tool
 * therefore can't crosstalk.
 */

import { ensureToolDescriptions } from '@/lib/tools/descriptions';
import { listAllHandlers } from '@/lib/tools/registry';
import { zodToJsonSchema } from 'zod-to-json-schema';

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: unknown;
}

export async function buildRegistrablePilotTools(
  opts: { isAdmin?: boolean } = {},
): Promise<ToolSpec[]> {
  // Descriptions live ONLY in the DB (Rule 4) — read them live. WebMCP's
  // registerTool requires a description string, so fall back to the tool name
  // when the live lookup is unavailable.
  const descs = await ensureToolDescriptions();
  return listAllHandlers()
    .filter((h) => h.tier === 'read' || h.tier === 'action')
    .filter((h) => (opts.isAdmin ? true : !h.admin_only))
    .map((h) => ({
      name: h.name,
      description: descs.get(h.name) ?? h.name,
      inputSchema: zodToJsonSchema(h.argsSchema, {
        $refStrategy: 'none',
        target: 'jsonSchema7',
      }),
    }));
}

/**
 * Inject WebMCP registrations into a tab. Only operates when the page
 * exposes `navigator.modelContext.registerTool`. Returns the count of
 * tools registered.
 *
 * Pass `tabId` to target a specific tab (e.g. from a `chrome.tabs.onUpdated`
 * gate). Without it, falls back to the active tab in the focused window
 * (useful for manual / debug invocations).
 *
 * The page → SW round-trip is handled by the `webmcp-bridge` content
 * script (`src/entrypoints/webmcp-bridge.content.ts`), which listens for
 * `__matrx_webmcp_call` events posted by the run-stub installed below
 * and dispatches them through `WEBMCP_CALL` to the SW handler.
 */
export async function registerToolsOnActiveTab(
  opts: {
    isAdmin?: boolean;
    tabId?: number;
  } = {},
): Promise<{ ok: boolean; count?: number; reason?: string }> {
  let tabId = opts.tabId;
  if (typeof tabId !== 'number') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { ok: false, reason: 'No active tab' };
    tabId = tab.id;
  }

  const tools = await buildRegistrablePilotTools({ isAdmin: opts.isAdmin });

  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (specs: ToolSpec[]) => {
        const mc = (
          navigator as unknown as {
            modelContext?: {
              registerTool?: (def: {
                name: string;
                description: string;
                inputSchema: unknown;
                run: (args: unknown) => Promise<unknown>;
              }) => void;
            };
          }
        ).modelContext;
        if (!mc?.registerTool) return { ok: false, reason: 'WebMCP unavailable' };
        let registered = 0;
        for (const t of specs) {
          try {
            mc.registerTool({
              name: `matrx.${t.name}`,
              description: t.description,
              inputSchema: t.inputSchema,
              run: (args: unknown) =>
                new Promise((resolve, reject) => {
                  // Per-call ID isolates concurrent invocations of the
                  // same tool. The bridge content script echoes it back
                  // verbatim in the response.
                  const callId =
                    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                      ? crypto.randomUUID()
                      : `webmcp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

                  // biome-ignore lint/style/useConst: assigned after the handler closure that reads it
                  let timer: number | undefined;
                  const handler = (event: MessageEvent) => {
                    if (event.source !== window) return;
                    const data = event.data as
                      | {
                          __matrx_webmcp_result?: true;
                          callId?: string;
                          ok?: boolean;
                          result?: unknown;
                          error?: string;
                        }
                      | undefined;
                    if (!data || data.__matrx_webmcp_result !== true || data.callId !== callId) {
                      return;
                    }
                    window.removeEventListener('message', handler);
                    if (timer !== undefined) clearTimeout(timer);
                    if (data.ok && !data.error) {
                      resolve(data.result);
                    } else {
                      reject(new Error(data.error ?? 'matrx tool error'));
                    }
                  };
                  window.addEventListener('message', handler);
                  window.postMessage(
                    {
                      __matrx_webmcp_call: true,
                      callId,
                      toolName: t.name,
                      args,
                    },
                    window.location.origin,
                  );
                  timer = window.setTimeout(() => {
                    window.removeEventListener('message', handler);
                    reject(new Error('matrx tool timeout'));
                  }, 60_000);
                }),
            });
            registered++;
          } catch (err) {
            console.warn(`[matrx webmcp] register ${t.name} failed`, err);
          }
        }
        return { ok: true, count: registered };
      },
      args: [tools],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
