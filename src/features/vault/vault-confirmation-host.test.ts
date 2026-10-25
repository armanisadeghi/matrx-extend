import { STORAGE_KEYS } from '@/config/env';
import type { Api } from '@ai-matrx/api';
import { primaryStepUpGrant, reveal } from '@ai-matrx/api/account';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmationParent, IsolatedConfirmationAuth } from './vault-confirmation';
import {
  type ParentSnapshotDeps,
  type VaultConfirmationHostDeps,
  VaultParentUnverifiableError,
  composeVaultConfirmationHost,
  listenForVaultAuthSessionChanges,
  readParentSnapshot,
} from './vault-confirmation-host';

const parent: ConfirmationParent = {
  userId: '1f82af75-fb56-4881-9721-3f0580e166a4',
  sessionId: 'session-harbor-dental',
  organizationId: 'f60ac767-0f56-4b4d-9c5a-73cc824bb54c',
  email: 'admin@admin.com',
  hasPassword: true,
};

function verified(
  overrides: Partial<{
    userId: string;
    sessionId: string;
    email: string | null;
    providers: string[];
  }> = {},
) {
  const userId = overrides.userId ?? parent.userId;
  const sessionId = overrides.sessionId ?? parent.sessionId;
  const email = overrides.email === undefined ? parent.email : overrides.email;
  const providers = overrides.providers ?? ['google', 'email'];
  return {
    status: 'verified' as const,
    user: { id: userId, email },
    claims: { sub: userId, session_id: sessionId, email, app_metadata: { providers } },
  };
}

