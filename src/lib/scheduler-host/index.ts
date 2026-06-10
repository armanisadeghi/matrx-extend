/**
 * SW-side scheduler host.
 *
 * Activates when a user is signed in; consumes `sch_task` rows that target
 * this surface (`chrome-extension-chat`) via Supabase Realtime postgres_changes,
 * claims them atomically through the vendored scheduler-client, dispatches
 * to a registered handler for the task's `kind`, and reports the result via
 * `completeRun` / `failRun`.
 *
 * Lifecycle:
 *  - `startSchedulerHost(userId)` — subscribes and remembers the teardown fn.
 *    Idempotent for the same userId; switches subscription if userId changes.
 *  - `stopSchedulerHost()` — tears down (idempotent).
 *
 * Wake-up: this host is REACTIVE to postgres_changes — the SW must already be
 * alive when an event arrives. Phase 4 will add Broadcast wake hints from
 * aidream so the SW comes alive on a wake envelope (chrome.alarms wakes the
 * SW; the SW reconnects this subscriber on boot via bootstrap.ts).
 *
 * Handler registry: task handlers are keyed by `kind` (a small string today —
 * the DB CHECK currently only allows 'agent'). Subsequent phases will widen
 * the constraint and ship more handlers; for now Phase 3c.1 ships only the
 * registration plumbing and one example `ping` handler.
 */

import { getOrMintInstanceId } from '@/lib/cross-component/instance-id';
import { log } from '@/lib/debug/log';
import {
  type Json,
  type SchTaskRow,
  type SchedulerClient,
  TaskClaimRaceError,
  type TaskEvent,
  createSchedulerClient,
} from '@/lib/scheduler-client';
import { getSupabase } from '@/lib/supabase/client';

// ── Handler registry ───────────────────────────────────────────────────────

export interface TaskHandlerResult {
  ok: boolean;
  resultSummary?: string;
  errorMessage?: string;
  resultMetadata?: Record<string, unknown>;
}

export type TaskHandler = (task: SchTaskRow) => Promise<TaskHandlerResult>;

const HANDLERS = new Map<string, TaskHandler>();

/**
 * Register a handler for a given task `kind`. Idempotent — re-registering
 * the same kind silently replaces the previous handler. Phase 3c.1 only
 * ships an example `ping` handler; production kinds land in later phases.
 */
export function registerTaskHandler(kind: string, handler: TaskHandler): void {
  HANDLERS.set(kind, handler);
}

/** Visibility for diagnostics — admin Debug tab uses this to render coverage. */
export function listRegisteredKinds(): string[] {
  return Array.from(HANDLERS.keys()).sort();
}

// ── Host state (singleton, SW-scoped) ──────────────────────────────────────

let activeTeardown: (() => Promise<void>) | null = null;
let activeUserId: string | null = null;
let starting: Promise<void> | null = null;

/**
 * Activate the host for the given user. If already active for the same user,
 * no-op. If active for a different user (rare — sign-out + new sign-in), the
 * previous subscription is torn down before the new one comes up.
 *
 * Failures here are LOGGED, not thrown. The extension keeps working without
 * the scheduler subscription; it just won't pick up tasks until the next
 * successful start (e.g. after a SW wake or manual retry).
 */
export async function startSchedulerHost(userId: string): Promise<void> {
  if (activeUserId === userId && activeTeardown) return;
  if (starting) {
    await starting;
    if (activeUserId === userId && activeTeardown) return;
  }

  starting = (async () => {
    try {
      if (activeTeardown) {
        await stopSchedulerHost();
      }

      const supabase = getSupabase();
      const instanceId = await getOrMintInstanceId();

      const client: SchedulerClient = createSchedulerClient({
        supabaseClient: supabase,
        surface: 'chrome-extension-chat',
        instanceId,
      });

      const teardown = client.subscribeToTasks({
        userId,
        onTask: (event) => {
          void handleTaskEvent(client, event);
        },
      });

      activeTeardown = teardown;
      activeUserId = userId;
      log.success(
        'sys',
        `scheduler-host: started for user=${userId} surface=chrome-extension-chat instance=${instanceId}`,
      );
    } catch (err) {
      log.warn('sys', `scheduler-host: start failed: ${(err as Error).message}`);
    }
  })();

  try {
    await starting;
  } finally {
    starting = null;
  }
}

/**
 * Tear down the active subscription. Idempotent.
 */
