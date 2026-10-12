import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  token: 'token-a',
  organizationId: '00000000-0000-4000-8000-000000000002' as string | null,
  userId: '00000000-0000-4000-8000-000000000001',
  verified: null as Promise<void> | null,
  verificationStarted: null as (() => void) | null,
  refresh: null as null | ((rejected?: string) => Promise<string | null>),
}));

vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://example.invalid' }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => state.token,
  getStoredAccessToken: async () => state.token,
  describeStoredSession: async () => ({
    hasAccessToken: false,
    expiresInMs: null,
    hasRefreshMaterial: true,
    hasOauthClientId: true,
  }),
  getCurrentUser: async () => ({ id: state.userId }),
  refreshAccessToken: async (rejected?: string) => (state.refresh ? state.refresh(rejected) : null),
  getVerifiedCurrentUser: async () => {
    state.verificationStarted?.();
    await state.verified;
    return { id: state.userId };
  },
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => state.organizationId,
  // The expectedActor path never holds — it binds the organization the caller
  // already pinned and fails closed when the live one stops matching. This
  // double would return the CURRENT organization if the hold were ever
  // reached, so a hold wired into that path would show up as a test that no
  // longer fails closed.
  requireActiveOrganizationId: async () => state.organizationId,
  isOrganizationNotSelectedError: (e: unknown) =>
    e instanceof Error && e.name === 'OrganizationNotSelectedError',
  isOrganizationNoMembershipsError: (e: unknown) =>
    e instanceof Error && e.name === 'OrganizationNoMembershipsError',
  OrganizationNotSelectedError: class OrganizationNotSelectedError extends Error {
    override name = 'OrganizationNotSelectedError';
    remedy = 'Choose an organization.';
  },
}));
vi.mock('@/lib/auth/guest-signature', () => ({ getOrCreateGuestSignature: async () => 'guest' }));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/messaging/native', () => ({ broadcast: vi.fn() }));

import { STATUS_EXPECTED_ACTOR_MISMATCH, apiPost } from './client';
import { runOp } from './matrx-api';

const pinnedOp = {
  m: 'POST',
  p: '/api/vault/items',
  d: 'aidream',
  a: 'user',
  o: 'required',
  n: 'test.pinned',
} as const;
const pinnedCall = () =>
  runOp((api, o) => api.call(pinnedOp, { body: {} }, o), { expectedActor: actor, silent: true });

const actor = {
  userId: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
};

describe('expectedActor transport binding', () => {
  it('strips authorization and organization aliases before fetch', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await apiPost('/api/vault/items', {}, undefined, {
      expectedActor: actor,
      headers: {
        authorization: 'Bearer attacker',
        'x-organization-id': 'attacker',
        ACCEPT: 'text/plain',
      },
    });
    expect(result.ok).toBe(true);
    const headers = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]
      ?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-a');
    expect(headers['X-Organization-Id']).toBe(actor.organizationId);
    expect(
      Object.keys(headers).filter((name) => name.toLowerCase() === 'authorization'),
    ).toHaveLength(1);
    expect(
      Object.keys(headers).filter((name) => name.toLowerCase() === 'x-organization-id'),
    ).toHaveLength(1);
    // The package wire owns Accept (case-insensitive): a caller's alias never doubles it.
    expect(Object.keys(headers).filter((name) => name.toLowerCase() === 'accept')).toHaveLength(1);
  });

  it('a 401 on a pinned call refreshes once, retries once with the fresh bearer, and a second 401 surfaces', async () => {
    const json = { 'content-type': 'application/json' };
    const refresh = vi.fn(async () => {
      state.token = 'token-fresh';
      return 'token-fresh';
    });
    state.refresh = refresh;
    const seen: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization as string;
      seen.push(auth);
      return auth === 'Bearer token-fresh'
        ? new Response('{"ok":true}', { headers: json })
        : new Response('{"detail":"expired"}', { status: 401, headers: json });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(pinnedCall()).resolves.toMatchObject({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['Bearer token-a', 'Bearer token-fresh']);

    // A second 401 is never retried again: it surfaces as the sign-in error.
    refresh.mockClear();
    state.token = 'token-a';
    const always401 = vi.fn(
      async () => new Response('{"detail":"expired"}', { status: 401, headers: json }),
    );
    vi.stubGlobal('fetch', always401);
    await expect(pinnedCall()).resolves.toMatchObject({ ok: false, status: 401 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(always401).toHaveBeenCalledTimes(2);

    // The pin still holds after a refresh: if the refreshed identity differs, no retry is sent.
    refresh.mockClear();
    state.token = 'token-a';
    state.refresh = async () => {
      state.token = 'token-other';
      state.organizationId = '00000000-0000-4000-8000-000000000003';
      return 'token-other';
    };
    const pinBroken = vi.fn(
      async () => new Response('{"detail":"expired"}', { status: 401, headers: json }),
    );
    vi.stubGlobal('fetch', pinBroken);
    await expect(pinnedCall()).resolves.toMatchObject({ ok: false, status: 401 });
    expect(pinBroken).toHaveBeenCalledTimes(1);
    state.refresh = null;
    state.token = 'token-a';
    state.organizationId = actor.organizationId;
  });

  it('does not dispatch when identity context changes during bearer verification', async () => {
    let release!: () => void;
    state.verified = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      state.verificationStarted = resolve;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const pending = apiPost('/api/vault/items', {}, undefined, { expectedActor: actor });
    await started;
    state.token = 'token-b';
    state.organizationId = '00000000-0000-4000-8000-000000000003';
    release();
    await expect(pending).resolves.toMatchObject({
      ok: false,
      status: STATUS_EXPECTED_ACTOR_MISMATCH,
      error: 'expected_actor_mismatch',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    state.token = 'token-a';
    state.organizationId = actor.organizationId;
    state.verified = null;
    state.verificationStarted = null;
  });

  it('refuses a malformed or missing organization before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    state.organizationId = 'not-a-uuid';
    await expect(apiPost('/api/vault/items', {})).resolves.toMatchObject({
      ok: false,
      status: -2,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    state.organizationId = null;
    await expect(apiPost('/api/vault/items', {})).resolves.toMatchObject({
      ok: false,
      status: -2,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    state.organizationId = actor.organizationId;
  });
});
