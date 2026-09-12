import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ rpc: mocks.rpc }),
}));

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
      appendRowsToUserTable('33333333-3333-4333-8333-333333333333', ORGANIZATION_ID, [{ name: 'Ada' }]),
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
      appendRowsToUserTable('33333333-3333-4333-8333-333333333333', 'not-a-uuid', [{ name: 'Ada' }]),
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
});
