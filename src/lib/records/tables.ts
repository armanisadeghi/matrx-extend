/**
 * THE EXTENSION'S TABLES, BY WHERE THEY LIVE (lane INTEG-CLIENTS, CUTOVER-PLAN rev 3 E1/E2).
 *
 * The Showcase saves scraped rows into a table — a new one ("Create new from these
 * fields…") or one the person already keeps. Until 2026-09-23 both went straight to the
 * older store (`create_user_table_with_fields`, `append_rows_to_user_table`), so for an
 * organization whose tables had MOVED into the record store a new table was born where
 * its screens no longer look, and an append wrote into the moved table's archived older
 * copy and reported success. After the flip both would write into tables nobody can see.
 *
 * Every answer here comes from the database, through `@ai-matrx/records/core`:
 *
 *   tablesLiveIn(org)   `platform.knob_resolve('data_tables','older_tables_moved', org)` —
 *                       written TRUE by the mover per organization, and for everyone at the
 *                       flip. A read that fails THROWS with the reason: a table made in the
 *                       wrong store is worse than a table not made.
 *   storeTables(client) the organization's record-store Tables (`tableList`), so the picker
 *                       offers them and an append knows its target is a store table.
 *   declareStoreTable   ONE `table_declare` carrying every column: the store makes the Table
 *                       and its Field records in one statement (LIMITS-FIX 2026-09-21), so a
 *                       table is never half made. Its Home is a record in the person kernel
 *                       (REC-1 / REC-14), exactly as records-ui `declareTable` does it.
 *   appendStoreRows     `record_write_many` — one call per batch, the store's own refusals.
 *
 * MISSING PRIMITIVE, named for GRID-PRIMITIVES: records-ui's `declareTable` is the platform's
 * one "make a table with these columns" helper, but it lives in a React package this service
 * worker cannot load (records-ui pulls design-system, alchemy, print and recharts). The door
 * shape the extension needs is a HEADLESS `declareTable(client, NewTableSpec)` exported from
 * `@ai-matrx/records/core`. Until it exists this file composes the same three doors.
 */

import { customDb, platformDb } from '@/lib/supabase/schemas';
import type { RecordsClient } from '@ai-matrx/records/core';

/** The knob the mover writes when an organization's tables move (aidream movers/move.py). */
export const OLDER_TABLES_MOVED_KNOB = {
  feature: 'data_tables',
  key: 'older_tables_moved',
} as const;

/** A store refusal, carried as an Error so the UI's existing catch paths print it. */
export class RecordStoreTableError extends Error {
  readonly hint: string | undefined;
  constructor(message: string, hint?: string) {
    super(hint ? `${message} ${hint}` : message);
    this.name = 'RecordStoreTableError';
    this.hint = hint;
  }
}

function refusal(error: { message: string; hint?: string | null }): RecordStoreTableError {
  return new RecordStoreTableError(error.message, error.hint ?? undefined);
}

/** Where this organization's tables live: the record store once they moved, else the older store. */
export async function tablesLiveIn(organizationId: string): Promise<'record' | 'older'> {
  const { data, error } = await platformDb().rpc('knob_resolve', {
    p_feature: OLDER_TABLES_MOVED_KNOB.feature,
    p_key: OLDER_TABLES_MOVED_KNOB.key,
    p_organization_id: organizationId,
  });
  if (error) {
    throw new RecordStoreTableError(
      'Could not read where this organization keeps its tables, so nothing was saved — saving into the wrong place would hide it from your screens. Try again.',
      error.message,
    );
  }
  return data === true || data === 'true' ? 'record' : 'older';
}

/**
 * WHERE EACH OF THESE TABLES IS READ AND WRITTEN (lane WHERE-LIVES-SWITCH, census row X1).
 *
 * The store's one answer, `custom.where_tables_live`, read from the organization's Data tables
 * switch — never "does the store hold a Table with this id?". COPY mode copied every older table
 * into the store under the SAME id and left the older table live until the owner presses the
 * switch, so asking for the copy's existence sent the Showcase's appends into the copy while the
 * owner kept working in the older table. "older": write the older table (its copy is read-only
 * and the store refuses a write to it). "record": the store. A refused read THROWS: saving into
 * the wrong place would hide the rows from the owner's screens.
 */
export async function tablesLiveWhere(tableIds: readonly string[]): Promise<Map<string, 'record' | 'older'>> {
  const ids = [...new Set(tableIds.filter(Boolean))];
  const homes = new Map<string, 'record' | 'older'>();
  if (ids.length === 0) return homes;
  const { data, error } = await customDb().rpc('where_tables_live', { p_table_ids: ids });
  if (error) {
    throw new RecordStoreTableError(
      'Could not read where this table lives, so nothing was saved — saving into the wrong place would hide it from your screens. Try again.',
      error.message,
    );
  }
  for (const row of (data ?? []) as { table_id?: unknown; lives_in?: unknown }[]) {
    if (typeof row.table_id === 'string' && (row.lives_in === 'record' || row.lives_in === 'older')) {
      homes.set(row.table_id, row.lives_in);
    }
  }
  return homes;
}

