-- Atomic agent-task creation (matrx-extend audit P2-16, approved 2026-06-10).
--
-- APPLIED 2026-06-10 directly via the Supabase MCP (recorded in Supabase's
-- own migration history as `sch_create_agent_task_rpc`). This file is the
-- tracked copy for the shared `_schema_migrations` ledger — re-run
-- aidream's `python db/apply_migrations.py --source matrx-extend` so the
-- ledger records it (CREATE OR REPLACE makes re-application a no-op).
--
-- Why: the extension's createTask() was three sequential PostgREST inserts
-- (sch_task -> sch_agent_task -> sch_trigger) with best-effort, unchecked
-- cleanup; a mid-sequence failure could orphan a trigger-less sch_task,
-- which then poisoned scanner passes until the per-row guards (also
-- 2026-06-10) were added. One SECURITY INVOKER function = one transaction;
-- RLS applies as the calling user, and column defaults (user_id =
-- auth.uid()) behave exactly as the direct inserts did.

CREATE OR REPLACE FUNCTION public.create_agent_task(
  p_title text,
  p_prompt text,
  p_trigger_type text,
  p_trigger_config jsonb,
  p_description text DEFAULT NULL,
  p_agent_id uuid DEFAULT NULL,
  p_variables jsonb DEFAULT '{}'::jsonb,
  p_persistent_conversation_id uuid DEFAULT NULL,
  p_auth_mode text DEFAULT 'ask',
  p_max_runtime_seconds integer DEFAULT 600,
  p_max_concurrent integer DEFAULT 1,
  p_surfaces text[] DEFAULT ARRAY['any'],
  p_tags text[] DEFAULT ARRAY[]::text[],
  p_expires_at timestamptz DEFAULT NULL,
  p_next_due_at timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_task_id uuid;
BEGIN
  INSERT INTO public.sch_task (kind, title, description, queue, surfaces, enabled, expires_at, tags, next_due_at)
  VALUES ('agent', p_title, p_description, 'default', p_surfaces, true, p_expires_at, p_tags, p_next_due_at)
  RETURNING id INTO v_task_id;

  INSERT INTO public.sch_agent_task (id, agent_id, prompt, variables, persistent_conversation_id, auth_mode, max_runtime_seconds, max_concurrent)
  VALUES (v_task_id, p_agent_id, p_prompt, p_variables, p_persistent_conversation_id, p_auth_mode, p_max_runtime_seconds, p_max_concurrent);

  INSERT INTO public.sch_trigger (task_id, type, config, enabled, next_due_at)
  VALUES (v_task_id, p_trigger_type, p_trigger_config, true, p_next_due_at);

  RETURN v_task_id;
END;
$$;
