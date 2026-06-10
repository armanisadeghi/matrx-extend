// src/lib/scheduler-client/types.ts
//
// Wire types for the sch_* tables.
//
// This is a HAND-WRITTEN MIRROR of the auto-generated row shapes that live in
// matrx-frontend at `types/database.types.ts` (the canonical TS scheduler
// client lives at `matrx-frontend/lib/scheduler-client/` and pulls those
// rows from a `Database` type produced by `pnpm update-supabase-types`).
//
// matrx-extend has no Supabase types generator hooked up — the SW only
// reads/writes a handful of tables via narrow handcrafted queries — so we
// inline the same shapes here instead of dragging a multi-megabyte
// `database.types.ts` into the extension bundle. The Python source of truth
// for these shapes is `aidream/packages/matrx-scheduler/matrx_scheduler/models.py`;
// if the DB schema drifts, update this file by hand to match.
//
// To regenerate by hand:
//   1. Read the relevant blocks of matrx-frontend `types/database.types.ts`
//      (search for `sch_task:`, `sch_run:`, `sch_trigger:`, `sch_agent_task:`).
//   2. Diff against the interfaces below.
//   3. Bump literal unions (RunStatus, TriggerType, AgentAuthMode) if the
//      DB CHECK constraints in `migrations/2026_05_10_sch_v0.sql` changed.

// ── Json helper (matches the Supabase-emitted `Json` alias) ───────────────

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// ── sch_task ───────────────────────────────────────────────────────────────

export interface SchTaskRow {
  created_at: string;
  description: string | null;
  enabled: boolean;
  expires_at: string | null;
  id: string;
  kind: string;
  last_run_at: string | null;
  next_due_at: string | null;
  queue: string;
  surfaces: string[];
  tags: string[];
  title: string;
  updated_at: string;
  user_id: string;
}

export interface SchTaskInsert {
  created_at?: string;
  description?: string | null;
  enabled?: boolean;
  expires_at?: string | null;
  id?: string;
  kind: string;
  last_run_at?: string | null;
  next_due_at?: string | null;
  queue?: string;
  surfaces?: string[];
  tags?: string[];
  title: string;
  updated_at?: string;
  user_id?: string;
}

export interface SchTaskUpdate {
  created_at?: string;
  description?: string | null;
  enabled?: boolean;
  expires_at?: string | null;
  id?: string;
  kind?: string;
  last_run_at?: string | null;
  next_due_at?: string | null;
  queue?: string;
  surfaces?: string[];
  tags?: string[];
  title?: string;
  updated_at?: string;
  user_id?: string;
}

// ── sch_run ────────────────────────────────────────────────────────────────

export interface SchRunRow {
  claim_expires_at: string | null;
  claim_token: string | null;
  claimed_at: string | null;
  created_at: string;
  due_at: string;
  error_message: string | null;
  finished_at: string | null;
  id: string;
  output_ref: Json | null;
  queue: string | null;
  result_metadata: Json | null;
  result_summary: string | null;
  started_at: string | null;
  status: string;
  surface: string | null;
  task_id: string;
  trigger_id: string | null;
  user_id: string;
}

export interface SchRunInsert {
  claim_expires_at?: string | null;
  claim_token?: string | null;
  claimed_at?: string | null;
  created_at?: string;
  due_at: string;
  error_message?: string | null;
  finished_at?: string | null;
  id?: string;
  output_ref?: Json | null;
  queue?: string | null;
  result_metadata?: Json | null;
  result_summary?: string | null;
  started_at?: string | null;
  status?: string;
  surface?: string | null;
  task_id: string;
  trigger_id?: string | null;
  user_id?: string;
}

export interface SchRunUpdate {
  claim_expires_at?: string | null;
  claim_token?: string | null;
  claimed_at?: string | null;
  created_at?: string;
  due_at?: string;
  error_message?: string | null;
  finished_at?: string | null;
  id?: string;
  output_ref?: Json | null;
  queue?: string | null;
  result_metadata?: Json | null;
  result_summary?: string | null;
  started_at?: string | null;
  status?: string;
  surface?: string | null;
  task_id?: string;
  trigger_id?: string | null;
  user_id?: string;
}

// ── sch_trigger ────────────────────────────────────────────────────────────

export interface SchTriggerRow {
  config: Json;
  created_at: string;
  enabled: boolean;
  id: string;
  last_fired_at: string | null;
  next_due_at: string | null;
  task_id: string;
  type: string;
  updated_at: string;
  user_id: string;
}

export interface SchTriggerInsert {
  config?: Json;
  created_at?: string;
  enabled?: boolean;
  id?: string;
  last_fired_at?: string | null;
  next_due_at?: string | null;
  task_id: string;
  type: string;
  updated_at?: string;
  user_id?: string;
}

export interface SchTriggerUpdate {
  config?: Json;
  created_at?: string;
  enabled?: boolean;
  id?: string;
  last_fired_at?: string | null;
  next_due_at?: string | null;
  task_id?: string;
  type?: string;
  updated_at?: string;
  user_id?: string;
}

// ── sch_agent_task ─────────────────────────────────────────────────────────

export interface SchAgentTaskRow {
  agent_id: string | null;
  auth_mode: string;
  id: string;
  max_concurrent: number;
  max_runtime_seconds: number;
  persistent_conversation_id: string | null;
  prompt: string;
  variables: Json;
}

export interface SchAgentTaskInsert {
  agent_id?: string | null;
  auth_mode?: string;
  id: string;
  max_concurrent?: number;
  max_runtime_seconds?: number;
  persistent_conversation_id?: string | null;
  prompt: string;
  variables?: Json;
}

export interface SchAgentTaskUpdate {
  agent_id?: string | null;
  auth_mode?: string;
  id?: string;
  max_concurrent?: number;
  max_runtime_seconds?: number;
  persistent_conversation_id?: string | null;
  prompt?: string;
  variables?: Json;
}

// ── Literal unions ─────────────────────────────────────────────────────────
//
// These mirror the CHECK constraints in 2026_05_10_sch_v0.sql and the matching
// Literals in `aidream/packages/matrx-scheduler/matrx_scheduler/models.py`.

/** Run status — matches sch_run_status_chk. */
export type RunStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'skipped';

/** Trigger type — matches sch_trigger_type_chk. */
export type TriggerType =
  | 'one-shot'
  | 'interval'
  | 'cron'
  | 'heartbeat'
  | 'context-match'
  | 'event'
  | 'manual'
  | 'dependency';

/** Agent task auth mode — matches sch_agent_task_auth_mode_chk. */
export type AgentAuthMode = 'ask' | 'auto';

/**
 * sch_run.output_ref polymorphic pointer.
 *
 * Stored as `Json | null` on the DB row, but every consumer narrows to
 * `{ kind, id }`. Unknown kinds fall through to the default branch in
 * renderers — they're not removed in case the producer added a new kind
 * faster than the consumer was rebuilt.
 */
export type OutputRefKind = 'conversation' | 'capture' | 'workflow_run';

export interface OutputRef {
  kind: OutputRefKind | (string & {});
  id: string;
  [extra: string]: Json | undefined;
}