export async function stopSchedulerHost(): Promise<void> {
  const fn = activeTeardown;
  activeTeardown = null;
  activeUserId = null;
  if (!fn) return;
  try {
    await fn();
    log.info('sys', 'scheduler-host: stopped');
  } catch (err) {
    log.warn('sys', `scheduler-host: teardown failed: ${(err as Error).message}`);
  }
}

// ── Event handling ────────────────────────────────────────────────────────

/**
 * Decide whether a sch_task event represents work this host should try to
 * claim, then walk the claim → run → finalize cycle.
 *
 * Why filtering is here rather than in subscribe.ts:
 * - subscribe.ts already drops events whose `surfaces[]` doesn't include
 *   this surface or 'any' (surface-targeting filter).
 * - This function applies HOST-LEVEL filters: enabled flag, due-now check,
 *   registered handler. Each is a reason to bail without ever touching the DB.
 */
async function handleTaskEvent(client: SchedulerClient, event: TaskEvent): Promise<void> {
  if (event.type === 'DELETE') return;

  const task = event.task;
  if (!task.enabled) return;
  if (task.next_due_at == null) return;

  // Only claim if the task is due now or in the past. Future tasks will be
  // picked up by the matching UPDATE event when next_due_at rolls into the
  // present (the Python scanner is what advances next_due_at, so the
  // extension never has to compute due times itself).
  if (new Date(task.next_due_at).getTime() > Date.now()) return;

  const handler = HANDLERS.get(task.kind);
  if (!handler) {
    log.info('sys', `scheduler-host: no handler for kind=${task.kind} task=${task.id} — skipping`);
    return;
  }

  let runId: string | null = null;
  let claimToken: string | null = null;

  try {
    const run = await client.claimTask({ task });
    runId = run.id;
    claimToken = run.claim_token;
    log.info('sys', `scheduler-host: claimed task=${task.id} run=${run.id} kind=${task.kind}`);
  } catch (err) {
    if (err instanceof TaskClaimRaceError) {
      // Another claimer won the race — expected, not an error.
      return;
    }
    log.warn('sys', `scheduler-host: claim failed for task=${task.id}: ${(err as Error).message}`);
    return;
  }

  if (!claimToken) {
    // The DB enforces NOT NULL on claim_token at INSERT; this branch is
    // defensive in case a future schema change relaxes that.
    log.warn(
      'sys',
      `scheduler-host: claim returned no claim_token for run=${runId} — cannot finalize`,
    );
    return;
  }

  try {
    const result = await handler(task);
    if (result.ok) {
      const won = await client.completeRun({
        runId,
        claimToken,
        resultSummary: result.resultSummary ?? null,
        resultMetadata: toResultMetadata(result.resultMetadata),
      });
      if (!won) {
        log.warn('sys', `scheduler-host: lease lost before completeRun for run=${runId}`);
      } else {
        log.success('sys', `scheduler-host: completed run=${runId} task=${task.id}`);
      }
    } else {
      const won = await client.failRun({
        runId,
        claimToken,
        errorMessage: result.errorMessage ?? 'handler reported failure',
        resultMetadata: toResultMetadata(result.resultMetadata),
      });
      if (!won) {
        log.warn('sys', `scheduler-host: lease lost before failRun for run=${runId}`);
      }
    }
  } catch (handlerErr) {
    const message = handlerErr instanceof Error ? handlerErr.message : String(handlerErr);
    log.error(
      'sys',
      `scheduler-host: handler crashed for run=${runId} task=${task.id}: ${message}`,
      handlerErr,
    );
    try {
      await client.failRun({
        runId,
        claimToken,
        errorMessage: message,
      });
    } catch (failErr) {
      log.error(
        'sys',
        `scheduler-host: failRun also failed for run=${runId}: ${(failErr as Error).message}`,
        failErr,
      );
    }
  }
}

/**
 * Narrow an arbitrary `Record<string, unknown>` to the `Record<string, Json>`
 * shape the scheduler-client write paths expect. We don't deep-validate —
 * the caller's handler is trusted, and any non-JSON-serializable value will
 * fail at the supabase-js serialization layer. This cast is purely a
 * structural-compat bridge so handler authors don't have to type their
 * return values against the imported `Json` alias.
 */
function toResultMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, Json> | null {
  if (metadata == null) return null;
  return metadata as Record<string, Json>;
}
