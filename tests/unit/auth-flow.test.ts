import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The OAuth machinery (PKCE, state, exchange, single-flight refresh, race guard) is
// `@ai-matrx/auth/matrx-oauth` and has its own tests. These run the extension's real wiring of
// it (src/lib/auth/flow.ts) against a fake chrome and a fake auth server at the network edge.

vi.mock('@/config/env', () => ({
  ENV: {
    SUPABASE_URL: 'https://db.example.test',
    SUPABASE_PUBLISHABLE_KEY: 'publishable',
    EXTENSION_OAUTH_CLIENT_ID: 'extension-client',
    SAFARI_OAUTH_CLIENT_ID: 'safari-client',
  },
  STORAGE_KEYS: {
    USER_PROFILE: 'profile',
    AUTH_SESSION: 'matrx.oauth.session',
    ACTIVE_ORGANIZATION: 'active-org',
    IS_ADMIN: 'is-admin',
  },
  ALARMS: { TOKEN_REFRESH: 'token-refresh' },
}));
vi.mock('@/lib/browser/detect', () => ({ BROWSER: 'chrome' }));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
const broadcast = vi.fn();
vi.mock('@/lib/messaging/native', () => ({ broadcast, send: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  clearSupabaseSession: vi.fn(),
  setSupabaseSession: vi.fn(),
}));
vi.mock('@/lib/auth/verify-claims', () => ({ verifyBearerClaims: vi.fn() }));

const b64u = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (sub: string, tag: string) =>
  `${b64u('{"alg":"none"}')}.${b64u(JSON.stringify({ sub, email: 'p@example.com', exp: 9_999_999_999, tag }))}.sig`;

const NOW = new Date('2026-10-12T12:00:00Z').getTime();
const store = (area: Map<string, unknown>) => ({
  get: async (keys: string[] | string) =>
    Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).filter((k) => area.has(k)).map((k) => [k, area.get(k)]),
    ),
  set: async (values: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(values)) area.set(k, v);
  },
  remove: async (keys: string[] | string) => {
    for (const k of Array.isArray(keys) ? keys : [keys]) area.delete(k);
  },
});

interface Server {
  tokenCalls: URLSearchParams[];
  userStatus: number;
  refresh: (call: URLSearchParams) => Response | Promise<Response>;
}

