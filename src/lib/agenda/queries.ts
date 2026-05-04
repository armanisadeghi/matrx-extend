/**
 * Agenda — multi-surface scheduled agent runs.
 *
 * Schema lives in `migrations/2026_05_03_agenda_v0.sql`.
 *
 * Two tables:
 *   agenda_task — task spec (what to run, when, where it can run)
 *   agenda_run  — individual executions, with lease-based claim pattern
 *
 * Surface picks up tasks where:
 *   1. enabled = true
 *   2. next_due_at <= now()
 *   3. its surface_id is in surfaces[] (or surfaces contains 'any')
 *   4. no active run is currently claimed (claim_token IS NULL or expired)
 */

import { getSupabase } from '@/lib/supabase/client';
import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────────────────

export type TriggerType = 'one-shot' | 'cron' | 'interval' | 'context-match' | 'heartbeat';
export type AuthMode = 'ask' | 'auto';
export type SurfaceTarget =
  | 'any'
  | 'chrome-extension-chat'
  | 'desktop'
  | 'web'
  | 'mobile'
  | 'sandbox';
export type RunStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'skipped';

/**
 * Trigger config shapes. The `trigger_config` jsonb column holds one of
 * these depending on trigger_type. Validate at write-time, parse at read.
 */
export type TriggerConfig =
  | { type: 'one-shot'; at: string /* ISO */ }
  | { type: 'cron'; expression: string; tz?: string }
  | { type: 'interval'; every_seconds: number }
  | {
      type: 'context-match';
      kind?: string; // page_brief.kind value
      url_pattern?: string; // regex string
      hostname?: string;
    }
  | { type: 'heartbeat'; every_seconds: number };

export const AgendaTaskSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  agent_id: z.string().uuid().nullable(),
  prompt: z.string(),
  variables: z.record(z.string(), z.unknown()),
  trigger_type: z.enum(['one-shot', 'cron', 'interval', 'context-match', 'heartbeat']),
  trigger_config: z.record(z.string(), z.unknown()),
  next_due_at: z.string().nullable(),
  last_run_at: z.string().nullable(),
  surfaces: z.array(z.string()),
  auth_mode: z.enum(['ask', 'auto']),
  max_runtime_seconds: z.number().int(),
  max_concurrent: z.number().int(),
  persistent_conversation_id: z.string().uuid().nullable(),
  enabled: z.boolean(),
  expires_at: z.string().nullable(),
  tags: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AgendaTask = z.infer<typeof AgendaTaskSchema>;

export const AgendaRunSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  user_id: z.string().uuid(),
  status: z.enum(['queued', 'claimed', 'running', 'success', 'failed', 'cancelled', 'skipped']),
  surface: z.string().nullable(),
  conversation_id: z.string().uuid().nullable(),
  due_at: z.string(),
  claimed_at: z.string().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  claim_token: z.string().uuid().nullable(),
  claim_expires_at: z.string().nullable(),
  result_summary: z.string().nullable(),
  error_message: z.string().nullable(),
  result_metadata: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});
export type AgendaRun = z.infer<typeof AgendaRunSchema>;

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function listMyTasks(opts?: {
  enabled_only?: boolean;
  limit?: number;
}): Promise<AgendaTask[]> {
  const c = getSupabase();
  let q = c.from('agenda_task').select('*').order('updated_at', { ascending: false });
  if (opts?.enabled_only) q = q.eq('enabled', true);
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) {
    console.warn('[matrx-extend] listMyTasks error', error.message);
    return [];
  }
  return (data ?? []).map((row) => AgendaTaskSchema.parse(row));
}

/**
 * Tasks due for pickup by THIS surface. Checks `surfaces` membership and
 * `next_due_at <= now()`. Does not claim anything — the scanner pulls these
 * and the executor claims one by one via `claimRun`.
 */
export async function listDueForSurface(
  surface: SurfaceTarget,
  opts?: { limit?: number },
): Promise<AgendaTask[]> {
  const c = getSupabase();
  const { data, error } = await c
    .from('agenda_task')
    .select('*')
    .eq('enabled', true)
    .lte('next_due_at', new Date().toISOString())
    .or(`surfaces.cs.{${surface}},surfaces.cs.{any}`)
    .order('next_due_at', { ascending: true })
    .limit(opts?.limit ?? 20);
  if (error) {
    console.warn('[matrx-extend] listDueForSurface error', error.message);
    return [];
  }
  return (data ?? []).map((row) => AgendaTaskSchema.parse(row));
}

export async function getTask(id: string): Promise<AgendaTask | null> {
  const c = getSupabase();
  const { data, error } = await c.from('agenda_task').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return AgendaTaskSchema.parse(data);
}

export async function listRunsForTask(
  taskId: string,
  opts?: { limit?: number },
): Promise<AgendaRun[]> {
  const c = getSupabase();
  const { data, error } = await c
    .from('agenda_run')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 20);
  if (error) return [];
  return (data ?? []).map((row) => AgendaRunSchema.parse(row));
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  title: string;
  description?: string;
  agent_id?: string | null;
  prompt: string;
  variables?: Record<string, unknown>;
  trigger_type: TriggerType;
  trigger_config: TriggerConfig;
  next_due_at?: string | null;
  surfaces?: SurfaceTarget[];
  auth_mode?: AuthMode;
  max_runtime_seconds?: number;
  max_concurrent?: number;
  persistent_conversation_id?: string | null;
  expires_at?: string | null;
  tags?: string[];
}

