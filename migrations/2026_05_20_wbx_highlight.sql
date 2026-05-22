-- wbx_highlight v0 — user-captured page highlights (text passages + elements).
--
-- Applied to "Matrx Main" (txzxabzwovsujtloxrus) on 2026-05-20 via the
-- Supabase MCP migration `wbx_highlight_v0`. This file is the repo mirror.
--
-- A highlight is something the user marked on a web page that they want to
-- remember, attach to an agent chat, or feed into the Data/Scrape extraction
-- tabs. Two capture modes:
--   * text    — a selected text passage; re-locatable via anchor.text_quote
--   * element — a whole element captured by stable selector + (ephemeral) ref
--
-- The `anchor` jsonb is the load-bearing "reference" — everything needed to
-- re-find the highlight later and hand a selector/ref to interaction +
-- extraction tools. Shape documented in src/lib/highlights/types.ts.
--
-- Prefix convention: wbx_ = extension workbench (matches wbx_screenshot).
-- Scoping: owner-only via RLS (user_id = auth.uid()), same pattern as notes.

begin;

create table if not exists public.wbx_highlight (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid,

  mode            text not null default 'text' check (mode in ('text', 'element')),
  url             text not null,
  domain          text not null,
  page_title      text,

  color           text not null default 'yellow',
  text            text,
  anchor          jsonb not null default '{}'::jsonb,
  metadata        jsonb not null default '{}'::jsonb,

  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists wbx_highlight_user_domain_idx
  on public.wbx_highlight (user_id, domain) where is_deleted = false;
create index if not exists wbx_highlight_user_url_idx
  on public.wbx_highlight (user_id, url) where is_deleted = false;
create index if not exists wbx_highlight_user_recent_idx
  on public.wbx_highlight (user_id, updated_at desc) where is_deleted = false;
create index if not exists wbx_highlight_user_conv_idx
  on public.wbx_highlight (user_id, conversation_id) where is_deleted = false;

alter table public.wbx_highlight enable row level security;

drop policy if exists wbx_highlight_owner on public.wbx_highlight;
create policy wbx_highlight_owner
  on public.wbx_highlight for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.wbx_highlight_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists wbx_highlight_updated_at on public.wbx_highlight;
create trigger wbx_highlight_updated_at
  before update on public.wbx_highlight
  for each row execute function public.wbx_highlight_set_updated_at();

commit;
