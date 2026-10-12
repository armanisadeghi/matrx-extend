import { beforeEach, describe, expect, it, vi } from 'vitest';

const callbacks = vi.hoisted(() => ({
  committed: undefined as
    | ((details: { tabId: number; frameId: number; url: string }) => void)
    | undefined,
  removed: undefined as ((tabId: number) => void) | undefined,
  alarm: undefined as ((alarm: { name: string }) => void) | undefined,
  handlers: new Map<string, () => Promise<unknown>>(),
  complete: vi.fn(),
  completeFromCallback: vi.fn(),
  broadcasts: [] as Array<{ kind: string; payload: unknown }>,
}));

vi.mock('@/lib/browser/detect', () => ({ BROWSER: 'safari' }));
// The OAuth client (state, verifier, exchange) is the package's and has its own tests; here the
// fake sign-in only shows the tab to the opener and reports what callback URL it was handed.
vi.mock('@/lib/auth/flow', () => ({
  completeSignInFromCallback: async (url: string) => {
    callbacks.completeFromCallback(url);
    return { user: { id: 'u', email: 'a@example.com' } };
  },
  signInWithOpener: async (
    open: (url: string, ctx: { state: string; redirectUri: string }) => Promise<string>,
  ) => {
    const callbackUrl = await open('https://db.example.test/auth/v1/oauth/authorize?x=1', {
      state: 'state',
      redirectUri: 'https://www.aimatrx.com/auth/extension-callback',
    });
    callbacks.complete(callbackUrl);
    return { user: { id: 'u', email: 'a@example.com' } };
  },
}));
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
vi.mock('@/lib/supabase/queries', () => ({ checkIsAdmin: async () => true }));
vi.mock('@/lib/messaging/native', () => ({
  on: (kind: string, handler: () => Promise<unknown>) => callbacks.handlers.set(kind, handler),
  broadcast: (kind: string, payload: unknown) => callbacks.broadcasts.push({ kind, payload }),
}));
vi.mock('@/lib/debug/log', () => ({ log: { info: vi.fn(), warn: vi.fn() } }));

