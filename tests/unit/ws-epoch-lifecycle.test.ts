import { afterEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (payload: unknown) => unknown>();
const native = {
  broadcast: vi.fn(),
  on: vi.fn((kind: string, handler: (payload: unknown) => unknown) => {
    handlers.set(kind, handler);
    return () => handlers.delete(kind);
  }),
  send: vi.fn(),
};
const debugLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };

vi.mock('@/lib/messaging/native', () => native);
vi.mock('@/lib/debug/log', () => ({ log: debugLog }));
vi.mock('@/lib/stream/offscreen-proxy', () => ({ ensureOffscreen: vi.fn() }));
vi.mock('@/lib/desktop/discovery', () => ({ getEngineBaseUrl: vi.fn() }));
vi.mock('@/lib/desktop/http', () => ({ ensurePairToken: vi.fn() }));

let chromeMessageListener: ((message: unknown) => boolean) | undefined;

function installChrome(): void {
  chromeMessageListener = undefined;
  vi.stubGlobal('crypto', { randomUUID: () => 'current-background-boot' });
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: (listener: (message: unknown) => boolean) => {
          chromeMessageListener = listener;
        },
      },
      getManifest: () => ({ version: '1', name: 'test' }),
      id: 'test-extension',
    },
  });
}

function wsMessage(payload: unknown): void {
  chromeMessageListener?.({ __matrx: true, kind: 'ws:message', payload });
}

interface FakeWebSocketEvent {
  code?: number;
  reason?: string;
  data?: unknown;
}

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Array<(event: FakeWebSocketEvent) => void>>();

  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: FakeWebSocketEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    for (const listener of this.listeners.get('open') ?? []) listener({});
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    for (const listener of this.listeners.get('close') ?? []) listener({ code, reason });
  }

  send(frame: string): void {
    this.sent.push(frame);
  }

  message(frame: unknown): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data: frame });
  }
}

