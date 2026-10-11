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
  STORAGE_KEYS: { ACCESS_TOKEN: 'token', ACTIVE_ORGANIZATION: 'organization' },
}));
vi.mock('@/lib/auth/flow', () => ({
  getCurrentUser: async () => (state.userId ? { id: state.userId } : null),
}));
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

describe('Supabase outgoing organization boundary (real SDK and resolver)', () => {
  it.each(['getSupabase', 'getAgentAuthoredSupabase', 'getMachineryAuthoredSupabase'] as const)(
    '%s sends the captured write organization even after the active organization changes',
    async (channel) => {
      const clients = await import('./client');
      const captured = state.org;
      state.org = '22222222-2222-4222-8222-222222222222';
      const { error } = await clients[channel]()
        .schema('extend')
        .from('wbx_pattern')
        .insert({ organization_id: captured, name: 'Cedar chairs' });
      expect(error).toBeNull();
      const request = outgoing.find((r) => r.url.endsWith('/wbx_pattern'));
      if (!request) throw new Error('Pattern write never reached fetch');
      expect(request.headers.get('X-Organization-Id')).toBe(captured);
      expect((await request.json()).organization_id).toBe(request.headers.get('X-Organization-Id'));
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
    const { getSupabase } = await import('./client');
    const { error } = await getSupabase().schema('extend').from('wbx_pattern').select('id');
    expect(error).toBeNull();
    const request = outgoing.find((r) => new URL(r.url).pathname.endsWith('/wbx_pattern'));
    if (!request) throw new Error('Pattern read never reached fetch');
    expect(request.headers.get('X-Organization-Id')).toBe(state.org);
    expect(outgoing.map((r) => new URL(r.url).pathname)).toEqual([
      '/rest/v1/rpc/mbr_for_user',
      '/rest/v1/organizations',
      '/rest/v1/user_preferences',
      '/rest/v1/wbx_pattern',
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
    const { getSupabase } = await import('./client');
    const { error } = await getSupabase().schema('extend').from('wbx_recipe').select('id');
    expect(error).toBeNull();
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]?.headers.get('X-Organization-Id')).toBeNull();
  });
  it('carries the captured RPC write organization', async () => {
    const { getMachineryAuthoredSupabase } = await import('./client');
    const captured = state.org;
    state.org = '22222222-2222-4222-8222-222222222222';
    await getMachineryAuthoredSupabase().rpc('create_agent_task', { p_organization_id: captured });
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]?.headers.get('X-Organization-Id')).toBe(captured);
    expect((await outgoing[0]?.json())?.p_organization_id).toBe(captured);
  });

  it.each([
    { organization_id: 'one', p_organization_id: 'two' },
    [{ organization_id: 'one' }, { organization_id: 'two' }],
  ])('refuses conflicting explicit organizations before network I/O: %j', async (body) => {
    const { getSupabase } = await import('./client');
    const { error } = await getSupabase().schema('extend').from('wbx_pattern').insert(body);
    expect(error?.message).toContain('conflicting organizations');
    expect(outgoing).toHaveLength(0);
  });

  it('does not infer organization context from nested user data', async () => {
    const { getSupabase } = await import('./client');
    await getSupabase().rpc('store_content', { metadata: { organization_id: 'incidental' } });
    expect(outgoing.at(-1)?.headers.get('X-Organization-Id')).toBe(state.org);
  });

  it('adds the cached verified organization to later bootstrap reads', async () => {
    const { getSupabase } = await import('./client');
    const { listMemberOrganizations } = await import('@/lib/org/active-org');
    await getSupabase().schema('extend').from('wbx_pattern').select('id');
    outgoing = [];
    await listMemberOrganizations();
    expect(outgoing.map((r) => r.headers.get('X-Organization-Id'))).toEqual([state.org, state.org]);
  });

  it.each(['body', 'profile', 'select', 'filter', 'path'] as const)(
    'does not extend the bootstrap exception to a changed %s',
    async (change) => {
      const { getSupabase } = await import('./client');
      const client = getSupabase();
      if (change === 'body')
        await client.rpc('mbr_for_user', { p_container_type: 'organization', extra: true });
      if (change === 'profile')
        await client.schema('iam').rpc('mbr_for_user', { p_container_type: 'organization' });
      if (change === 'select')
        await client.schema('users').from('user_preferences').select('*').eq('user_id', 'member');
      if (change === 'filter')
        await client.schema('iam').from('organizations').select('id,name,archived_at');
      if (change === 'path')
        await client
          .schema('iam')
          .from('other_organizations')
          .select('id,name,archived_at')
          .in('id', [state.org]);
      expect(outgoing).toHaveLength(4);
      expect(outgoing.at(-1)?.headers.get('X-Organization-Id')).toBe(state.org);
    },
  );

  it('requires resolution for ordinary requests identical to the membership bootstrap', async () => {
    const { getSupabase } = await import('./client');
    await getSupabase().rpc('mbr_for_user', { p_container_type: 'organization' });
    expect(outgoing).toHaveLength(4);
    expect(outgoing.at(-1)?.headers.get('X-Organization-Id')).toBe(state.org);
  });

  it('refuses ordinary authenticated reads with zero memberships', async () => {
    state.memberships = false;
    const { getSupabase } = await import('./client');
    const { error } = await getSupabase().schema('extend').from('wbx_pattern').select('id');
    expect(error?.message).toContain('do not belong to any organization');
    expect(outgoing.some((r) => new URL(r.url).pathname.endsWith('/wbx_pattern'))).toBe(false);
  });
});
