/**
 * Agenda — multi-surface scheduled agent runs.
 *
 * Schema lives in `migrations/2026_05_10_sch_v0.sql`. The `agenda_*` tables
 * (2026-05-03) were replaced by the `sch_*` scheduling spine — kind-agnostic
 * task definition + many-triggers-per-task + per-execution rows — so future
 * kinds (workflows, scrapes, webhooks, …) can share the same plumbing.
 *
 * This module is the agent-kind façade over `sch_*`: it joins
 *   sch_task ⋈ sch_agent_task ⋈ sch_trigger
 * and reshapes into the flat `AgendaTask` type the UI / scanner / runner
 * already consume. New kinds will get their own façades.
 *
 * Pickup rule (sch_run side): a surface picks a task up when
 *   1. sch_task.enabled = true
 *   2. sch_task.next_due_at <= now()
 *   3. surface_id is in sch_task.surfaces (or 'any')
 *   4. no active sch_run is currently claimed (claim_token IS NULL or expired)
 */

import { getSupabase } from '@/lib/supabase/client';
import { z } from 'zod';
import { nextCronTime } from './cron';

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

// ─── Row reshape: sch_task ⋈ sch_agent_task ⋈ sch_trigger → AgendaTask ──────
//
// The UI / scanner / runner consume the flat AgendaTask shape. v0 only has
// one trigger per task (legacy schema enforced 1:1; new tasks default to 1).
// When multi-trigger tasks land we'll surface a `triggers: TriggerConfig[]`
// alongside the primary one.

interface SchTaskJoinedRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  description: string | null;
  surfaces: string[];
  enabled: boolean;
  expires_at: string | null;
  tags: string[];
  next_due_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
  agent: {
    agent_id: string | null;
    prompt: string;
    variables: Record<string, unknown>;
    persistent_conversation_id: string | null;
    auth_mode: 'ask' | 'auto';
    max_runtime_seconds: number;
    max_concurrent: number;
  } | null;
  triggers: Array<{
    type: TriggerType;
    config: Record<string, unknown>;
    enabled: boolean;
    next_due_at: string | null;
  }>;
}

const SELECT_AGENDA_TASK =
  '*, agent:sch_agent_task!inner(agent_id, prompt, variables, persistent_conversation_id, auth_mode, max_runtime_seconds, max_concurrent), triggers:sch_trigger(type, config, enabled, next_due_at)';

/**
 * Variant with an INNER trigger join so PostgREST embedded-resource filters
 * (`.eq('triggers.type', …)`) can both filter parents and constrain the
 * embed. Used by `listContextMatchTasks` — `trigger_type` is NOT a column on
 * `sch_task` (it lived on the dropped `agenda_task`), so the old top-level
 * `.eq('trigger_type', …)` 42703'd on every scan and context-match triggers
 * silently never fired. docs/AUDIT_2026_06_10.md P2-17.
 */
const SELECT_AGENDA_TASK_TRIGGER_INNER =
  '*, agent:sch_agent_task!inner(agent_id, prompt, variables, persistent_conversation_id, auth_mode, max_runtime_seconds, max_concurrent), triggers:sch_trigger!inner(type, config, enabled, next_due_at)';

/**
 * Per-row-guarded mapping. `rowToAgendaTask` throws on a corrupt task (no
 * agent extension row, no triggers, out-of-enum trigger type) — and one bad
 * row inside a bare `.map()` used to reject the whole fetch: the Agenda tab
 * bricked, and worse, the SW scanner aborted its ENTIRE pass every minute
 * forever (the corrupt row sorts first by next_due_at and its date never
 * advances). Skip + warn instead. docs/AUDIT_2026_06_10.md P1-16.
 */
function rowsToAgendaTasks(rows: unknown[]): AgendaTask[] {
  const out: AgendaTask[] = [];
  for (const row of rows) {
    try {
      out.push(rowToAgendaTask(row as SchTaskJoinedRow));
    } catch (err) {
      const id = (row as { id?: string })?.id ?? '(unknown id)';
      console.warn(`[matrx-extend] skipping malformed sch_task ${id}: ${(err as Error).message}`);
    }
  }
  return out;
}

