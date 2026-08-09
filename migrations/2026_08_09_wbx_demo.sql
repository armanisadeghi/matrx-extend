-- wbx_demo — cloud-synced recorded demo BODIES (TASK-004 follow-up).
--
-- Why this table exists
-- ---------------------
-- Guidance metadata already syncs (extend.wbx_guidance), but a guidance item of
-- kind `demo_ref` carries only a POINTER. The recorded demo itself lived
-- local-only in chrome.storage.local under `matrx.demos.{id}`. On a fresh
-- machine a synced demo_ref listed fine and then `replay_demo` failed — the user
-- was shown a saved workflow that did not exist. That is worse than not syncing
-- it at all: it reads as "replay is broken" rather than "the demo is absent".
--
-- Why a dedicated table instead of folding the body into wbx_guidance.data
-- ----------------------------------------------------------------------
--   1. Demos outlive (and out-scope) their refs. `record_demo` saves a demo with
--      NO guidance ref at all; the Guidance UI path creates one. A body that
--      only travels inside a guidance row would leave every agent-recorded demo
--      unsynced.
--   2. N refs → 1 demo. Folding duplicates the body per ref and forks it on edit.
--   3. Size. The guidance hydrate selects `data` for EVERY row on sign-in. A
--      demo body is a full step list with a selector chain and an element
--      snapshot per step — orders of magnitude larger than the pointers that
--      column was designed for. Folding turns a cheap metadata sync into a
--      multi-megabyte pull just to list captions.
-- The body is one `body` jsonb (the full Demo record) rather than a steps table:
-- it is only ever read and written whole, and a relational step table would buy
-- nothing but joins.
--
-- Ownership follows the extend template: `created_by` (NOT user_id), stamped by
-- BEFORE-INSERT triggers together with `organization_id`. Clients must never
-- send either column.
--
-- Apply order: after 2026_06_10_wbx_guidance_soft_delete.sql.
-- Apply via aidream's applier (`python db/apply_migrations.py --source matrx-extend`)
-- against Supabase project txzxabzwovsujtloxrus.

create table if not exists extend.wbx_demo (
  -- Client-generated demo id (NOT a uuid) — e.g. 'demo_<uuid>'. Keeping the
  -- client id as the PK is what lets a guidance `demo_ref` pointer stay valid
  -- across machines with no id-translation layer.
  id text primary key,

  -- Denormalised summary columns so a list/repair query never pulls `body`.
  name text not null default '',
  description text not null default '',
  start_url text not null default '',
  step_count integer not null default 0,
  parameter_names text[] not null default '{}',

  -- The full Demo record (steps + parameters + the client's own epoch-ms
  -- created_at/updated_at). The client timestamps live IN here on purpose: the
  -- platform `_100_touch_row` trigger overwrites the `updated_at` COLUMN with
  -- now() on every write, so the column is server bookkeeping and cannot be
  -- used for cross-machine last-write-wins. The body's timestamps can.
  body jsonb not null default '{}'::jsonb,

  -- Tombstone — deletes propagate as soft-deletes so another machine's hydrate
  -- can apply them (same contract as wbx_guidance.is_deleted).
  is_deleted boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- extend base-entity template. organization_id is NOT NULL with NO default —
  -- the _stamp_org_default trigger below is the only thing that fills it.
  organization_id uuid not null,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  visibility platform.visibility not null default 'internal'
);

create index if not exists wbx_demo_owner_updated_idx
  on extend.wbx_demo (created_by, updated_at desc);

alter table extend.wbx_demo enable row level security;

grant select, insert, update, delete on extend.wbx_demo to anon, authenticated;
grant select, insert, update, delete on extend.wbx_demo to service_role;

drop policy if exists wbx_demo_owner_select on extend.wbx_demo;
drop policy if exists wbx_demo_owner_insert on extend.wbx_demo;
drop policy if exists wbx_demo_owner_update on extend.wbx_demo;
drop policy if exists wbx_demo_owner_delete on extend.wbx_demo;
drop policy if exists wbx_demo_svc on extend.wbx_demo;

create policy wbx_demo_owner_select on extend.wbx_demo
  for select using (created_by = (select auth.uid()));

create policy wbx_demo_owner_insert on extend.wbx_demo
  for insert with check (created_by = (select auth.uid()));

-- UPDATE policy: the sync path is INSERT ... ON CONFLICT DO UPDATE, and the
-- soft delete is an UPDATE.
create policy wbx_demo_owner_update on extend.wbx_demo
  for update using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

create policy wbx_demo_owner_delete on extend.wbx_demo
  for delete using (created_by = (select auth.uid()));

create policy wbx_demo_svc on extend.wbx_demo
  for all using (true) with check (true);

-- Platform triggers — the THREE that work on a text primary key, and only those.
--
-- `platform._version_capture` and `platform._gc_entity_associations` are
-- deliberately NOT attached: both coerce the row's `id` to uuid
-- (`(rec->>'id')::uuid` / `v_id uuid := old.id`), so on a text-PK table every
-- INSERT (and every hard DELETE) aborts with
-- `invalid input syntax for type uuid`. extend.wbx_recipe — the other text-PK
-- table in this schema — carries no platform entity triggers for the same
-- reason. See the wbx_guidance repair below.
create trigger _100_touch_row before insert or update on extend.wbx_demo
  for each row execute function platform._touch_row();
create trigger _110_stamp_actor before insert or update on extend.wbx_demo
  for each row execute function platform._stamp_actor();
create trigger _stamp_org_default before insert on extend.wbx_demo
  for each row execute function public._stamp_org_default();

-- ── Repair: extend.wbx_guidance has been rejecting every insert ──────────────
--
-- Found 2026-08-09 while building this table. The schema move attached the full
-- platform entity trigger set to extend.wbx_guidance, whose `id` is TEXT
-- ('gd_<ts>_<rand>'). `platform._version_capture` inserts
-- `(rec->>'id')::uuid` into history.row_versions.row_id (a uuid column), so
-- EVERY insert into wbx_guidance aborted with `invalid input syntax for type
-- uuid`; `platform._gc_entity_associations` fails the same way on hard delete
-- and on the soft-delete UPDATE path. The client swallows the error
-- (upsertGuidanceRow logs and returns false; pushGuidanceToCloud is
-- fire-and-forget), so guidance sync has been silently dead — the table holds
-- zero rows. Syncing demo bodies is pointless while the ref that points at them
-- cannot be written, so the repair lands here.
drop trigger if exists _900_version_capture on extend.wbx_guidance;
drop trigger if exists _gc_assoc_harddelete on extend.wbx_guidance;
drop trigger if exists _gc_assoc_softdelete on extend.wbx_guidance;
