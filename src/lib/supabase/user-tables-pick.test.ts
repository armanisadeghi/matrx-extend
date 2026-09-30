import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const ORG_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';
const T_A = '11111111-1111-4111-8111-111111111111';
const T_B = '22222222-2222-4222-8222-222222222222';

const h = vi.hoisted(() => ({
  clientOrgs: [] as string[],
  older: [] as Record<string, unknown>[],
  storeByOrg: new Map<string, { id: string; table_name: string; organization_id: string }[]>(),
}));

vi.mock('@/lib/org/active-org', () => ({
  // The ACTIVE organization is deliberately absent from this mock: the picker must never ask.
  listMemberOrganizations: async () => [
    { id: ORG_A, name: 'A' },
    { id: ORG_B, name: 'B' },
  ],
}));
vi.mock('@/lib/records/store', () => ({
  recordsClientFor: async (org: string) => {
    h.clientOrgs.push(org);
    return { org };
  },
}));
vi.mock('@/lib/records/tables', () => ({
  storeTables: async (client: { org: string }) => h.storeByOrg.get(client.org) ?? [],
  tablesLiveWhere: async (_c: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, 'record' as const])),
  tableLivesWhere: async () => 'record',
  tablesLiveIn: async () => 'record',
  declareStoreTable: vi.fn(),
  appendStoreRows: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({}) }));
vi.mock('@/lib/supabase/schemas', () => ({
  workbenchDb: () => ({
    from: () => ({
      select: () => ({
        order: () => ({ order: async () => ({ data: h.older, error: null }) }),
      }),
    }),
  }),
}));

import { listPickableTables } from './user-tables';

describe('listPickableTables: the active organization never narrows the picker', () => {
  beforeEach(() => {
    h.clientOrgs = [];
    h.older = [];
    h.storeByOrg = new Map([
      [ORG_A, [{ id: T_A, table_name: 'Alpha', organization_id: ORG_A }]],
      [ORG_B, [{ id: T_B, table_name: 'Beta', organization_id: ORG_B }]],
    ]);
  });

  it('offers tables from every organization when no filter is given', async () => {
    const tables = await listPickableTables();
    expect(tables.map((t) => [t.table_name, t.organization_id])).toEqual([
      ['Alpha', ORG_A],
      ['Beta', ORG_B],
    ]);
    expect(h.clientOrgs.sort()).toEqual([ORG_A, ORG_B].sort());
  });

  it('narrows to one organization only when a filter is passed explicitly', async () => {
    const tables = await listPickableTables(ORG_B);
    expect(tables.map((t) => t.table_name)).toEqual(['Beta']);
  });
});