function rowToAgendaTask(row: SchTaskJoinedRow): AgendaTask {
  if (!row.agent) {
    throw new Error(`sch_task ${row.id} (kind=${row.kind}) has no agent extension row`);
  }
  // v0: pick the primary trigger. Multi-trigger support comes later.
  const primary = row.triggers[0];
  if (!primary) {
    throw new Error(`sch_task ${row.id} has no triggers`);
  }
  return AgendaTaskSchema.parse({
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description,
    agent_id: row.agent.agent_id,
    prompt: row.agent.prompt,
    variables: row.agent.variables ?? {},
    trigger_type: primary.type,
    trigger_config: primary.config ?? {},
    next_due_at: row.next_due_at,
    last_run_at: row.last_run_at,
    surfaces: row.surfaces,
    auth_mode: row.agent.auth_mode,
    max_runtime_seconds: row.agent.max_runtime_seconds,
    max_concurrent: row.agent.max_concurrent,
    persistent_conversation_id: row.agent.persistent_conversation_id,
    enabled: row.enabled,
    expires_at: row.expires_at,
    tags: row.tags,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

interface SchRunRow {
  id: string;
  task_id: string;
  user_id: string;
  status: RunStatus;
  surface: string | null;
  output_ref: { kind?: string; id?: string } | null;
  due_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  claim_token: string | null;
  claim_expires_at: string | null;
  result_summary: string | null;
  error_message: string | null;
  result_metadata: Record<string, unknown> | null;
  created_at: string;
}

function rowToAgendaRun(row: SchRunRow): AgendaRun {
  const conversationId =
    row.output_ref?.kind === 'conversation' && typeof row.output_ref.id === 'string'
      ? row.output_ref.id
      : null;
  return AgendaRunSchema.parse({
    id: row.id,
    task_id: row.task_id,
    user_id: row.user_id,
    status: row.status,
    surface: row.surface,
    conversation_id: conversationId,
    due_at: row.due_at,
    claimed_at: row.claimed_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    claim_token: row.claim_token,
    claim_expires_at: row.claim_expires_at,
    result_summary: row.result_summary,
    error_message: row.error_message,
    result_metadata: row.result_metadata,
    created_at: row.created_at,
  });
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function listMyTasks(opts?: {
  enabled_only?: boolean;
  limit?: number;
}): Promise<AgendaTask[]> {
  const c = getSupabase();
  let q = c
    .from('sch_task')
    .select(SELECT_AGENDA_TASK)
    .eq('kind', 'agent')
    .order('updated_at', { ascending: false });
  if (opts?.enabled_only) q = q.eq('enabled', true);
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) {
    console.warn('[matrx-extend] listMyTasks error', error.message);
    return [];
  }
  return rowsToAgendaTasks(data ?? []);
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
    .from('sch_task')
    .select(SELECT_AGENDA_TASK)
    .eq('kind', 'agent')
    .eq('enabled', true)
    .lte('next_due_at', new Date().toISOString())
    .or(`surfaces.cs.{${surface}},surfaces.cs.{any}`)
    .order('next_due_at', { ascending: true })
    .limit(opts?.limit ?? 20);
  if (error) {
    console.warn('[matrx-extend] listDueForSurface error', error.message);
    return [];
  }
  return rowsToAgendaTasks(data ?? []);
}

/**
 * Enabled context-match tasks for THIS surface. These never have a
 * `next_due_at` (they fire on a page-context match, not a clock), so the
 * scanner can't find them via `listDueForSurface`. It fetches them here and
 * evaluates each task's `trigger_config` against the active tab itself.
 */
export async function listContextMatchTasks(
  surface: SurfaceTarget,
  opts?: { limit?: number },
): Promise<AgendaTask[]> {
  const c = getSupabase();
  const { data, error } = await c
    .from('sch_task')
    .select(SELECT_AGENDA_TASK_TRIGGER_INNER)
    .eq('kind', 'agent')
    .eq('enabled', true)
    // Embedded-resource filter on the trigger row — sch_task has no
    // trigger_type column (see SELECT_AGENDA_TASK_TRIGGER_INNER docs).
    .eq('triggers.type', 'context-match')
    .or(`surfaces.cs.{${surface}},surfaces.cs.{any}`)
    .limit(opts?.limit ?? 50);
  if (error) {
    console.warn('[matrx-extend] listContextMatchTasks error', error.message);
    return [];
  }
  return rowsToAgendaTasks(data ?? []);
}

export async function getTask(id: string): Promise<AgendaTask | null> {
  const c = getSupabase();
  const { data, error } = await c
    .from('sch_task')
    .select(SELECT_AGENDA_TASK)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return rowToAgendaTask(data as unknown as SchTaskJoinedRow);
  } catch (err) {
    console.warn(`[matrx-extend] getTask ${id} malformed: ${(err as Error).message}`);
    return null;
  }
}

export async function listRunsForTask(
  taskId: string,
  opts?: { limit?: number },
): Promise<AgendaRun[]> {
  const c = getSupabase();
  const { data, error } = await c
    .from('sch_run')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 20);
  if (error) return [];
  return (data ?? []).map((row) => rowToAgendaRun(row as unknown as SchRunRow));
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

/**
 * Atomic path: the `create_agent_task` Postgres RPC (one transaction —
 * migrations/2026_06_10_sch_create_agent_task_rpc.sql, audit P2-16) does
 * all three inserts; a mid-sequence failure can no longer orphan a
 * trigger-less sch_task. The legacy three-insert path below remains as a
 * fallback for DBs where the function hasn't been applied yet (42883).
 */
export async function createTask(input: CreateTaskInput): Promise<AgendaTask> {
  const c = getSupabase();
  const nextDueAt = input.next_due_at ?? computeFirstDue(input.trigger_config);

  const { data: rpcId, error: rpcErr } = await c.rpc('create_agent_task', {
    p_title: input.title,
    p_prompt: input.prompt,
    p_trigger_type: input.trigger_type,
    p_trigger_config: input.trigger_config,
    p_description: input.description ?? null,
    p_agent_id: input.agent_id ?? null,
    p_variables: input.variables ?? {},
    p_persistent_conversation_id: input.persistent_conversation_id ?? null,
    p_auth_mode: input.auth_mode ?? 'ask',
    p_max_runtime_seconds: input.max_runtime_seconds ?? 600,
    p_max_concurrent: input.max_concurrent ?? 1,
    p_surfaces: input.surfaces ?? ['any'],
    p_tags: input.tags ?? [],
    p_expires_at: input.expires_at ?? null,
    p_next_due_at: nextDueAt,
  });
  if (!rpcErr && typeof rpcId === 'string') {
    const created = await getTask(rpcId);
    if (!created) throw new Error(`createTask: row vanished after RPC insert (${rpcId})`);
    return created;
  }
  // 42883 = undefined_function — the RPC isn't applied on this DB (staging /
  // fresh env). Anything else from the RPC is a real failure: surface it
  // rather than retrying down the non-atomic path.
  if (rpcErr && rpcErr.code !== '42883' && !/create_agent_task/.test(rpcErr.message ?? '')) {
    throw new Error(`createTask (rpc): ${rpcErr.message}`);
  }
  console.warn('[matrx-extend] create_agent_task RPC unavailable — using legacy 3-insert path');

  // 1. sch_task
  const { data: taskRow, error: taskErr } = await c
    .from('sch_task')
    .insert({
      kind: 'agent',
      title: input.title,
      description: input.description ?? null,
      queue: 'default',
      surfaces: input.surfaces ?? ['any'],
      enabled: true,
      expires_at: input.expires_at ?? null,
      tags: input.tags ?? [],
      next_due_at: nextDueAt,
    })
    .select('id')
    .single();
  if (taskErr || !taskRow) throw new Error(`createTask (sch_task): ${taskErr?.message}`);
  const taskId = taskRow.id as string;

  // 2. sch_agent_task — cleanup parent if this fails.
  const { error: agentErr } = await c.from('sch_agent_task').insert({
    id: taskId,
    agent_id: input.agent_id ?? null,
    prompt: input.prompt,
    variables: input.variables ?? {},
    persistent_conversation_id: input.persistent_conversation_id ?? null,
    auth_mode: input.auth_mode ?? 'ask',
    max_runtime_seconds: input.max_runtime_seconds ?? 600,
    max_concurrent: input.max_concurrent ?? 1,
  });
  if (agentErr) {
    await c.from('sch_task').delete().eq('id', taskId);
    throw new Error(`createTask (sch_agent_task): ${agentErr.message}`);
  }

  // 3. sch_trigger — cleanup parent if this fails.
  const { error: trigErr } = await c.from('sch_trigger').insert({
    task_id: taskId,
    type: input.trigger_type,
    config: input.trigger_config,
    enabled: true,
    next_due_at: nextDueAt,
  });
  if (trigErr) {
    await c.from('sch_task').delete().eq('id', taskId);
    throw new Error(`createTask (sch_trigger): ${trigErr.message}`);
  }

  const fetched = await getTask(taskId);
  if (!fetched) throw new Error(`createTask: row vanished after insert (${taskId})`);
  return fetched;
}

/**
 * Patch fields across sch_task, sch_agent_task, and sch_trigger based on
 * which columns the caller passed.
 *
 * Trigger-shape changes (trigger_type / trigger_config) update the single
 * trigger row associated with the task — v0 still assumes 1 trigger per
 * task. When multi-trigger tasks ship, this function will need a trigger_id
 * param to disambiguate.
 */
export async function updateTask(
  id: string,
  patch: Partial<CreateTaskInput> & { enabled?: boolean; last_run_at?: string },
): Promise<AgendaTask | null> {
  const c = getSupabase();

  // Split the patch by destination table.
  const taskPatch: Record<string, unknown> = {};
  const agentPatch: Record<string, unknown> = {};
  const triggerPatch: Record<string, unknown> = {};

  if ('title' in patch) taskPatch.title = patch.title;
  if ('description' in patch) taskPatch.description = patch.description ?? null;
  if ('surfaces' in patch) taskPatch.surfaces = patch.surfaces;
  if ('enabled' in patch) taskPatch.enabled = patch.enabled;
  if ('expires_at' in patch) taskPatch.expires_at = patch.expires_at ?? null;
  if ('tags' in patch) taskPatch.tags = patch.tags;
  if ('next_due_at' in patch) taskPatch.next_due_at = patch.next_due_at ?? null;
  if ('last_run_at' in patch) taskPatch.last_run_at = patch.last_run_at ?? null;

  if ('agent_id' in patch) agentPatch.agent_id = patch.agent_id ?? null;
  if ('prompt' in patch) agentPatch.prompt = patch.prompt;
  if ('variables' in patch) agentPatch.variables = patch.variables ?? {};
  if ('persistent_conversation_id' in patch)
    agentPatch.persistent_conversation_id = patch.persistent_conversation_id ?? null;
  if ('auth_mode' in patch) agentPatch.auth_mode = patch.auth_mode;
  if ('max_runtime_seconds' in patch) agentPatch.max_runtime_seconds = patch.max_runtime_seconds;
  if ('max_concurrent' in patch) agentPatch.max_concurrent = patch.max_concurrent;

  if ('trigger_type' in patch) triggerPatch.type = patch.trigger_type;
  if ('trigger_config' in patch) triggerPatch.config = patch.trigger_config;
  // Mirror next_due_at + enabled onto the trigger row so the eventual
  // multi-trigger scanner sees a consistent state.
  if ('next_due_at' in patch) triggerPatch.next_due_at = patch.next_due_at ?? null;
  if ('enabled' in patch) triggerPatch.enabled = patch.enabled;

  if (Object.keys(taskPatch).length > 0) {
    const { error } = await c.from('sch_task').update(taskPatch).eq('id', id);
    if (error) return null;
  }
  if (Object.keys(agentPatch).length > 0) {
    const { error } = await c.from('sch_agent_task').update(agentPatch).eq('id', id);
    if (error) return null;
  }
  if (Object.keys(triggerPatch).length > 0) {
    const { error } = await c.from('sch_trigger').update(triggerPatch).eq('task_id', id);
    if (error) return null;
  }
  return getTask(id);
}

/**
 * Atomically claim a due fire (docs/AUDIT_2026_06_10.md P0-7 / P2-15).
 *
 * The scanner used to notify/broadcast FIRST and advance `next_due_at`
 * AFTER the dispatch settled — so a run outlasting the 1-minute alarm
 * period re-fired on the next scan (the stale next_due_at was still <=
 * now), the boot-scan raced the alarm-scan, and two devices on the same
 * account both fired. This is a compare-and-set UPDATE: it only matches
 * when the schedule field still holds the value THIS scanner observed, so
 * exactly one concurrent scanner wins. Firing happens AFTER the claim —
 * a crash between claim and notify is a missed fire (recoverable, the
 * user re-enables / next cron window), never a duplicate run.
 *
 * Clock triggers CAS on `next_due_at`; context-match triggers have no
 * schedule, so they CAS on `last_run_at` (the cooldown stamp).
 */
export async function claimDueFire(
  task: AgendaTask,
  patch: { next_due_at: string | null; last_run_at: string; enabled: boolean },
): Promise<boolean> {
  const c = getSupabase();
  let q = c
    .from('sch_task')
    .update({
      next_due_at: patch.next_due_at,
      last_run_at: patch.last_run_at,
      enabled: patch.enabled,
    })
    .eq('id', task.id);
  if (task.trigger_type === 'context-match') {
    q =
      task.last_run_at === null ? q.is('last_run_at', null) : q.eq('last_run_at', task.last_run_at);
  } else {
    q =
      task.next_due_at === null ? q.is('next_due_at', null) : q.eq('next_due_at', task.next_due_at);
  }
  const { data, error } = await q.select('id');
  if (error) {
    console.warn('[matrx-extend] claimDueFire error', error.message);
    return false;
  }
  const won = (data?.length ?? 0) > 0;
  if (won) {
    // Mirror onto the trigger row (best-effort, non-CAS — the task row is
    // the authoritative schedule; this keeps the future multi-trigger
    // scanner consistent, same as updateTask does).
    await c
      .from('sch_trigger')
      .update({ next_due_at: patch.next_due_at, enabled: patch.enabled })
      .eq('task_id', task.id);
  }
  return won;
}

/**
 * Fail-close runs whose claim lease expired with no surface finishing them
 * (docs/AUDIT_2026_06_10.md P1-16). `claim_expires_at` was written on every
 * claim but READ nowhere — a sidepanel closed mid-run left the row
 * 'claimed'/'running' forever, and the partial unique index
 * `sch_run_unique_active_per_task` then blocked every future run of that
 * task at the DB level. Runs as part of the minute scan; RLS scopes the
 * sweep to this user's rows.
 */
export async function reapExpiredRuns(): Promise<number> {
  const c = getSupabase();
  const now = new Date().toISOString();
  const { data, error } = await c
    .from('sch_run')
    .update({
      status: 'failed',
      error_message: 'lease expired — no surface finished this run (reaped)',
      finished_at: now,
    })
    .in('status', ['queued', 'claimed', 'running'])
    .lt('claim_expires_at', now)
    .select('id');
  if (error) {
    console.warn('[matrx-extend] reapExpiredRuns error', error.message);
    return 0;
  }
  return data?.length ?? 0;
}

export async function deleteTask(id: string): Promise<boolean> {
  // FK cascades drop sch_agent_task, sch_trigger, sch_run rows automatically.
  const c = getSupabase();
  const { error } = await c.from('sch_task').delete().eq('id', id);
  return !error;
}

// ─── Run lifecycle (lease-based claim) ──────────────────────────────────────
//
// Each run goes through: queued → claimed → running → (success | failed).
// Claims expire — a stuck-running surface releases its lease automatically
// after `max_runtime_seconds`, letting another surface pick up.

/**
 * Atomically create a `claimed` run and return it. Returns null if the
 * insert fails (e.g., RLS denied).
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
  const claimExpiresAt = new Date(Date.now() + (opts.lease_seconds ?? 600) * 1000).toISOString();
  const now = new Date().toISOString();

  const { data, error } = await c
    .from('sch_run')
    .insert({
      task_id: taskId,
      status: 'claimed',
      surface,
      queue: 'default',
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
  return rowToAgendaRun(data as unknown as SchRunRow);
}

/**
 * Terminal/start transitions are gated on still being in an ACTIVE state
 * (audit P2-15). Unconditional `.eq('id')` updates let a late finisher —
 * e.g. a run the reaper already failed for an expired lease — overwrite the
 * terminal row (`success` stomping `failed`, or re-nulling a fresh claim's
 * token). The scheduler-client twins gate on claim_token; the agenda façade
 * gates on status, which is the equivalent invariant the reaper maintains.
 * Errors are logged (they used to be silently ignored — a failed write left
 * the row stuck while the UI believed it finished).
 */
export async function markRunStarted(runId: string, conversationId?: string): Promise<void> {
  const c = getSupabase();
  const { error } = await c
    .from('sch_run')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
      output_ref: conversationId ? { kind: 'conversation', id: conversationId } : null,
    })
    .eq('id', runId)
    .in('status', ['queued', 'claimed']);
  if (error) console.warn('[matrx-extend] markRunStarted error', error.message);
}

