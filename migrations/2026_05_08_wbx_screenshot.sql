-- wbx_screenshot — per-page screenshot history index.
--
-- The actual image bytes live in cld_files (uploaded via uploadFile()).
-- This table is the queryable index, keyed by canonical URL so the side
-- panel can list all screenshots taken of the user's currently-active
-- page, regardless of whether the agent or the user triggered them.
--
-- Apply order: after the original wbx_* tables (2026-04-30 batch).
--
-- Apply via Supabase SQL Editor on project txzxabzwovsujtloxrus.

create table if not exists public.wbx_screenshot (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  -- Canonical URL (host + path + search, fragment dropped, www. stripped).
  -- This is what the side-panel tab queries against — see
  -- src/lib/url/match.ts normalizeUrl().
  page_url_canonical text not null,
  -- Full URL as captured (with fragment, original casing). Useful for
  -- showing "this was taken when you were here".
  page_url_full text not null,
  -- Page title at capture time, when available.
  page_title text,

  -- cld_files pointers. file_id is the canonical reference; file_url is
  -- a snapshot of whatever URL the upload returned (CDN if public,
  -- signed if private — may be null when neither is configured).
  file_id uuid not null,
  file_url text,

  -- Image dimensions and format (denormalized for fast gallery rendering
  -- without round-tripping cld_files).
  width integer,
  height integer,
  mime_type text,
  byte_length integer,

  -- Who triggered this. Tracks "did the agent take it" vs "did the user
  -- click the screenshot button".
  -- Values: 'agent' | 'user' | 'unknown'
  source text not null default 'unknown',

  captured_at timestamptz not null default now()
);

create index if not exists wbx_screenshot_user_url_idx
  on public.wbx_screenshot (user_id, page_url_canonical, captured_at desc);

create index if not exists wbx_screenshot_user_captured_idx
  on public.wbx_screenshot (user_id, captured_at desc);

alter table public.wbx_screenshot enable row level security;

drop policy if exists wbx_screenshot_owner_select on public.wbx_screenshot;
drop policy if exists wbx_screenshot_owner_insert on public.wbx_screenshot;
drop policy if exists wbx_screenshot_owner_delete on public.wbx_screenshot;

create policy wbx_screenshot_owner_select on public.wbx_screenshot
  for select using (user_id = auth.uid());

create policy wbx_screenshot_owner_insert on public.wbx_screenshot
  for insert with check (user_id = auth.uid());

create policy wbx_screenshot_owner_delete on public.wbx_screenshot
  for delete using (user_id = auth.uid());
