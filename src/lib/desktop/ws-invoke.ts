/**
 * WS reverse-channel consumer — services engine→extension tool invocations.
 *
 * matrx-local pushes `{ type: "extension.invoke", callId, toolName, args }`
 * frames over /extension/ws (see matrx-local
 * docs/MATRX_EXTEND_CONNECTION.md). This module subscribes to inbound WS
 * frames and:
 *
 *   1. `extension.invoke` → routes through the same `handleWebmcpCall`
 *      permission-gated executor used by WebMCP and FRONTEND_RPC callers
 *      (initiator `'desktop'` — action-tier tools always confirm with the
 *      user; privileged/ask-user tiers are rejected), then wires
 *      `{ type: "extension.result", callId, ok, result|error }` back to the
 *      engine so its callId-keyed Future resolves.
 *
 *   2. `ws.catalog-stale` → the offscreen document saw a
 *      `tool_catalog_hash` mismatch on a pong; refetch `capabilities` over
 *      HTTP RPC and stash it under `matrx.desktop.lastCapabilities`.
 *
 * Extracted from `background/bootstrap.ts` so the protocol logic is unit
 * testable: the collaborators are injectable via `WsInvokeDeps`; production
 * callers use the zero-arg defaults.
 */

import { log } from '@/lib/debug/log';
import { desktopRpc } from '@/lib/desktop/bridge';
import type { DesktopRpcRequest, DesktopRpcResponse } from '@/lib/desktop/types';
import { onWsMessage, sendWs } from '@/lib/desktop/ws-client';
import { readDefaultPermissionMode } from '@/lib/settings/persisted';
import { handleWebmcpCall } from '@/lib/tools/dispatch';

// ─── Injectable collaborators (production defaults below) ───────────────────

export interface WsInvokeCallResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface WsInvokeDeps {
  /** Permission-gated tool executor (production: `handleWebmcpCall`). */
  callTool: (
    payload: { callId: string; toolName: string; args: unknown },
    opts: { permissionMode: 'ask' | 'act'; initiator: 'desktop' },
  ) => Promise<WsInvokeCallResult>;
  /** Send a frame back to the engine over the WS (production: `sendWs`). */
  sendFrame: (payload: unknown) => Promise<void>;
  /** User's default permission mode (production: `readDefaultPermissionMode`). */
  readPermissionMode: () => Promise<'ask' | 'act'>;
  /** HTTP RPC to the engine (production: `desktopRpc`). */
  rpc: (req: DesktopRpcRequest) => Promise<DesktopRpcResponse>;
  /** Persist the refetched capabilities payload (production: chrome.storage.local). */
  storeCapabilities: (data: unknown) => Promise<void>;
}

function productionDeps(): WsInvokeDeps {
  return {
    callTool: (payload, opts) => handleWebmcpCall(payload, opts),
    sendFrame: (payload) => sendWs(payload),
    readPermissionMode: async () => {
      const mode = await readDefaultPermissionMode();
      return mode === 'act' ? 'act' : 'ask';
    },
    rpc: (req) => desktopRpc(req),
    storeCapabilities: async (data) => {
      await chrome.storage.local.set({
        'matrx.desktop.lastCapabilities': { data, fetchedAt: Date.now() },
      });
    },
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Subscribe the reverse-invoke consumer to inbound WS frames. Called once
 * from the background bootstrap. Idempotence is the caller's concern
 * (bootstrap runs once per SW life).
 */
export function registerWsReverseInvocationHandler(deps: WsInvokeDeps = productionDeps()): void {
  onWsMessage((payload) => {
    void handleWsInboundFrame(payload, deps);
  });
}

/**
 * Route one inbound WS frame. Exported for tests; production traffic
 * arrives via `registerWsReverseInvocationHandler`. Unknown frame types
 * (hello / pong / telemetry) require no SW action and are ignored.
 */
export async function handleWsInboundFrame(
  payload: unknown,
  deps: WsInvokeDeps = productionDeps(),
): Promise<void> {
  if (!payload || typeof payload !== 'object') return;
  const p = payload as Record<string, unknown>;
  const type = typeof p.type === 'string' ? p.type : undefined;

  if (type === 'extension.invoke') {
    await handleExtensionInvoke(p, deps);
    return;
  }
  if (type === 'ws.catalog-stale') {
    await handleCatalogStale(deps);
    return;
  }
  // hello / pong / other server frames are observed via this hook for
  // telemetry but require no SW action.
}

/**
 * Service one engine-pushed tool invocation and wire the result back.
 * Never throws — the engine's Future must resolve or time out cleanly; our
 * failures travel as `extension.result ok:false`.
 */
export async function handleExtensionInvoke(
  p: Record<string, unknown>,
  deps: WsInvokeDeps = productionDeps(),
): Promise<void> {
  const callId = typeof p.callId === 'string' ? p.callId : '';
  const toolName = typeof p.toolName === 'string' ? p.toolName : '';
  const args = p.args;
  if (!callId || !toolName) {
    log.warn('sw', 'ws extension.invoke missing callId/toolName', p);
    return;
  }

  let result: WsInvokeCallResult;
  try {
    const permissionMode = await deps.readPermissionMode();
    result = await deps.callTool(
      { callId, toolName, args },
      { permissionMode, initiator: 'desktop' },
    );
  } catch (err) {
    // handleWebmcpCall encodes failures as {ok:false}; a throw here means a
    // wiring-level crash. Still answer the engine so its Future resolves.
    result = { ok: false, error: `extension executor crashed: ${(err as Error).message}` };
    log.error('sw', `ws extension.invoke executor threw for ${toolName}`, err);
  }

  const wireFrame = result.ok
    ? { type: 'extension.result', callId, ok: true, result: result.result }
    : {
        type: 'extension.result',
        callId,
        ok: false,
        error: result.error ?? 'tool failed',
      };
  try {
    await deps.sendFrame(wireFrame);
  } catch (err) {
    log.warn('sw', `ws extension.result send failed for ${callId}`, (err as Error).message);
  }
}

/**
 * The engine's tool catalog changed (hash mismatch on a pong) — refetch
 * `capabilities` over HTTP RPC and stash the freshest catalog.
 */
export async function handleCatalogStale(deps: WsInvokeDeps = productionDeps()): Promise<void> {
  log.info('sw', 'ws catalog-stale → refetching capabilities');
  try {
    const r = await deps.rpc({ command: 'capabilities' });
    if (!r.ok) {
      log.warn('sw', 'capabilities refetch failed', r.error);
      return;
    }
    await deps.storeCapabilities(r.data);
    log.success('sw', 'capabilities refetched and stashed');
  } catch (err) {
    log.warn('sw', 'capabilities refetch threw', (err as Error).message);
  }
}
