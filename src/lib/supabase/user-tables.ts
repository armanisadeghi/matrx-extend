/**
 * Direct Supabase queries against the user-defined dynamic-table system:
 *   - user_tables   (table definitions)
 *   - table_fields  (schema per table)
 *   - table_data    (rows, each as JSONB keyed by field_name)
 *
 * These tables already exist in the Matrx Supabase project — the extension
 * does NOT create them. RLS + cascade triggers handle ownership and
 * is_public inheritance server-side.
 *
 * Used by the Structured-Data Showcase to let the user save extracted rows
 * straight into a user-defined knowledge-base table.
 */

import { getSupabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/state/auth';
import { z } from 'zod';

/**
 * `table_fields.data_type` is a Postgres ENUM `public.field_data_type`. The
 * default value is `'string'`. Other valid values are not known to the
 * extension yet — until they're, we omit the field on insert and let the DB
 * default apply. The TS type below reflects what we display in the UI; we
 * never send these values across the wire.
 */
export const USER_TABLE_DATA_TYPES = [
  'string',
  'number',
  'date',
  'url',
  'boolean',
  'json',
] as const;
export type UserTableDataType = (typeof USER_TABLE_DATA_TYPES)[number];

/**
 * Slugify an arbitrary string into a snake_case identifier matching the
 * `table_fields.field_name` CHECK constraint: `^[a-z][a-z0-9_]*$`.
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
 * Mirrors public.user_tables. Note: the column is `table_name`, not `name`.
 * We expose it as `name` on the TS side for readability.
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
    .from('user_tables')
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
    .from('table_fields')
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
  /** Maps to `user_tables.table_name`. */
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
 * Two-step create: insert user_tables row, then bulk-insert table_fields.
 * If field insert fails, we delete the parent so we don't leave a schemaless
 * table behind.
 *
 * Note: user_tables.user_id is NOT NULL with no default, so we provide it
 * explicitly from the auth store. RLS still enforces ownership.
 */
export async function createUserTableFromSchema(
  input: CreateUserTableInput,
): Promise<{ id: string } | null> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) {
    console.warn('[matrx-extend] createUserTableFromSchema: not signed in');
    return null;
  }

  const c = getSupabase();

  const { data: tableRow, error: tableErr } = await c
    .from('user_tables')
    .insert({
      table_name: input.table_name,
      description: input.description ?? null,
      user_id: userId,
      is_public: input.is_public ?? false,
      organization_id: input.organization_id ?? null,
      project_id: input.project_id ?? null,
      task_id: input.task_id ?? null,
    })
    .select('id')
    .single();
  if (tableErr) {
    console.warn('[matrx-extend] createUserTableFromSchema (table) error', tableErr.message);
    return null;
  }
  const tableId = (tableRow as { id: string }).id;

  if (input.fields.length === 0) return { id: tableId };

  // Note on data_type: the column is a Postgres ENUM `public.field_data_type`
  // with default 'string'. Other valid values are not yet known to the
  // extension; until they are, omit the field on insert and let the DB default
  // apply rather than risk an enum-mismatch error.
  const { error: fieldsErr } = await c
    .from('table_fields')
    .insert(
      input.fields.map((f) => ({
        table_id: tableId,
        user_id: userId,
        field_name: toSnakeCaseFieldName(f.field_name),
        display_name: f.display_name || f.field_name,
        field_order: f.field_order,
        is_required: f.is_required ?? false,
      })),
    );
  if (fieldsErr) {
    console.warn('[matrx-extend] createUserTableFromSchema (fields) error', fieldsErr.message);
    await c.from('user_tables').delete().eq('id', tableId);
    return null;
  }

  return { id: tableId };
}

/**
 * Append rows to an existing user table. Each row is stored as one
 * table_data row with the row payload in the `data` jsonb column, keyed by
 * the table's `field_name` values.
 *
 * Source rows arrive with arbitrary keys (e.g. extracted-data field names).
 * We snake-case-slugify those keys, then drop any that don't appear in the
 * table's schema. table_data.user_id is required by the table; we read it
 * from the auth store.
 */
export async function appendRowsToUserTable(
  tableId: string,
  rows: Record<string, unknown>[],
): Promise<{ inserted: number } | null> {
  if (rows.length === 0) return { inserted: 0 };

  const userId = useAuthStore.getState().user?.id;
  if (!userId) {
    console.warn('[matrx-extend] appendRowsToUserTable: not signed in');
    return null;
  }

  const c = getSupabase();
  const schema = await getUserTableSchema(tableId);
  const allowed = new Set(schema.map((f) => f.field_name));

  const cleanedRows = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(r)) {
      const slug = toSnakeCaseFieldName(k);
      if (allowed.size === 0 || allowed.has(slug)) {
        out[slug] = r[k];
      }
    }
    return out;
  });

  const { error } = await c
    .from('table_data')
    .insert(
      cleanedRows.map((data) => ({
        table_id: tableId,
        user_id: userId,
        data,
      })),
    );
  if (error) {
    console.warn('[matrx-extend] appendRowsToUserTable error', error.message);
    return null;
  }
  return { inserted: cleanedRows.length };
}

/**
 * Heuristic that maps an extracted row's value types to a UserTableDataType.
 * Used by the "Create new from these fields" button so the user doesn't have
 * to think about types.
 */
export function inferDataType(value: unknown): UserTableDataType {
  if (value === null || value === undefined) return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return 'json';
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) return 'url';
    if (/^\d{4}-\d{2}-\d{2}/.test(value) || !Number.isNaN(Date.parse(value))) {
      // Only flag as date if the string is short and parseable — avoid catching
      // long descriptions that happen to start with a parseable substring.
      if (value.length <= 40) return 'date';
    }
  }
  return 'string';
}

export function inferSchemaFromRow(
  row: Record<string, unknown>,
): {
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
