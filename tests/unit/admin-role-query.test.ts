import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown } }));
vi.mock('@/lib/supabase/schemas', () => ({
  adminDb: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: async () => query.result,
        }),
      }),
    }),
  }),
}));

import { checkIsAdmin } from '@/lib/supabase/queries';

beforeEach(() => {
  query.result = { data: null, error: null };
});

describe('checkIsAdmin role lookup', () => {
  it('keeps a failed role read distinct from a confirmed non-admin account', async () => {
    query.result = { data: null, error: { message: 'role read unavailable' } };
    expect(await checkIsAdmin('7d945376-2ac6-442c-bfb5-2ca3512377af')).toBeNull();

    query.result = { data: [], error: null };
    expect(await checkIsAdmin('7d945376-2ac6-442c-bfb5-2ca3512377af')).toBe(false);
  });
});