export async function createTask(input: CreateTaskInput): Promise<AgendaTask> {
  const c = getSupabase();
  const payload = {
    title: input.title,
    description: input.description ?? null,
    agent_id: input.agent_id ?? null,
    prompt: input.prompt,
    variables: input.variables ?? {},
    trigger_type: input.trigger_type,
    trigger_config: input.trigger_config,
    next_due_at: input.next_due_at ?? computeFirstDue(input.trigger_type, input.trigger_config),
    surfaces: input.surfaces ?? ['any'],
    auth_mode: input.auth_mode ?? 'ask',
    max_runtime_seconds: input.max_runtime_seconds ?? 600,
    max_concurrent: input.max_concurrent ?? 1,
    persistent_conversation_id: input.persistent_conversation_id ?? null,
    expires_at: input.expires_at ?? null,
    tags: input.tags ?? [],
  };
  const { data, error } = await c.from('agenda_task').insert(payload).select('*').single();
  if (error) throw new Error(`createTask failed: ${error.message}`);
  return AgendaTaskSchema.parse(data);
}

export async function updateTask(
  id: string,
  patch: Partial<CreateTaskInput> & { enabled?: boolean; last_run_at?: string },
): Promise<AgendaTask | null> {
  const c = getSupabase();
  const { data, error } = await c
    .from('agenda_task')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return null;
  return AgendaTaskSchema.parse(data);
}

export async function deleteTask(id: string): Promise<boolean> {
  const c = getSupabase();
  const { error } = await c.from('agenda_task').delete().eq('id', id);
  return !error;
}

// ─── Run lifecycle (lease-based claim) ──────────────────────────────────────
//
// Each run goes through: queued → claimed → running → (success | failed).
// Claims expire — a stuck-running surface releases its lease automatically
// after `max_runtime_seconds`, letting another surface pick up.

/**
 * Atomically create a `queued` run and claim it. Returns null if the task
 * already has an unexpired claim (another surface beat us to it).
 *
 * Caller follows up with `markRunStarted` once execution actually begins,
 * then `finishRun` on completion.
 */
export async function claimRun(
  taskId: string,
  surface: SurfaceTarget,
  opts: { lease_seconds?: number } = {},
): Promise<AgendaRun | null> {
  const c = getSupabase();
  const claimToken = crypto.randomUUID();
  const claimExpiresAt = new Date(
    Date.now() + (opts.lease_seconds ?? 600) * 1000,
  ).toISOString();
  const now = new Date().toISOString();

  // Insert a fresh run row pre-claimed by us. If another surface inserts
  // first we'll see two rows — the deduplication is handled by the scanner
  // not picking up tasks where there's already an active run.
  const { data, error } = await c
    .from('agenda_run')
    .insert({
      task_id: taskId,
      status: 'claimed',
      surface,
      due_at: now,
      claimed_at: now,
      claim_token: claimToken,
      claim_expires_at: claimExpiresAt,
    })
    .select('*')
    .single();
  if (error) {
    console.warn('[matrx-extend] claimRun error', error.message);
    return null;
  }
  return AgendaRunSchema.parse(data);
}

export async function markRunStarted(runId: string, conversationId?: string): Promise<void> {
  const c = getSupabase();
  await c
    .from('agenda_run')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
      conversation_id: conversationId ?? null,
    })
    .eq('id', runId);
}

export async function finishRun(
  runId: string,
  outcome: 'success' | 'failed' | 'cancelled',
  details?: { result_summary?: string; error_message?: string; result_metadata?: object },
): Promise<void> {
  const c = getSupabase();
  await c
    .from('agenda_run')
    .update({
      status: outcome,
      finished_at: new Date().toISOString(),
      claim_token: null,
      claim_expires_at: null,
      result_summary: details?.result_summary ?? null,
      error_message: details?.error_message ?? null,
      result_metadata: details?.result_metadata ?? null,
    })
    .eq('id', runId);
}

// ─── Time math helpers ──────────────────────────────────────────────────────

/**
 * First-fire timestamp for a freshly-created task. The SW scanner advances
 * `next_due_at` after each fire — this only handles the very first run.
 *
 * Cron is intentionally not handled here (would need a cron parser); pass
 * `next_due_at` explicitly for cron tasks until we add a parser.
 */
export function computeFirstDue(type: TriggerType, config: TriggerConfig): string | null {
  switch (config.type) {
    case 'one-shot':
      return config.at;
    case 'interval':
    case 'heartbeat':
      return new Date(Date.now() + config.every_seconds * 1000).toISOString();
    case 'context-match':
      return null; // fires on context-match, not on schedule
    case 'cron':
      return null; // caller must compute and pass next_due_at
  }
  // Fallback for unrecognized types.
  return null;
}

/**
 * Compute the next-due timestamp after a successful run. Used by the
 * scanner to advance `last_run_at` and `next_due_at` for recurring tasks.
 */
export function computeNextDueAfterRun(
  trigger_type: TriggerType,
  trigger_config: TriggerConfig,
): string | null {
  switch (trigger_config.type) {
    case 'interval':
    case 'heartbeat':
      return new Date(Date.now() + trigger_config.every_seconds * 1000).toISOString();
    case 'one-shot':
      return null; // disable after fire
    case 'context-match':
      return null; // re-fires on next match, not on schedule
    case 'cron':
      return null; // needs a cron parser; stub for v0
  }
  return null;
}
