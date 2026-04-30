-- SEO audits saved from the matrx-extend SEO tab.
-- Stores both the raw audit signals and any AI-generated recommendations.
-- Apply via Supabase SQL editor (or `psql` connected to the Matrx project).

create table if not exists public.wbx_seo_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url text not null,
  audited_at timestamptz not null default now(),
  signals jsonb not null,                    -- SeoAudit shape: title/desc/canonical/headings/links/images/etc.
  recommendations jsonb,                     -- AI agent output, populated lazily
  flesch_reading_ease numeric,               -- denormalized for indexing
  word_count integer,                        -- denormalized for indexing
  notes text                                 -- user notes
);

create index if not exists wbx_seo_audit_user_url
  on public.wbx_seo_audit (user_id, url);

create index if not exists wbx_seo_audit_user_recent
  on public.wbx_seo_audit (user_id, audited_at desc);

alter table public.wbx_seo_audit enable row level security;

drop policy if exists wbx_seo_audit_owner on public.wbx_seo_audit;
create policy wbx_seo_audit_owner
  on public.wbx_seo_audit
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.wbx_seo_audit is
  'SEO audits + AI recommendations for pages, captured by the matrx-extend SEO tab.';