/** Where one table is read and written; throws when the store did not say. */
export async function tableLivesWhere(tableId: string): Promise<'record' | 'older'> {
  const home = (await tablesLiveWhere([tableId])).get(tableId);
  if (!home) {
    throw new RecordStoreTableError(
      'Could not read where this table lives, so nothing was saved. Try again.',
      'custom.where_tables_live gave no answer for this table.',
    );
  }
  return home;
}

export interface StoreTableSummary {
  id: string;
  table_name: string;
  organization_id: string;
}

/** The organization's own record-store Tables (never the kernel tables the store keeps). */
export async function storeTables(client: RecordsClient): Promise<StoreTableSummary[]> {
  const listed = await client.tableList();
  if (!listed.ok) throw refusal(listed.error);
  return listed.data
    .filter((t) => !t.is_kernel && !(t.slug ?? '').startsWith('records_ui_'))
    .map((t) => ({ id: t.id, table_name: t.name, organization_id: t.organization_id }));
}

/** The older storage words the Showcase infers → the store's word for the column. */
function storeTypeFor(dataType: string | undefined): { type: string; multi?: boolean } {
  switch (dataType) {
    case 'number':
    case 'integer':
      return { type: 'number' };
    case 'boolean':
      return { type: 'checkbox' };
    case 'date':
    case 'datetime':
      return { type: 'datetime' };
    case 'json':
      return { type: 'long_text' };
    case 'array':
      return { type: 'text', multi: true };
    default:
      return { type: 'text' };
  }
}

function slugFor(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'table'
  );
}

export interface NewStoreTable {
  name: string;
  description?: string;
  fields: { field_name: string; display_name: string; data_type?: string; field_order: number }[];
}

/** Make a Table and every one of its columns in one declaration. Returns the Table's id. */
export async function declareStoreTable(
  client: RecordsClient,
  input: NewStoreTable,
): Promise<string> {
  const fields = [...input.fields].sort((a, b) => a.field_order - b.field_order);
  const personKernel = await client.personKernelId();
  if (!personKernel.ok) throw refusal(personKernel.error);
  const home = await client.recordWrite({
    table_id: personKernel.data,
    data: { name: `${input.name} Home` },
  });
  if (!home.ok) throw refusal(home.error);
  const titleField = fields[0]?.field_name ?? 'title';
  const declared = await client.tableDeclare({
    homeId: home.data,
    spec: {
      name: input.name,
      slug: slugFor(input.name),
      type: 'entity',
      label_singular: input.name,
      label_plural: input.name,
      display: 'list',
      weight: 'light',
      ordered: false,
      row_order: 'manual',
      title_field: titleField,
      retention_days: 365,
      // AGT-1: a table a person made is agent-writable by declaration; the organization turns it off.
      agent_writable: true,
      default_sort: [{ field: titleField, direction: 'asc' }],
      ...(input.description ? { description: input.description } : {}),
      fields:
        fields.length > 0
          ? fields.map((f, i) => ({
              name: f.field_name,
              key: f.field_name,
              label: f.display_name || f.field_name,
              sort: (i + 1) * 100,
              required: false,
              ...storeTypeFor(f.data_type),
            }))
          : [
              {
                name: 'title',
                key: 'title',
                label: 'Title',
                type: 'text',
                sort: 100,
                required: false,
              },
            ],
    },
  });
  if (!declared.ok) {
    // Leave no empty Home behind a refused declaration (records-ui `declareTable` does the same).
    await client.recordDelete({ record_id: home.data });
    throw refusal(declared.error);
  }
  return declared.data;
}

/**
 * Append rows (already keyed by the table's own column keys) to a store Table. Keys the
 * Table has no column for are DROPPED AND NAMED — the older door dropped them silently.
 */
export async function appendStoreRows(
  client: RecordsClient,
  tableId: string,
  rows: Record<string, unknown>[],
): Promise<{ inserted: number; unmatched: string[] }> {
  if (rows.length === 0) return { inserted: 0, unmatched: [] };
  const fields = await client.fields({ table_id: tableId });
  if (!fields.ok) throw refusal(fields.error);
  const keys = new Set(fields.data.map((f) => f.key));
  const unmatched = new Set<string>();
  const documents = rows
    .map((r) => {
      const doc: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (keys.has(k)) doc[k] = v;
        else unmatched.add(k);
      }
      return doc;
    })
    .filter((d) => Object.keys(d).length > 0);
  if (documents.length === 0) return { inserted: 0, unmatched: [...unmatched] };
  const written = await client.recordWriteMany({ table_id: tableId, rows: documents as never });
  if (!written.ok) throw refusal(written.error);
  return { inserted: written.data.length, unmatched: [...unmatched] };
}
