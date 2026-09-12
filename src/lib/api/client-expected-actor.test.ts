import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  token: 'token-a',
  organizationId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000001',
  verified: null as Promise<void> | null,
  verificationStarted: null as (() => void) | null,
}));

vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://example.invalid' }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => state.token,
  refreshAccessToken: async () => null,
  getVerifiedCurrentUser: async () => {
    state.verificationStarted?.();
    await state.verified;
    return { id: state.userId };
  },
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => state.organizationId,
  OrganizationNotSelectedError: class OrganizationNotSelectedError extends Error {
    remedy = 'Choose an organization.';
  },
}));
vi.mock('@/lib/auth/guest-signature', () => ({ getOrCreateGuestSignature: async () => 'guest' }));
vi.mock('@/lib/debug/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/messaging/native', () => ({ broadcast: vi.fn() }));

import { apiPost } from './client';

const actor = {
  userId: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
};

describe('expectedActor transport binding', () => {
  it('strips authorization and organization aliases before fetch', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await apiPost('/api/vault/items', {}, undefined, {
      expectedActor: actor,
      headers: { authorization: 'Bearer attacker', 'x-organization-id': 'attacker', ACCEPT: 'text/plain' },
    });
    expect(result.ok).toBe(true);
    const headers = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]
      ?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-a');
    expect(headers['X-Organization-Id']).toBe(actor.organizationId);
    expect(Object.keys(headers).filter((name) => name.toLowerCase() === 'authorization')).toHaveLength(1);
    expect(Object.keys(headers).filter((name) => name.toLowerCase() === 'x-organization-id')).toHaveLength(1);
    expect(headers.ACCEPT).toBe('text/plain');
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
    await expect(pending).resolves.toMatchObject({ ok: false, status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
    state.token = 'token-a';
    state.organizationId = actor.organizationId;
    state.verified = null;
    state.verificationStarted = null;
  });
});
