import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/env', () => ({
  ENV: {
    SUPABASE_URL: 'https://db.example.test',
    SUPABASE_PUBLISHABLE_KEY: 'publishable',
    EXTENSION_OAUTH_CLIENT_ID: 'extension-client',
  },
  STORAGE_KEYS: {
    ACCESS_TOKEN: 'access',
    REFRESH_TOKEN_ENC: 'refresh-ct',
    REFRESH_TOKEN_IV: 'refresh-iv',
    TOKEN_EXPIRES_AT: 'expires-at',
    ACTIVE_ORGANIZATION: 'active-org',
    USER_PROFILE: 'profile',
  },
  ALARMS: { TOKEN_REFRESH: 'token-refresh' },
}));
vi.mock('@/lib/auth/crypto', () => ({
  decryptString: async () => 'refresh-token',
  encryptString: async () => ({ ct: 'new-ct', iv: 'new-iv' }),
}));
vi.mock('@/lib/auth/pkce', () => ({
  generateCodeVerifier: vi.fn(),
  generateCodeChallenge: vi.fn(),
  generateNonce: vi.fn(),
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/messaging/native', () => ({ broadcast: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ clearSupabaseSession: vi.fn() }));

describe('401 force-refresh reproduction', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) =>
          callback(),
      },
    });
  });

  it('refreshes a nominally-fresh bearer after that exact bearer receives a 401', async () => {
    const stored: Record<string, unknown> = {
      access: 'server-rejected-access-token',
      'refresh-ct': 'encrypted-refresh-token',
      'refresh-iv': 'iv',
      'expires-at': Date.now() + 3_600_000,
    };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (keys: string[]) =>
            Object.fromEntries(
              keys.filter((key) => key in stored).map((key) => [key, stored[key]]),
            ),
          set: async (values: Record<string, unknown>) => Object.assign(stored, values),
          remove: vi.fn(),
        },
      },
      alarms: { create: vi.fn(), clear: vi.fn() },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'refreshed-access-token',
          refresh_token: 'refreshed-refresh-token',
          expires_in: 3600,
          token_type: 'bearer',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { refreshAccessToken } = await import('@/lib/auth/flow');
    await expect(refreshAccessToken('server-rejected-access-token')).resolves.toMatchObject({
      access_token: 'refreshed-access-token',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent 401 refreshes for the same rejected bearer', async () => {
    const stored: Record<string, unknown> = {
      access: 'server-rejected-access-token',
      'refresh-ct': 'encrypted-refresh-token',
      'refresh-iv': 'iv',
      'expires-at': Date.now() + 3_600_000,
    };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (keys: string[]) =>
            Object.fromEntries(
              keys.filter((key) => key in stored).map((key) => [key, stored[key]]),
            ),
          set: async (values: Record<string, unknown>) => Object.assign(stored, values),
          remove: vi.fn(),
        },
      },
      alarms: { create: vi.fn(), clear: vi.fn() },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'winner-access-token',
          refresh_token: 'winner-refresh-token',
          expires_in: 3600,
          token_type: 'bearer',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { refreshAccessToken } = await import('@/lib/auth/flow');
    const results = await Promise.all([
      refreshAccessToken('server-rejected-access-token'),
      refreshAccessToken('server-rejected-access-token'),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ access_token: 'winner-access-token' }),
      expect.objectContaining({ access_token: 'winner-access-token' }),
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('adopts a newer sign-in when a stale refresh completes late', async () => {
    const stored: Record<string, unknown> = {
      access: 'old-access',
      'refresh-ct': 'old-refresh-ct',
      'refresh-iv': 'old-iv',
      'expires-at': 0,
    };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (keys: string[]) =>
            Object.fromEntries(
              keys.filter((key) => key in stored).map((key) => [key, stored[key]]),
            ),
          set: async (values: Record<string, unknown>) => Object.assign(stored, values),
          remove: vi.fn(),
        },
        session: { remove: vi.fn() },
      },
      alarms: { create: vi.fn(), clear: vi.fn() },
    });
    let release!: () => void;
    const responseReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await responseReady;
        return new Response(
          JSON.stringify({
            access_token: 'stale-refreshed-access',
            refresh_token: 'stale-refreshed-refresh',
            expires_in: 3600,
            token_type: 'bearer',
          }),
          { status: 200 },
        );
      }),
    );

    const { refreshAccessToken } = await import('@/lib/auth/flow');
    const { broadcast } = await import('@/lib/messaging/native');
    vi.mocked(broadcast).mockClear();
    const refresh = refreshAccessToken();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    Object.assign(stored, {
      access: 'new-login-access',
      'refresh-ct': 'new-login-ct',
      'refresh-iv': 'new-login-iv',
      'expires-at': Date.now() + 3_600_000,
    });
    release();

    await expect(refresh).resolves.toMatchObject({ access_token: 'new-login-access' });
    expect(stored.access).toBe('new-login-access');
    expect(stored['refresh-ct']).toBe('new-login-ct');
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('broadcasts signed-out only after a terminal refresh rejection clears the matching local session', async () => {
    const stored: Record<string, unknown> = {
      access: 'rejected-access',
      'refresh-ct': 'rejected-refresh-ct',
      'refresh-iv': 'iv',
      'expires-at': 0,
    };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (keys: string[]) =>
            Object.fromEntries(
              keys.filter((key) => key in stored).map((key) => [key, stored[key]]),
            ),
          set: async (values: Record<string, unknown>) => Object.assign(stored, values),
          remove: async (keys: string[]) => {
            for (const key of keys) delete stored[key];
          },
        },
        session: { remove: vi.fn() },
      },
      alarms: { create: vi.fn(), clear: async () => true },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    );

    const { refreshAccessToken } = await import('@/lib/auth/flow');
    const { broadcast } = await import('@/lib/messaging/native');
    const { CHANNELS } = await import('@/lib/messaging/schemas');
    await expect(refreshAccessToken('rejected-access')).resolves.toBeNull();

    expect(stored.access).toBeUndefined();
    expect(stored['refresh-ct']).toBeUndefined();
    expect(broadcast).toHaveBeenCalledWith(CHANNELS.AUTH_STATE_CHANGED, {
      user: null,
      isAdmin: false,
      reason: 'refresh_token_rejected',
    });
  });
});
