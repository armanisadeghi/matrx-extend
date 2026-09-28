import { afterEach, expect, it, vi } from 'vitest';

// A saved calendar extraction writes health through the actual query function.
// Only the PostgREST boundary is replaced; a missing row must not look saved.
const db = vi.hoisted(() => ({
  result: { data: null as { id: string } | null, error: null as { message: string } | null },
  schema: '',
  table: '',
  id: '',
  update: null as Record<string, unknown> | null,
  select: '',
}));

vi.mock('@/lib/supabase/client', () => {
  const query = {
    schema: (name: string) => {
      db.schema = name;
      return query;
    },
    from: (name: string) => {
      db.table = name;
      return query;
    },
    update: (value: Record<string, unknown>) => {
      db.update = value;
      return query;
    },
    eq: (_column: string, value: string) => {
      db.id = value;
      return query;
    },
    select: (value: string) => {
      db.select = value;
      return query;
    },
    maybeSingle: async () => db.result,
  };
  return { getMachineryAuthoredSupabase: () => query };
});

import { bumpPatternRun } from '@/lib/supabase/queries';

const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

afterEach(() => {
  db.result = { data: null, error: null };
  db.schema = '';
  db.table = '';
  db.id = '';
  db.update = null;
  db.select = '';
  vi.useRealTimers();
});

it('reports a zero-row health update as unsaved', async () => {
  const outcome = await bumpPatternRun(id, 'ok', 10);
  expect(outcome).toMatch(/could not be found or updated/i);
  expect(db.schema).toBe('extend');
  expect(db.table).toBe('wbx_pattern');
  expect(db.id).toBe(id);
  expect(db.select).toBe('id');
  expect(db.update).toMatchObject({ last_status: 'ok', last_run_count: 10 });
});

it('returns the database error when the health update is refused', async () => {
  db.result = { data: null, error: { message: 'Row update denied' } };
  expect(await bumpPatternRun(id, 'broken', 0)).toBe('Row update denied');
  expect(db.update).toMatchObject({ last_status: 'broken', last_run_count: 0 });
});

it('reports success only when PostgREST returns the updated row', async () => {
  db.result = { data: { id }, error: null };
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-28T15:00:00.000Z'));
  expect(await bumpPatternRun(id, 'ok', 10)).toBeNull();
  expect(db.update).toMatchObject({
    last_run_at: '2026-09-28T15:00:00.000Z',
    last_used_at: '2026-09-28T15:00:00.000Z',
    last_status: 'ok',
    last_run_count: 10,
  });
});
