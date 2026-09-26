// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../scripts/check-migrations';

vi.mock('../../scripts/_supabase-rest', () => ({ loadSupabaseEnv: () => null, fetchPublicJson: vi.fn() }));
const originalArgv = [...process.argv];
beforeEach(() => {
  process.argv = [...originalArgv, '--strict'];
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
