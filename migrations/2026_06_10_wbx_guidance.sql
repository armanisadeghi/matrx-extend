-- wbx_guidance — cloud-synced index of user-saved guidance items.
--
-- Guidance items (domain-scoped notes, screenshots, GIFs, demo references)
-- were previously local-only in chrome.storage.local — only the artifact
-- bytes reached cld_files, so the guidance ENTRIES themselves vanished on
-- reinstall / machine-switch. This table makes the metadata follow the user
-- (TASK-004).
--
-- Source of truth = this table; chrome.storage.local is a fast offline cache,
-- reconciled last-write-wins by updated_at. The `id` is the client-generated
-- guidance id (gd_<ts>_<rand>), NOT a uuid, so local <-> cloud map 1:1 with no
-- id-translation layer and the demo_ref pointer stays stable.
--
-- Kind-specific fields live in the `data` jsonb so the GuidanceItem
-- discriminated union (note | screenshot | gif | demo_ref) stays intact and
-- future kinds need no schema change. Heavy bytes stay in cld_files; `data`
-- only carries pointers (file_id + url) + small inline blobs (note text,
-- tldraw annotation doc).
--
-- Apply order: after 2026_05_20_wbx_highlight.sql.
-- Apply via Supabase (project txzxabzwovsujtloxrus).

create table if not exists public.wbx_guidance (
  -- Client-generated guidance id (NOT a uuid) — e.g. 'gd_abc_def'.
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  -- Domain the item is scoped to. Parent-domain rows apply to subdomains,
  -- mirrored client-side in guidanceMatchesDomain().
  domain text not null,
  -- 'note' | 'screenshot' | 'gif' | 'demo_ref'
  kind text not null,
  -- Optional one-line summary shown in lists.
  caption text,
  -- The specific URL the artifact was captured on, when known.
  origin_url text,

  -- Kind-specific payload (note text / file_id+url+dims+annotations / gif
  -- pointer / demo pointer). Pointers only — bytes live in cld_files.
  data jsonb not null default '{}'::jsonb,

  -- Client epoch-ms timestamps, stored native. updated_at drives the
  -- last-write-wins reconciliation between cloud and the local cache.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wbx_guidance_user_domain_idx
  on public.wbx_guidance (user_id, domain);

create index if not exists wbx_guidance_user_updated_idx
  on public.wbx_guidance (user_id, updated_at desc);

alter table public.wbx_guidance enable row level security;

drop policy if exists wbx_guidance_owner_select on public.wbx_guidance;
drop policy if exists wbx_guidance_owner_insert on public.wbx_guidance;
drop policy if exists wbx_guidance_owner_update on public.wbx_guidance;
drop policy if exists wbx_guidance_owner_delete on public.wbx_guidance;

create policy wbx_guidance_owner_select on public.wbx_guidance
  for select using (user_id = auth.uid());

create policy wbx_guidance_owner_insert on public.wbx_guidance
  for insert with check (user_id = auth.uid());

-- UPDATE policy (unlike the immutable wbx_screenshot) — guidance items are
-- mutable, and the upsert path uses INSERT ... ON CONFLICT DO UPDATE.
create policy wbx_guidance_owner_update on public.wbx_guidance
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy wbx_guidance_owner_delete on public.wbx_guidance
  for delete using (user_id = auth.uid());
