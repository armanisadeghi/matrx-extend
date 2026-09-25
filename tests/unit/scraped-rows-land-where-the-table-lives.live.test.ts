// @vitest-environment node
/**
 * LIVE, DEV CLONE ONLY. SCRAPED ROWS LAND IN THE STORE THEIR TABLE LIVES IN
 * (lane INTEG-CLIENTS, CUTOVER-PLAN rev 3 rows E1 + E2).
 *
 * The real use case: Rincon Plumbing (admin's Workspace on the clone — its tables were moved
 * into the record store by OLD-TABLES-4) scrapes a supplier's price page in the Showcase and
 * presses "Save as pattern" with "+ Create new from these fields…", then the next day appends
 * two scraped rows into the "Parts on order" table it already keeps.
 *
 * RED before the repoint: `createUserTableFromSchema` called `create_user_table_with_fields`
 * (a `workbench.udt_datasets` row the organization's screens no longer read) and
 * `appendRowsToUserTable` called `append_rows_to_user_table` on the moved table's ARCHIVED
 * older copy. GREEN after: a record-store Table with its columns, rows written through
 * `record_write_many`, the archived older copy untouched, and the picker offering the moved
 * table once.
 *
 * Needs GRID_PORT_SUPABASE_URL + GRID_PORT_SUPABASE_PUBLISHABLE_KEY (refused unless it is the
 * clone) and AI_ADMIN_USERNAME / AI_ADMIN_PASSWORD (read from ../aidream/.env). Skipped,
 * loudly, without them. What it writes it archives again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

function envFrom(file: string): Record<string, string> {
  try {
    return Object.fromEntries(
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => [m[1] as string, (m[2] as string).replace(/^"|"$/g, '')]),
    );
  } catch {
    return {};
  }
}
const aidreamEnv = envFrom(path.resolve(__dirname, '../../../aidream/.env'));
const URL_ = process.env.GRID_PORT_SUPABASE_URL ?? '';
const KEY = process.env.GRID_PORT_SUPABASE_PUBLISHABLE_KEY ?? '';
const EMAIL = process.env.AI_ADMIN_USERNAME ?? aidreamEnv.AI_ADMIN_USERNAME ?? '';
const PASSWORD = process.env.AI_ADMIN_PASSWORD ?? aidreamEnv.AI_ADMIN_PASSWORD ?? '';
const CLONE_REF = 'jxhgzalwckuarngvsdyq';
const ORG = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f'; // admin's Workspace — moved on the clone
const PARTS_ON_ORDER = '00d6e9a2-45c4-4e45-af46-431bccb3c51a';
const READY = Boolean(URL_ && KEY && EMAIL && PASSWORD);

const holder = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }));
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => holder.client,
  getAgentAuthoredSupabase: () => holder.client,
}));

import {
  appendRowsToUserTable,
  createUserTableFromSchema,
  inferSchemaFromRows,
  listPickableTables,
} from '@/lib/supabase/user-tables';

const describeLive = READY ? describe : describe.skip;
if (!READY) {
  console.warn(
    '[scraped-rows-land-where-the-table-lives] SKIPPED: set GRID_PORT_SUPABASE_URL and GRID_PORT_SUPABASE_PUBLISHABLE_KEY (the dev clone) to run it.',
  );
}

async function olderRowCount(tableId: string): Promise<number> {
  const { count, error } = await holder.client
    .schema('workbench')
    .from('udt_dataset_rows')
    .select('id', { count: 'exact', head: true })
    .eq('table_id', tableId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function storeRecords(
  tableId: string,
): Promise<Array<{ id: string; document: Record<string, unknown> }>> {
  const { data, error } = await holder.client.schema('custom').rpc('read_records', {
    p_organization_id: ORG,
    p_table_id: tableId,
    p_limit: 200,
    p_offset: 0,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; document: Record<string, unknown> }>;
}

describeLive('scraped rows land in the store their table lives in', () => {
  const made: string[] = [];

  beforeAll(async () => {
    if (!URL_.includes(CLONE_REF)) throw new Error(`refusing to run: ${URL_} is not the dev clone`);
    holder.client = createClient(URL_, KEY, { auth: { persistSession: false } });
    const signed = await holder.client.auth.signInWithPassword({
      email: EMAIL,
      password: PASSWORD,
    });
    if (signed.error || !signed.data.user)
      throw new Error(`sign-in failed: ${signed.error?.message}`);
    expect(signed.data.user.email).toBe('admin@admin.com');
    await chrome.storage.local.set({ 'matrx.user.profile': { id: signed.data.user.id } });
  });

  afterAll(async () => {
    for (const id of [...made].reverse()) {
      await holder.client
        .schema('custom')
        .rpc('record_delete', { p_organization_id: ORG, p_record_id: id });
    }
  });

  it('a new table from scraped rows is born in the record store with its columns', async () => {
    const scraped = [
      {
        Item: 'Watts LF25AUB-Z3 1/2 in PRV',
        'Price (USD)': 89.5,
        'In stock': true,
        SKU: 'WAT-0009',
      },
      {
        Item: 'Nibco 3/4 in ball valve, lead free',
        'Price (USD)': 18.25,
        'In stock': false,
        SKU: 'NIB-5310',
      },
    ];
    const fields = inferSchemaFromRows(scraped);
    const created = await createUserTableFromSchema({
      table_name: 'Ventura Supply — valve prices',
      description: 'Auto-created from matrx-extend manual_css pattern.',
      organization_id: ORG,
      fields,
    });
    made.push(created.id);

    // RED before the repoint: this id was a workbench.udt_datasets row.
    const older = await holder.client
      .schema('workbench')
      .from('udt_datasets')
      .select('id')
      .eq('id', created.id);
    expect(older.data ?? []).toHaveLength(0);
    const picked = await listPickableTables(ORG);
    expect(picked.find((t) => t.id === created.id)).toMatchObject({ store: 'record' });

    const appended = await appendRowsToUserTable(created.id, ORG, scraped);
    expect(appended.inserted).toBe(2);
    const rows = await storeRecords(created.id);
    expect(rows.map((r) => r.document.item).sort()).toEqual([
      'Nibco 3/4 in ball valve, lead free',
      'Watts LF25AUB-Z3 1/2 in PRV',
    ]);
    expect(rows.find((r) => r.document.sku === 'WAT-0009')?.document.price_usd).toBe(89.5);
    made.push(...rows.map((r) => r.id));
  });

  it('appending scraped rows to a moved table writes the store, never the archived older copy', async () => {
    const olderBefore = await olderRowCount(PARTS_ON_ORDER);
    const storeBefore = new Set((await storeRecords(PARTS_ON_ORDER)).map((r) => r.id));
    const result = await appendRowsToUserTable(PARTS_ON_ORDER, ORG, [
      { Part: 'Rinnai RE180iN tankless heater', Supplier: 'Ferguson Ventura', Qty: 1 },
      { Part: 'Oatey 3 in no-hub coupling', Supplier: 'Ewing Oxnard', Qty: 6 },
    ]);
    expect(result.inserted).toBe(2);
    expect(await olderRowCount(PARTS_ON_ORDER)).toBe(olderBefore);
    const added = (await storeRecords(PARTS_ON_ORDER)).filter((r) => !storeBefore.has(r.id));
    expect(added.map((r) => r.document.part).sort()).toEqual([
      'Oatey 3 in no-hub coupling',
      'Rinnai RE180iN tankless heater',
    ]);
    made.push(...added.map((r) => r.id));
  });

  it('the picker offers the moved table once, from the store', async () => {
    const picked = await listPickableTables(ORG);
    const parts = picked.filter((t) => t.id === PARTS_ON_ORDER);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.store).toBe('record');
  });
});
