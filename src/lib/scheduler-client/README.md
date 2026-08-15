# `@matrx/scheduler-client` (matrx-extend mirror)

This is the **matrx-extend mirror** of the canonical TypeScript scheduler client. The canonical version lives at `matrx-frontend/lib/scheduler-client/` — edit there first, then port the change here.

The matching Python source of truth is `aidream/packages/matrx-scheduler/`. When claim semantics or row shapes change, update Python first, then matrx-frontend, then re-vendor here.

## Why this exists

The Python `matrx-scheduler` is the authoritative scanner — it runs in aidream, polls `sch_task.next_due_at`, claims due rows by inserting `sch_run` records, and dispatches to the host's agent runner.

But the Chrome extension can't host a Python process. matrx-extend's SW needs to:

- Subscribe to the signed-in user's private scheduler Broadcast topic so it knows when work targeted at the extension arrives without `postgres_changes` WAL/RLS cost.
- Atomically claim those tasks the same way the Python scanner does (INSERT into `sch_run` gated by the partial unique index `sch_run_unique_active_per_task`).
- Report results via the same lease-token-gated UPDATE path.

This module is the TS twin that makes all of that possible against the same `sch_*` tables.

## What this package mirrors

The TS API is intentionally shaped to match the Python module:

| TS                              | Python (`matrx_scheduler/`)                        |
| ------------------------------- | -------------------------------------------------- |
| `createSchedulerClient(cfg)`    | `configure(...)` + module singleton                |
| `claimTask(opts)`               | `queries.py::claim_task`                           |
| `markRunRunning(opts)`          | `queries.py::mark_run_running`                     |
| `completeRun(opts)`             | `queries.py::finalize_run(status='success')`       |
| `failRun(opts)`                 | `queries.py::finalize_run(status='failed')`        |
| `subscribeToTasks(opts)`        | (no Python equivalent — Python polls)              |
| `computeNextDueAt(trigger)`     | `next_due.py::compute_next_due_at`                 |
| `TaskClaimRaceError`            | `claim_task` returning `None` on 23505             |
| `SCHEDULER_SURFACES`            | hard-coded list (must match DB CHECK)              |

For the authoritative claim/lease semantics, **read the Python module** — that's where the design lives. This TS package follows it.

## Mirror policy

| Repo               | Path                                  | Role                                                          |
| ------------------ | ------------------------------------- | ------------------------------------------------------------- |
| matrx-frontend     | `lib/scheduler-client/`               | **Canonical TS home.** Edits here first.                      |
| **matrx-extend**   | `src/lib/scheduler-client/` *(this)*  | Hand-mirrored from matrx-frontend.                            |
| aidream            | `packages/matrx-scheduler/`           | **Canonical Python.** TS follows; never the other way around. |

Sync workflow (until a build-time vendor process exists):

1. Land semantic changes in matrx-frontend first (or Python, then both TS clients).
2. Open this directory and update the matching file. The TS source should be a near-verbatim copy.
3. Run `pnpm tsc --noEmit` to confirm the import graph still compiles.

## Adjustments vs the canonical version

These are the only places this mirror intentionally diverges from `matrx-frontend/lib/scheduler-client/`:

- **`types.ts`** — matrx-frontend imports `Database['public']['Tables']['sch_*']` from a `database.types.ts` produced by `pnpm update-supabase-types`. matrx-extend has no Supabase types generator hooked up, so the same row shapes are **inlined** as hand-written interfaces. If the DB schema drifts, update `types.ts` by hand against the corresponding block in `matrx-frontend/types/database.types.ts`. The Python `aidream/packages/matrx-scheduler/matrx_scheduler/models.py` is the cross-language reference.

- **`README.md`** — this file, rewritten with matrx-extend framing.

Everything else (`client.ts`, `claim.ts`, `subscribe.ts`, `next-due.ts`, `surfaces.ts`, `errors.ts`, `index.ts`) is a verbatim copy.

## Usage

```ts
import { createSchedulerClient } from "@/lib/scheduler-client";
import { getSupabase } from "@/lib/supabase/client";
import { getOrMintInstanceId } from "@/lib/cross-component/instance-id";

const scheduler = createSchedulerClient({
    supabaseClient: getSupabase(),
    surface: "chrome-extension-chat",
    instanceId: await getOrMintInstanceId(),
});

// Subscribe to schedule changes for the current user.
const stop = scheduler.subscribeToTasks({
    userId: currentUserId,
    onTask: ({ type, task }) => {
        console.log(`sch_task ${type}`, task.id, task.next_due_at);
    },
});

// Atomically claim a due task. Throws TaskClaimRaceError if another
// scanner won the race — back off and move on.
try {
    const run = await scheduler.claimTask({ task });
    // ... do work ...
    const won = await scheduler.completeRun({
        runId: run.id,
        claimToken: run.claim_token!,
        resultSummary: "ok",
    });
    if (!won) {
        // Lease lapsed mid-flight; another claimer owns this run now.
    }
} catch (err) {
    if (err instanceof TaskClaimRaceError) {
        // Expected race loss — log at debug, move on.
    }
}
```

The matrx-extend SW wires the scheduler client through `src/lib/scheduler-host/`. That module is the entry point — `index.ts` here is a low-level building block.

## Race-loss handling

The DB has a partial unique index `sch_run_unique_active_per_task` on `(task_id) WHERE status IN ('queued','claimed','running')`. The second concurrent claimer trips a SQLSTATE `23505` unique violation; `claimTask` catches that and re-throws `TaskClaimRaceError` (which carries the task id and the underlying PostgrestError as `cause`).

`completeRun`, `failRun`, and `markRunRunning` gate their UPDATE on `claim_token` — a stale lease can't overwrite a re-claimed run. They return `boolean`; `false` means the lease was lost and the caller should stop writing.

## File layout

- `index.ts` — public re-exports (the only file external callers should import from).
- `client.ts` — `createSchedulerClient` factory.
- `claim.ts` — `claimTask`, `markRunRunning`, `completeRun`, `failRun`.
- `subscribe.ts` + `realtime.ts` — ref-counted private per-user database Broadcast subscription; durable task reads and claims still use table RLS.
- `next-due.ts` — TS twin of Python `next_due.py`. Uses `cron-parser` for cron expressions.
- `surfaces.ts` — `SCHEDULER_SURFACES` whitelist + `SchedulerSurface` type.
- `types.ts` — **hand-written row shapes** mirroring `database.types.ts` (see above).
- `errors.ts` — `SchedulerClientError`, `TaskClaimRaceError`, `isClaimRaceLoss`.

## Verification

```bash
pnpm tsc --noEmit 2>&1 | grep "scheduler-client"
# Expect: no output.
```
