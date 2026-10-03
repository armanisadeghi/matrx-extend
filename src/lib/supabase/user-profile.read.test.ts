import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  requestedTable: '' as string,
  filters: [] as Array<[string, unknown]>,
  row: null as Record<string, unknown> | null,
  error: null as { message: string } | null,
  rpcCalls: 0,
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    rpc: async () => {
      db.rpcCalls += 1;
      return { data: null, error: { message: 'permission denied for function get_user_form_context', code: '42501' } };
    },
  }),
}));
vi.mock('@/lib/supabase/schemas', () => ({
  usersDb: () => ({
    from: (table: string) => {
      db.requestedTable = table;
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          db.filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => ({ data: db.row, error: db.error }),
      };
      return query;
    },
  }),
}));

import { fetchUserFormProfile } from './user-profile';

beforeEach(() => {
  db.requestedTable = '';
  db.filters = [];
  db.row = null;
  db.error = null;
  db.rpcCalls = 0;
});

it.each([
  ['Maya', 'Maya'],
  ['Samir', 'Samir'],
])('reads the signed-in owner profile when preferred name is %s', async (preferred, expected) => {
  db.row = { preferred_name: preferred };
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const result = await fetchUserFormProfile(userId);
  expect(result).toMatchObject({ ok: true, profile: { preferred_name: expected } });
  expect(db.requestedTable).toBe('user_form_profile');
  expect(db.filters).toEqual([['user_id', userId]]);
  expect(db.rpcCalls).toBe(0);
});

it('keeps a denied owner row read distinct from an absent profile', async () => {
  db.error = { message: 'permission denied for table user_form_profile' };
  const result = await fetchUserFormProfile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(result).toEqual({ ok: false, error: 'permission denied for table user_form_profile' });
});

it('treats no owner row as a new empty profile', async () => {
  const result = await fetchUserFormProfile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(result).toEqual({ ok: true, profile: null });
  expect(db.requestedTable).toBe('user_form_profile');
});

it('refuses a malformed stored profile instead of presenting a blank form', async () => {
  db.row = { preferred_name: 42 };
  const result = await fetchUserFormProfile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(result).toEqual({ ok: false, error: 'Profile data came back in an unexpected shape.' });
});