export async function finishRun(
  runId: string,
  outcome: 'success' | 'failed' | 'cancelled',
  details?: { result_summary?: string; error_message?: string; result_metadata?: object },
): Promise<void> {
  const c = getSupabase();
  const { error } = await c
    .from('sch_run')
    .update({
      status: outcome,
      finished_at: new Date().toISOString(),
      claim_token: null,
      claim_expires_at: null,
      result_summary: details?.result_summary ?? null,
      error_message: details?.error_message ?? null,
      result_metadata: details?.result_metadata ?? null,
    })
    .eq('id', runId)
    .in('status', ['queued', 'claimed', 'running']);
  if (error) console.warn('[matrx-extend] finishRun error', error.message);
}

// ─── Time math helpers ──────────────────────────────────────────────────────

/**
 * First-fire timestamp for a freshly-created task. The SW scanner advances
 * `next_due_at` after each fire — this only handles the very first run.
 *
 * Cron is computed via the local cron parser (src/lib/agenda/cron.ts),
 * evaluated in the host's local timezone.
 */
export function computeFirstDue(config: TriggerConfig): string | null {
  switch (config.type) {
    case 'one-shot':
      return config.at;
    case 'interval':
    case 'heartbeat':
      return new Date(Date.now() + config.every_seconds * 1000).toISOString();
    case 'context-match':
      return null; // fires on a page-context match, not on a schedule
    case 'cron': {
      const next = nextCronTime(config.expression, new Date(), config.tz);
      return next ? next.toISOString() : null;
    }
  }
}

/**
 * Compute the next-due timestamp after a successful run. Used by the
 * scanner to advance `last_run_at` and `next_due_at` for recurring tasks.
 */
export function computeNextDueAfterRun(trigger_config: TriggerConfig): string | null {
  switch (trigger_config.type) {
    case 'interval':
    case 'heartbeat':
      return new Date(Date.now() + trigger_config.every_seconds * 1000).toISOString();
    case 'one-shot':
      return null; // disable after fire
    case 'context-match':
      return null; // re-fires on next page-context match, not on a schedule
    case 'cron': {
      const next = nextCronTime(trigger_config.expression, new Date(), trigger_config.tz);
      return next ? next.toISOString() : null;
    }
  }
}
