-- Agenda v0 — multi-surface scheduled agent runs.
--
-- Two tables, lease-based execution. Designed for: chrome extension (today),
-- desktop app, web app, mobile app, sandboxed runners.
--
-- Surface picks up tasks where:
--   1. enabled = true
--   2. next_due_at <= now()
--   3. its surface_id is in surfaces[] (or surfaces contains 'any')
--   4. no active run is currently claimed (claim_token IS NULL or expired)
--
-- Applied 05/03/2026 to project txzxabzwovsujtloxrus by Arman Sadeghi via Supabase MCP.

-- ─── agenda_task — the task spec ─────────────────────────────────────────────
create table if not exists public.agenda_task (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  description text,

  -- What to run
  agent_id uuid,                              -- soft FK to agx_agent(id); nullable for raw prompts
  prompt text not null,
  variables jsonb not null default '{}'::jsonb,

  -- When to run
  -- trigger_type values: 'one-shot' | 'cron' | 'interval' | 'context-match' | 'heartbeat'
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  -- Examples:
  --   one-shot: { "at": "2026-05-04T15:00:00Z" }
  --   cron: { "expression": "0 9 * * 1-5", "tz": "America/Los_Angeles" }
  --   interval: { "every_seconds": 3600 }
  --   context-match: { "kind": "pull_request", "url_pattern": "github.com/..." }
  --   heartbeat: { "every_seconds": 60 }
  next_due_at timestamptz,
  last_run_at timestamptz,

  -- Where it can run (multi-surface).
  -- Values: 'any', 'chrome-extension-chat', 'desktop', 'web', 'mobile', 'sandbox'
  -- 'any' = first eligible online surface picks it up.
  surfaces text[] not null default array['any']::text[],

  -- Execution policy
  auth_mode text not null default 'ask',      -- 'ask' | 'auto'
  max_runtime_seconds integer not null default 600,
  max_concurrent integer not null default 1,

  -- Conversation policy
  -- For heartbeat / persistent-conversation tasks: append all runs to this thread.
  -- For ephemeral tasks (default): each run creates its own conversation.
  persistent_conversation_id uuid,            -- soft FK to cx_conversation(id)

  -- Lifecycle
  enabled boolean not null default true,
  expires_at timestamptz,                     -- after which the task auto-disables

  tags text[] not null default '{}'::text[],

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenda_task_trigger_type_chk check (
    trigger_type in ('one-shot', 'cron', 'interval', 'context-match', 'heartbeat')
  ),
  constraint agenda_task_auth_mode_chk check (auth_mode in ('ask', 'auto'))
);

create index if not exists agenda_task_user_due_idx
  on public.agenda_task (user_id, next_due_at)
  where enabled = true;

create index if not exists agenda_task_user_recent_idx
  on public.agenda_task (user_id, updated_at desc);

alter table public.agenda_task enable row level security;

drop policy if exists agenda_task_owner on public.agenda_task;
create policy agenda_task_owner
  on public.agenda_task
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.agenda_task is
  'Multi-surface scheduled agent runs. Triggers (cron/interval/one-shot/context-match/heartbeat) plus surface targeting plus auth mode. See agenda_run for executions.';


-- ─── agenda_run — individual executions ──────────────────────────────────────
create table if not exists public.agenda_run (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.agenda_task(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  -- status values: 'queued' | 'claimed' | 'running' | 'success' | 'failed' | 'cancelled' | 'skipped'
  status text not null default 'queued',

  -- Which surface picked it up.
  -- Values match agenda_task.surfaces values plus the user-agent surface ID.
  surface text,
  conversation_id uuid,                       -- soft FK to cx_conversation(id)

  -- Timing
  due_at timestamptz not null,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,

  -- Lease — atomic claim pattern so two surfaces don't both run the same task.
  -- Surface UPDATEs claim_token + claim_expires_at conditionally on
  -- (claim_token IS NULL OR claim_expires_at < now()).
  claim_token uuid,
  claim_expires_at timestamptz,

  -- Output
  result_summary text,
  error_message text,
  result_metadata jsonb,                      -- arbitrary surface-specific payload

  created_at timestamptz not null default now(),

  constraint agenda_run_status_chk check (
    status in ('queued', 'claimed', 'running', 'success', 'failed', 'cancelled', 'skipped')
  )
);

create index if not exists agenda_run_task_due_idx
  on public.agenda_run (task_id, due_at desc);

create index if not exists agenda_run_user_recent_idx
  on public.agenda_run (user_id, created_at desc);

create index if not exists agenda_run_pickup_idx
  on public.agenda_run (status, claim_expires_at)
  where status in ('queued', 'claimed');

alter table public.agenda_run enable row level security;

drop policy if exists agenda_run_owner on public.agenda_run;
create policy agenda_run_owner
  on public.agenda_run
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.agenda_run is
  'One row per execution of an agenda_task. Lease pattern via claim_token/claim_expires_at lets multiple surfaces safely race for pickup without double-running.';


-- ─── trigger: bump updated_at on agenda_task UPDATE ─────────────────────────
create or replace function public.agenda_task_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agenda_task_updated_at on public.agenda_task;
create trigger agenda_task_updated_at
  before update on public.agenda_task
  for each row
  execute function public.agenda_task_set_updated_at();
