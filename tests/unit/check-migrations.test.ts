// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSupabaseEnv } from '../../scripts/_supabase-rest';
import { main } from '../../scripts/check-migrations';

vi.mock('../../scripts/_supabase-rest', async (original) => ({
  ...await original<typeof import('../../scripts/_supabase-rest')>(),
  loadSupabaseEnv: vi.fn(() => null),
}));
const originalArgv = [...process.argv];
beforeEach(() => {
  process.argv = [...originalArgv, '--strict'];
  vi.mocked(loadSupabaseEnv).mockReturnValue(null);
  vi.stubEnv('MATRX_SUPABASE_PROJECT_REF', 'brsgrqvjdzwihsvnfqkf');
  vi.stubEnv('SUPABASE_ACCESS_TOKEN', 'operator-fixture-token');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.argv = [...originalArgv];
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe('strict migration ledger verification through the real Management reader', () => {
  it('fails when both public configuration and operator authorization are absent', async () => {
    vi.stubEnv('SUPABASE_ACCESS_TOKEN', '');
    const read = vi.fn(); vi.stubGlobal('fetch', read);
    await expect(main()).resolves.toBe(2);
    expect(read).not.toHaveBeenCalled();
  });

  it('uses the real operator query when public configuration is absent and detects pending migrations', async () => {
    const read = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({
        query: "select filename, checksum from public._schema_migrations where source = 'matrx-extend' order by filename",
        read_only: true,
      });
      return new Response('[]', { status: 201 });
    });
    vi.stubGlobal('fetch', read);
    await expect(main()).resolves.toBe(1);
    expect(read).toHaveBeenCalledOnce();
  });

  it('fails strict verification on malformed ledger rows rather than comparing them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[{"filename":"0070.sql","checksum":7}]', { status: 201 })));
    await expect(main()).resolves.toBe(2);
  });
});


describe('public ledger response validation through the real REST reader', () => {
  // Mirror a fully recorded repository ledger using the real migration bytes;
  // adding a malformed extra row must change clean to unverified, not be ignored.
  const ledger = readdirSync(resolve(process.cwd(), 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .map((filename) => ({ filename, checksum: createHash('sha256').update(readFileSync(resolve(process.cwd(), 'migrations', filename))).digest('hex') }));

  it.each([
    { label: 'complete ledger', rows: ledger, expected: 0 },
    { label: 'malformed extra row', rows: [...ledger, { filename: 'unverified.sql', checksum: 7 }], expected: 2 },
    { label: 'non-array envelope', rows: { rows: ledger }, expected: 2 },
  ])('$label', async ({ rows, expected }) => {
    vi.mocked(loadSupabaseEnv).mockReturnValue({ url: 'https://db.matrxserver.com', key: 'publishable-fixture-key' });
    vi.stubEnv('SUPABASE_ACCESS_TOKEN', '');
    const read = vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 }));
    vi.stubGlobal('fetch', read);
    expect(await main()).toBe(expected);
    expect(read).toHaveBeenCalledOnce();
  });
});
