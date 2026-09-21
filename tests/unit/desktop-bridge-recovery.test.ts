/**
 * Regressions caught by adversarial review of the 2026-09-21 desktop-bridge
 * change. Each one is a way the bridge could be left OFF, or left lying
 * about being off, after the fixes that were supposed to keep it on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => {
    const q = {
      select: () => q,
      eq: () => q,
      is: () => q,
      not: () => q,
      order: () => q,
      limit: async () => ({ data: [], error: null }),
    };
    return { from: () => q };
  },
}));

afterEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  await chrome.storage.local.clear();
});

describe('discovery cannot report a running engine as offline for long', () => {
  it('caps the backoff so the lie window stays small', async () => {
    const mod = await import('@/lib/desktop/discovery');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );

    // Climb the WHOLE ladder. Each miss must land after the previous rung
    // expired, or the gate short-circuits and the ladder never advances —
    // which is how a naive version of this test passed against a 15-minute
    // ceiling it was written to reject.
    let clock = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    for (const step of [0, 31_000, 61_000, 121_000, 121_000, 121_000]) {
      clock += step;
      await mod.getEngineBaseUrl();
    }

    // At the ceiling. Two minutes and a second later the sweep MUST run
    // again: while the gate is shut, a running engine that moved ports is
    // reported offline to the user and to every desktop tool.
    clock += 120_001;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === 'http://127.0.0.1:22151/health') {
        return new Response(
          JSON.stringify({ status: 'ok', service: 'matrx-local', version: '1.4.15' }),
          { status: 200 },
        );
      }
      throw new Error('connection refused');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(mod.getEngineBaseUrl()).resolves.toBe('http://127.0.0.1:22151');
    nowSpy.mockRestore();
  });

  it('keeps the tunnel lookup off the loopback ladder', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase/client', () => ({
      getSupabase: () => {
        const q = {
          select: () => q,
          eq: () => q,
          is: () => q,
          not: () => q,
          order: () => q,
          limit: async () => ({
            data: [
              {
                instance_id: 'i1',
                instance_name: 'Studio',
                tunnel_url: 'https://tunnel.example/',
                last_seen: '2026-09-21T00:00:00Z',
              },
            ],
            error: null,
          }),
        };
        return { from: () => q };
      },
    }));
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getEngineBaseUrl } = await import('@/lib/desktop/discovery');

    // A remote user: no local engine, ever. First call sweeps and resolves
    // the tunnel.
    await expect(getEngineBaseUrl()).resolves.toBe('https://tunnel.example');
    const sweepCalls = fetchMock.mock.calls.length;
    expect(sweepCalls).toBeGreaterThan(1);

    // The remote hit must NOT have reset the loopback ladder. If it did,
    // this user pays a full 20-port sweep on every 30s tick, forever —
    // which is the exact noise the rate limit exists to stop.
    fetchMock.mockClear();
    const { invalidateEnginePortCache } = await import('@/lib/desktop/discovery');
    await invalidateEnginePortCache();
    await getEngineBaseUrl();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the socket is not reopened against its own idle decision', () => {
  it('reports an intentional close so the background poll leaves it alone', async () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    let listener: ((m: unknown) => boolean) | undefined;
    vi.stubGlobal('crypto', { randomUUID: () => 'boot' });
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: (fn: (m: unknown) => boolean) => {
            listener = fn;
          },
        },
      },
    });
    const ws = await import('@/lib/desktop/ws-client');
    ws.installWsRouter();

    listener?.({ __matrx: true, kind: 'ws:state', payload: { state: 'open' } });
    expect(ws.shouldBackgroundReopenWs()).toBe(false);

    // The offscreen idle watchdog closed it on purpose.
    listener?.({
      __matrx: true,
      kind: 'ws:state',
      payload: { state: 'closed', intentional: true },
    });
    expect(ws.shouldBackgroundReopenWs()).toBe(false);

    // A failure close is a different matter — that one must be reopened.
    listener?.({ __matrx: true, kind: 'ws:state', payload: { state: 'open' } });
    listener?.({ __matrx: true, kind: 'ws:state', payload: { state: 'closed' } });
    expect(ws.shouldBackgroundReopenWs()).toBe(true);
  });
});

describe('only the service worker answers the offscreen', () => {
  it('registers no request handlers in a side panel', async () => {
    const registered: string[] = [];
    vi.doMock('@/lib/messaging/native', () => ({
      broadcast: vi.fn(),
      send: vi.fn(),
      on: (kind: string) => {
        registered.push(kind);
        return () => undefined;
      },
    }));
    // happy-dom gives us window/document: this IS a side panel.
    vi.stubGlobal('crypto', { randomUUID: () => 'panel-boot' });
    vi.stubGlobal('chrome', {
      runtime: { onMessage: { addListener: () => undefined } },
    });
    const ws = await import('@/lib/desktop/ws-client');
    ws.installWsRouter();

    expect(registered).not.toContain('ws:epoch-handshake');
    expect(registered).not.toContain('ws:resolve-url');
    expect(registered).not.toContain('ws:reconnect');
  });
});
