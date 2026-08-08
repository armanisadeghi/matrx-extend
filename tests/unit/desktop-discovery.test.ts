import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabase: vi.fn(),
}));

vi.mock('@/config/env', () => ({
  ENV: { DESKTOP_LOCAL_URL: 'http://127.0.0.1:22180' },
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

  it('rejects non-HTTPS tunnel URLs and falls back without exposing credentials', async () => {
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
    await expect(getEngineBaseUrl()).resolves.toBe('http://127.0.0.1:22180');
  });
});
