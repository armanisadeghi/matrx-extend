/**
 * The Showcase's tables: list the record-store Tables a person may save into, make a new one
 * from the extracted rows' columns, and append rows to one. Every call goes through the record
 * store (`@/lib/records/tables` over `@ai-matrx/records/core`); every table lives there since the
 * final switch.
 */

import { listMemberOrganizations } from '@/lib/org/active-org';
import { recordsClientFor } from '@/lib/records/store';
import { appendStoreRows, declareStoreTable, storeTables } from '@/lib/records/tables';
import { type DbCallSite, recordDbFailure } from '@/lib/supabase/db-failure';
import { requireOrganizationContext } from '@ai-matrx/agents/matrx';

/**
 * The value kinds the Showcase infers from extracted rows; `declareStoreTable` maps each to
 * the record store's own column type.
 */
export const USER_TABLE_DATA_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'json',
  'array',
] as const;
export type UserTableDataType = (typeof USER_TABLE_DATA_TYPES)[number];

/**
 * Slugify an arbitrary string into a snake_case column key: `^[a-z][a-z0-9_]*$`.
 * Examples:
 *   "@type"        → "type"
 *   "URL"          → "url"
 *   "First Name"   → "first_name"
 *   "price (USD)"  → "price_usd"
 *   "123 Items"    → "f_123_items" (must start with a letter)
 *   ""             → "field"
 */
export function toSnakeCaseFieldName(raw: string): string {
  let s = (raw ?? '').toString();
  s = s
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) return 'field';
  if (!/^[a-z]/.test(s)) s = `f_${s}`;
  return s;
}

/**
 * A record-store refusal keeps the STORE's own sentence ("SKU takes a date, and WAT-0009 is
 * not one") — the generic `failDbCall` words would hide what to fix — and is still recorded
 * durably in the platform's client-error store, like every other refused write here.
 */
async function recordedStoreCall<T>(site: DbCallSite, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const e = err as { message?: string; hint?: string };
    await recordDbFailure(site, 'failed', {
      message: e?.message ?? String(err),
      hint: e?.hint ?? null,
    });
    throw err;
  }
}

/** One table the Showcase may save into. */
export interface PickableTable {
  id: string;
  table_name: string;
  organization_id: string | null;
}

/**
 * Every record-store Table the Showcase may offer, each ONCE, across ALL of the person's
 * organizations (active-org law 2026-09-30: the active organization never narrows a read).
 * `organizationFilter` is an optional, explicit page filter; null/undefined means every
 * organization. Each table carries its own `organization_id` so a write into it runs in that
 * table's org. Throws on a refused read, never an empty list.
 */
export async function listPickableTables(
  organizationFilter?: string | null,
): Promise<PickableTable[]> {
  const orgIds = organizationFilter
    ? [requireOrganizationContext(organizationFilter)]
    : (await listMemberOrganizations('active')).map((o) => o.id);
  const picked = new Map<string, PickableTable>();
  for (const org of orgIds) {
    const client = await recordsClientFor(org, 'user');
    for (const t of await storeTables(client)) {
      if (!picked.has(t.id)) picked.set(t.id, t);
    }
  }
  return [...picked.values()];
}

/** The column keys a table holds — for the Showcase's "N columns had no match" note before an append. */
export async function tableColumnKeys(tableId: string, organizationId: string): Promise<string[]> {
  const org = requireOrganizationContext(organizationId);
  const client = await recordsClientFor(org, 'user');
  const fields = await client.fields({ table_id: tableId });
  if (!fields.ok) throw new Error(fields.error.message);
  return fields.data.map((f) => f.key);
}

/**
 * The organization a table belongs to — the Showcase proves it matches the operation's
 * organization before any linked write. `null` when the store holds no such Table.
 */
export async function tableOrganization(
  tableId: string,
  organizationId: string,
): Promise<string | null> {
  const org = requireOrganizationContext(organizationId);
  const client = await recordsClientFor(org, 'user');
  const table = await client.tableRead({ table_id: tableId });
  if (!table.ok) throw new Error(table.error.message);
  return table.data?.organization_id ?? null;
}

export interface CreateUserTableInput {
  table_name: string;
  description?: string;
  /** Immutable organization captured when the create action begins. */
  organization_id: string;
  fields: {
    field_name: string;
    display_name: string;
    data_type?: UserTableDataType;
    field_order: number;
  }[];
}

/** Make a record-store Table and every one of its columns in one declaration. */
export async function createUserTableFromSchema(
  input: CreateUserTableInput,
): Promise<{ id: string }> {
  // The request kernel is the sole UUID parser/normalizer. Keep its canonical
  // OrganizationContextError intact so every direct-write boundary agrees.
  const organizationId = requireOrganizationContext(input.organization_id);
  const client = await recordsClientFor(organizationId, 'user');
  const site: DbCallSite = {
    table: 'rpc:custom.table_declare',
    operation: 'rpc',
    what: 'create this table',
    title: 'Table not created',
  };
  const id = await recordedStoreCall(site, () =>
    declareStoreTable(client, {
      name: input.table_name,
      ...(input.description !== undefined && { description: input.description }),
      fields: input.fields.map((f) => ({
        field_name: toSnakeCaseFieldName(f.field_name),
        display_name: f.display_name || f.field_name,
        ...(f.data_type !== undefined && { data_type: f.data_type }),
        field_order: f.field_order,
      })),
    }),
  );
  return { id };
}

