-- Reusable structured-extraction patterns scoped to a domain (and optional route).
-- Drives the matrx-extend Data tab.
-- Apply via Supabase SQL editor (or `psql` connected to the Matrx project).
-- Requires: 2026_04_30_wbx_capture.sql applied first.
-- Applied 05/01/2026 by Arman Sadeghi.

create table if not exists public.wbx_pattern (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  domain text not null,                      -- exact host match (e.g. "news.ycombinator.com")
  route_pattern text,                        -- glob ("/blog/**") or regex ("/^\/items\/\d+$/")
  list_root_selector text,                   -- when present, extraction iterates over matching elements
  fields jsonb not null,                     -- WbxPatternField[] — { name, selector, attr?, is_list }
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists wbx_pattern_user_domain
  on public.wbx_pattern (user_id, domain);

alter table public.wbx_pattern enable row level security;

drop policy if exists wbx_pattern_owner on public.wbx_pattern;
create policy wbx_pattern_owner
  on public.wbx_pattern
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Link wbx_capture back to the pattern that produced it (if any).
alter table public.wbx_capture
  drop constraint if exists wbx_capture_pattern_fk;

alter table public.wbx_capture
  add constraint wbx_capture_pattern_fk
  foreign key (pattern_id) references public.wbx_pattern(id)
  on delete set null;

comment on table public.wbx_pattern is
  'User-defined CSS-selector patterns for repeatable structured extraction in matrx-extend.';
