/**
 * Direct Supabase queries against the user-defined dynamic-table system
 * ("UDT" — user-defined data types). Tables (renamed 2026-04-30):
 *   - udt_datasets        (table definitions, was `user_tables`)
 *   - udt_dataset_fields  (schema per table, was `table_fields`)
 *   - udt_dataset_rows    (rows as JSONB keyed by field_name, was `table_data`)
 *
 * These tables already exist in the Matrx Supabase project — the extension
 * does NOT create them. RLS + cascade triggers handle ownership and
 * is_public inheritance server-side.
 *
 * Used by the Structured-Data Showcase to let the user save extracted rows
 * straight into a user-defined knowledge-base dataset.
 *
 * Note on RPC names: the create + append RPCs (`create_user_table_with_fields`,
 * `append_rows_to_user_table`) kept their pre-rename names by design — the
 * server-side migration only renamed tables, not RPC signatures. So the
 * function calls below still work post-rename.
 *
 * udt_v2_backbone (live on Matrx Main 2026-05-29): the server gained workbook
 * grouping (`udt_workbooks`) and an append-only row-version audit log
 * (`udt_dataset_row_versions`). Both are transparent to this file — our two
 * RPCs are unchanged, and the new BEFORE-validate trigger defaults to
 * 'permissive' (a passthrough). Every append we send now also logs a version
 * row, attributed to the user's `auth.uid()` since we write with the user JWT.
 * The four RPCs we do NOT use (batch_update_rows_in_user_table,
 * remove_column_from_user_table, create_new_user_table, create_new_user_table_wrapper)
 * are slated for removal — do not start calling them.
 */

import { getSupabase } from '@/lib/supabase/client';
import { z } from 'zod';

/**
 * Mirrors the Postgres ENUM `public.field_data_type`. Authoritative source is
 * `select unnest(enum_range(null::field_data_type))` — the RPC
 * `list_field_data_types()` returns the same values if you ever need them at
 * runtime. Update this list when new enum values are added.
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
 * Slugify an arbitrary string into a snake_case identifier matching the
 * `udt_dataset_fields.field_name` CHECK constraint: `^[a-z][a-z0-9_]*$`.
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
 * Mirrors public.udt_datasets (renamed from user_tables 2026-04-30). Column
 * names were intentionally NOT renamed — `table_name`, `is_public`, etc.
 * stay as-is so RPC bodies and existing client code keep working.
 */
export const UserTableSchema = z.object({
  id: z.string().uuid(),
  table_name: z.string(),
  description: z.string().nullable(),
  user_id: z.string().uuid(),
  is_public: z.boolean(),
  version: z.number().int().nullable(),
  organization_id: z.string().uuid().nullable(),
  project_id: z.string().uuid().nullable(),
  task_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});
export type UserTable = z.infer<typeof UserTableSchema>;

export const TableFieldSchema = z.object({
  id: z.string().uuid(),
  table_id: z.string().uuid(),
  field_name: z.string(),
  data_type: z.string(),
  field_order: z.number().int(),
  validation_rules: z.unknown().nullable(),
});
export type TableField = z.infer<typeof TableFieldSchema>;

export async function listUserTables(): Promise<UserTable[]> {
  const c = getSupabase();
  const { data, error } = await c
    .from('udt_datasets')
    .select(
      'id, table_name, description, user_id, is_public, version, organization_id, project_id, task_id, created_at, updated_at',
    )
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    console.warn('[matrx-extend] listUserTables error', error.message);
    return [];
  }
  return z.array(UserTableSchema).parse(data ?? []);
}

export async function getUserTableSchema(tableId: string): Promise<TableField[]> {
  const c = getSupabase();
  const { data, error } = await c
    .from('udt_dataset_fields')
    .select('id, table_id, field_name, data_type, field_order, validation_rules')
    .eq('table_id', tableId)
    .order('field_order', { ascending: true });
  if (error) {
    console.warn('[matrx-extend] getUserTableSchema error', error.message);
    return [];
  }
  return z.array(TableFieldSchema).parse(data ?? []);
}

export interface CreateUserTableInput {
  /** Maps to `udt_datasets.table_name`. */
  table_name: string;
  description?: string;
  is_public?: boolean;
  organization_id?: string | null;
  project_id?: string | null;
  task_id?: string | null;
  fields: {
    field_name: string;
    display_name: string;
    data_type?: UserTableDataType;
    field_order: number;
    is_required?: boolean;
  }[];
}

/**
 * Atomic create via the `create_user_table_with_fields` RPC. Inserts the
 * udt_datasets row plus all udt_dataset_fields rows in one transaction; the
 * RPC runs as security_invoker so RLS still applies and `auth.uid()` stamps
 * the owner server-side. RPC name kept as-is post-rename — the server only
 * renamed tables, not function signatures.
 */
export async function createUserTableFromSchema(
  input: CreateUserTableInput,
): Promise<{ id: string } | null> {
  const c = getSupabase();
  const { data, error } = await c.rpc('create_user_table_with_fields', {
    p_table_name: input.table_name,
    p_description: input.description ?? null,
    p_is_public: input.is_public ?? false,
    p_organization_id: input.organization_id ?? null,
    p_project_id: input.project_id ?? null,
    p_task_id: input.task_id ?? null,
    p_fields: input.fields.map((f) => ({
      field_name: toSnakeCaseFieldName(f.field_name),
      display_name: f.display_name || f.field_name,
      data_type: f.data_type ?? 'string',
      field_order: f.field_order,
      is_required: f.is_required ?? false,
    })),
  });
  if (error) {
    console.warn('[matrx-extend] createUserTableFromSchema error', error.message);
    return null;
  }
  return { id: data as string };
}

/**
 * Append rows to a dataset via the `append_rows_to_user_table` RPC. The RPC
 * stamps user_id from auth.uid() and silently drops keys that don't match a
 * declared field_name on the target dataset. RPC name kept post-rename.
 *
 * We slugify keys client-side first so cosmetic keys (e.g. "Event Name")
 * land on the right field names ("event_name") before the server-side
 * schema check runs.
 */
export async function appendRowsToUserTable(
  tableId: string,
  rows: Record<string, unknown>[],
): Promise<{ inserted: number } | null> {
  if (rows.length === 0) return { inserted: 0 };

  const cleanedRows = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(r)) {
      out[toSnakeCaseFieldName(k)] = r[k];
    }
    return out;
  });

  const c = getSupabase();
  const { data, error } = await c.rpc('append_rows_to_user_table', {
    p_table_id: tableId,
    p_rows: cleanedRows,
  });
  if (error) {
    console.warn('[matrx-extend] appendRowsToUserTable error', error.message);
    return null;
  }
  return { inserted: typeof data === 'number' ? data : 0 };
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
      // Date.parse-able short string, no explicit time → date
      if (!Number.isNaN(Date.parse(value)) && /\d{4}/.test(value)) return 'date';
    }
  }
  return 'string';
}

export function inferSchemaFromRow(row: Record<string, unknown>): {
  field_name: string;
  display_name: string;
  data_type: UserTableDataType;
  field_order: number;
}[] {
  const seen = new Set<string>();
  return Object.keys(row).map((rawKey, i) => {
    let field_name = toSnakeCaseFieldName(rawKey);
    // Avoid clashes if two raw keys slugify to the same name.
    if (seen.has(field_name)) {
      let n = 2;
      while (seen.has(`${field_name}_${n}`)) n++;
      field_name = `${field_name}_${n}`;
    }
    seen.add(field_name);
    return {
      field_name,
      display_name: rawKey,
      data_type: inferDataType(row[rawKey]),
      field_order: i,
    };
  });
}
