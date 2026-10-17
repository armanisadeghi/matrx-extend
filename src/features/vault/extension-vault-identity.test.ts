import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/flow', () => ({
  getStoredAccessToken: vi.fn(),
  restoreSupabaseSession: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock('@/lib/messaging/native', () => ({ broadcast: vi.fn(), on: vi.fn(() => () => undefined) }));

import { authenticatedAt, createExtensionVaultIdentity } from './extension-vault-identity';

const ME = '87a6e699-3622-4869-8843-d0867456c0dd';
const SOMEONE_ELSE = '11111111-2222-3333-4444-555555555555';

/** An unsigned JWT with the claims the identity reads (the real shape the OAuth exchange mints). */
function jwt(sub: string, authAt: number, iat = authAt): string {
  const enc = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'ES256' })}.${enc({
    sub,
    iat,
    amr: [{ method: 'oauth_provider/authorization_code', timestamp: authAt }],
  })}.sig`;
}

afterEach(() => vi.useRealTimers());

describe('extensionVaultIdentity', () => {
  it('reads the newest amr timestamp, not iat (a refreshed token keeps an old amr)', () => {
    const [, payload] = jwt(ME, 1000, 5000).split('.');
    expect(
      authenticatedAt(JSON.parse(atob((payload ?? '').replace(/-/g, '+').replace(/_/g, '/')))),
    ).toBe(1000);
  });

  it('offers only the browser sign-in', async () => {
    const identity = createExtensionVaultIdentity({
      readToken: async () => jwt(ME, 1000),
      signIn: async () => undefined,
    });
    await expect(identity.account()).resolves.toEqual({
      email: null,
      providers: ['browser'],
      hasPassword: false,
    });
    await expect(identity.withPassword('x')).rejects.toThrow('browser');
    await expect(identity.sendEmailCode()).rejects.toThrow('browser');
  });

  it('resolves only once a token for the same person with a FRESH amr is stored', async () => {
    vi.useFakeTimers();
    let stored = jwt(ME, 1000);
    const onFresh = vi.fn();
    let finishSignIn: () => void = () => undefined;
    const identity = createExtensionVaultIdentity({
      readToken: async () => stored,
      // Safari-shaped: the sign-in call returns before any token lands.
      signIn: () =>
        new Promise<void>((r) => {
          finishSignIn = r;
        }),
      onFresh,
      pollMs: 100,
    });
    let settled = false;
    const done = identity.withProvider('browser').then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    // A refreshed bearer for the same person (new iat, same old amr) is NOT a confirmation.
    stored = jwt(ME, 1000, 9000);
    finishSignIn();
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBe(false);
    expect(onFresh).not.toHaveBeenCalled();

    stored = jwt(ME, 2000);
    await vi.advanceTimersByTimeAsync(150);
    await done;
    expect(settled).toBe(true);
    expect(onFresh).toHaveBeenCalledOnce();
  });

  it('rejects when the sign-in lands a different person, and says so to every surface', async () => {
    let stored = jwt(ME, 1000);
    const onDifferentPerson = vi.fn();
    const identity = createExtensionVaultIdentity({
      readToken: async () => stored,
      signIn: async () => {
        stored = jwt(SOMEONE_ELSE, 2000);
      },
      onDifferentPerson,
      pollMs: 10,
    });
    await expect(identity.withProvider('browser')).rejects.toThrow('different account');
    expect(onDifferentPerson).toHaveBeenCalledOnce();
  });

  it('passes a cancelled sign-in through instead of waiting', async () => {
    const identity = createExtensionVaultIdentity({
      readToken: async () => jwt(ME, 1000),
      signIn: async () => {
        throw new Error('OAuth flow cancelled or returned no URL');
      },
    });
    await expect(identity.withProvider('browser')).rejects.toThrow('cancelled');
  });

  it('refuses when nobody is signed in', async () => {
    const signIn = vi.fn();
    const identity = createExtensionVaultIdentity({ readToken: async () => null, signIn });
    await expect(identity.withProvider('browser')).rejects.toThrow('signed out');
    expect(signIn).not.toHaveBeenCalled();
  });
});
