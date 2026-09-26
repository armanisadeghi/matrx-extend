// @vitest-environment node
// Use case: an extension release operator verifies the browser tool catalog.
// Keep the real command, SQL selection, Management HTTP reader, and predicates;
// replace only the network, local catalog input, public configuration, and output file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { main as drift } from '../../scripts/check-tool-db-drift';
import { main as generateDocs } from '../../scripts/dump-tools-from-db';
import type { DbToolRow } from '../../scripts/_tool-db-row-validation';

vi.mock('../../scripts/_supabase-rest', () => ({ loadSupabaseEnv: () => null, fetchPublicJson: vi.fn() }));
vi.mock('../../src/lib/tools/catalog', () => ({
  buildToolCatalogManifest: () => ({ tools: [{
    name: 'google_workspace', tier: 'read', category: 'google', admin_only: false,
    input_schema: { type: 'object', properties: {}, required: [] },
  }] }),
}));
vi.mock('../../src/lib/tools/categories', () => ({ CANONICAL_SURFACE: new Set(['google_workspace']) }));
vi.mock('node:fs', async (original) => ({ ...await original<typeof import('node:fs')>(), writeFileSync: vi.fn() }));

const tool = {
  id: 'b1f7624d-8ec0-465d-b5dd-1f0ba47c8859', name: 'google_workspace',
  description: 'Work with Google Workspace.', parameters: {}, tier: 'read',
  admin_only: false, is_active: true, category: 'google', source_kind: 'native',
} satisfies DbToolRow;
const argv = [...process.argv];
let definitions: unknown[];
let direct: string[];
let bundles: string[];
let membership: unknown;
let membershipStatus: number;
let read: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.argv = [...argv, '--strict'];
  vi.stubEnv('MATRX_SUPABASE_PROJECT_REF', 'brsgrqvjdzwihsvnfqkf');
  vi.stubEnv('SUPABASE_ACCESS_TOKEN', 'operator-fixture-token');
  definitions = [tool]; direct = ['google_workspace']; bundles = []; membership = []; membershipStatus = 201;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(writeFileSync).mockClear();
  read = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.read_only !== true) throw new Error('Read must be server-enforced read_only');
    const sql = String(body.query);
    let rows: unknown;
    let status = 201;
    if (sql.includes('platform.associations')) {
      // A wrong relation/direction/filter must not return a passing fixture.
      for (const clause of ["a.target_id = b.id", "a.source_type = 'tool'", "a.target_type = 'tool_bundle'", "a.role = 'member'", 'a.deleted_at is null', 'd.id = a.source_id', 'b.name = any(s.always_include_bundles)']) {
        if (!sql.includes(clause)) throw new Error('Incorrect membership query');
      }
      rows = membership; status = membershipStatus;
    } else if (sql.includes('from tool.binding')) {
      rows = [{ tool_id: tool.id, executor_name: 'chrome-extension', is_active: true }];
    } else if (sql.includes('from tool.definition')) {
      rows = definitions;
    } else if (sql.includes('from tool.surface_defaults')) {
      rows = [{ surface_name: 'chrome-extension/assistant', always_include_tools: direct, always_include_bundles: bundles, never_include_tools: [] }];
    } else throw new Error('Unexpected SQL');
    return new Response(JSON.stringify(rows), { status });
  });
  vi.stubGlobal('fetch', read);
});

afterEach(() => {
  process.argv = [...argv];
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

describe('private catalog commands through the real Management reader', () => {
  it('verifies direct inclusion and generates complete docs with no public config', async () => {
    expect(await drift()).toBe(0);
    await generateDocs();
    expect(writeFileSync).toHaveBeenCalledOnce();
    expect(vi.mocked(writeFileSync).mock.calls[0]?.[1]).toContain('### `google_workspace`');
    expect(vi.mocked(writeFileSync).mock.calls[0]?.[1]).toContain('Work with Google Workspace.');
  });

  it('refuses absent operator authorization in strict mode and preserves docs', async () => {
    vi.stubEnv('SUPABASE_ACCESS_TOKEN', '');
    expect(await drift()).toBe(3);
    await generateDocs();
    expect(read).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it.each([
    { description: 42 }, { parameters: null }, { parameters: { action: { required: 'yes' } } },
    { tier: [] }, { category: 3 }, { admin_only: 'false' }, { is_active: 'true' },
  ])('rejects malformed selected fields before comparison or document writes: %j', async (patch) => {
    definitions = [{ ...tool, ...patch }];
    expect(await drift()).toBe(3);
    await generateDocs();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('proves bundle-only inclusion from actual member edges', async () => {
    direct = []; bundles = ['google'];
    membership = [{ bundle_name: 'google', tool_name: 'google_workspace' }];
    expect(await drift()).toBe(0);
  });

  it('rejects absent membership even though a bundle was declared', async () => {
    direct = []; bundles = ['google'];
    membership = [{ bundle_name: 'google', tool_name: 'google_email_send' }];
    expect(await drift()).toBe(1);
  });

  it('does not count a tool from an unrelated bundle', async () => {
    direct = []; bundles = ['google'];
    membership = [{ bundle_name: 'browser', tool_name: 'google_workspace' }];
    expect(await drift()).toBe(1);
  });

  it.each([403, 500])('fails strict verification when member access returns HTTP %s', async (status) => {
    direct = []; bundles = ['google']; membershipStatus = status;
    expect(await drift()).toBe(3);
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('No drift detected'));
  });

  it('rejects malformed bundle members instead of accepting an unverifiable surface', async () => {
    direct = []; bundles = ['google']; membership = [{ bundle_name: 'google', tool_name: 7 }];
    expect(await drift()).toBe(3);
  });

  it('keeps an unverified development run loud without calling it clean', async () => {
    process.argv = [...argv]; direct = []; bundles = ['google']; membershipStatus = 403;
    expect(await drift()).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('UNVERIFIED'));
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('No drift detected'));
  });

  it('does not publish an empty catalog or accept inactive advertised tools', async () => {
    definitions = [];
    expect(await drift()).toBe(1);
    await generateDocs();
    expect(writeFileSync).not.toHaveBeenCalled();
    definitions = [{ ...tool, is_active: false }];
    expect(await drift()).toBe(1);
  });
});
