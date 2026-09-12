import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ rpc }),
}));

import { OrganizationContextError } from '@ai-matrx/agents/matrx';

import { createUserTableFromSchema } from './user-tables';

const ORGANIZATION_ID = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';

describe('user-table organization boundary', () => {
  beforeEach(() => {
    rpc.mockReset();
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
    expect(rpc).not.toHaveBeenCalled();
  });

  it('normalizes the operation organization before sending it to the UDT create RPC', async () => {
    rpc.mockResolvedValue({ data: '22222222-2222-4222-8222-222222222222', error: null });

    await expect(
      createUserTableFromSchema({
        table_name: 'Extracted recipes',
        organization_id: `  ${ORGANIZATION_ID.toUpperCase()}  `,
        fields: [],
      }),
    ).resolves.toEqual({ id: '22222222-2222-4222-8222-222222222222' });

    expect(rpc).toHaveBeenCalledWith('create_user_table_with_fields', {
      p_table_name: 'Extracted recipes',
      p_description: null,
      p_is_public: false,
      p_organization_id: ORGANIZATION_ID,
      p_project_id: null,
      p_task_id: null,
      p_fields: [],
    });
  });
});