describe('extension sign-in wiring', () => {
  let local: Map<string, unknown>;
  let session: Map<string, unknown>;
  let server: Server;
  let alarms: { create: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  let authorize: (url: string) => Promise<string>;

  const tokenJson = (access: string, refresh: string) =>
    new Response(
      JSON.stringify({ access_token: access, refresh_token: refresh, expires_in: 3600 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  beforeEach(() => {
    vi.resetModules();
    broadcast.mockReset();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    local = new Map();
    session = new Map();
    alarms = { create: vi.fn(), clear: vi.fn(async () => true) };
    server = {
      tokenCalls: [],
      userStatus: 200,
      refresh: () => tokenJson(jwt('person-1', 'refreshed'), 'refresh-2'),
    };
    authorize = async (url) => {
      const state = new URL(url).searchParams.get('state');
      return `https://abc.chromiumapp.org/?code=the-code&state=${state}`;
    };
    vi.stubGlobal('navigator', {
      locks: { request: async (_n: string, _o: unknown, cb: () => Promise<unknown>) => cb() },
    });
    vi.stubGlobal('chrome', {
      runtime: { id: 'abc' },
      storage: { local: store(local), session: store(session) },
      alarms,
      identity: {
        getRedirectURL: () => 'https://abc.chromiumapp.org/',
        launchWebAuthFlow: ({ url }: { url: string }, cb: (callbackUrl?: string) => void) =>
          void authorize(url).then(cb),
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/auth/v1/oauth/token')) {
          const form = new URLSearchParams(String(init?.body));
          server.tokenCalls.push(form);
          return form.get('grant_type') === 'authorization_code'
            ? tokenJson(jwt('person-1', 'first'), 'refresh-1')
            : server.refresh(form);
        }
        if (url.endsWith('/auth/v1/user')) {
          return new Response(
            JSON.stringify({ id: 'person-1', email: 'p@example.com', email_confirmed_at: 'x' }),
            { status: server.userStatus },
          );
        }
        return new Response(null, { status: 204 }); // logout
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('signs in: stores the session and profile, schedules the refresh alarm, serves the bearer', async () => {
    const flow = await import('@/lib/auth/flow');
    const result = await flow.signIn();
    expect(result).toMatchObject({ user: { id: 'person-1', email: 'p@example.com' } });
    expect(local.get('profile')).toMatchObject({ id: 'person-1' });
    expect(local.has('matrx.oauth.session')).toBe(true);
    expect(alarms.create).toHaveBeenCalledWith('token-refresh', { delayInMinutes: 50 });
    expect(await flow.getAccessToken()).toBe(jwt('person-1', 'first'));
    expect(await flow.getCurrentUser()).toMatchObject({ id: 'person-1' });
    // the refresh token is sealed at rest, never plaintext
    expect(JSON.stringify([...local.values()])).not.toContain('refresh-1');
  });

  it('does not replace an existing session when the new bearer cannot fetch a profile', async () => {
    const flow = await import('@/lib/auth/flow');
    await flow.signIn();
    server.userStatus = 401;
    await expect(flow.signIn()).rejects.toThrow('Failed to fetch Supabase user: 401');
    expect(await flow.getAccessToken()).toBe(jwt('person-1', 'first'));
  });

  it('refreshes a nominally-fresh bearer after that exact bearer received a 401', async () => {
    const flow = await import('@/lib/auth/flow');
    await flow.signIn();
    const rejected = jwt('person-1', 'first');
    await expect(flow.refreshAccessToken(rejected)).resolves.toEqual({
      access_token: jwt('person-1', 'refreshed'),
    });
    expect(server.tokenCalls.at(-1)?.get('grant_type')).toBe('refresh_token');
    expect(server.tokenCalls.at(-1)?.get('refresh_token')).toBe('refresh-1');
  });

  it('refreshes once for concurrent callers of an expired bearer', async () => {
    const flow = await import('@/lib/auth/flow');
    await flow.signIn();
    vi.setSystemTime(NOW + 2 * 3_600_000);
    const [a, b] = await Promise.all([flow.getAccessToken(), flow.getAccessToken()]);
    expect(a).toBe(b);
    expect(server.tokenCalls.filter((c) => c.get('grant_type') === 'refresh_token')).toHaveLength(
      1,
    );
  });

  it('broadcasts signed-out once, and clears profile and organization, after a terminal refusal', async () => {
    const flow = await import('@/lib/auth/flow');
    await flow.signIn();
    local.set('active-org', { id: 'o', name: 'o' });
    server.refresh = () =>
      new Response(JSON.stringify({ error: 'refresh_token_already_used' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    vi.setSystemTime(NOW + 2 * 3_600_000);
    expect(await flow.getAccessToken()).toBeNull();
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalledTimes(1));
    expect(broadcast.mock.calls[0]?.[1]).toMatchObject({
      user: null,
      reason: 'refresh_token_rejected',
    });
    expect(local.has('profile')).toBe(false);
    expect(local.has('active-org')).toBe(false);
    expect(await flow.getStoredAccessToken()).toBeNull();
  });

  it('does not commit a pending login after sign-out invalidates its attempt', async () => {
    const flow = await import('@/lib/auth/flow');
    let finish: (url: string) => void = () => undefined;
    let state = '';
    authorize = (url) => {
      state = new URL(url).searchParams.get('state') ?? '';
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    };
    const pending = flow.signIn();
    pending.catch(() => undefined);
    await vi.waitFor(() => expect(state).not.toBe(''));
    await flow.signOut();
    finish(`https://abc.chromiumapp.org/?code=c&state=${state}`);
    await expect(pending).rejects.toThrow('superseded');
    expect(await flow.getStoredAccessToken()).toBeNull();
  });

  it("refuses a callback whose state is not this attempt's", async () => {
    const flow = await import('@/lib/auth/flow');
    authorize = async () => 'https://abc.chromiumapp.org/?code=c&state=forged';
    await expect(flow.signIn()).rejects.toThrow('OAuth state mismatch');
    expect(server.tokenCalls).toHaveLength(0);
  });

  it('finishes a sign-in from the captured redirect after the context that started it was torn down (Safari)', async () => {
    let authorizeUrl = '';
    authorize = () => {
      throw new Error('unused');
    };
    // Context 1 shows the authorize URL, then dies: its opener promise never settles.
    const first = await import('@/lib/auth/flow');
    void first.signInWithOpener(async (url) => {
      authorizeUrl = url;
      return new Promise<string>(() => {});
    });
    await vi.waitFor(() => expect(authorizeUrl).not.toBe(''));
    const state = new URL(authorizeUrl).searchParams.get('state');

    // Context 2 (fresh module realm, same chrome.storage) catches the redirect.
    vi.resetModules();
    const second = await import('@/lib/auth/flow');
    const result = await second.completeSignInFromCallback(
      `https://abc.chromiumapp.org/?code=the-code&state=${state}`,
    );
    expect(result).toMatchObject({ user: { id: 'person-1' } });
    expect(local.get('profile')).toMatchObject({ id: 'person-1' });
    expect(await second.getAccessToken()).toBe(jwt('person-1', 'first'));
    expect(server.tokenCalls[0]?.get('grant_type')).toBe('authorization_code');
    // a second redirect for the same attempt has nothing left to finish
    await expect(
      second.completeSignInFromCallback(`https://abc.chromiumapp.org/?code=x&state=${state}`),
    ).rejects.toThrow('Please try again');
  });

  it('never builds a sign-in on a redirect captured before the identity API was ready', async () => {
    const identity = (globalThis as unknown as { chrome: { identity: unknown } }).chrome.identity;
    (globalThis as unknown as { chrome: { identity: unknown } }).chrome.identity = undefined;
    const flow = await import('@/lib/auth/flow');
    // a read-only call creates (and caches) the client before the identity API exists
    expect(await flow.getAccessToken()).toBeNull();
    (globalThis as unknown as { chrome: { identity: unknown } }).chrome.identity = identity;
    let authorizeUrl = '';
    authorize = async (url) => {
      authorizeUrl = url;
      return `https://abc.chromiumapp.org/?code=the-code&state=${new URL(url).searchParams.get('state')}`;
    };
    await flow.signIn();
    expect(new URL(authorizeUrl).searchParams.get('redirect_uri')).toBe(
      'https://abc.chromiumapp.org/',
    );
    expect(server.tokenCalls[0]?.get('redirect_uri')).toBe('https://abc.chromiumapp.org/');
  });
});
