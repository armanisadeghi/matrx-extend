import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabase: vi.fn(),
}));

vi.mock('@/lib/debug/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));
vi.mock('@/lib/supabase/client', () => ({ getSupabase: mocks.getSupabase }));

function remoteQuery(result: {
  data: Array<{
    instance_id: string;
    instance_name: string;
    tunnel_url: string;
    last_seen: string;
  }> | null;
  error: { message: string } | null;
}) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    not: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(async () => result),
  };
  const client = { from: vi.fn(() => query) };
  mocks.getSupabase.mockReturnValue(client);
  return { client, query };
}

describe('desktop engine discovery', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await chrome.storage.local.clear();
  });

  it('prefers a real matrx-local listener on the live local port range', async () => {
    const remote = remoteQuery({ data: [], error: null });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === 'http://127.0.0.1:22147/health') {
          return new Response(
            JSON.stringify({ status: 'ok', service: 'matrx-local', version: '1.4.15' }),
            { status: 200 },
          );
        }
        throw new Error('connection refused');
      }),
    );

    const { getEngineBaseUrl } = await import('@/lib/desktop/discovery');
    await expect(getEngineBaseUrl()).resolves.toBe('http://127.0.0.1:22147');
    expect(remote.client.from).not.toHaveBeenCalled();
  });

  it('discovers the freshest active remote tunnel through owner-RLS app_instances', async () => {
    const remote = remoteQuery({
      data: [
        {
          instance_id: 'local-machine-1',
          instance_name: 'Studio Mac',
          tunnel_url: 'https://fresh-tunnel.trycloudflare.com/',
          last_seen: '2026-08-08T18:00:00Z',
        },
      ],
      error: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('connection refused'))),
    );

    const { getEngineBaseUrl } = await import('@/lib/desktop/discovery');
    await expect(getEngineBaseUrl()).resolves.toBe('https://fresh-tunnel.trycloudflare.com');
    expect(remote.client.from).toHaveBeenCalledWith('app_instances');
    expect(remote.query.eq).toHaveBeenCalledWith('tunnel_active', true);
    expect(remote.query.order).toHaveBeenCalledWith('last_seen', { ascending: false });

    // The short in-memory cache avoids 20 localhost probes + one database
    // query on every remote RPC while still following quick-tunnel churn.
    vi.mocked(fetch).mockClear();
    await expect(getEngineBaseUrl()).resolves.toBe('https://fresh-tunnel.trycloudflare.com');
    expect(fetch).not.toHaveBeenCalled();
    expect(remote.client.from).toHaveBeenCalledTimes(1);
  });

  it('rejects non-HTTPS tunnel URLs and reports no engine rather than a phantom address', async () => {
    remoteQuery({
      data: [
        {
          instance_id: 'local-machine-1',
          instance_name: 'Studio Mac',
          tunnel_url: 'http://user:pass@unsafe.example/',
          last_seen: '2026-08-08T18:00:00Z',
        },
      ],
      error: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('connection refused'))),
    );

    const { getEngineBaseUrl } = await import('@/lib/desktop/discovery');
    // null, not a build-time fallback port: callers degrade on null, and a
    // phantom address made every one of those paths unreachable.
    await expect(getEngineBaseUrl()).resolves.toBeNull();
  });

  it('rate-limits the full port sweep instead of re-scanning every 30s forever', async () => {
    remoteQuery({ data: [], error: null });
    const fetchMock = vi.fn(async () => Promise.reject(new Error('connection refused')));
    vi.stubGlobal('fetch', fetchMock);

    const { getEngineBaseUrl } = await import('@/lib/desktop/discovery');
    await expect(getEngineBaseUrl()).resolves.toBeNull();
    const firstSweep = fetchMock.mock.calls.length;
    expect(firstSweep).toBeGreaterThan(1); // it really did sweep the range

    // The desktop-probe alarm keeps calling. Nothing has changed, so the
    // expensive scan must not run again — this is the wall of refused
    // connections Chrome prints to the console every 30 seconds.
    fetchMock.mockClear();
    await expect(getEngineBaseUrl()).resolves.toBeNull();
    await expect(getEngineBaseUrl()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-scans immediately when a person asks for it', async () => {
    remoteQuery({ data: [], error: null });
    const fetchMock = vi.fn(async () => Promise.reject(new Error('connection refused')));
    vi.stubGlobal('fetch', fetchMock);

    const { getEngineBaseUrl, resetEngineDiscoveryBackoff } = await import(
      '@/lib/desktop/discovery'
    );
    await expect(getEngineBaseUrl()).resolves.toBeNull();
    fetchMock.mockClear();

    resetEngineDiscoveryBackoff();
    await expect(getEngineBaseUrl()).resolves.toBeNull();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('re-probes the last good port on every tick without sweeping the range', async () => {
    remoteQuery({ data: [], error: null });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === 'http://127.0.0.1:22147/health') {
        return new Response(
          JSON.stringify({ status: 'ok', service: 'matrx-local', version: '1.4.15' }),
          { status: 200 },
        );
      }
      throw new Error('connection refused');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getEngineBaseUrl, invalidateEnginePortCache } = await import(
      '@/lib/desktop/discovery'
    );
    await expect(getEngineBaseUrl()).resolves.toBe('http://127.0.0.1:22147');

    // Engine restarts on the same port. The TTL cache was dropped (that is
    // what every transport failure does), but recovery must not need a full
    // sweep — one request to the port it always uses.
    await invalidateEnginePortCache();
    fetchMock.mockClear();
    await expect(getEngineBaseUrl()).resolves.toBe('http://127.0.0.1:22147');
    expect(fetchMock.mock.calls).toEqual([
      ['http://127.0.0.1:22147/health', expect.anything()],
    ]);
  });
});
