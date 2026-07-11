-- Drop the duplicate public.create_agent_task overload.
--
-- APPLIED 2026-07-11 via the Supabase MCP (project txzxabzwovsujtloxrus),
-- recorded in Supabase's own migration history as
-- `drop_duplicate_create_agent_task_overload`. This file is the tracked copy
-- for the shared `_schema_migrations` ledger.
--
-- ── What was broken ─────────────────────────────────────────────────────────
-- public.create_agent_task existed TWICE. Two repos each shipped a migration
-- creating it, neither aware of the other:
--   * matrx-frontend/migrations/sch_create_agent_task.sql          (16 args, p_queue)
--   * matrx-extend/migrations/2026_06_10_sch_create_agent_task_rpc.sql (15 args)
-- Different param order + arity => two distinct overloads, both live.
--
-- Every param that differs between them has a DEFAULT, so BOTH were valid
-- candidates for the argument set the extension sends. PostgREST refuses to
-- guess:
--     HTTP 300  PGRST203  "Could not choose the best candidate function"
--
-- So every Agenda task creation through the RPC had been failing, silently
-- falling back to the extension's legacy 3-insert path. The entire POINT of the
-- RPC — one transaction, so a mid-sequence failure can't orphan a trigger-less
-- sch_task and poison the scanner — was never actually in effect.
--
-- ── Which one survives, and why ─────────────────────────────────────────────
-- Kept: the matrx-frontend 16-arg version.
--   * spec-referenced (docs/SCHEDULING.md §8)
--   * strict superset — exposes p_queue (DEFAULT 'default')
--   * carries an explicit auth guard: RAISE 42501 when auth.uid() IS NULL
-- Both were SECURITY INVOKER, so RLS applied either way, and `sch_task.enabled`
-- defaults to true — so the kept version not setting it is behaviour-identical.
--
-- Callers are unaffected: the extension passes 15 NAMED args, omitting p_queue,
-- which now resolves unambiguously to the survivor via p_queue's DEFAULT.
-- Verified live: the call went from HTTP 300 (PGRST203) to HTTP 401 42501
-- "authentication required" for anon — i.e. it resolves, and lands on the guard.
--
-- ── Lesson ─────────────────────────────────────────────────────────────────
-- Three repos share this database and this ledger. `CREATE OR REPLACE FUNCTION`
-- does NOT replace across a differing signature — it creates an OVERLOAD. Before
-- adding an RPC, grep the sibling repos for the name.

DROP FUNCTION IF EXISTS public.create_agent_task(
  p_title text,
  p_prompt text,
  p_trigger_type text,
  p_trigger_config jsonb,
  p_description text,
  p_agent_id uuid,
  p_variables jsonb,
  p_persistent_conversation_id uuid,
  p_auth_mode text,
  p_max_runtime_seconds integer,
  p_max_concurrent integer,
  p_surfaces text[],
  p_tags text[],
  p_expires_at timestamptz,
  p_next_due_at timestamptz
);
