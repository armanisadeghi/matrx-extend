import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The generated-operation path keeps THE GUEST-DOWNGRADE GUARD: a signed-in
 * install with no readable bearer is refused with STATUS_SESSION_NOT_READY and
 * nothing goes on the wire; a refreshed 401 retries once with the new bearer.
 */
const state = vi.hoisted(() => ({
  token: null as string | null,
  profile: null as { id: string } | null,
  refresh: vi.fn(async () => null as string | null),
}));
vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://example.invalid' }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => state.token,
  getCurrentUser: async () => state.profile,
  getStoredAccessToken: async () => state.token,
  getVerifiedCurrentUser: async () => state.profile,
  describeStoredSession: async () => ({}),
  refreshAccessToken: state.refresh,
}));
vi.mock('@/lib/auth/guest-signature', () => ({ getOrCreateGuestSignature: async () => 'guest' }));
vi.mock('@/lib/messaging/native', () => ({ broadcast: vi.fn() }));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => '00000000-0000-4000-8000-000000000002',
  requireActiveOrganizationId: async () => '00000000-0000-4000-8000-000000000002',
  OrganizationNotSelectedError: class extends Error {},
  isOrganizationNotSelectedError: () => false,
  isOrganizationNoMembershipsError: () => false,
}));

import { STATUS_INVALID_BODY, STATUS_SESSION_NOT_READY } from '@/lib/api/client';
import { createPackageApi, runOpAs } from '@/lib/api/matrx-api';
import { listComputeTargets } from '@ai-matrx/api/architecture';

afterEach(() => vi.unstubAllGlobals());

describe('runOp session rules', () => {
  it('refuses a signed-in session with no bearer instead of sending as a guest', async () => {
    state.token = null;
    state.profile = { id: 'user-1' };
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    const r = await runOpAs((api, o) => listComputeTargets(api, undefined, o));
    expect(r).toMatchObject({ ok: false, status: STATUS_SESSION_NOT_READY });
    expect(network).not.toHaveBeenCalled();
  }, 20_000);

  it('sends as a guest only when nobody is signed in', async () => {
    state.token = null;
    state.profile = null;
    const network = vi.fn(async (_u: unknown, init: RequestInit) => {
      expect(new Headers(init.headers).get('X-Fingerprint-ID')).toBe('guest');
      return Response.json([]);
    });
    vi.stubGlobal('fetch', network);
    expect(await runOpAs((api, o) => listComputeTargets(api, undefined, o))).toMatchObject({
      ok: true,
    });
  });

  it('refreshes once on 401 and retries with the new bearer', async () => {
    state.token = 'old';
    state.profile = { id: 'user-1' };
    state.refresh.mockImplementation(async () => {
      state.token = 'new';
      return 'new';
    });
    const seen: Array<string | null> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: unknown, init: RequestInit) => {
        seen.push(new Headers(init.headers).get('Authorization'));
        return seen.length === 1 ? new Response('expired', { status: 401 }) : Response.json([]);
      }),
    );
    expect(await runOpAs((api, o) => listComputeTargets(api, undefined, o))).toMatchObject({
      ok: true,
    });
    expect(seen).toEqual(['Bearer old', 'Bearer new']);
  });

  it('classifies a malformed successful JSON body as invalid body', async () => {
    state.token = null;
    state.profile = null;
    const network = vi.fn(
      async () =>
        new Response('{broken', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', network);

    expect(await runOpAs((api, o) => listComputeTargets(api, undefined, o))).toMatchObject({
      ok: false,
      status: STATUS_INVALID_BODY,
    });
    expect(network).toHaveBeenCalledOnce();
  });

  it('keeps a failed network request at status zero', async () => {
    state.token = null;
    state.profile = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect(await runOpAs((api, o) => listComputeTargets(api, undefined, o))).toMatchObject({
      ok: false,
      status: 0,
    });
  });
});

describe('package session injection', () => {
  it('hydrates confirmation before the final bearer read and preserves a per-item organization', async () => {
    const events: string[] = [];
    const api = createPackageApi('00000000-0000-4000-8000-000000000002', {
      bearer: async () => {
        events.push('bearer');
        return 'parent';
      },
      refresh: async () => false,
      headers: async () => {
        events.push('headers');
        return { 'X-Matrx-Step-Up': 'grant' };
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: RequestInit) => {
        events.push('wire');
        const headers = new Headers(init.headers);
        expect(headers.get('Authorization')).toBe('Bearer parent');
        expect(headers.get('X-Matrx-Step-Up')).toBe('grant');
        expect(headers.get('X-Organization-Id')).toBe('00000000-0000-4000-8000-000000000003');
        return Response.json([]);
      }),
    );
    await listComputeTargets(api, undefined, { organizationId: '00000000-0000-4000-8000-000000000003' });
    expect(events).toEqual(['bearer', 'headers', 'bearer', 'wire']);
  });

  it('sends nothing when identity changes while confirmation headers hydrate', async () => {
    let changed = false;
    const network = vi.fn();
    const api = createPackageApi('00000000-0000-4000-8000-000000000002', {
      bearer: async () => {
        if (changed) throw new Error('workspace changed');
        return 'parent';
      },
      refresh: async () => false,
      headers: async () => {
        changed = true;
        return { 'X-Matrx-Step-Up': 'old-grant' };
      },
    });
    vi.stubGlobal('fetch', network);
    await expect(listComputeTargets(api)).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });

  it('uses only the injected refresh and fresh pinned bearer on a 401', async () => {
    let token = 'old-parent';
    const refresh = vi.fn(async () => {
      token = 'fresh-parent';
      return true;
    });
    const seen: Array<string | null> = [];
    const api = createPackageApi('00000000-0000-4000-8000-000000000002', {
      bearer: async () => token,
      refresh,
      headers: async () => ({ 'X-Matrx-Step-Up': 'grant' }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: RequestInit) => {
        const headers = new Headers(init.headers);
        seen.push(headers.get('Authorization'));
        expect(headers.get('X-Matrx-Step-Up')).toBe('grant');
        return seen.length === 1 ? new Response('expired', { status: 401 }) : Response.json([]);
      }),
    );
    await listComputeTargets(api);
    expect(seen).toEqual(['Bearer old-parent', 'Bearer fresh-parent']);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