describe('Safari background OAuth tab transport', () => {
  const session = new Map<string, unknown>();
  const removed: number[] = [];
  let tabUrl = 'https://db.example.test/auth/v1/oauth/authorize';
  beforeEach(async () => {
    session.clear();
    vi.resetModules();
    callbacks.handlers.clear();
    callbacks.broadcasts.length = 0;
    callbacks.complete.mockReset();
    callbacks.completeFromCallback.mockReset();
    removed.length = 0;
    tabUrl = 'https://db.example.test/auth/v1/oauth/authorize';
    const setSession = async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) {
        session.set(key, value);
      }
    };
    const getSession = async (keys: string[]) => {
      const values: Record<string, unknown> = {};
      for (const key of keys) {
        if (session.has(key)) {
          values[key] = session.get(key);
        }
      }
      return values;
    };
    const removeSession = async (keys: string[]) => {
      for (const key of keys) {
        session.delete(key);
      }
    };
    const registerRemoved = (listener: typeof callbacks.removed) => {
      callbacks.removed = listener;
    };
    const registerAlarm = (listener: typeof callbacks.alarm) => {
      callbacks.alarm = listener;
    };
    const registerCommitted = (listener: typeof callbacks.committed) => {
      callbacks.committed = listener;
    };
    vi.stubGlobal('browser', undefined);
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          set: setSession,
          get: getSession,
          remove: removeSession,
        },
      },
      tabs: {
        create: async () => ({ id: 44 }),
        update: vi.fn(),
        get: async () => ({ url: tabUrl }),
        remove: async (id: number) => removed.push(id),
        onRemoved: { addListener: registerRemoved },
      },
      alarms: {
        create: vi.fn(),
        clear: async () => true,
        onAlarm: { addListener: registerAlarm },
      },
      webNavigation: {
        onCommitted: { addListener: registerCommitted },
      },
    });
    const { registerSafariAuthorizationBackground } = await import('@/lib/auth/safari-background');
    registerSafariAuthorizationBackground();
  });

  it('accepts only its owned exact callback after the popup is gone', async () => {
    await callbacks.handlers.get('auth:safari-start')?.();
    await vi.waitFor(() => expect(session.has('safari-attempt')).toBe(true));
    callbacks.committed?.({
      tabId: 44,
      frameId: 0,
      url: 'https://www.aimatrx.com/auth/extension-callback?code=code&state=state',
    });
    await vi.waitFor(() =>
      expect(callbacks.complete).toHaveBeenCalledWith(
        'https://www.aimatrx.com/auth/extension-callback?code=code&state=state',
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
    await callbacks.handlers.get('auth:safari-start')?.();
    await vi.waitFor(() => expect(session.has('safari-attempt')).toBe(true));
    callbacks.committed?.({ tabId, frameId: 0, url });
    await new Promise((r) => setTimeout(r, 20));
    expect(callbacks.complete).not.toHaveBeenCalled();
  });

  it('closes an owned authorization tab when cancelled', async () => {
    await callbacks.handlers.get('auth:safari-start')?.();
    await callbacks.handlers.get('auth:safari-cancel')?.();
    await vi.waitFor(() => expect(session.has('safari-attempt')).toBe(false));
    expect(removed).toContain(44);
  });

  it('preserves a repurposed tab while cancelling its attempt', async () => {
    await callbacks.handlers.get('auth:safari-start')?.();
    tabUrl = 'https://example.com/reused';
    await callbacks.handlers.get('auth:safari-cancel')?.();
    expect(removed).toHaveLength(0);
  });

  it('cleans its attempt on timeout without closing a tab the user may reuse', async () => {
    await callbacks.handlers.get('auth:safari-start')?.();
    callbacks.alarm?.({ name: 'safari-timeout' });
    await vi.waitFor(() => expect(session.has('safari-attempt')).toBe(false));
    expect(removed).toHaveLength(0);
  });

  it('keeps a matching attempt after a forged error and accepts its real callback', async () => {
    await callbacks.handlers.get('auth:safari-start')?.();
    await vi.waitFor(() => expect(session.has('safari-attempt')).toBe(true));
    callbacks.committed?.({
      tabId: 44,
      frameId: 0,
      url: 'https://www.aimatrx.com/auth/extension-callback?error=denied&state=wrong',
    });
    await vi.waitFor(() => expect(session.has('safari-attempt')).toBe(true));
    callbacks.committed?.({
      tabId: 44,
      frameId: 0,
      url: 'https://www.aimatrx.com/auth/extension-callback?code=code&state=state',
    });
    await vi.waitFor(() => expect(callbacks.complete).toHaveBeenCalledOnce());
  });

  it('finishes the sign-in from the captured redirect when the background context that started it was torn down', async () => {
    await callbacks.handlers.get('auth:safari-start')?.();
    await vi.waitFor(() => expect(session.has('safari-attempt')).toBe(true));
    // Torn down: a fresh module realm has no waiter for the attempt, only chrome.storage.session.
    vi.resetModules();
    const { registerSafariAuthorizationBackground } = await import('@/lib/auth/safari-background');
    registerSafariAuthorizationBackground();
    const url = 'https://www.aimatrx.com/auth/extension-callback?code=code&state=state';
    callbacks.committed?.({ tabId: 44, frameId: 0, url });
    await vi.waitFor(() => expect(callbacks.completeFromCallback).toHaveBeenCalledWith(url));
    await vi.waitFor(() =>
      expect(callbacks.broadcasts).toContainEqual(
        expect.objectContaining({ kind: 'auth:state-changed' }),
      ),
    );
    expect(callbacks.broadcasts).not.toContainEqual(expect.objectContaining({ kind: 'auth:safari-failed' }));
    expect(removed).toContain(44);
  });
});
