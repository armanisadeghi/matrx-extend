import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const ORG_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

const h = vi.hoisted(() => ({
  opened: [] as (string | null | undefined)[],
  tables: {} as Record<string, { id: string; slug: string; name: string }[]>,
  records: {} as Record<string, Record<string, unknown>>,
}));

function clientFor(org: string) {
  return {
    tableList: async () => ({
      ok: true,
      data: (h.tables[org] ?? []).map((t) => ({
        ...t,
        type: 't',
        agent_writable: true,
        is_kernel: false,
      })),
    }),
    recordRead: async ({ record_id }: { record_id: string }) =>
      h.records[org]?.[record_id]
        ? { ok: true, data: { document: h.records[org]?.[record_id], hidden: [] } }
        : { ok: false, error: { code: 'nf', message: 'not found' } },
  };
}

vi.mock('@/lib/records/store', () => ({
  openRecordStore: vi.fn(async () => {
    throw new Error('the active-org door must not be used for reads');
  }),
  openRecordStores: async (_actor: string, filter?: string | null) => {
    h.opened.push(filter);
    const orgs = filter ? [filter] : [ORG_A, ORG_B];
    return { stores: orgs.map((o) => ({ organizationId: o, client: clientFor(o) })), closed: [] };
  },
}));

import { records_handlers } from './records';

const handler = records_handlers[0] as (typeof records_handlers)[number];

async function run(args: Record<string, unknown>) {
  const parsed = handler.argsSchema.parse(args);
  return (await handler.run(parsed, {} as never)) as Record<string, unknown>;
}

describe('records tool: sees every organization, active org never narrows', () => {
  beforeEach(() => {
    h.opened = [];
    h.tables = {
      [ORG_A]: [{ id: 't-a', slug: 'a', name: 'Alpha' }],
      [ORG_B]: [{ id: 't-b', slug: 'b', name: 'Beta' }],
    };
    h.records = { [ORG_B]: { 'rec-b': { name: 'in B' } } };
  });

  it('table_list unions all organizations, each labelled with its own', async () => {
    const out = await run({ action: 'table_list' });
    expect((out.tables as { organization_id: string }[]).map((t) => t.organization_id)).toEqual([
      ORG_A,
      ORG_B,
    ]);
    expect(h.opened).toEqual([null]);
  });

  it('an explicit organization_id narrows to that organization', async () => {
    const out = await run({ action: 'table_list', organization_id: ORG_A });
    expect((out.tables as unknown[]).length).toBe(1);
    expect(h.opened).toEqual([ORG_A]);
  });

  it('the catalog null default and an explicit null both keep all organizations visible', async () => {
    expect(handler.argsSchema.parse({ action: 'table_list' }).organization_id).toBeNull();
    const out = await run({ action: 'table_list', organization_id: null });
    expect((out.tables as unknown[]).length).toBe(2);
    expect(h.opened).toEqual([null]);
  });

  it("record_read opens a record in the record's own organization", async () => {
    const out = await run({ action: 'record_read', record_id: 'rec-b' });
    expect(out).toMatchObject({ ok: true, organization_id: ORG_B });
  });
});