function parentReadDeps(): ParentSnapshotDeps {
  return {
    accessToken: vi.fn(async () => 'parent-bearer-a'),
    storedAccessToken: vi.fn(async () => 'parent-bearer-a'),
    activeOrganizationId: vi.fn(async () => parent.organizationId),
    verify: vi.fn(async () => verified()),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('readParentSnapshot', () => {
  it('returns only verified metadata while keeping the stable bearer outside React state', async () => {
    const result = await readParentSnapshot(parentReadDeps());
    expect(result).toEqual({ parent, bearer: 'parent-bearer-a' });
  });

  it('uses the shared email-provider inference instead of treating an OAuth email as a password', async () => {
    const deps = parentReadDeps();
    deps.verify = vi.fn(async () => verified({ providers: ['google'] }));
    const result = await readParentSnapshot(deps);
    expect(result?.parent).toEqual({ ...parent, hasPassword: false });
  });

  it('distinguishes definitive invalidity from retryable verification uncertainty', async () => {
    const invalid = parentReadDeps();
    invalid.verify = vi.fn(async () => ({ status: 'invalid' as const, reason: 'expired' }));
    expect(await readParentSnapshot(invalid)).toBeNull();

    const uncertain = parentReadDeps();
    uncertain.verify = vi.fn(async () => ({
      status: 'unverifiable' as const,
      reason: 'JWKS offline',
    }));
    await expect(readParentSnapshot(uncertain)).rejects.toBeInstanceOf(
      VaultParentUnverifiableError,
    );
  });

  it.each([
    ['bearer', 'parent-bearer-b', parent.organizationId],
    ['organization', 'parent-bearer-a', 'f96c462f-107c-42a1-a035-aa292e80e40f'],
  ])('refuses a %s switch during the stable reread', async (_case, stored, finalOrg) => {
    const deps = parentReadDeps();
    deps.storedAccessToken = vi.fn(async () => stored);
    deps.activeOrganizationId = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(parent.organizationId)
      .mockResolvedValueOnce(finalOrg);
    await expect(readParentSnapshot(deps)).rejects.toThrow('changed while it was being checked');
  });
});

describe('listenForVaultAuthSessionChanges', () => {
  it('listens only for the canonical local OAuth row and removes the exact listener', () => {
    const onChange = vi.fn();
    const added = vi.spyOn(chrome.storage.onChanged, 'addListener');
    const removed = vi.spyOn(chrome.storage.onChanged, 'removeListener');
    const stop = listenForVaultAuthSessionChanges(onChange);
    const listener = added.mock.calls.at(-1)?.[0];
    expect(listener).toBeTypeOf('function');
    listener?.({ unrelated: { newValue: 1 } }, 'local');
    listener?.({ [STORAGE_KEYS.AUTH_SESSION]: { newValue: 'rotated' } }, 'session');
    expect(onChange).not.toHaveBeenCalled();
    listener?.({ [STORAGE_KEYS.AUTH_SESSION]: { newValue: 'rotated' } }, 'local');
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    expect(removed).toHaveBeenCalledWith(listener);
  });
});

function makeProofAuth(proofToken: string, events: string[]): IsolatedConfirmationAuth {
  return {
    async signInWithPassword() {
      events.push('proof');
      return {
        data: { user: { id: parent.userId }, session: { access_token: proofToken } },
        error: null,
      };
    },
    async signInWithOtp() {
      return { error: null };
    },
    async verifyOtp() {
      return {
        data: { user: { id: parent.userId }, session: { access_token: proofToken } },
        error: null,
      };
    },
    async signOut() {
      events.push('proof-logout');
      return { error: null };
    },
  };
}

function hostHarness() {
  let current = { parent, bearer: 'parent-bearer-a' };
  let cache: unknown;
  let proofCount = 0;
  const events: string[] = [];
  const sessions: Array<Parameters<VaultConfirmationHostDeps['api']>[1]> = [];
  const calls: Array<{
    path: string;
    args: unknown;
    bearer: string;
    headers: Record<string, string>;
  }> = [];
  const refresh = vi.fn(async () => ({ access_token: current.bearer }));
  const deps: VaultConfirmationHostDeps = {
    readSnapshot: vi.fn(async () => current),
    refresh,
    api: (_organizationId, session) => {
      sessions.push(session);
      return {
        async call(descriptor: { p: string }, args: unknown) {
          const headers =
            typeof session.headers === 'function'
              ? ((await session.headers()) ?? {})
              : (session.headers ?? {});
          const bearer = await session.bearer();
          calls.push({ path: descriptor.p, args, bearer, headers });
          if (descriptor.p === '/vault/step-up/primary') {
            return { grant: 'grant-fixed-deadline', expires_in: 1800 };
          }
          return {
            item_id: 'login-harbor-dental',
            field_key: 'password',
            value: 'opaque-value-not-logged',
          };
        },
      } as Api;
    },
    proofAuth: () => {
      proofCount += 1;
      return makeProofAuth(`isolated-proof-${proofCount}`, events);
    },
    issueGrant: (api, proofToken) =>
      primaryStepUpGrant(api, { body: { access_token: proofToken } }),
    cache: {
      read: async () => cache,
      write: async (value) => {
        expect(events.at(-1)).toBe('proof-logout');
        cache = value;
      },
      remove: async () => {
        cache = undefined;
      },
    },
    lock: async (work) => work(),
    cleanupFailed: vi.fn(),
  };
  return {
    deps,
    sessions,
    calls,
    events,
    refresh,
    proofCount: () => proofCount,
    cache: () => cache,
    setCurrent(next: { parent: ConfirmationParent; bearer: string }) {
      current = next;
    },
  };
}

describe('composeVaultConfirmationHost', () => {
  it('uses the generated grant operation with proof only in its body, then wires the grant header to reveal', async () => {
    const h = hostHarness();
    const host = composeVaultConfirmationHost(parent, h.deps);
    await host.identity.withPassword('not-recorded-by-the-host');
    await reveal(host.api, {
      path: { item_id: 'login-harbor-dental' },
      body: { field_key: 'password', organization_id: parent.organizationId },
    });

    expect(h.calls).toEqual([
      {
        path: '/vault/step-up/primary',
        args: { body: { access_token: 'isolated-proof-1' } },
        bearer: 'parent-bearer-a',
        headers: {},
      },
      {
        path: '/vault/items/{item_id}/reveal',
        args: {
          path: { item_id: 'login-harbor-dental' },
          body: { field_key: 'password', organization_id: parent.organizationId },
        },
        bearer: 'parent-bearer-a',
        headers: { 'X-Matrx-Step-Up': 'grant-fixed-deadline' },
      },
    ]);
    expect(h.events).toEqual(['proof', 'proof-logout']);
  });

  it('reuses one session cache across a fresh panel and preserves it through transient reads', async () => {
    const h = hostHarness();
    const first = composeVaultConfirmationHost(parent, h.deps);
    await first.identity.withPassword('not-recorded-by-the-host');
    first.dispose();

    const second = composeVaultConfirmationHost(parent, h.deps);
    expect(await second.identity.headers()).toEqual({
      'X-Matrx-Step-Up': 'grant-fixed-deadline',
    });
    h.deps.readSnapshot = vi.fn(async () => {
      throw new VaultParentUnverifiableError('JWKS offline');
    });
    await expect(second.identity.headers()).rejects.toThrow('JWKS offline');
    expect(h.cache()).toBeDefined();
    h.deps.readSnapshot = vi.fn(async () => ({ parent, bearer: 'parent-bearer-b' }));
    expect(await second.identity.headers()).toEqual({
      'X-Matrx-Step-Up': 'grant-fixed-deadline',
    });
    expect(h.proofCount()).toBe(1);
  });

  it('expires the fixed grant locally without opening another proof client', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    const h = hostHarness();
    const host = composeVaultConfirmationHost(parent, h.deps);
    await host.identity.withPassword('not-recorded-by-the-host');
    vi.advanceTimersByTime(1_800_001);
    expect(await host.identity.headers()).toEqual({});
    expect(h.cache()).toBeUndefined();
    expect(h.proofCount()).toBe(1);
  });

  it.each([
    ['actor', { ...parent, userId: '829cb697-f3a0-4bfe-ab7a-60b1dc260ae4' }],
    ['session', { ...parent, sessionId: 'session-harbor-dental-replaced' }],
    ['organization', { ...parent, organizationId: 'f96c462f-107c-42a1-a035-aa292e80e40f' }],
  ])(
    'refuses a %s switch during refresh and passes the rejected bearer to strict refresh',
    async (_case, changed) => {
      const h = hostHarness();
      let release!: () => void;
      h.deps.refresh = vi.fn(
        () =>
          new Promise<{ access_token: string }>((resolve) => {
            release = () => resolve({ access_token: 'parent-bearer-b' });
          }),
      );
      composeVaultConfirmationHost(parent, h.deps);
      const protectedSession = h.sessions[0];
      expect(await protectedSession?.bearer()).toBe('parent-bearer-a');
      const refreshing = protectedSession?.refresh();
      h.setCurrent({ parent: changed, bearer: 'parent-bearer-b' });
      release();
      await expect(refreshing).rejects.toThrow('account changed');
      expect(h.deps.refresh).toHaveBeenCalledWith('parent-bearer-a');
    },
  );
});