/**
 * Union of row keys across ALL rows, in first-seen order. Schema inference
 * and append mapping must both work from this — inferring from row 1 alone
 * creates tables missing columns the preview showed (audit P0-3).
 */
export function unionRowKeys(rows: Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys;
}

/**
 * Deterministic raw-key → field_name mapping with collision suffixes
 * ("Name" → name, "name" → name_2). THE single source of truth shared by
 * schema inference (create) and row mapping (append): if the two ever
 * slugify independently, rows with colliding keys silently overwrite each
 * other (audit P0-3 / L1).
 */
export function buildFieldNameMap(rawKeys: Iterable<string>): Map<string, string> {
  const used = new Set<string>();
  const map = new Map<string, string>();
  for (const rawKey of rawKeys) {
    if (map.has(rawKey)) continue;
    let field = toSnakeCaseFieldName(rawKey);
    if (used.has(field)) {
      let n = 2;
      while (used.has(`${field}_${n}`)) n++;
      field = `${field}_${n}`;
    }
    used.add(field);
    map.set(rawKey, field);
  }
  return map;
}

/**
 * Append rows to a record-store Table through `record_write_many`. Keys are mapped via ONE map
 * built from the union of all rows' keys, so collision suffixes line up with what
 * `inferSchemaFromRows` produced at table-creation time.
 */
export async function appendRowsToUserTable(
  tableId: string,
  operationOrganizationId: string,
  rows: Record<string, unknown>[],
): Promise<{ inserted: number }> {
  // Validate first, including for the empty-row no-op. A required operation
  // context is never optional merely because this invocation has no rows.
  const organizationId = requireOrganizationContext(operationOrganizationId);
  if (rows.length === 0) return { inserted: 0 };
  const client = await recordsClientFor(organizationId, 'user');
  const keyMap = buildFieldNameMap(unionRowKeys(rows));
  const mapped = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(r)) {
      const field = keyMap.get(k);
      if (field) out[field] = r[k];
    }
    return out;
  });
  const site: DbCallSite = {
    table: 'rpc:custom.record_write_many',
    operation: 'rpc',
    what: 'add these rows to your table',
    title: 'Rows not added to the table',
  };
  const written = await recordedStoreCall(site, () => appendStoreRows(client, tableId, mapped));
  return { inserted: written.inserted };
}

/**
 * Heuristic that maps an extracted row's value types to a UserTableDataType.
 * Used by the "Create new from these fields" button so the user doesn't have
 * to think about types.
 */
export function inferDataType(value: unknown): UserTableDataType {
  if (value === null || value === undefined) return 'string';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'json';
  if (typeof value === 'string') {
    // Only attempt date detection on short strings — avoid catching long
    // descriptions that happen to start with a parseable substring.
    if (value.length <= 40) {
      // YYYY-MM-DD with NO time component → date
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
      // ISO 8601 with time, or any string Date.parse can read AND that
      // contains a time delimiter → datetime
      if (
        /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value) ||
        (!Number.isNaN(Date.parse(value)) && /\d{1,2}:\d{2}/.test(value))
      ) {
        return 'datetime';
      }
      // A written-out date with no time → date. ONLY recognised shapes: V8's Date.parse
      // reads "WAT-0009" (a SKU) as the year 2001, and a column typed `date` from that is
      // refused by the record store on every row ("SKU takes a date"), where the older
      // store's permissive validation had silently kept the text (lane INTEG-CLIENTS).
      if (
        /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value) ||
        /^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}$/.test(value) ||
        /^\d{1,2} [A-Za-z]{3,9}\.? \d{4}$/.test(value)
      ) {
        if (!Number.isNaN(Date.parse(value))) return 'date';
      }
    }
  }
  return 'string';
}

export interface InferredField {
  field_name: string;
  display_name: string;
  data_type: UserTableDataType;
  field_order: number;
}

/**
 * Schema from the UNION of all rows' keys (first-seen order), typed from the
 * first non-null value per key. The preview table shows the union — the
 * created table must match it, or later rows silently lose columns.
 */
export function inferSchemaFromRows(rows: Record<string, unknown>[]): InferredField[] {
  const keys = unionRowKeys(rows);
  const map = buildFieldNameMap(keys);
  return keys.map((rawKey, i) => {
    let sample: unknown;
    for (const r of rows) {
      const v = r[rawKey];
      if (v !== null && v !== undefined) {
        sample = v;
        break;
      }
    }
    return {
      field_name: map.get(rawKey) as string,
      display_name: rawKey,
      data_type: inferDataType(sample),
      field_order: i,
    };
  });
}

/** @deprecated Use inferSchemaFromRows — single-row inference misses columns. */
export function inferSchemaFromRow(row: Record<string, unknown>): InferredField[] {
  return inferSchemaFromRows([row]);
}
