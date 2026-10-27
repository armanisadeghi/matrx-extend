import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebLocks } from '../../../tests/helpers/web-locks';
import type { ConfirmationParent, IsolatedConfirmationAuth } from './vault-confirmation';

const actor: ConfirmationParent = {
  userId: '1f82af75-fb56-4881-9721-3f0580e166a4',
  sessionId: 'session-harbor-dental',
  organizationId: 'f60ac767-0f56-4b4d-9c5a-73cc824bb54c',
  email: 'admin@admin.com',
  hasPassword: true,
};

const boundary = vi.hoisted(() => ({
  createClient: vi.fn(),
  token: 'parent-oauth-bearer',
}));

vi.mock('@ai-matrx/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ai-matrx/auth')>()),
  createAuthClient: boundary.createClient,
}));
vi.mock('@/config/env', () => ({
  ENV: {
    SUPABASE_URL: 'https://db.example.test',
    SUPABASE_PUBLISHABLE_KEY: 'publishable',
  },
  STORAGE_KEYS: { AUTH_SESSION: 'matrx.oauth.session' },
}));
vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://server.example.test' }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessTokenStrict: async () => boundary.token,
  getStoredAccessToken: async () => boundary.token,
  refreshAccessTokenStrict: async () => ({ access_token: boundary.token }),
  getAccessToken: async () => boundary.token,
  getVerifiedCurrentUser: async () => ({ id: actor.userId }),
  refreshAccessToken: async () => ({ access_token: boundary.token }),
}));
vi.mock('@/lib/auth/verify-claims', () => ({
  verifyBearerClaims: async () => ({
    status: 'verified',
    user: { id: actor.userId, email: actor.email },
    claims: {
      sub: actor.userId,
      session_id: actor.sessionId,
      email: actor.email,
      app_metadata: { providers: ['email'] },
    },
  }),
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => actor.organizationId,
  requireActiveOrganizationId: async () => actor.organizationId,
  OrganizationNotSelectedError: class extends Error {},
  isOrganizationNotSelectedError: () => false,
  isOrganizationNoMembershipsError: () => false,
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/messaging/native', () => ({ broadcast: vi.fn() }));

import { createVaultConfirmationHost } from './vault-confirmation-host';

function sessionStorage() {
  const values = new Map<string, unknown>();
  return {
    values,
    area: {
      async get(keys: string[] | string) {
        const requested = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          requested.filter((key) => values.has(key)).map((key) => [key, values.get(key)]),
        );
      },
      async set(next: Record<string, unknown>) {
        for (const [key, value] of Object.entries(next)) values.set(key, value);
      },
      async remove(keys: string[] | string) {
        for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
      },
    },
  };
}

function proofClient(proofToken: string): IsolatedConfirmationAuth {
  return {
    async signInWithPassword() {
      return {
        data: { user: { id: actor.userId }, session: { access_token: proofToken } },
        error: null,
      };
    },
    async signInWithOtp() {
      return { error: null };
    },
    async verifyOtp() {
      return {
        data: { user: { id: actor.userId }, session: { access_token: proofToken } },
        error: null,
      };
    },
    async signOut() {
      return { error: null };
    },
  };
}

describe('production Vault confirmation adapters', () => {
  let storage: ReturnType<typeof sessionStorage>;
  let lockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage = sessionStorage();
    const locks = createWebLocks();
    lockRequest = vi.fn(locks.request.bind(locks));
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: lockRequest },
    });
    vi.stubGlobal('chrome', { storage: { session: storage.area } });
    boundary.createClient.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a fresh non-persisting proof client per attempt and reuses its session-cache grant in a fresh host', async () => {
    const proofClients = [proofClient('isolated-proof-one'), proofClient('isolated-proof-two')];
    const [firstProof, secondProof] = proofClients;
    if (!firstProof || !secondProof) throw new Error('proof fixtures missing');
    const firstSignOut = vi.spyOn(firstProof, 'signOut');
    const secondSignOut = vi.spyOn(secondProof, 'signOut');
    boundary.createClient
      .mockReturnValueOnce({ auth: firstProof })
      .mockReturnValueOnce({ auth: secondProof });
    const wire: Array<{
      body: unknown;
      authorization: string | null;
      organization: string | null;
      confirmation: string | null;
    }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: RequestInit) => {
        const headers = new Headers(init.headers);
        wire.push({
          body: JSON.parse(String(init.body)),
          authorization: headers.get('Authorization'),
          organization: headers.get('X-Organization-Id'),
          confirmation: headers.get('X-Matrx-Step-Up'),
        });
        return Response.json({ grant: `grant-${wire.length}`, expires_in: 1800 });
      }),
    );

    const first = createVaultConfirmationHost(actor);
    await first.identity.withPassword('not-retained');
    first.dispose();
    const second = createVaultConfirmationHost(actor);
    expect(await second.identity.headers()).toEqual({ 'X-Matrx-Step-Up': 'grant-1' });
    await second.identity.withPassword('also-not-retained');

    expect(boundary.createClient).toHaveBeenCalledTimes(2);
    expect(firstSignOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(secondSignOut).toHaveBeenCalledWith({ scope: 'local' });
    for (const call of boundary.createClient.mock.calls) {
      expect(call[0]).toMatchObject({ persist: false, detectSessionInUrl: false });
    }
    expect(wire).toEqual([
      {
        body: { access_token: 'isolated-proof-one' },
        authorization: 'Bearer parent-oauth-bearer',
        organization: actor.organizationId,
        confirmation: null,
      },
      {
        body: { access_token: 'isolated-proof-two' },
        authorization: 'Bearer parent-oauth-bearer',
        organization: actor.organizationId,
        confirmation: null,
      },
    ]);
    expect([...storage.values]).toEqual([
      [
        'matrx.vault.primary-confirmation.v1',
        expect.objectContaining({
          userId: actor.userId,
          sessionId: actor.sessionId,
          organizationId: actor.organizationId,
          grant: 'grant-2',
        }),
      ],
    ]);
  });

  it('serializes real session-cache reads under the one named exclusive Web Lock', async () => {
    await storage.area.set({
      'matrx.vault.primary-confirmation.v1': {
        id: 'cached-grant',
        userId: actor.userId,
        sessionId: actor.sessionId,
        organizationId: actor.organizationId,
        grant: 'grant-shared-across-panels',
        expiresAtMs: Date.now() + 60_000,
      },
    });
    const originalGet = storage.area.get;
    let started = 0;
    let releaseFirst!: () => void;
    storage.area.get = vi.fn(async (keys: string[] | string) => {
      started += 1;
      if (started === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return originalGet(keys);
    });
    const first = createVaultConfirmationHost(actor);
    const second = createVaultConfirmationHost(actor);
    const firstRead = first.identity.headers();
    const secondRead = second.identity.headers();
    await vi.waitFor(() => expect(started).toBe(1), { timeout: 200 });
    releaseFirst();

    await expect(Promise.all([firstRead, secondRead])).resolves.toEqual([
      { 'X-Matrx-Step-Up': 'grant-shared-across-panels' },
      { 'X-Matrx-Step-Up': 'grant-shared-across-panels' },
    ]);
    expect(started).toBe(2);
    expect(lockRequest).toHaveBeenCalledTimes(2);
    for (const call of lockRequest.mock.calls) {
      expect(call[0]).toBe('matrx:vault:primary-confirmation');
      expect(call[1]).toEqual({ mode: 'exclusive' });
    }
  });
});
