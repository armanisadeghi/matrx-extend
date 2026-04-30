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
import { z } from 'zod';

export const USER_TABLE_DATA_TYPES = [
  'text',
  'number',
  'date',
  'url',
  'boolean',
  'json',
] as const;
export type UserTableDataType = (typeof USER_TABLE_DATA_TYPES)[number];

export const UserTableSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
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
    .select('id, name, description, created_at, updated_at')
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
  name: string;
  description?: string;
  fields: { field_name: string; data_type: UserTableDataType; field_order: number }[];
}

/**
 * Two-step create: insert user_tables row, then bulk-insert table_fields.
 * If field insert fails, we delete the parent so we don't leave a schemaless
 * table behind.
 */
export async function createUserTableFromSchema(
  input: CreateUserTableInput,
): Promise<{ id: string } | null> {
  const c = getSupabase();

  const { data: tableRow, error: tableErr } = await c
    .from('user_tables')
    .insert({ name: input.name, description: input.description ?? null })
    .select('id')
    .single();
  if (tableErr) {
    console.warn('[matrx-extend] createUserTableFromSchema (table) error', tableErr.message);
    return null;
  }
  const tableId = (tableRow as { id: string }).id;

  if (input.fields.length === 0) return { id: tableId };

  const { error: fieldsErr } = await c
    .from('table_fields')
    .insert(
      input.fields.map((f) => ({
        table_id: tableId,
        field_name: f.field_name,
        data_type: f.data_type,
        field_order: f.field_order,
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
 * table_data row with the row payload in the `data` jsonb column.
 *
 * Drops keys not declared in the table's schema to keep the JSONB tidy
 * (the EAV approach lets you store anything, but we shouldn't).
 */
export async function appendRowsToUserTable(
  tableId: string,
  rows: Record<string, unknown>[],
): Promise<{ inserted: number } | null> {
  if (rows.length === 0) return { inserted: 0 };

  const c = getSupabase();
  const schema = await getUserTableSchema(tableId);
  const allowed = new Set(schema.map((f) => f.field_name));

  const cleanedRows = rows.map((r) => {
    if (allowed.size === 0) return r;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(r)) {
      if (allowed.has(k)) out[k] = r[k];
    }
    return out;
  });

  const { error } = await c
    .from('table_data')
    .insert(cleanedRows.map((data) => ({ table_id: tableId, data })));
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
  if (value === null || value === undefined) return 'text';
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
  return 'text';
}

export function inferSchemaFromRow(
  row: Record<string, unknown>,
): { field_name: string; data_type: UserTableDataType; field_order: number }[] {
  return Object.keys(row).map((field_name, i) => ({
    field_name,
    data_type: inferDataType(row[field_name]),
    field_order: i,
  }));
}
