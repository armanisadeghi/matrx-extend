# Requested RPCs — `user_tables` integration

The matrx-extend Showcase saves extracted rows into the `user_tables` /
`table_fields` / `table_data` system. The current client-side implementation
in [src/lib/supabase/user-tables.ts](../src/lib/supabase/user-tables.ts) uses
multiple separate `INSERT` calls and a manual rollback, which is fragile.

Two RPCs would replace that with atomic, race-free flows. Both should run
under the caller's `auth.uid()` so RLS continues to enforce ownership.

---

## RPC 1 — `create_user_table_with_fields`

### Purpose
Create a new `user_tables` row plus all its `table_fields` rows in one
transaction. Eliminates the current "insert table, insert fields, on failure
delete table" rollback dance.

### Signature

```sql
create or replace function public.create_user_table_with_fields(
  p_table_name      text,
  p_description     text default null,
  p_is_public       boolean default false,
  p_organization_id uuid default null,
  p_project_id      uuid default null,
  p_task_id         uuid default null,
  p_fields          jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security invoker  -- runs as the caller; RLS still applies
as $$
declare
  v_table_id uuid;
  v_field    jsonb;
begin
  insert into public.user_tables (
    table_name, description, is_public,
    organization_id, project_id, task_id, user_id
  )
  values (
    p_table_name, p_description, p_is_public,
    p_organization_id, p_project_id, p_task_id, auth.uid()
  )
  returning id into v_table_id;

  for v_field in select * from jsonb_array_elements(p_fields)
  loop
    insert into public.table_fields (
      table_id, user_id,
      field_name, display_name,
      data_type, field_order, is_required,
      default_value, validation_rules
    )
    values (
      v_table_id,
      auth.uid(),
      v_field->>'field_name',
      coalesce(v_field->>'display_name', v_field->>'field_name'),
      coalesce((v_field->>'data_type')::public.field_data_type, 'string'::public.field_data_type),
      coalesce((v_field->>'field_order')::int, 0),
      coalesce((v_field->>'is_required')::boolean, false),
      v_field->'default_value',
      v_field->'validation_rules'
    );
  end loop;

  return v_table_id;
end;
$$;

grant execute on function public.create_user_table_with_fields(
  text, text, boolean, uuid, uuid, uuid, jsonb
) to authenticated;
```

### Input shape (`p_fields`)

```json
[
  {
    "field_name": "event_name",
    "display_name": "Event Name",
    "data_type": "string",
    "field_order": 0,
    "is_required": false
  },
  { "field_name": "event_date", "display_name": "Event Date", "data_type": "date", "field_order": 1 }
]
```

`field_name` must already be snake_case (matches the existing CHECK constraint
`^[a-z][a-z0-9_]*$`); the extension slugifies on the client before calling.

### Return
The new `user_tables.id` (uuid).

### Why this matters
Without atomicity, a failed `table_fields` insert leaves a schemaless table
behind. The current client-side mitigation deletes the parent on field-insert
failure, which races with concurrent reads.

---

## RPC 2 — `append_rows_to_user_table`

### Purpose
Bulk-insert into `table_data` with `user_id = auth.uid()` set automatically.
Single round-trip, single transaction, schema-validated.

### Signature

```sql
create or replace function public.append_rows_to_user_table(
  p_table_id uuid,
  p_rows     jsonb       -- array of objects, each = one row's data column
) returns int
language plpgsql
security invoker
as $$
declare
  v_inserted int;
  v_allowed  text[];
  v_row      jsonb;
  v_clean    jsonb;
  v_key      text;
begin
  -- 1. Verify the user owns the table (RLS would catch it, but we want a
  --    clean error rather than zero rows on a wrong table_id).
  if not exists (
    select 1 from public.user_tables
    where id = p_table_id and user_id = auth.uid()
  ) then
    raise exception 'table not found or not owned by caller';
  end if;

  -- 2. Pull the allowed field names so we can drop unknown keys.
  select array_agg(field_name) into v_allowed
  from public.table_fields
  where table_id = p_table_id;

  -- 3. Insert one table_data row per p_rows element, with unknown keys filtered.
  v_inserted := 0;
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_clean := '{}'::jsonb;
    for v_key in select jsonb_object_keys(v_row)
    loop
      if v_allowed is null or v_key = any(v_allowed) then
        v_clean := v_clean || jsonb_build_object(v_key, v_row -> v_key);
      end if;
    end loop;

    insert into public.table_data (table_id, user_id, data)
    values (p_table_id, auth.uid(), v_clean);
    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

grant execute on function public.append_rows_to_user_table(uuid, jsonb) to authenticated;
```

### Input shape (`p_rows`)

```json
[
  { "event_name": "Concert A", "event_date": "2026-05-15" },
  { "event_name": "Concert B", "event_date": "2026-05-16" }
]
```

Keys must be the table's `field_name` (snake_case); the extension slugifies
before calling.

### Return
Count of inserted rows.

---

## How the extension would call them

```ts
// Replace this current two-step:
//   insert user_tables → if ok → insert table_fields → if not ok → delete user_tables
//
// With:
const { data, error } = await supabase.rpc('create_user_table_with_fields', {
  p_table_name: 'Events',
  p_description: 'Auto-created from matrx-extend extraction.',
  p_is_public: false,
  p_organization_id: null,
  p_project_id: null,
  p_task_id: null,
  p_fields: [{ field_name: 'event_name', display_name: 'Event Name', field_order: 0 }],
});
// data is the new uuid
```

```ts
const { data, error } = await supabase.rpc('append_rows_to_user_table', {
  p_table_id: tableId,
  p_rows: rows,
});
// data is the inserted count
```

---

## Optional bonus — exposing the `field_data_type` enum

Right now the extension only safely uses `'string'` because it doesn't know
the rest of the enum values. A tiny helper would let the UI show valid
options:

```sql
create or replace function public.list_field_data_types()
returns text[]
language sql
stable
as $$
  select array(
    select unnest(enum_range(null::public.field_data_type))::text
  );
$$;

grant execute on function public.list_field_data_types() to authenticated;
```

Once this exists, the extension's "Create new from these fields…" preview
can render the right type dropdowns instead of defaulting everything to
`'string'`.
