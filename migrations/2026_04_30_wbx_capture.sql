-- Page captures saved from the matrx-extend Chrome extension's Scrape tab.
-- Apply via Supabase SQL editor (or `psql` connected to the Matrx project).

create table if not exists public.wbx_capture (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url text not null,
  captured_at timestamptz not null default now(),
  title text,
  description text,
  lang text,
  soup jsonb not null,                       -- normalized SoupResult (article + media + structured)
  markdown text,                             -- rendered markdown of the article
  metadata jsonb,                            -- og, twitter, schema_types, canonical
  ld_json jsonb,                             -- raw JSON-LD blocks
  media_count integer not null default 0,
  pattern_id uuid                            -- soft FK; FK constraint added by wbx_pattern migration
);

create index if not exists wbx_capture_user_url
  on public.wbx_capture (user_id, url);

create index if not exists wbx_capture_user_recent
  on public.wbx_capture (user_id, captured_at desc);

alter table public.wbx_capture enable row level security;

drop policy if exists wbx_capture_owner on public.wbx_capture;
create policy wbx_capture_owner
  on public.wbx_capture
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.wbx_capture is
  'Browser-captured page data (article, media, structured) saved from matrx-extend.';
