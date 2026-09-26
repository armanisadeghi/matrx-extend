import { beforeEach, describe, expect, it, vi } from 'vitest';

const callbacks = vi.hoisted(() => ({
  committed: undefined as
    | ((details: { tabId: number; frameId: number; url: string }) => void)
    | undefined,
  removed: undefined as ((tabId: number) => void) | undefined,
  alarm: undefined as ((alarm: { name: string }) => void) | undefined,
  handlers: new Map<string, () => Promise<unknown>>(),
  complete: vi.fn(),
  broadcasts: [] as Array<{ kind: string; payload: unknown }>,
}));

vi.mock('@/lib/browser/detect', () => ({ BROWSER: 'safari' }));
vi.mock('@/lib/auth/flow', () => ({ completeBackgroundAuthorizationCode: callbacks.complete }));
vi.mock('@/config/env', () => ({
  ENV: {
    FRONTEND_URL: 'https://aimatrx.com',
    SUPABASE_URL: 'https://db.example.test',
    EXTENSION_OAUTH_CLIENT_ID: 'client',
    SAFARI_OAUTH_CLIENT_ID: 'safari-client',
  },
  STORAGE_KEYS: {
    PKCE_VERIFIER: 'pkce',
    SAFARI_AUTH_ATTEMPT: 'safari-attempt',
    SAFARI_AUTH_FAILURE: 'safari-failure',
  },
  ALARMS: { SAFARI_AUTH_TIMEOUT: 'safari-timeout' },
}));
vi.mock('@/lib/auth/pkce', () => ({
  generateCodeVerifier: () => 'verifier',
  generateCodeChallenge: async () => 'challenge',
  generateNonce: () => 'state',
}));
vi.mock('@/lib/auth/identity-transport', () => ({
  getSafariRedirectUri: () => 'https://www.aimatrx.com/auth/extension-callback',
}));
vi.mock('@/lib/supabase/queries', () => ({ checkIsAdmin: async () => true }));
vi.mock('@/lib/messaging/native', () => ({
  on: (kind: string, handler: () => Promise<unknown>) => callbacks.handlers.set(kind, handler),
  broadcast: (kind: string, payload: unknown) => callbacks.broadcasts.push({ kind, payload }),
}));
vi.mock('@/lib/debug/log', () => ({ log: { info: vi.fn(), warn: vi.fn() } }));

describe('Safari background OAuth tab transport', () => {
  const session = new Map<string, unknown>();
  const removed: number[] = [];
  beforeEach(async () => {
    vi.resetModules();
    callbacks.handlers.clear();
    callbacks.broadcasts.length = 0;
    callbacks.complete.mockReset();
    removed.length = 0;
    vi.stubGlobal('browser', undefined);
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          set: async (v: Record<string, unknown>) =>
            Object.entries(v).forEach(([k, x]) => session.set(k, x)),
          get: async (keys: string[]) =>
            Object.fromEntries(keys.filter((k) => session.has(k)).map((k) => [k, session.get(k)])),
          remove: async (keys: string[]) => keys.forEach((k) => session.delete(k)),
        },
      },
      tabs: {
        create: async () => ({ id: 44 }),
        update: vi.fn(),
        get: async () => ({ url: 'https://db.example.test/auth/v1/oauth/authorize' }),
        remove: async (id: number) => removed.push(id),
        onRemoved: { addListener: (f: typeof callbacks.removed) => (callbacks.removed = f) },
      },
      alarms: {
        create: vi.fn(),
        clear: async () => true,
        onAlarm: { addListener: (f: typeof callbacks.alarm) => (callbacks.alarm = f) },
      },
      webNavigation: {
        onCommitted: { addListener: (f: typeof callbacks.committed) => (callbacks.committed = f) },
      },
    });
    const { registerSafariAuthorizationBackground } = await import('@/lib/auth/safari-background');
    registerSafariAuthorizationBackground();
  });

  it('accepts only its owned exact callback after the popup is gone', async () => {
    await callbacks.handlers.get('auth:safari-start')?.();
    callbacks.complete.mockResolvedValue({ id: 'u', email: 'a@example.com' });
    callbacks.committed?.({
      tabId: 44,
      frameId: 0,
      url: 'https://www.aimatrx.com/auth/extension-callback?code=code&state=state',
    });
    await vi.waitFor(() =>
      expect(callbacks.complete).toHaveBeenCalledWith(
        expect.any(String),
        'state',
        'code',
        'https://www.aimatrx.com/auth/extension-callback',
        'safari-client',
      ),
    );
    expect(callbacks.broadcasts).toContainEqual(
      expect.objectContaining({ kind: 'auth:state-changed' }),
    );
  });

  it.each([
    ['wrong tab', 45, 'https://www.aimatrx.com/auth/extension-callback?code=x&state=state'],
    ['wrong origin', 44, 'https://evil.test/auth/extension-callback?code=x&state=state'],
    ['wrong path', 44, 'https://www.aimatrx.com/wrong?code=x&state=state'],
    ['wrong state', 44, 'https://www.aimatrx.com/auth/extension-callback?code=x&state=wrong'],
  ])('refuses %s without exchanging a code', async (_case, tabId, url) => {
    session.clear();
    await callbacks.handlers.get('auth:safari-start')?.();
    callbacks.committed?.({ tabId, frameId: 0, url });
    await vi.waitFor(() => expect(callbacks.complete).not.toHaveBeenCalled());
  });

  it('cleans its attempt when cancelled or timed out', async () => {
    await callbacks.handlers.get('auth:safari-start')?.();
    callbacks.removed?.(44);
    await vi.waitFor(() => expect(session.has('safari-attempt')).toBe(false));
    await callbacks.handlers.get('auth:safari-start')?.();
    callbacks.alarm?.({ name: 'safari-timeout' });
    await vi.waitFor(() => expect(session.has('safari-attempt')).toBe(false));
    expect(removed).toContain(44);
  });
});
