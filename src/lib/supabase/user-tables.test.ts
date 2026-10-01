import { beforeEach, describe, expect, it, vi } from 'vitest';

const home = vi.hoisted(() => ({
  clientFor: vi.fn(async (_org: string, _seat: string) => ({})),
  declareStoreTable: vi.fn(async () => '44444444-4444-4444-8444-444444444444'),
  appendStoreRows: vi.fn(async () => ({ inserted: 1, unmatched: [] as string[] })),
}));
vi.mock('@/lib/records/tables', () => ({
  storeTables: async () => [],
  declareStoreTable: home.declareStoreTable,
  appendStoreRows: home.appendStoreRows,
}));
vi.mock('@/lib/records/store', () => ({ recordsClientFor: home.clientFor }));

import { OrganizationContextError } from '@ai-matrx/agents/matrx';

import { appendRowsToUserTable, createUserTableFromSchema } from './user-tables';

const ORGANIZATION_ID = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const TABLE_ID = '33333333-3333-4333-8333-333333333333';

describe('user-table organization boundary', () => {
  beforeEach(() => {
    home.clientFor.mockClear();
    home.declareStoreTable.mockClear();
    home.appendStoreRows.mockClear();
  });

  it('refuses missing and malformed organizations before any store I/O', async () => {
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
    await expect(
      Reflect.apply(appendRowsToUserTable, undefined, [TABLE_ID, undefined, [{ name: 'Ada' }]]),
    ).rejects.toBeInstanceOf(OrganizationContextError);
    await expect(
      appendRowsToUserTable(TABLE_ID, 'not-a-uuid', [{ name: 'Ada' }]),
    ).rejects.toBeInstanceOf(OrganizationContextError);
    expect(home.clientFor).not.toHaveBeenCalled();
    expect(home.declareStoreTable).not.toHaveBeenCalled();
    expect(home.appendStoreRows).not.toHaveBeenCalled();
  });

  it('a new table is declared in the record store in the normalized organization', async () => {
    await expect(
      createUserTableFromSchema({
        table_name: 'Ventura Supply — valve prices',
        organization_id: `  ${ORGANIZATION_ID.toUpperCase()}  `,
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
    expect(home.clientFor).toHaveBeenCalledWith(ORGANIZATION_ID, 'user');
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
  });

  it('an append goes through the store with the same column mapping', async () => {
    await expect(
      appendRowsToUserTable(TABLE_ID, ` ${ORGANIZATION_ID.toUpperCase()} `, [
        { 'First Name': 'Ada' },
      ]),
    ).resolves.toEqual({ inserted: 1 });
    expect(home.clientFor).toHaveBeenCalledWith(ORGANIZATION_ID, 'user');
    expect(home.appendStoreRows).toHaveBeenCalledWith({}, TABLE_ID, [{ first_name: 'Ada' }]);
  });
});
