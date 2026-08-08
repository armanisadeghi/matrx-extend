import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getSupabase: vi.fn(),
  handleFrontendRpc: vi.fn(),
  recordBridgeTraffic: vi.fn(),
}));

vi.mock('@/lib/auth/flow', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/debug/bridge-traffic', () => ({
  recordBridgeTraffic: mocks.recordBridgeTraffic,
}));
vi.mock('@/lib/debug/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));
vi.mock('@/lib/frontend-bridge/handler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/frontend-bridge/handler')>();
  return { ...actual, handleFrontendRpc: mocks.handleFrontendRpc };
});
vi.mock('@/lib/supabase/client', () => ({ getSupabase: mocks.getSupabase }));

interface Harness {
  channel: {
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
  };
  supabase: {
    channel: ReturnType<typeof vi.fn>;
    removeChannel: ReturnType<typeof vi.fn>;
  };
  receive: (payload: unknown) => void;
}

function makeHarness(): Harness {
  let receiver: ((message: unknown) => void) | undefined;
  const channel = {
    on: vi.fn((_type, _filter, callback) => {
      receiver = callback;
      return channel;
    }),
    subscribe: vi.fn((callback) => {
      callback('SUBSCRIBED');
      return channel;
    }),
    send: vi.fn(async () => 'ok'),
    unsubscribe: vi.fn(async () => 'ok'),
  };
  const supabase = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => 'ok'),
  };
  mocks.getSupabase.mockReturnValue(supabase);
  return {
    channel,
    supabase,
    receive: (payload) => {
      if (!receiver) throw new Error('broadcast receiver not registered');
      receiver({ payload });
    },
  };
}

describe('frontend bridge Broadcast transport', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-123' });
    mocks.handleFrontendRpc.mockResolvedValue({
      ok: true,
      result: { pong: true },
      requestId: 'req-in',
    });
  });

  it('subscribes with the exact shared event and replies to inbound RPC', async () => {
    const h = makeHarness();
    const { connectBroadcast, disconnectBroadcast } = await import(
      '@/lib/frontend-bridge/broadcast'
    );
    await connectBroadcast();

    expect(h.supabase.channel).toHaveBeenCalledWith(
      'matrx-extension-bridge:user-123',
      expect.objectContaining({ config: expect.any(Object) }),
    );
    expect(h.channel.on).toHaveBeenCalledWith(
      'broadcast',
      { event: 'FRONTEND_RPC' },
      expect.any(Function),
    );

    h.receive({
      direction: 'frontend->extension',
      action: 'ping',
      requestId: 'req-in',
      payload: {},
      timestamp: Date.now(),
    });
    await vi.waitFor(() => expect(h.channel.send).toHaveBeenCalledTimes(1));

    expect(mocks.handleFrontendRpc).toHaveBeenCalledWith(
      {
        channel: 'FRONTEND_RPC',
        action: 'ping',
        requestId: 'req-in',
        payload: {},
      },
      {},
    );
    expect(h.channel.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'FRONTEND_RPC',
      payload: expect.objectContaining({
        direction: 'extension->frontend',
        action: 'ping',
        requestId: 'req-in',
        payload: { ok: true, result: { pong: true }, requestId: 'req-in' },
      }),
    });
    await disconnectBroadcast();
  });

  it('correlates frontend replies to extension-initiated requests', async () => {
    const h = makeHarness();
    const { connectBroadcast, disconnectBroadcast, publishToFrontend } = await import(
      '@/lib/frontend-bridge/broadcast'
    );
    await connectBroadcast();
    const outbound = await publishToFrontend('openPanel', { panelId: 'notes' });

    h.receive({
      direction: 'frontend->extension',
      action: 'openPanel',
      requestId: outbound.requestId,
      payload: { ok: true, result: { opened: true } },
      timestamp: Date.now(),
    });

    await expect(outbound.promise).resolves.toEqual({
      ok: true,
      result: { opened: true },
      requestId: outbound.requestId,
    });
    await disconnectBroadcast();
  });

  it('preserves request correlation when disconnecting an in-flight call', async () => {
    makeHarness();
    const { connectBroadcast, disconnectBroadcast, publishToFrontend } = await import(
      '@/lib/frontend-bridge/broadcast'
    );
    await connectBroadcast();
    const outbound = await publishToFrontend('openPanel', { panelId: 'notes' });
    await disconnectBroadcast();

    await expect(outbound.promise).resolves.toEqual({
      ok: false,
      error: 'broadcast disconnected',
      requestId: outbound.requestId,
    });
  });

  it('does not subscribe when the extension has no authenticated user', async () => {
    const h = makeHarness();
    mocks.getCurrentUser.mockResolvedValue(null);
    const { connectBroadcast } = await import('@/lib/frontend-bridge/broadcast');
    await connectBroadcast();
    expect(h.supabase.channel).not.toHaveBeenCalled();
  });
});