describe('private local-browser socket epochs', () => {
  afterEach(() => {
    handlers.clear();
    native.broadcast.mockReset();
    native.on.mockClear();
    native.send.mockReset();
    debugLog.error.mockReset();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('drops lifecycle frames until the background exactly acknowledges the epoch', async () => {
    installChrome();
    const ws = await import('@/lib/desktop/ws-client');
    const frames: unknown[] = [];
    const genericFrames: unknown[] = [];
    const invalidations: Array<string | null> = [];
    ws.onLocalBrowserLifecycle((payload) => frames.push(payload));
    ws.onWsMessage((payload) => genericFrames.push(payload));
    ws.onLocalBrowserEpochInvalidated((epoch) => invalidations.push(epoch));

    wsMessage({
      __matrxLocalBrowserLifecycle: true,
      socketEpoch: 'epoch-1',
      payload: { type: 'local_browser.register_required' },
    });
    expect(frames).toEqual([]);

    const handshake = handlers.get('ws:epoch-handshake');
    expect(
      handshake?.({ socketEpoch: 'stale', backgroundBootId: 'prior-background-boot' }),
    ).toEqual({
      ok: false,
    });
    expect(ws.getLocalBrowserSocketEpoch()).toBeNull();
    expect(
      handshake?.({ socketEpoch: 'epoch-1', backgroundBootId: 'current-background-boot' }),
    ).toEqual({
      ok: true,
      socketEpoch: 'epoch-1',
    });
    expect(invalidations).toEqual(['epoch-1']);
    wsMessage({
      __matrxLocalBrowserLifecycle: true,
      socketEpoch: 'epoch-1',
      payload: { type: 'local_browser.register_required' },
    });
    expect(frames).toEqual([{ type: 'local_browser.register_required' }]);
    wsMessage({
      __matrxLocalBrowserLifecycle: true,
      socketEpoch: 'stale',
      payload: { type: 'local_browser.result' },
    });
    expect(frames).toHaveLength(1);
    expect(genericFrames).toEqual([]);
    ws.onLocalBrowserLifecycle(() => {
      throw new Error('vault-grant-sentinel');
    });
    wsMessage({
      __matrxLocalBrowserLifecycle: true,
      socketEpoch: 'epoch-1',
      payload: { type: 'local_browser.result' },
    });
    expect(JSON.stringify(debugLog.error.mock.calls)).not.toContain('vault-grant-sentinel');
    chromeMessageListener?.({
      __matrx: true,
      kind: 'ws:state',
      payload: { state: 'closed', socketEpoch: 'epoch-1' },
    });
    expect(ws.getLocalBrowserSocketEpoch()).toBeNull();
    expect(invalidations).toEqual(['epoch-1', null]);
  });

  it('rejects a replaced socket epoch in both inbound and reverse directions', async () => {
    installChrome();
    const ws = await import('@/lib/desktop/ws-client');
    const frames: unknown[] = [];
    ws.onLocalBrowserLifecycle((payload) => frames.push(payload));
    const handshake = handlers.get('ws:epoch-handshake');
    handshake?.({ socketEpoch: 'epoch-1', backgroundBootId: 'current-background-boot' });
    handshake?.({ socketEpoch: 'epoch-2', backgroundBootId: 'current-background-boot' });
    chromeMessageListener?.({
      __matrx: true,
      kind: 'ws:state',
      payload: { state: 'closed', socketEpoch: 'epoch-1' },
    });
    expect(ws.getLocalBrowserSocketEpoch()).toBe('epoch-2');

    wsMessage({
      __matrxLocalBrowserLifecycle: true,
      socketEpoch: 'epoch-1',
      payload: { type: 'local_browser.result' },
    });
    wsMessage({
      __matrxLocalBrowserLifecycle: true,
      socketEpoch: 'epoch-2',
      payload: { type: 'local_browser.result' },
    });
    expect(frames).toEqual([{ type: 'local_browser.result' }]);

    expect(await ws.sendLocalBrowserLifecycle('epoch-1', { type: 'local_browser.register' })).toBe(
      false,
    );
    expect(native.send).not.toHaveBeenCalled();
    native.send.mockResolvedValueOnce({ ok: true });
    expect(await ws.sendLocalBrowserLifecycle('epoch-2', { type: 'local_browser.register' })).toBe(
      true,
    );
    expect(native.send).toHaveBeenCalledWith('ws:send', {
      __matrxLocalBrowserLifecycle: true,
      socketEpoch: 'epoch-2',
      payload: { type: 'local_browser.register' },
    });
  });

  it('reconnects a retained offscreen socket after a background restart and preserves normal frames', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    FakeWebSocket.instances = [];
    let firstHandshake = true;
    let firstEpoch: string | undefined;
    let releaseFirstHandshake: ((value: { ok: boolean; socketEpoch: string }) => void) | undefined;
    native.send.mockImplementation((kind: string, payload: { socketEpoch: string }) => {
      if (kind === 'ws:epoch-handshake' && firstHandshake) {
        firstHandshake = false;
        firstEpoch = payload.socketEpoch;
        return new Promise((resolve) => {
          releaseFirstHandshake = resolve;
        });
      }
      if (kind === 'ws:epoch-handshake') return { ok: true, socketEpoch: payload.socketEpoch };
      return { ok: true };
    });
    const { startWsOffscreenRuntime } = await import('@/lib/desktop/ws-offscreen');
    startWsOffscreenRuntime();
    const start = handlers.get('ws:start');
    const firstOpen = start?.({
      wsUrl: 'ws://example.test',
      backgroundBootId: 'boot-1',
    }) as Promise<unknown>;
    FakeWebSocket.instances[0]?.open();
    await Promise.resolve();
    expect(FakeWebSocket.instances[0]?.sent).toEqual([]);
    const secondOpen = start?.({
      wsUrl: 'ws://example.test',
      backgroundBootId: 'boot-2',
    }) as Promise<unknown>;
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1]?.open();
    await secondOpen;
    expect(FakeWebSocket.instances[1]?.sent).toContain(
      JSON.stringify({ type: 'local_browser.ready', version: 1 }),
    );
    releaseFirstHandshake?.({ ok: true, socketEpoch: firstEpoch ?? '' });
    await firstOpen;

    FakeWebSocket.instances[1]?.message(JSON.stringify({ type: 'pong', timestamp: 1 }));
    expect(native.broadcast).toHaveBeenCalledWith('ws:message', { type: 'pong', timestamp: 1 });
    await (handlers.get('ws:stop')?.({}) as Promise<unknown>);
  });
});
