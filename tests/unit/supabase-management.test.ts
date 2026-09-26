// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectRowsViaManagementApi } from '../../scripts/_supabase-management';

const projectRef = 'brsgrqvjdzwihsvnfqkf';
const isNamedRow = (row: unknown): row is { name: string } =>
  typeof row === 'object' && row !== null && typeof (row as { name?: unknown }).name === 'string';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('build-time Management API read', () => {
  it('sends one SELECT with server read_only and validates distinct returned rows', async () => {
    vi.stubEnv('MATRX_SUPABASE_PROJECT_REF', projectRef);
    vi.stubEnv('SUPABASE_ACCESS_TOKEN', 'operator-fixture-token');
    const fetchRead = vi.fn(
      async () =>
        new Response(JSON.stringify([{ name: 'capture_page' }, { name: 'open_source' }]), {
          status: 201,
        }),
    );
    vi.stubGlobal('fetch', fetchRead);

    await expect(
      selectRowsViaManagementApi('select name from tool.definition', isNamedRow),
    ).resolves.toEqual([{ name: 'capture_page' }, { name: 'open_source' }]);
    expect(fetchRead).toHaveBeenCalledOnce();
    const [url, options] = fetchRead.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.supabase.com/v1/projects/${projectRef}/database/query`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({
      query: 'select name from tool.definition',
      read_only: true,
    });
  });

  it('refuses a second statement before any network request', async () => {
    vi.stubEnv('MATRX_SUPABASE_PROJECT_REF', projectRef);
    vi.stubEnv('SUPABASE_ACCESS_TOKEN', 'operator-fixture-token');
    const fetchRead = vi.fn();
    vi.stubGlobal('fetch', fetchRead);

    await expect(
      selectRowsViaManagementApi('select 1; delete from tool.binding', isNamedRow),
    ).rejects.toThrow('single SELECT statement');
    expect(fetchRead).not.toHaveBeenCalled();
  });

  it('refuses missing operator authorization before any network request', async () => {
    vi.stubEnv('MATRX_SUPABASE_PROJECT_REF', projectRef);
    vi.stubEnv('SUPABASE_ACCESS_TOKEN', '');
    const fetchRead = vi.fn();
    vi.stubGlobal('fetch', fetchRead);

    await expect(
      selectRowsViaManagementApi('select name from tool.definition', isNamedRow),
    ).rejects.toThrow('SUPABASE_ACCESS_TOKEN is missing');
    expect(fetchRead).not.toHaveBeenCalled();
  });

  it('fails closed and never includes a refused response body in its error', async () => {
    vi.stubEnv('MATRX_SUPABASE_PROJECT_REF', projectRef);
    vi.stubEnv('SUPABASE_ACCESS_TOKEN', 'operator-fixture-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('private-response-marker', { status: 403 })),
    );

    await expect(
      selectRowsViaManagementApi('select name from tool.definition', isNamedRow),
    ).rejects.toThrow('Supabase Management API read failed (HTTP 403)');
  });

  it('rejects malformed rows instead of claiming the catalog was verified', async () => {
    vi.stubEnv('MATRX_SUPABASE_PROJECT_REF', projectRef);
    vi.stubEnv('SUPABASE_ACCESS_TOKEN', 'operator-fixture-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([{ wrong: 'field' }]), { status: 201 })),
    );

    await expect(
      selectRowsViaManagementApi('select name from tool.definition', isNamedRow),
    ).rejects.toThrow('Supabase Management API returned invalid rows');
  });

  it('rejects malformed JSON and a non-array top-level payload', async () => {
    vi.stubEnv('MATRX_SUPABASE_PROJECT_REF', projectRef);
    vi.stubEnv('SUPABASE_ACCESS_TOKEN', 'operator-fixture-token');
    const fetchRead = vi
      .fn()
      .mockResolvedValueOnce(new Response('{invalid', { status: 201 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rows: [{ name: 'capture_page' }] }), { status: 201 }),
      );
    vi.stubGlobal('fetch', fetchRead);

    await expect(
      selectRowsViaManagementApi('select name from tool.definition', isNamedRow),
    ).rejects.toThrow('invalid JSON');
    await expect(
      selectRowsViaManagementApi('select name from tool.definition', isNamedRow),
    ).rejects.toThrow('invalid rows');
  });
});
