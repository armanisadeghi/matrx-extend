import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Characterization of checkIsAdmin (2026-10-21): recorded green against the hand-rolled
 * `admin.admins` read, then kept green after it moved onto @ai-matrx/auth/admin readAdminStatus.
 * The fake sits at the supabase client, so it answers either query shape (`.limit(1)` array or
 * `.maybeSingle()` row) with the SAME database fact.
 */
type Fact =
  | { kind: 'row' }
  | { kind: 'none' }
  | { kind: 'error'; message: string }
  | { kind: 'throws'; error: Error };

const db = vi.hoisted(() => ({
  fact: { kind: 'none' } as Fact,
  calls: [] as string[],
}));

function answer(single: boolean) {
  const f = db.fact;
  if (f.kind === 'throws') throw f.error;
  if (f.kind === 'error') return { data: null, error: { message: f.message } };
  const row = { user_id: 'u', level: 'super_admin' };
  if (f.kind === 'row') return { data: single ? row : [row], error: null };
  return { data: single ? null : [], error: null };
}

vi.mock('@/lib/supabase/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/supabase/client')>();
  const fake = {
    schema: (schema: string) => {
      db.calls.push(`schema:${schema}`);
      return {
        from: (table: string) => {
          db.calls.push(`from:${table}`);
          const filtered = {
            eq: (column: string, value: string) => {
              db.calls.push(`eq:${column}=${value}`);
              return {
                limit: async () => answer(false),
                maybeSingle: async () => answer(true),
              };
            },
          };
          return { select: () => filtered };
        },
      };
    },
  };
  return { ...original, getSupabase: () => fake };
});

import { checkIsAdmin } from '@/lib/supabase/queries';

const UID = '7d945376-2ac6-442c-bfb5-2ca3512377af';
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.fact = { kind: 'none' };
  db.calls = [];
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('checkIsAdmin role lookup', () => {
  it("reads this person's row in admin.admins", async () => {
    await checkIsAdmin(UID);
    expect(db.calls).toEqual(['schema:admin', 'from:admins', `eq:user_id=${UID}`]);
  });

  it('a row is a confirmed admin', async () => {
    db.fact = { kind: 'row' };
    expect(await checkIsAdmin(UID)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('no row is a confirmed non-admin', async () => {
    db.fact = { kind: 'none' };
    expect(await checkIsAdmin(UID)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps a failed role read distinct from a confirmed non-admin account (null + one warning)', async () => {
    db.fact = { kind: 'error', message: 'role read unavailable' };
    expect(await checkIsAdmin(UID)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[matrx-extend] checkIsAdmin error', 'role read unavailable');
  });

  it('a thrown failure still rejects (use-auth catches it)', async () => {
    db.fact = { kind: 'throws', error: new TypeError('Failed to fetch') };
    await expect(checkIsAdmin(UID)).rejects.toThrow('Failed to fetch');
  });
});
