-- Backfill `created_by` from `user_id` where the ownership migration left it NULL.
--
-- APPLIED 2026-07-11 via the Supabase MCP (project txzxabzwovsujtloxrus),
-- recorded in Supabase's own migration history as
-- `backfill_created_by_from_user_id`. This file is the tracked copy for the
-- shared `_schema_migrations` ledger.
--
-- ── Scope ───────────────────────────────────────────────────────────────────
-- Swept EVERY table in the DB carrying both `user_id` and `created_by` (~100).
-- 14 had user_id populated but created_by NULL: 15,395 rows. Platform RLS has
-- moved to gating on created_by, so a NULL there is a row whose owner the new
-- policies cannot see. Biggest offenders: scheduler.sch_run (8,332) and
-- public.app_log (6,476).
--
-- ── Triggers DISABLED for the duration, deliberately ────────────────────────
-- A plain UPDATE here is destructive, not merely noisy:
--   * scheduler.sch_run has `emit_run_lifecycle` ON UPDATE — a bare backfill
--     would emit 8,332 stale run-lifecycle events for long-finished runs.
--   * `_touch_row` would rewrite updated_at on all 15k rows, falsifying the very
--     audit trail this repair exists to fix.
--   * `_version_capture` would write thousands of meaningless history rows.
--   * users.user_feedback has `trg_enforce_testing_before_close`, a validation
--     trigger that could reject the update outright.
-- This is a data repair, not a user edit — the rows do not change meaning, we are
-- recording an owner that was always implicit. No trigger should observe it.
-- Verified afterwards: all 61 user triggers across the 12 tables re-enabled
-- (pg_trigger.tgenabled = 'O', zero 'D').
--
-- ── THREE TABLES DELIBERATELY EXCLUDED — backfilling them would CORRUPT data ─
--   * chat.agent_task — `created_by` is typed `cx_agent_task_creator`, an ENUM
--     ('user' / 'system'). It is not a user id at all: same column name, entirely
--     different concept. (Its 64 "conflicts" are a false positive of the sweep.)
--   * iam.memberships (3 rows already differ) and
--     communication.dm_conversation_participants (1 row differs) — there,
--     `created_by` is the INVITER and `user_id` is the MEMBER. They are supposed
--     to be different people. `created_by := user_id` would falsely record every
--     member as having added themselves and destroy the who-invited-whom trail.
-- Those pre-existing mismatches are CORRECT data. The 105 remaining NULLs in
-- those two tables are left as-is: the inviter is genuinely unknown for those
-- rows, and inventing one is worse than admitting it.

DO $$
DECLARE
  updated  bigint;
  total    bigint := 0;
  targets  text[][] := ARRAY[
    ['scheduler','sch_run'],
    ['public','app_log'],
    ['public','system_error'],
    ['public','ops_issue_event'],
    ['users','user_feedback'],
    ['public','system_write_failure'],
    ['public','sandbox_instances'],
    ['workbench','udt_dataset_fields'],
    ['workbench','udt_datasets'],
    ['chat','artifact'],
    ['canvas','canvas_items'],
    ['transcripts','studio_recording_segments']
  ];
  i int;
  s text;
  t text;
BEGIN
  FOR i IN 1 .. array_length(targets, 1) LOOP
    s := targets[i][1];
    t := targets[i][2];

    EXECUTE format('ALTER TABLE %I.%I DISABLE TRIGGER USER', s, t);

    EXECUTE format(
      'UPDATE %I.%I SET created_by = user_id
        WHERE created_by IS NULL AND user_id IS NOT NULL', s, t);
    GET DIAGNOSTICS updated = ROW_COUNT;

    EXECUTE format('ALTER TABLE %I.%I ENABLE TRIGGER USER', s, t);

    total := total + updated;
    RAISE NOTICE 'backfilled %.%: % rows', s, t, updated;
  END LOOP;

  RAISE NOTICE 'created_by backfill complete: % rows across % tables',
    total, array_length(targets, 1);
END $$;
