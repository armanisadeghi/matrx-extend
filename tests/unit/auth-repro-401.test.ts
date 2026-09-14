import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  token: 'access-a',
  refreshArguments: [] as Array<string | undefined>,
  broadcasts: [] as Array<{ kind: string; payload: unknown }>,
}));

vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://api.example.test' }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => state.token,
  getStoredAccessToken: async () => state.token,
  getVerifiedCurrentUser: async () => ({ id: 'user-a' }),
  refreshAccessToken: async (rejectedAccessToken?: string) => {
    state.refreshArguments.push(rejectedAccessToken);
    return { access_token: state.token };
  },
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => '00000000-0000-4000-8000-000000000002',
  OrganizationNotSelectedError: class OrganizationNotSelectedError extends Error {
    remedy = 'Choose an organization.';
  },
}));
vi.mock('@/lib/auth/guest-signature', () => ({ getOrCreateGuestSignature: async () => 'guest' }));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/messaging/native', () => ({
  broadcast: (kind: string, payload: unknown) => state.broadcasts.push({ kind, payload }),
}));

import { apiGet } from '@/lib/api/client';
import { CHANNELS } from '@/lib/messaging/schemas';

describe('late 401 auth invalidation reproduction', () => {
  beforeEach(() => {
    state.token = 'access-a';
    state.refreshArguments.length = 0;
    state.broadcasts.length = 0;
  });

  it('keeps a newer session when an older in-flight retry returns 401 late', async () => {
    let releaseSecond!: () => void;
    const secondMayReturn = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let secondStarted!: () => void;
    const secondWasDispatched = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) return new Response('old token', { status: 401 });
        secondStarted();
        await secondMayReturn;
        return new Response('retry token rejected', { status: 401 });
      }),
    );

    const request = apiGet('/api/example');
    await secondWasDispatched;
    state.token = 'access-new-sign-in';
    releaseSecond();
    await expect(request).resolves.toMatchObject({ ok: false, status: 401 });

    expect(state.refreshArguments).toEqual(['access-a']);

    expect(state.broadcasts).not.toContainEqual({
      kind: CHANNELS.AUTH_STATE_CHANGED,
      payload: { user: null, isAdmin: false, reason: 'unauthorized' },
    });
  });

  it('signs out the session when the rejected retry used the current bearer', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('expired token', { status: 401 }))
        .mockResolvedValueOnce(new Response('retry token rejected', { status: 401 })),
    );

    await expect(apiGet('/api/example')).resolves.toMatchObject({ ok: false, status: 401 });

    expect(state.broadcasts).toContainEqual({
      kind: CHANNELS.AUTH_STATE_CHANGED,
      payload: { user: null, isAdmin: false, reason: 'unauthorized' },
    });
  });
});
