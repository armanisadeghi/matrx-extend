import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  authenticated: true,
  organizationId: '11111111-1111-4111-8111-111111111111' as string | null,
  organizationError: null as Error | null,
  filters: [] as [string, unknown][],
  reads: 0,
}));

vi.mock('@/lib/supabase/client', () => ({
  hasSupabaseAccessToken: async () => state.authenticated,
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => {
    if (state.organizationError) throw state.organizationError;
    return state.organizationId;
  },
}));
vi.mock('@/lib/supabase/schemas', () => ({
  docprocDb: () => {
    state.reads += 1;
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        state.filters.push([column, value]);
        return query;
      },
      in: () => query,
      is: () => query,
      order: () => query,
      limit: async () => {
        const selectedOrg = state.filters.find(([column]) => column === 'organization_id')?.[1];
        // The same URL exists in another RLS-visible organization. An unscoped
        // query would incorrectly recognise that Source in the current workspace.
        return {
          error: null,
          data:
            selectedOrg === '11111111-1111-4111-8111-111111111111'
              ? [
                  {
                    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                    canonical_identity: 'https://journal.harbor-dental.test/intake',
                    created_at: '2026-09-26T09:00:00Z',
                    name: 'Harbor Dental intake guide',
                  },
                ]
              : selectedOrg
                ? []
                : [
                    {
                      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                      canonical_identity: 'https://journal.harbor-dental.test/intake',
                      created_at: '2026-09-26T10:00:00Z',
                      name: 'Other workspace copy',
                    },
                  ],
        };
      },
    };
    return { from: () => query };
  },
}));

import { lookupCapturedByUrl } from './queries';

const URL = 'https://journal.harbor-dental.test/intake#requirements';

beforeEach(() => {
  state.authenticated = true;
  state.organizationId = '11111111-1111-4111-8111-111111111111';
  state.organizationError = null;
  state.filters = [];
  state.reads = 0;
});

describe('lookupCapturedByUrl organization boundary', () => {
  it('a guest has no saved Source and sends no query', async () => {
    state.authenticated = false;
    expect(await lookupCapturedByUrl(URL)).toEqual({ status: 'none' });
    expect(state.reads).toBe(0);
  });

  it('recognises only a Source in the selected organization', async () => {
    expect(await lookupCapturedByUrl(URL)).toMatchObject({
      status: 'found',
      page: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    });
    expect(state.filters).toContainEqual(['organization_id', state.organizationId]);

    state.organizationId = '22222222-2222-4222-8222-222222222222';
    state.filters = [];
    expect(await lookupCapturedByUrl(URL)).toEqual({ status: 'none' });
    expect(state.filters).toContainEqual(['organization_id', state.organizationId]);
  });

  it('reports an unknown result without querying when the device has no selected organization', async () => {
    state.organizationId = null;
    expect(await lookupCapturedByUrl(URL)).toMatchObject({
      status: 'unknown',
      cause: 'organization_unselected',
      reason: expect.stringMatching(/organization|workspace/i),
    });
    expect(state.reads).toBe(0);
  });

  it('reports an unknown result without querying when organization resolution fails', async () => {
    state.organizationError = new Error('membership read failed');
    expect(await lookupCapturedByUrl(URL)).toMatchObject({
      status: 'unknown',
      reason: expect.stringMatching(/could not|organization|workspace/i),
    });
    expect(state.reads).toBe(0);
  });
});
