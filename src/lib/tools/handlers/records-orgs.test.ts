import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const ORG_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

const h = vi.hoisted(() => ({
  opened: [] as (string | null | undefined)[],
  searched: [] as (string | null)[],
  wroteIn: [] as string[],
  off: [] as string[],
  tables: {} as Record<string, { id: string; slug: string; name: string }[]>,
  records: {} as Record<string, Record<string, unknown>>,
}));

function clientFor(org: string) {
  return {
    tableList: async () => ({
      ok: true,
      data: (h.tables[org] ?? []).map((t) => ({
        ...t,
        organization_id: org,
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

const CLOSED = 'The custom data store is switched off for this organization.';

vi.mock('@/lib/records/store', () => ({
  openRecordStore: vi.fn(async () => {
    throw new Error('the active-org door must not be used for reads');
  }),
  // A write goes to the client of the organization that owns the thing.
  recordsClientFor: async (org: string) => ({
    org,
    recordDelete: async () => {
      h.wroteIn.push(org);
      return { ok: true, data: '2026-09-30T00:00:00Z' };
    },
  }),
  // The package's own across-organizations client: the union of every organization's tables,
  // narrowed by the optional filter, a record opened wherever it lives.
  openSpanningClient: async () => ({
    organizationIds: [ORG_A, ORG_B],
    client: {
      organizationsOpen: async (args?: { organization_id?: string | null }) => {
        const orgs = args?.organization_id ? [args.organization_id] : [ORG_A, ORG_B];
        return {
          ok: true,
          data: {
            open: orgs.filter((o) => !h.off.includes(o)),
            unavailable: orgs
              .filter((o) => h.off.includes(o))
              .map((o) => ({ organization_id: o, reason: CLOSED })),
          },
        };
      },
      ownerOrganization: async (a: { table_id?: string | null; record_id?: string | null }) => {
        for (const o of [ORG_A, ORG_B]) {
          if (a.table_id && h.tables[o]?.some((t) => t.id === a.table_id))
            return { ok: true, data: o };
          if (a.record_id && h.records[o]?.[a.record_id]) return { ok: true, data: o };
        }
        return { ok: true, data: null };
      },
      metadataSearch: async (a: { text: string; organization_id?: string | null }) => {
        h.searched.push(a.organization_id ?? null);
        const orgs = (a.organization_id ? [a.organization_id] : [ORG_A, ORG_B]).filter(
          (o) => !h.off.includes(o),
        );
        return {
          ok: true,
          data: {
            matches: orgs.map((o) => ({ table: `hit-${a.text}`, organization_id: o })),
            organizations_covered: orgs,
            unavailable: h.off.map((o) => ({ organization_id: o, reason: CLOSED })),
          },
        };
      },
      recordAggregate: async (a: { table_id: string }) => ({
        ok: true,
        data: [
          {
            row_count: 3,
            organization_id: h.tables[ORG_B]?.some((t) => t.id === a.table_id) ? ORG_B : ORG_A,
          },
        ],
      }),
      tableList: async (args?: { organization_id?: string | null }) => {
        h.opened.push(args?.organization_id ?? null);
        const orgs = args?.organization_id ? [args.organization_id] : [ORG_A, ORG_B];
        const parts = await Promise.all(orgs.map((o) => clientFor(o).tableList()));
        return { ok: true, data: parts.flatMap((p) => p.data) };
      },
      recordRead: async (a: { record_id: string }) => {
        for (const o of [ORG_A, ORG_B]) {
          const r = await clientFor(o).recordRead(a);
          if (r.ok) return r;
        }
        return { ok: false, error: { code: 'nf', message: 'not found' } };
      },
    },
  }),
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
    h.searched = [];
    h.wroteIn = [];
    h.off = [];
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
    expect(out).toMatchObject({ ok: true, values: { name: 'in B' } });
  });

  it('metadata_search spans every organization and names one whose store is off, with why', async () => {
    h.off = [ORG_B];
    const out = await run({ action: 'metadata_search', query: 'tenant' });
    expect(out).toMatchObject({ ok: true });
    expect((out.matches as { organization_id: string }[]).map((m) => m.organization_id)).toEqual([
      ORG_A,
    ]);
    expect(out.organizations_unavailable).toEqual([{ organization_id: ORG_B, reason: CLOSED }]);
    expect(h.searched).toEqual([null]);
  });

  it('record_aggregate runs where the table lives and never drops an unavailable note', async () => {
    const out = await run({ action: 'record_aggregate', table_id: 't-b' });
    expect(out).toMatchObject({ ok: true, rows: [{ organization_id: ORG_B }] });
  });

  it("a write lands in the record's own organization, not the first one", async () => {
    const out = await run({ action: 'record_delete', record_id: 'rec-b' });
    expect(out).toMatchObject({ ok: true });
    expect(h.wroteIn).toEqual([ORG_B]);
  });

  it('a write to a record whose organization is unavailable says why, never "not found"', async () => {
    h.off = [ORG_B];
    const out = await run({ action: 'record_delete', record_id: 'rec-b' });
    expect(out).toMatchObject({ ok: false, reason: CLOSED });
    expect(h.wroteIn).toEqual([]);
  });

  it('every organization unavailable is a refusal with the reason, not an empty success', async () => {
    h.off = [ORG_A, ORG_B];
    const out = await run({ action: 'table_list' });
    expect(out).toMatchObject({ ok: false, reason: CLOSED });
  });
});
