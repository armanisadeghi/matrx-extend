import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  userId: 'member',
  org: '11111111-1111-4111-8111-111111111111',
  memberships: true,
}));
vi.mock('@/config/env', () => ({
  ENV: {
    SUPABASE_URL: 'https://db.matrxserver.com',
    SUPABASE_PUBLISHABLE_KEY: 'publishable',
    FRONTEND_URL: 'https://aimatrx.com',
  },
  STORAGE_KEYS: { ACTIVE_ORGANIZATION: 'organization' },
}));
vi.mock('@/lib/auth/flow', async () => {
  const { fakeOAuthClient } = await import('../../../tests/helpers/fake-organizations-db');
  return {
    getOAuthClient: () => fakeOAuthClient(() => state.userId),
    getCurrentUser: async () => (state.userId ? { id: state.userId } : null),
    getStoredAccessToken: async () => {
      const stored = await chrome.storage.local.get(['token']);
      return typeof stored.token === 'string' ? stored.token : null;
    },
  };
});
vi.mock('@/lib/debug/log', () => ({ log: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/state/notices', () => ({ pushNotice: vi.fn() }));

let outgoing: Request[];
beforeEach(async () => {
  vi.resetModules();
  outgoing = [];
  state.memberships = true;
  state.userId = 'member';
  state.org = '11111111-1111-4111-8111-111111111111';
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ token: 'member-access-token' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      outgoing.push(request);
      const path = new URL(request.url).pathname;
      const rows = path.endsWith('/rpc/mbr_for_user')
        ? state.memberships
          ? [{ container_id: state.org, status: 'active' }]
          : []
        : path.endsWith('/organizations')
          ? [{ id: state.org, name: 'Cedar furnishings' }]
          : path.endsWith('/user_preferences')
            ? { last_active_organization_id: state.org }
            : path.endsWith('/wbx_pattern') && request.method === 'POST'
              ? { id: 'saved-pattern' }
              : [];
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

/** Exercise adversarial HTTP inputs at the final boundary; application reads/writes above use the SDK. */
async function sendBoundary(
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const { organizationFetch } = await import('./organization-fetch');
  return organizationFetch(`https://db.matrxserver.com/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer member-access-token',
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('Supabase outgoing organization boundary (real SDK and resolver)', () => {
  it.each(['getSupabase', 'getAgentAuthoredSupabase', 'getMachineryAuthoredSupabase'] as const)(
    '%s sends the captured write organization even after the active organization changes',
    async (channel) => {
      const clients = await import('./client');
      const captured = state.org;
      state.org = '22222222-2222-4222-8222-222222222222';
      const { error } = await clients[channel]().functions.invoke('organization-probe', {
        body: { organization_id: captured, name: 'Cedar chairs' },
      });
      expect(error).toBeNull();
      const request = outgoing.find((r) => r.url.endsWith('/organization-probe'));
      if (!request) throw new Error('Pattern write never reached fetch');
      expect(request.headers.get('X-Organization-Id')).toBe(captured);
      expect((await request.json()).organization_id).toBe(request.headers.get('X-Organization-Id'));
      expect(request.headers.get('x-matrx-actor-system')).toBe(
        channel === 'getSupabase'
          ? null
          : channel === 'getAgentAuthoredSupabase'
            ? 'matrx-extend:agent'
            : 'matrx-extend:scheduler',
      );
      expect(request.headers.get('x-matrx-actor-tier')).toBe(
        channel === 'getSupabase'
          ? null
          : channel === 'getAgentAuthoredSupabase'
            ? 'agent'
            : 'system',
      );
    },
  );

  it('preserves the Data Save caller body through the real query and SDK', async () => {
    const { savePattern } = await import('./queries');
    const captured = state.org;
    state.org = '22222222-2222-4222-8222-222222222222';
    const saved = await savePattern({
      authored_by: 'person',
      organization_id: captured,
      name: 'Cedar dining chairs',
      domain: 'furnishings.example.com',
      route_pattern: '/chairs',
      list_root_selector: '.product-card',
      fields: [],
    });
    expect(saved).toEqual({ id: 'saved-pattern' });
    const request = outgoing.find((r) => new URL(r.url).pathname.endsWith('/wbx_pattern'));
    if (!request) throw new Error('Data Save never reached fetch');
    expect(request.headers.get('X-Organization-Id')).toBe(captured);
    expect((await request.json()).organization_id).toBe(captured);
  });

  it('resolves first-load membership before attaching the organization to the ordinary read', async () => {
    const { fetchPatternsForDomain } = await import('./queries');
    await fetchPatternsForDomain('furnishings.example.com');
    const request = outgoing.find((r) => new URL(r.url).pathname.endsWith('/wbx_pattern'));
    if (!request) throw new Error('Pattern read never reached fetch');
    expect(request.headers.get('X-Organization-Id')).toBe(state.org);
    expect(outgoing.map((r) => new URL(r.url).pathname.split('/').slice(-1)[0])).toEqual([
      'mbr_for_user',
      'organizations',
      'user_preferences',
      'wbx_pattern',
    ]);
    expect(outgoing.slice(0, 3).map((r) => r.headers.get('X-Organization-Id'))).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('keeps anonymous catalog reads independent of organization resolution', async () => {
    state.userId = '';
    await chrome.storage.local.remove('token');
    const { fetchPatternsForDomain } = await import('./queries');
    await fetchPatternsForDomain('furnishings.example.com');
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]?.headers.get('X-Organization-Id')).toBeNull();
  });
  it('carries the captured RPC write organization', async () => {
    const captured = state.org;
    state.org = '22222222-2222-4222-8222-222222222222';
    await sendBoundary('rpc/create_agent_task', { p_organization_id: captured });
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]?.headers.get('X-Organization-Id')).toBe(captured);
    expect((await outgoing[0]?.json())?.p_organization_id).toBe(captured);
  });

  it.each([
    { organization_id: 'one', p_organization_id: 'two' },
    [{ organization_id: 'one' }, { organization_id: 'two' }],
  ])('refuses conflicting explicit organizations before network I/O: %j', async (body) => {
    await expect(sendBoundary('wbx_pattern', body)).rejects.toThrow('conflicting organizations');
    expect(outgoing).toHaveLength(0);
  });

  it('does not infer organization context from nested user data', async () => {
    await sendBoundary('rpc/store_content', { metadata: { organization_id: 'incidental' } });
    expect(outgoing.at(-1)?.headers.get('X-Organization-Id')).toBe(state.org);
  });

  it('adds the cached verified organization to later bootstrap reads', async () => {
    const { fetchPatternsForDomain } = await import('./queries');
    const { listMemberOrganizations } = await import('@/lib/org/active-org');
    await fetchPatternsForDomain('furnishings.example.com');
    outgoing = [];
    await listMemberOrganizations();
    expect(outgoing.map((r) => r.headers.get('X-Organization-Id'))).toEqual([state.org, state.org]);
  });

  it.each(['body', 'profile', 'select', 'filter', 'path'] as const)(
    'does not extend the bootstrap exception to a changed %s',
    async (change) => {
      const path =
        change === 'path'
          ? 'other_organizations'
          : change === 'select'
            ? 'user_preferences'
            : change === 'filter'
              ? 'organizations'
              : 'rpc/mbr_for_user';
      const body =
        change === 'body' ? { p_container_type: 'organization', extra: true } : undefined;
      const headers = change === 'profile' ? { 'Accept-Profile': 'iam' } : {};
      const query = change === 'select' ? '?select=*' : change === 'filter' ? '?id=eq.member' : '';
      await sendBoundary(path + query, body, headers);
      expect(outgoing).toHaveLength(4);
      expect(outgoing.at(-1)?.headers.get('X-Organization-Id')).toBe(state.org);
    },
  );

  it('requires resolution for ordinary requests identical to the membership bootstrap', async () => {
    const { call, createDb } = await import('@ai-matrx/data/db');
    const { getSupabase } = await import('./client');
    await call(
      createDb({ client: getSupabase() }),
      { schema: 'public', name: 'mbr_for_user', roles: ['authenticated'], registered: true },
      { p_container_type: 'organization' },
    );
    expect(outgoing).toHaveLength(4);
    // The ordinary RPC uses the same real SDK endpoint and body as bootstrap,
    // but only the private bootstrap client may send it before resolution.
    // (the package's membership read pages the same RPC, so only the query string differs)
    expect(new URL(outgoing.at(-1)!.url).pathname).toBe(new URL(outgoing[0]!.url).pathname);
    expect(await outgoing.at(-1)?.clone().json()).toEqual(await outgoing[0]?.clone().json());
    expect(outgoing[0]?.headers.get('X-Organization-Id')).toBeNull();
    expect(outgoing.at(-1)?.headers.get('X-Organization-Id')).toBe(state.org);
  });

  it('refuses ordinary authenticated reads with zero memberships', async () => {
    state.memberships = false;
    const { fetchPatternsForDomain } = await import('./queries');
    await expect(fetchPatternsForDomain('furnishings.example.com')).rejects.toThrow(
      'do not belong to any organization',
    );
    expect(outgoing.some((r) => new URL(r.url).pathname.endsWith('/wbx_pattern'))).toBe(false);
  });
});
