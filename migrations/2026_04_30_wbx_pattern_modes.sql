-- Multi-mode extraction support — additive migration on wbx_pattern.
-- Adds: kind discriminator, mode-specific config blob, target user_table link,
-- and rolling health tracking for scheduled re-runs.
-- Existing rows automatically get kind='manual_css' via the column default.
-- Apply via Supabase SQL editor (or `psql` connected to the Matrx project).
-- Requires: 2026_04_30_wbx_pattern.sql applied first.
-- Optional FK: target_user_table_id references user_tables(id). If your
--   environment doesn't have user_tables yet, drop the REFERENCES clause.

alter table public.wbx_pattern
  add column if not exists kind text not null default 'manual_css',
  add column if not exists config jsonb not null default '{}'::jsonb,
  add column if not exists target_user_table_id uuid references public.user_tables(id) on delete set null,
  add column if not exists last_run_at timestamptz,
  add column if not exists last_status text,
  add column if not exists last_run_count int;

create index if not exists wbx_pattern_kind_idx
  on public.wbx_pattern(kind);

create index if not exists wbx_pattern_target_user_table_idx
  on public.wbx_pattern(target_user_table_id)
  where target_user_table_id is not null;

comment on column public.wbx_pattern.kind is
  'Extraction mode discriminator: manual_css | json_ld | og_meta | auto_table | next_data | ai_extract | list_pattern.';
comment on column public.wbx_pattern.config is
  'Mode-specific config blob. Shape varies by kind. For manual_css this is empty (data lives in fields/list_root_selector).';
comment on column public.wbx_pattern.target_user_table_id is
  'Optional user_tables.id where extracted rows append on each scheduled run.';
comment on column public.wbx_pattern.last_status is
  'Rolling status from the last run: ok | broken | never_run.';
