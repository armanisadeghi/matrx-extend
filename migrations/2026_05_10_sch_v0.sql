-- Scheduling system v0 — kind-agnostic spine for scheduled work.
--
-- Replaces the agenda_* tables with a 4-table foundation designed to grow
-- to ~20 tables: scheduled agents, workflows, actions, user-actions,
-- webhooks, scrape tasks, etc. Today only the 'agent' kind exists.
--
-- Layout:
--   sch_task         — kind-agnostic definition (what can run)
--     ↳ sch_agent_task — agent-specific extension (1:1 by id)
--   sch_trigger      — when it fires (many per task)
--   sch_run          — each execution (lease-based claim pattern)
--
-- Conventions locked in here (apply to every future sch_ table):
--   * Singular table names: sch_task, not sch_tasks
--   * `kind` is text + CHECK constraint (NOT a Postgres enum — easier to widen)
--   * Class-table inheritance for kind-specific columns:
--       sch_<kind>_task references sch_task(id) 1:1
--   * Cross-namespace pointers use `output_ref jsonb` not N FK columns
--   * RLS owner-only via user_id = auth.uid()
--   * Denormalize user_id onto child tables that aren't 1:1 with sch_task
--     (so RLS policies stay one-line without joins)
--
-- Applied 05/10/2026 to project txzxabzwovsujtloxrus by Arman Sadeghi via Supabase MCP.

begin;

-- ─── sch_task — kind-agnostic task definition ────────────────────────────────
create table if not exists public.sch_task (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  -- Kind discriminator. Widen the CHECK constraint when a new sch_<kind>_task
  -- table lands. The constraint guards against rows whose backing spec table
  -- doesn't exist yet.
  kind text not null,

  title text not null,
  description text,

  -- Routing & where it can run.
  queue text not null default 'default',
  surfaces text[] not null default array['any']::text[],

  -- Lifecycle
  enabled boolean not null default true,
  expires_at timestamptz,
  tags text[] not null default '{}'::text[],

  -- Denormalized scanner cache — soonest enabled trigger's next_due_at.
  -- Maintained by the application (or a future DB trigger when multiple
  -- triggers per task become common).
  next_due_at timestamptz,
  last_run_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sch_task_kind_chk check (kind in ('agent'))
);

create index if not exists sch_task_user_due_idx
  on public.sch_task (user_id, next_due_at)
  where enabled = true;

create index if not exists sch_task_user_recent_idx
  on public.sch_task (user_id, updated_at desc);

create index if not exists sch_task_kind_idx
  on public.sch_task (kind);

alter table public.sch_task enable row level security;

drop policy if exists sch_task_owner on public.sch_task;
create policy sch_task_owner
  on public.sch_task for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.sch_task is
  'Scheduling-system spine. Kind-agnostic definition of a scheduled unit of work. Kind-specific fields live on sch_<kind>_task tables joined 1:1 by id. Triggers live on sch_trigger.';


-- ─── sch_agent_task — agent-kind extension ───────────────────────────────────
create table if not exists public.sch_agent_task (
  id uuid primary key references public.sch_task(id) on delete cascade,

  agent_id uuid,                              -- soft FK to agx_agent
  prompt text not null,
  variables jsonb not null default '{}'::jsonb,

  -- Conversation policy. Heartbeat/persistent tasks append to this thread;
  -- ephemeral tasks (null) get a fresh conversation per run.
  persistent_conversation_id uuid,            -- soft FK to cx_conversation

  -- Execution policy
  auth_mode text not null default 'ask',
  max_runtime_seconds integer not null default 600,
  max_concurrent integer not null default 1,

  constraint sch_agent_task_auth_mode_chk check (auth_mode in ('ask', 'auto'))
);

alter table public.sch_agent_task enable row level security;

-- 1:1 with sch_task by id, so ownership flows through the parent.
drop policy if exists sch_agent_task_owner on public.sch_agent_task;
create policy sch_agent_task_owner
  on public.sch_agent_task for all
  using (
    exists (
      select 1 from public.sch_task t
      where t.id = sch_agent_task.id and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sch_task t
      where t.id = sch_agent_task.id and t.user_id = auth.uid()
    )
  );

comment on table public.sch_agent_task is
  'Agent-specific extension of sch_task. 1:1 with sch_task by id where kind = ''agent''.';


