import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ rpc }),
}));

import { createUserTableFromSchema } from './user-tables';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';

describe('user-table organization boundary', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('refuses missing and malformed organizations before any Supabase I/O', async () => {
    await expect(
      Reflect.apply(createUserTableFromSchema, undefined, [
        { table_name: 'Missing org', fields: [] },
      ]),
    ).rejects.toThrow('Choose your organization');
    await expect(
      Reflect.apply(createUserTableFromSchema, undefined, [
        { table_name: 'Malformed org', organization_id: 'not-a-uuid', fields: [] },
      ]),
    ).rejects.toThrow('Choose a valid organization');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sends the operation organization exactly to the UDT create RPC', async () => {
    rpc.mockResolvedValue({ data: '22222222-2222-4222-8222-222222222222', error: null });

    await expect(
      createUserTableFromSchema({
        table_name: 'Extracted recipes',
        organization_id: ORGANIZATION_ID,
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
