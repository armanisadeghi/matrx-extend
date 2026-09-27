import { afterEach, describe, expect, it, vi } from 'vitest';

const debug = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/debug/log', () => ({ log: debug }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('D48 native observation boundary', () => {
  it('delivers a captured URL to the owner while omitting it from the debug detail', async () => {
    vi.resetModules();
    const listeners: Array<(message: unknown, sender: unknown, reply: (response: unknown) => void) => void> = [];
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: { addListener: (listener: typeof listeners[number]) => listeners.push(listener), removeListener: vi.fn() },
        sendMessage: vi.fn(async () => undefined),
      },
    });
    const { on } = await import('@/lib/messaging/native');
    const { CHANNELS } = await import('@/lib/messaging/schemas');
    const observed = vi.fn();
    on(CHANNELS.NET_CAPTURE_EVENT, observed);
    const secret = 'SYNTHETIC_NATIVE_SECRET';
    listeners[0]?.({ __matrx: true, kind: CHANNELS.NET_CAPTURE_EVENT, payload: {
      url: `https://calendar.invalid/api?access_token=${secret}`,
    } }, {}, vi.fn());
    expect(observed).toHaveBeenCalledWith({ url: `https://calendar.invalid/api?access_token=${secret}` }, {});
    expect(JSON.stringify(debug.info.mock.calls)).not.toContain(secret);
  });

  it('does not debug-log delegated stream arguments on send or receive', async () => {
    vi.resetModules();
    const listeners: Array<(message: unknown, sender: unknown, reply: (response: unknown) => void) => void> = [];
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: { addListener: (listener: typeof listeners[number]) => listeners.push(listener), removeListener: vi.fn() },
        sendMessage: vi.fn(async () => ({ ack: true })),
      },
    });
    const { on, send } = await import('@/lib/messaging/native');
    const { CHANNELS } = await import('@/lib/messaging/schemas');
    const payload = { arguments: { action: 'save', kind: 'network_capture', config: { url_filter: 'https://calendar.invalid/api?access_token=SYNTHETIC_STREAM_SECRET' } } };
    on(CHANNELS.STREAM_CHUNK, () => ({ ack: true }));
    await send(CHANNELS.STREAM_CHUNK, payload);
    listeners[0]?.({ __matrx: true, kind: CHANNELS.STREAM_CHUNK, payload }, {}, vi.fn());
    expect(JSON.stringify(debug.info.mock.calls)).not.toContain('SYNTHETIC_STREAM_SECRET');
  });

  it('does not debug-log an external WebMCP Network save envelope', async () => {
    vi.resetModules();
    const listeners: Array<(message: unknown, sender: unknown, reply: (response: unknown) => void) => void> = [];
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: { addListener: (listener: typeof listeners[number]) => listeners.push(listener), removeListener: vi.fn() },
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
    });
    const { on, send } = await import('@/lib/messaging/native');
    const { CHANNELS } = await import('@/lib/messaging/schemas');
    const payload = { toolName: 'data_patterns', args: { action: 'save', kind: 'network_capture', config: { url_filter: 'https://calendar.invalid/api?access_token=SYNTHETIC_WEBMCP_SECRET' } } };
    on(CHANNELS.WEBMCP_CALL, () => ({ ok: true }));
    await send(CHANNELS.WEBMCP_CALL, payload);
    listeners[0]?.({ __matrx: true, kind: CHANNELS.WEBMCP_CALL, payload }, {}, vi.fn());
    expect(JSON.stringify(debug.info.mock.calls)).not.toContain('SYNTHETIC_WEBMCP_SECRET');
  });
});
