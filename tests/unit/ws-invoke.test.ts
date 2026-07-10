/**
 * Channel B reverse-invoke consumer (src/lib/desktop/ws-invoke.ts).
 *
 * Simulates the matrx-local engine pushing `extension.invoke` frames over
 * /extension/ws and asserts the extension services them through the
 * permission-gated executor and wires `extension.result` back with the
 * matching callId — the engine's Future-resolution contract.
 */

import {
  type WsInvokeCallResult,
  type WsInvokeDeps,
  handleCatalogStale,
  handleExtensionInvoke,
  handleWsInboundFrame,
} from '@/lib/desktop/ws-invoke';
import { describe, expect, it, vi } from 'vitest';

interface SentFrame {
  type: string;
  callId?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
}

function makeDeps(overrides: Partial<WsInvokeDeps> = {}): {
  deps: WsInvokeDeps;
  sent: SentFrame[];
  calls: Array<{ callId: string; toolName: string; args: unknown }>;
  stored: unknown[];
} {
  const sent: SentFrame[] = [];
  const calls: Array<{ callId: string; toolName: string; args: unknown }> = [];
  const stored: unknown[] = [];
  const deps: WsInvokeDeps = {
    callTool: async (payload): Promise<WsInvokeCallResult> => {
      calls.push(payload);
      return { ok: true, result: { echoed: payload.args } };
    },
    sendFrame: async (payload) => {
      sent.push(payload as SentFrame);
    },
    readPermissionMode: async () => 'ask',
    rpc: async () => ({ ok: true, data: { tools: [{ name: 'SystemInfo' }] } }),
    storeCapabilities: async (data) => {
      stored.push(data);
    },
    ...overrides,
  };
  return { deps, sent, calls, stored };
}

describe('ws-invoke: extension.invoke servicing', () => {
  it('routes an invoke through the executor and replies extension.result ok:true', async () => {
    const { deps, sent, calls } = makeDeps();
    await handleWsInboundFrame(
      { type: 'extension.invoke', callId: 'call-1', toolName: 'read_page', args: { mode: 'text' } },
      deps,
    );
    expect(calls).toEqual([{ callId: 'call-1', toolName: 'read_page', args: { mode: 'text' } }]);
    expect(sent).toEqual([
      {
        type: 'extension.result',
        callId: 'call-1',
        ok: true,
        result: { echoed: { mode: 'text' } },
      },
    ]);
  });

  it('passes the desktop initiator + user permission mode to the executor', async () => {
    const callTool = vi.fn(async (): Promise<WsInvokeCallResult> => ({ ok: true, result: null }));
    const { deps } = makeDeps({ callTool, readPermissionMode: async () => 'act' });
    await handleExtensionInvoke(
      { type: 'extension.invoke', callId: 'c', toolName: 't', args: {} },
      deps,
    );
    expect(callTool).toHaveBeenCalledWith(
      { callId: 'c', toolName: 't', args: {} },
      { permissionMode: 'act', initiator: 'desktop' },
    );
  });

  it('wires executor failures back as extension.result ok:false with the error', async () => {
    const { deps, sent } = makeDeps({
      callTool: async () => ({ ok: false, error: 'element not found' }),
    });
    await handleWsInboundFrame(
      { type: 'extension.invoke', callId: 'call-2', toolName: 'click_element', args: {} },
      deps,
    );
    expect(sent).toEqual([
      { type: 'extension.result', callId: 'call-2', ok: false, error: 'element not found' },
    ]);
  });

  it('still answers the engine when the executor THROWS (Future must resolve)', async () => {
    const { deps, sent } = makeDeps({
      callTool: async () => {
        throw new Error('boom');
      },
    });
    await handleExtensionInvoke({ callId: 'call-3', toolName: 'read_page', args: {} }, deps);
    expect(sent).toHaveLength(1);
    const frame = sent[0];
    expect(frame).toBeDefined();
    expect(frame).toMatchObject({ type: 'extension.result', callId: 'call-3', ok: false });
    expect(frame?.error).toContain('boom');
  });

  it('drops invokes missing callId or toolName without calling the executor', async () => {
    const { deps, sent, calls } = makeDeps();
    await handleExtensionInvoke({ type: 'extension.invoke', toolName: 'read_page' }, deps);
    await handleExtensionInvoke({ type: 'extension.invoke', callId: 'x' }, deps);
    expect(calls).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('ignores non-invoke frames (hello / pong / garbage) without side effects', async () => {
    const { deps, sent, calls } = makeDeps();
    await handleWsInboundFrame({ type: 'hello', session_id: 's' }, deps);
    await handleWsInboundFrame({ type: 'pong' }, deps);
    await handleWsInboundFrame('not-an-object', deps);
    await handleWsInboundFrame(null, deps);
    expect(calls).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('does not crash when the result frame send fails', async () => {
    const { deps } = makeDeps({
      sendFrame: async () => {
        throw new Error('socket closed');
      },
    });
    await expect(
      handleExtensionInvoke({ callId: 'c', toolName: 't', args: {} }, deps),
    ).resolves.toBeUndefined();
  });
});

describe('ws-invoke: catalog-stale refetch', () => {
  it('refetches capabilities over HTTP RPC and stashes the payload', async () => {
    const { deps, stored } = makeDeps();
    await handleWsInboundFrame({ type: 'ws.catalog-stale' }, deps);
    expect(stored).toEqual([{ tools: [{ name: 'SystemInfo' }] }]);
  });

  it('does not stash when the RPC fails', async () => {
    const { deps, stored } = makeDeps({
      rpc: async () => ({ ok: false, error: 'engine offline' }),
    });
    await handleCatalogStale(deps);
    expect(stored).toEqual([]);
  });
});
