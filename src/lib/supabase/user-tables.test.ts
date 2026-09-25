import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ rpc: mocks.rpc }),
}));

// Where a table lives (lane INTEG-CLIENTS): the boundary cases below are about the OLDER arm,
// so the organization's tables have not moved and the store holds no Table by these ids.
const home = vi.hoisted(() => ({
  livesIn: 'older' as 'older' | 'record',
  /** What `custom.where_tables_live` answers per table id (lane WHERE-LIVES-SWITCH); absent = older. */
  where: new Map<string, 'older' | 'record'>(),
  storeTables: [] as { id: string; table_name: string; organization_id: string }[],
  declareStoreTable: vi.fn(async () => '44444444-4444-4444-8444-444444444444'),
  appendStoreRows: vi.fn(async () => ({ inserted: 1, unmatched: [] as string[] })),
}));
vi.mock('@/lib/records/tables', () => ({
  tablesLiveIn: async () => home.livesIn,
  tableLivesWhere: async (_client: unknown, id: string) => home.where.get(id) ?? 'older',
  tablesLiveWhere: async (_client: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, home.where.get(id) ?? 'older'])),
  storeTables: async () => home.storeTables,
  declareStoreTable: home.declareStoreTable,
  appendStoreRows: home.appendStoreRows,
}));
vi.mock('@/lib/records/store', () => ({ recordsClientFor: async () => ({}) }));

vi.mock('@/lib/supabase/schemas', () => ({
  workbenchDb: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}));

import { OrganizationContextError } from '@ai-matrx/agents/matrx';

import { appendRowsToUserTable, createUserTableFromSchema } from './user-tables';

const ORGANIZATION_ID = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const OTHER_ORGANIZATION_ID = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

describe('user-table organization boundary', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.maybeSingle.mockReset();
    home.livesIn = 'older';
    home.where = new Map();
    home.storeTables = [];
    home.declareStoreTable.mockClear();
    home.appendStoreRows.mockClear();
  });

  it('refuses missing and malformed organizations before any Supabase I/O', async () => {
    await expect(
      Reflect.apply(createUserTableFromSchema, undefined, [
        { table_name: 'Missing org', fields: [] },
      ]),
    ).rejects.toBeInstanceOf(OrganizationContextError);
    await expect(
      Reflect.apply(createUserTableFromSchema, undefined, [
        { table_name: 'Malformed org', organization_id: 'not-a-uuid', fields: [] },
      ]),
    ).rejects.toBeInstanceOf(OrganizationContextError);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('normalizes the operation organization before sending it to the UDT create RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: '22222222-2222-4222-8222-222222222222', error: null });

    await expect(
      createUserTableFromSchema({
        table_name: 'Extracted recipes',
        organization_id: `  ${ORGANIZATION_ID.toUpperCase()}  `,
        fields: [],
      }),
    ).resolves.toEqual({ id: '22222222-2222-4222-8222-222222222222' });

    expect(mocks.rpc).toHaveBeenCalledWith('create_user_table_with_fields', {
      p_table_name: 'Extracted recipes',
      p_description: null,
      p_is_public: false,
      p_organization_id: ORGANIZATION_ID,
      p_project_id: null,
      p_task_id: null,
      p_fields: [],
    });
  });

  it('refuses a table in another organization before append RPC I/O', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { organization_id: OTHER_ORGANIZATION_ID },
      error: null,
    });

    await expect(
      appendRowsToUserTable('33333333-3333-4333-8333-333333333333', ORGANIZATION_ID, [
        { name: 'Ada' },
      ]),
    ).rejects.toMatchObject({ code: 'organization_context_mismatch' });

    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses missing or malformed organizations before table-read or append I/O', async () => {
    await expect(
      Reflect.apply(appendRowsToUserTable, undefined, [
        '33333333-3333-4333-8333-333333333333',
        undefined,
        [{ name: 'Ada' }],
      ]),
    ).rejects.toBeInstanceOf(OrganizationContextError);
    await expect(
      appendRowsToUserTable('33333333-3333-4333-8333-333333333333', 'not-a-uuid', [
        { name: 'Ada' },
      ]),
    ).rejects.toBeInstanceOf(OrganizationContextError);

    expect(mocks.maybeSingle).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('uses the normalized matching organization for the positive append', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { organization_id: ORGANIZATION_ID },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: 1, error: null });

    await expect(
      appendRowsToUserTable(
        '33333333-3333-4333-8333-333333333333',
        ` ${ORGANIZATION_ID.toUpperCase()} `,
        [{ 'First Name': 'Ada' }],
      ),
    ).resolves.toEqual({ inserted: 1 });

    expect(mocks.rpc).toHaveBeenCalledWith('append_rows_to_user_table', {
      p_table_id: '33333333-3333-4333-8333-333333333333',
      p_rows: [{ first_name: 'Ada' }],
    });
  });

  it("a moved organization's new table is declared in the record store, never the older RPC", async () => {
    home.livesIn = 'record';
    await expect(
      createUserTableFromSchema({
        table_name: 'Ventura Supply — valve prices',
        organization_id: ORGANIZATION_ID,
        fields: [
          {
            field_name: 'Price (USD)',
            display_name: 'Price (USD)',
            data_type: 'number',
            field_order: 0,
          },
        ],
      }),
    ).resolves.toEqual({ id: '44444444-4444-4444-8444-444444444444' });
    expect(home.declareStoreTable).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        name: 'Ventura Supply — valve prices',
        fields: [
          {
            field_name: 'price_usd',
            display_name: 'Price (USD)',
            data_type: 'number',
            field_order: 0,
          },
        ],
      }),
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('an append to a record-store table goes through the store with the same column mapping', async () => {
    home.where.set('33333333-3333-4333-8333-333333333333', 'record');
    home.storeTables = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        table_name: 'Parts on order',
        organization_id: ORGANIZATION_ID,
      },
    ];
    await expect(
      appendRowsToUserTable('33333333-3333-4333-8333-333333333333', ORGANIZATION_ID, [
        { 'First Name': 'Ada' },
      ]),
    ).resolves.toEqual({ inserted: 1 });
    expect(home.appendStoreRows).toHaveBeenCalledWith({}, '33333333-3333-4333-8333-333333333333', [
      { first_name: 'Ada' },
    ]);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });

  // LANE WHERE-LIVES-SWITCH (census row X1). "Heat Pump Field Research" was COPIED into the
  // record store under its own id, and the owner has not pressed his Data tables switch. The
  // store's answer is "older": the Showcase's scraped rows must land in the older table the
  // owner still works in, never in the copy. RED before this lane: the append found the copy
  // among the store's Tables and wrote it.
  it('an append to a copied table goes to the older table while the switch is off', async () => {
    home.storeTables = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        table_name: 'Heat Pump Field Research',
        organization_id: ORGANIZATION_ID,
      },
    ];
    home.where.set('33333333-3333-4333-8333-333333333333', 'older');
    mocks.maybeSingle.mockResolvedValue({
      data: { organization_id: ORGANIZATION_ID },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: 1, error: null });

    await expect(
      appendRowsToUserTable('33333333-3333-4333-8333-333333333333', ORGANIZATION_ID, [
        { Topic: 'Mini-split defrost settings for coastal installs' },
      ]),
    ).resolves.toEqual({ inserted: 1 });
    expect(home.appendStoreRows).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('append_rows_to_user_table', {
      p_table_id: '33333333-3333-4333-8333-333333333333',
      p_rows: [{ topic: 'Mini-split defrost settings for coastal installs' }],
    });
  });
});
