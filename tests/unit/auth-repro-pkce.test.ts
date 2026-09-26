import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  verifierIndex: 0,
  nonceIndex: 0,
}));

vi.mock('@/config/env', () => ({
  ENV: {
    SUPABASE_URL: 'https://db.example.test',
    SUPABASE_PUBLISHABLE_KEY: 'publishable',
    EXTENSION_OAUTH_CLIENT_ID: 'extension-client',
  },
  STORAGE_KEYS: {
    PKCE_VERIFIER: 'matrx.pkce.verifier',
    USER_PROFILE: 'matrx.user.profile',
    ACCESS_TOKEN: 'matrx.auth.accessToken',
    REFRESH_TOKEN_ENC: 'matrx.auth.refreshTokenEnc',
    REFRESH_TOKEN_IV: 'matrx.auth.refreshTokenIv',
    TOKEN_EXPIRES_AT: 'matrx.auth.expiresAt',
    ACTIVE_ORGANIZATION: 'matrx.org.active',
  },
  ALARMS: { TOKEN_REFRESH: 'token-refresh' },
}));
vi.mock('@/lib/auth/pkce', () => ({
  generateCodeVerifier: () => `verifier-${++state.verifierIndex}`,
  generateCodeChallenge: async (verifier: string) => `challenge-${verifier}`,
  generateNonce: () => `state-${++state.nonceIndex}`,
}));
vi.mock('@/lib/auth/crypto', () => ({
  encryptString: async () => ({ ct: 'encrypted', iv: 'iv' }),
  decryptString: async () => 'refresh',
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/supabase/client', () => ({ clearSupabaseSession: vi.fn() }));

describe('concurrent PKCE sign-in reproduction', () => {
  beforeEach(() => {
    state.verifierIndex = 0;
    state.nonceIndex = 0;
    vi.stubGlobal('browser', undefined);
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) =>
          callback(),
      },
    });
  });

  it('keeps each concurrent sign-in verifier until its own callback consumes it', async () => {
    const session = new Map<string, unknown>();
    const callbacks: Array<(callbackUrl?: string) => void> = [];
    vi.stubGlobal('chrome', {
      identity: {
        getRedirectURL: () => 'https://extension.chromiumapp.org/',
        launchWebAuthFlow: (_options: unknown, callback: (callbackUrl?: string) => void) =>
          callbacks.push(callback),
      },
      runtime: { lastError: undefined },
      storage: {
        session: {
          set: async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) session.set(key, value);
          },
          get: async (keys: string[]) =>
            Object.fromEntries(
              keys.filter((key) => session.has(key)).map((key) => [key, session.get(key)]),
            ),
          remove: async (keys: string[]) => {
            for (const key of keys) session.delete(key);
          },
        },
        local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
      },
      alarms: { create: vi.fn(), clear: vi.fn() },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    );

    const { signIn } = await import('@/lib/auth/flow');
    const first = signIn();
    const second = signIn();
    await vi.waitFor(() => expect(callbacks).toHaveLength(2));

    callbacks[0]?.('https://extension.chromiumapp.org/?code=code-1&state=state-1');
    callbacks[1]?.('https://extension.chromiumapp.org/?code=code-2&state=state-2');

    await expect(first).rejects.toThrow('Token exchange failed');
    await expect(second).rejects.toThrow('Token exchange failed');
    expect(fetch).toHaveBeenCalledTimes(2);
    const requestBodies = (fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      ([, request]) => new URLSearchParams((request as RequestInit).body as string),
    );
    expect(requestBodies.map((body) => body.get('code_verifier'))).toEqual([
      'verifier-1',
      'verifier-2',
    ]);
  });

  it('does not use a fabricated Safari identity API', async () => {
    const session = new Map<string, unknown>();
    const local = new Map<string, unknown>();
    vi.stubGlobal('browser', {
      identity: {
        getRedirectURL: () => 'https://com.example.matrx.safariwebext.apple/',
        launchWebAuthFlow: async () =>
          'https://com.example.matrx.safariwebext.apple/?code=safari-code&state=state-1',
      },
    });
    vi.stubGlobal('chrome', {
      runtime: { lastError: undefined },
      storage: {
        session: {
          set: async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) session.set(key, value);
          },
          get: async (keys: string[]) =>
            Object.fromEntries(
              keys.filter((key) => session.has(key)).map((key) => [key, session.get(key)]),
            ),
          remove: async (keys: string[]) => {
            for (const key of keys) session.delete(key);
          },
        },
        local: {
          get: async (keys: string[]) =>
            Object.fromEntries(
              keys.filter((key) => local.has(key)).map((key) => [key, local.get(key)]),
            ),
          set: async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) local.set(key, value);
          },
          remove: vi.fn(),
        },
      },
      alarms: { create: vi.fn(), clear: vi.fn() },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'safari-access',
              refresh_token: 'safari-refresh',
              expires_in: 3600,
              token_type: 'bearer',
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: '00000000-0000-4000-8000-000000000001',
              email: 'admin@example.com',
              email_confirmed_at: '2026-01-01T00:00:00Z',
              user_metadata: {},
            }),
            { status: 200 },
          ),
        ),
    );

    const { signIn } = await import('@/lib/auth/flow');
    await expect(signIn()).rejects.toThrow('does not provide an identity API');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not replace an existing session when the exchanged bearer cannot fetch a profile', async () => {
    const session = new Map<string, unknown>();
    const local = new Map<string, unknown>([
      ['matrx.auth.accessToken', 'existing-access'],
      ['matrx.auth.refreshTokenEnc', 'existing-refresh'],
      ['matrx.auth.refreshTokenIv', 'existing-iv'],
      ['matrx.auth.expiresAt', 123],
    ]);
    let callback: ((callbackUrl?: string) => void) | undefined;
    vi.stubGlobal('chrome', {
      identity: {
        getRedirectURL: () => 'https://extension.chromiumapp.org/',
        launchWebAuthFlow: (_options: unknown, next: (callbackUrl?: string) => void) => {
          callback = next;
        },
      },
      runtime: { lastError: undefined },
      storage: {
        session: {
          set: async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) session.set(key, value);
          },
          get: async (keys: string[]) =>
            Object.fromEntries(
              keys.filter((key) => session.has(key)).map((key) => [key, session.get(key)]),
            ),
          remove: async (keys: string[]) => {
            for (const key of keys) session.delete(key);
          },
        },
        local: {
          get: async (keys: string[]) =>
            Object.fromEntries(
              keys.filter((key) => local.has(key)).map((key) => [key, local.get(key)]),
            ),
          set: async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) local.set(key, value);
          },
          remove: vi.fn(),
        },
      },
      alarms: { create: vi.fn(), clear: vi.fn() },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'new-access',
              refresh_token: 'new-refresh',
              expires_in: 3600,
              token_type: 'bearer',
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(new Response('invalid bearer', { status: 401 })),
    );

    const { signIn } = await import('@/lib/auth/flow');
    const attempt = signIn();
    await vi.waitFor(() => expect(callback).toBeDefined());
    callback?.('https://extension.chromiumapp.org/?code=code-1&state=state-1');

    await expect(attempt).rejects.toThrow('Failed to fetch Supabase user: 401');
    expect(local.get('matrx.auth.accessToken')).toBe('existing-access');
    expect(local.get('matrx.auth.refreshTokenEnc')).toBe('existing-refresh');
    expect(local.get('matrx.auth.refreshTokenIv')).toBe('existing-iv');
    expect(local.get('matrx.auth.expiresAt')).toBe(123);
  });

  it('keeps a successful sign-in successful when PKCE verifier cleanup fails', async () => {
    const session = new Map<string, unknown>();
    let callback: ((callbackUrl?: string) => void) | undefined;
    vi.stubGlobal('chrome', {
      identity: {
        getRedirectURL: () => 'https://extension.chromiumapp.org/',
        launchWebAuthFlow: (_options: unknown, next: (callbackUrl?: string) => void) => {
          callback = next;
        },
      },
      runtime: { lastError: undefined },
      storage: {
        session: {
          set: async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) session.set(key, value);
          },
          get: async (keys: string[]) =>
            Object.fromEntries(
              keys.filter((key) => session.has(key)).map((key) => [key, session.get(key)]),
            ),
          remove: async () => {
            throw new Error('session store unavailable');
          },
        },
        local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
      },
      alarms: { create: vi.fn(), clear: vi.fn() },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'new-access',
              refresh_token: 'new-refresh',
              expires_in: 3600,
              token_type: 'bearer',
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: '00000000-0000-4000-8000-000000000001',
              email: 'admin@example.com',
              email_confirmed_at: '2026-01-01T00:00:00Z',
              user_metadata: {},
            }),
            { status: 200 },
          ),
        ),
    );

    const { signIn } = await import('@/lib/auth/flow');
    const attempt = signIn();
    await vi.waitFor(() => expect(callback).toBeDefined());
    callback?.('https://extension.chromiumapp.org/?code=code-1&state=state-1');

    await expect(attempt).resolves.toMatchObject({ user: { email: 'admin@example.com' } });
  });

  it('does not commit a pending login after sign-out invalidates its attempt', async () => {
    const session = new Map<string, unknown>();
    const local = new Map<string, unknown>([
      ['matrx.auth.accessToken', 'prior-access'],
      ['matrx.auth.refreshTokenEnc', 'prior-refresh'],
      ['matrx.auth.refreshTokenIv', 'prior-iv'],
      ['matrx.auth.expiresAt', 123],
    ]);
    let callback: ((callbackUrl?: string) => void) | undefined;
    vi.stubGlobal('chrome', {
      identity: {
        getRedirectURL: () => 'https://extension.chromiumapp.org/',
        launchWebAuthFlow: (_options: unknown, next: (callbackUrl?: string) => void) => {
          callback = next;
        },
      },
      runtime: { lastError: undefined },
      storage: {
        session: {
          set: async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) session.set(key, value);
          },
          get: async (keys: string[]) =>
            Object.fromEntries(
              keys.filter((key) => session.has(key)).map((key) => [key, session.get(key)]),
            ),
          remove: async (keys: string[]) => {
            for (const key of keys) session.delete(key);
          },
        },
        local: {
          get: async (keys: string[]) =>
            Object.fromEntries(
              keys.filter((key) => local.has(key)).map((key) => [key, local.get(key)]),
            ),
          set: async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) local.set(key, value);
          },
          remove: async (keys: string[]) => {
            for (const key of keys) local.delete(key);
          },
        },
      },
      alarms: { create: vi.fn(), clear: vi.fn().mockResolvedValue(true) },
    });
    let releaseUser!: () => void;
    const userResponse = new Promise<void>((resolve) => {
      releaseUser = resolve;
    });
    let userRequested!: () => void;
    const userRequestStarted = new Promise<void>((resolve) => {
      userRequested = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/oauth/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'pending-access',
              refresh_token: 'pending-refresh',
              expires_in: 3600,
              token_type: 'bearer',
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('/auth/v1/user')) {
          userRequested();
          await userResponse;
          return new Response(
            JSON.stringify({
              id: '00000000-0000-4000-8000-000000000001',
              email: 'new@example.com',
            }),
            { status: 200 },
          );
        }
        return new Response('', { status: 204 });
      }),
    );

    const { signIn, signOut } = await import('@/lib/auth/flow');
    const pending = signIn();
    await vi.waitFor(() => expect(callback).toBeDefined());
    callback?.('https://extension.chromiumapp.org/?code=code-1&state=state-1');
    await userRequestStarted;
    await signOut();
    releaseUser();

    await expect(pending).rejects.toThrow('superseded');
    expect(local.get('matrx.auth.accessToken')).toBeUndefined();
    expect(local.get('matrx.auth.refreshTokenEnc')).toBeUndefined();
  });
});
