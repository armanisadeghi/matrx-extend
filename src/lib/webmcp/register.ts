/**
 * Register matrx-extend's tools with `navigator.modelContext` on the active
 * tab so other agents (in the page itself, in other extensions, or in the
 * browser's own AI surfaces) can discover and call them.
 *
 * Two-way handshake:
 *   1. We call this from a content script or via chrome.scripting MAIN-world
 *      injection. The script registers each tool's name + description +
 *      input schema with `navigator.modelContext.registerTool`.
 *   2. When something calls one of our registered tools, the page-side stub
 *      sends `{ __matrx_webmcp_call: true, name, args }` over postMessage.
 *      A listener installed on the same tab forwards to the SW dispatcher
 *      and returns the response.
 *
 * Feature-gated: WebMCP shipped in Chrome 146 (Feb 2026). On older Chromes,
 * `register()` is a no-op.
 *
 * STATUS: scaffold. The dispatcher integration (item 2) is left for the
 * Pilot tab milestone — the registration half is what's interesting now,
 * since it lets our tools show up in the Chrome built-in AI tool picker
 * and similar surfaces where being "available" matters even before any
 * external agent calls us.
 */

import { listAllHandlers } from '@/lib/tools/registry';
import { zodToJsonSchema } from 'zod-to-json-schema';

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: unknown;
}

export function buildRegistrablePilotTools(opts: { isAdmin?: boolean } = {}): ToolSpec[] {
  return listAllHandlers()
    .filter((h) => h.tier === 'read' || h.tier === 'action')
    .filter((h) => (opts.isAdmin ? true : !h.admin_only))
    .map((h) => ({
      name: h.name,
      description: h.description,
      inputSchema: zodToJsonSchema(h.argsSchema, {
        $refStrategy: 'none',
        target: 'jsonSchema7',
      }),
    }));
}

/**
 * Inject WebMCP registrations into the active tab. Only operates when the
 * page exposes `navigator.modelContext.registerTool`. Returns the count of
 * tools registered.
 *
 * NOTE: this only registers the SHAPE — when the page actually invokes one
 * of our tools, we still need a postMessage listener on the page side that
 * forwards into the SW. Wire that during the Pilot tab milestone.
 */
export async function registerToolsOnActiveTab(opts: {
  isAdmin?: boolean;
} = {}): Promise<{ ok: boolean; count?: number; reason?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, reason: 'No active tab' };

  const tools = buildRegistrablePilotTools({ isAdmin: opts.isAdmin });

  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (specs: ToolSpec[]) => {
        const mc = (navigator as unknown as {
          modelContext?: {
            registerTool?: (def: {
              name: string;
              description: string;
              inputSchema: unknown;
              run: (args: unknown) => Promise<unknown>;
            }) => void;
          };
        }).modelContext;
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
                  // Page-side stub forwards the call back to the extension.
                  const handler = (event: MessageEvent) => {
                    const data = event.data as
                      | { __matrx_webmcp_response?: true; toolName?: string; result?: unknown; error?: string }
                      | undefined;
                    if (
                      data?.__matrx_webmcp_response &&
                      data.toolName === t.name
                    ) {
                      window.removeEventListener('message', handler);
                      if (data.error) reject(new Error(data.error));
                      else resolve(data.result);
                    }
                  };
                  window.addEventListener('message', handler);
                  window.postMessage(
                    { __matrx_webmcp_call: true, toolName: t.name, args },
                    '*',
                  );
                  setTimeout(() => {
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
