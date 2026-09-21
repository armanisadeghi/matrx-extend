/**
 * The desktop socket must survive an engine restart on its own.
 *
 * Before this guard the offscreen runtime replayed the URL it was handed at
 * WS_START forever: the engine binds the first free port in 22140-22159, so
 * a restart onto another port left the bridge permanently down while a
 * warning ("ws open timeout ... did not respond") was logged every 30s for
 * the life of the browser. The HTTP transport already self-healed the same
 * failure (http.ts drops the port cache and re-pairs); the socket did not.
 */
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
vi.mock('@ai-matrx/kit/format', () => ({ formatDurationMs: (ms: number) => `${ms}ms` }));

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
  closedWith: Array<{ code: number; reason: string }> = [];
  readonly url: string;
  private listeners = new Map<string, Array<(event: FakeWebSocketEvent) => void>>();

  constructor(url: string) {
    this.url = url;
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
    this.closedWith.push({ code, reason });
    this.readyState = 3;
    for (const listener of this.listeners.get('close') ?? []) listener({ code, reason });
  }

  send(): void {
    /* no-op */
  }
}

/** Let queued microtasks (the epoch handshake await chain) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function loadRuntime(): Promise<typeof import('@/lib/desktop/ws-offscreen')> {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('crypto', { randomUUID: () => 'epoch-1' });
  const mod = await import('@/lib/desktop/ws-offscreen');
  mod.startWsOffscreenRuntime();
  return mod;
}

/** Drive a full open: WS_START → socket opens → epoch acknowledged. */
async function openSocket(url: string): Promise<FakeWebSocket> {
  native.send.mockImplementation(async (kind: string) => {
    if (kind === 'ws:epoch-handshake') return { ok: true, socketEpoch: 'epoch-1' };
    return { ok: false };
  });
  const started = handlers.get('ws:start')?.({
    wsUrl: url,
    identity: { extensionId: 'x', version: '1', name: 'test' },
    backgroundBootId: 'boot-1',
  });
  await flush();
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!socket) throw new Error('no socket created');
  socket.open();
  await flush();
  await started;
  return socket;
}

describe('desktop socket reconnect', () => {
  afterEach(() => {
    handlers.clear();
    FakeWebSocket.instances = [];
    native.broadcast.mockReset();
    native.on.mockClear();
    native.send.mockReset();
    debugLog.info.mockReset();
    debugLog.warn.mockReset();
    vi.useRealTimers();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('re-resolves the URL through the service worker instead of replaying a dead port', async () => {
    vi.useFakeTimers();
    await loadRuntime();
    const socket = await openSocket('ws://127.0.0.1:22140/extension/ws?token=old');

    // The engine goes away and comes back on the next port in the scan range.
    const resolveCalls: unknown[] = [];
    native.send.mockImplementation(async (kind: string, payload: unknown) => {
      if (kind === 'ws:resolve-url') {
        resolveCalls.push(payload);
        return { ok: true, wsUrl: 'ws://127.0.0.1:22141/extension/ws?token=new' };
      }
      if (kind === 'ws:epoch-handshake') return { ok: true, socketEpoch: 'epoch-1' };
      return { ok: false };
    });
    socket.close(1006, '');

    await vi.advanceTimersByTimeAsync(1_100);
    await flush();

    expect(resolveCalls).toEqual([
      { failedUrl: 'ws://127.0.0.1:22140/extension/ws?token=old' },
    ]);
    const retry = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    expect(retry?.url).toBe('ws://127.0.0.1:22141/extension/ws?token=new');
  });

  it('stops retrying once the backoff ladder is spent', async () => {
    vi.useFakeTimers();
    await loadRuntime();
    const socket = await openSocket('ws://127.0.0.1:22140/extension/ws?token=old');

    // Engine gone for good: discovery resolves nothing.
    native.send.mockImplementation(async (kind: string) => {
      if (kind === 'ws:resolve-url') return { ok: false };
      return { ok: false };
    });
    const socketsBefore = FakeWebSocket.instances.length;
    socket.close(1006, '');

    // The whole ladder (1+2+4+8+16+30s) plus generous slack.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await flush();

    // Not one connect attempt: discovery said the engine is unreachable.
    expect(FakeWebSocket.instances.length).toBe(socketsBefore);
    expect(
      debugLog.info.mock.calls.some((call) =>
        String(call[1]).includes('pausing retries'),
      ),
    ).toBe(true);
    // And it is actually quiet afterwards — no endless warning stream.
    debugLog.info.mockReset();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(debugLog.info).not.toHaveBeenCalled();
  });

  it('closes a socket that never finished connecting', async () => {
    vi.useFakeTimers();
    await loadRuntime();
    native.send.mockResolvedValue({ ok: false });
    const started = handlers.get('ws:start')?.({
      wsUrl: 'ws://127.0.0.1:22140/extension/ws?token=old',
      identity: { extensionId: 'x', version: '1', name: 'test' },
      backgroundBootId: 'boot-1',
    });
    await flush();
    const socket = FakeWebSocket.instances[0];
    expect(socket?.readyState).toBe(FakeWebSocket.CONNECTING);

    // A restarting engine holds the port bound without accepting: no open,
    // no close, no error. The runtime must not leak the half-open socket.
    await vi.advanceTimersByTimeAsync(5_100);
    await flush();
    await started;

    expect(socket?.closedWith).toEqual([{ code: 1000, reason: 'open timeout' }]);
  });
});