-- ─── sch_trigger — many triggers per task ────────────────────────────────────
create table if not exists public.sch_trigger (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.sch_task(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  -- Trigger types and their config shapes:
  --   one-shot      { at: ISO }
  --   cron          { expression, tz }
  --   interval      { every_seconds }
  --   heartbeat     { every_seconds }
  --   context-match { kind?, url_pattern?, hostname? }
  --   event         { event_name, filter? }            — webhooks/queue events
  --   manual        {}                                 — only fires via UI/API
  --   dependency    { after_task_id, on: 'success'|'any' }
  type text not null,
  config jsonb not null default '{}'::jsonb,

  enabled boolean not null default true,
  next_due_at timestamptz,
  last_fired_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sch_trigger_type_chk check (
    type in ('one-shot', 'cron', 'interval', 'context-match', 'heartbeat', 'event', 'manual', 'dependency')
  )
);

create index if not exists sch_trigger_task_idx
  on public.sch_trigger (task_id);

create index if not exists sch_trigger_due_idx
  on public.sch_trigger (next_due_at)
  where enabled = true;

alter table public.sch_trigger enable row level security;

drop policy if exists sch_trigger_owner on public.sch_trigger;
create policy sch_trigger_owner
  on public.sch_trigger for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.sch_trigger is
  'Trigger definitions. Many per sch_task. A task with no enabled triggers is manual-only.';


-- ─── sch_run — individual executions ─────────────────────────────────────────
create table if not exists public.sch_run (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.sch_task(id) on delete cascade,
  trigger_id uuid references public.sch_trigger(id) on delete set null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  status text not null default 'queued',

  -- Which surface picked it up. Matches sch_task.surfaces values plus the
  -- specific surface ID of the worker.
  surface text,
  queue text,                                 -- denormalized from task at claim

  -- Polymorphic output pointer.
  -- Examples:
  --   { "kind": "conversation", "id": "<uuid>" }   — agent runs
  --   { "kind": "capture",      "id": "<uuid>" }   — scrape runs (future)
  --   { "kind": "workflow_run", "id": "<uuid>" }   — workflow runs (future)
  output_ref jsonb,

  -- Timing
  due_at timestamptz not null,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,

  -- Lease — atomic claim pattern so multiple workers don't double-run.
  claim_token uuid,
  claim_expires_at timestamptz,

  -- Output
  result_summary text,
  error_message text,
  result_metadata jsonb,

  created_at timestamptz not null default now(),

  constraint sch_run_status_chk check (
    status in ('queued', 'claimed', 'running', 'success', 'failed', 'cancelled', 'skipped')
  )
);

create index if not exists sch_run_task_due_idx
  on public.sch_run (task_id, due_at desc);

create index if not exists sch_run_user_recent_idx
  on public.sch_run (user_id, created_at desc);

create index if not exists sch_run_pickup_idx
  on public.sch_run (status, claim_expires_at)
  where status in ('queued', 'claimed');

alter table public.sch_run enable row level security;

drop policy if exists sch_run_owner on public.sch_run;
create policy sch_run_owner
  on public.sch_run for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.sch_run is
  'One row per execution of a sch_task. Lease pattern via claim_token/claim_expires_at lets multiple workers safely race for pickup. output_ref is a polymorphic pointer to whatever artifact the run produced (conversation, capture, workflow_run, etc.).';


-- ─── shared updated_at trigger function ──────────────────────────────────────
create or replace function public.sch_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sch_task_updated_at on public.sch_task;
create trigger sch_task_updated_at
  before update on public.sch_task
  for each row
  execute function public.sch_set_updated_at();

drop trigger if exists sch_trigger_updated_at on public.sch_trigger;
create trigger sch_trigger_updated_at
  before update on public.sch_trigger
  for each row
  execute function public.sch_set_updated_at();


-- ─── Migrate data from agenda_* ──────────────────────────────────────────────
-- All existing agenda_task rows are agent-kind by definition.

-- 1. sch_task — preserve ids.
insert into public.sch_task (
  id, user_id, kind, title, description, queue, surfaces,
  enabled, expires_at, tags, next_due_at, last_run_at, created_at, updated_at
)
select
  id, user_id, 'agent', title, description, 'default', surfaces,
  enabled, expires_at, tags, next_due_at, last_run_at, created_at, updated_at
from public.agenda_task
on conflict (id) do nothing;

-- 2. sch_agent_task — joined by id.
insert into public.sch_agent_task (
  id, agent_id, prompt, variables, persistent_conversation_id,
  auth_mode, max_runtime_seconds, max_concurrent
)
select
  id, agent_id, prompt, variables, persistent_conversation_id,
  auth_mode, max_runtime_seconds, max_concurrent
from public.agenda_task
on conflict (id) do nothing;

-- 3. sch_trigger — one new trigger row per legacy task (one trigger each).
--    Carries forward the task's next_due_at and enabled flag.
insert into public.sch_trigger (
  task_id, user_id, type, config, enabled, next_due_at
)
select
  id, user_id, trigger_type, trigger_config, enabled, next_due_at
from public.agenda_task;

-- 4. sch_run — preserve ids. conversation_id (if any) becomes output_ref.
--    trigger_id is null: we can't recover which historical trigger fired each run.
insert into public.sch_run (
  id, task_id, trigger_id, user_id, status, surface, queue, output_ref,
  due_at, claimed_at, started_at, finished_at,
  claim_token, claim_expires_at,
  result_summary, error_message, result_metadata, created_at
)
select
  id, task_id, null, user_id, status, surface, 'default',
  case when conversation_id is not null
       then jsonb_build_object('kind', 'conversation', 'id', conversation_id)
       else null
  end,
  due_at, claimed_at, started_at, finished_at,
  claim_token, claim_expires_at,
  result_summary, error_message, result_metadata, created_at
from public.agenda_run
on conflict (id) do nothing;


-- ─── Drop the old tables ─────────────────────────────────────────────────────
-- agenda_run FKs agenda_task; drop child first.
drop table if exists public.agenda_run cascade;
drop table if exists public.agenda_task cascade;

-- The old updated_at trigger function is no longer referenced.
drop function if exists public.agenda_task_set_updated_at() cascade;

commit;
