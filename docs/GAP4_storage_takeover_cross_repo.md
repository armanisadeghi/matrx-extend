# GAP 4 cross-repo change — `storage.delete` + `request_user_takeover.timeout_seconds`

> Coordination doc for [docs/TOOL_SOURCE_OF_TRUTH.md](./TOOL_SOURCE_OF_TRUTH.md)
> GAP 4. The DB is the source of truth; a change to a tool's `parameters` must
> land in `tl_def` **first**, then every executor's code is brought into line.
> _Last updated: 2026-05-24._
>
> **✅ STATUS: APPLIED.** DB migration `0062_gap4_storage_delete_takeover_timeout.sql`
> applied to prod (via `--only 0062`); matrx-extend + matrx-frontend code updated;
> all three drift checks green. aidream needed no code change (external tools, no
> arg-model). The sections below document what was done.

## Why this is cross-repo

Both tools are owned by `source_app=matrx-extend` but have **three active
executors** (verified live in `public.tl_executor`):

| executor surface | repo / runtime |
|---|---|
| `matrx-extend.browser` | matrx-extend (this repo) |
| `matrx-user.ui-first` | matrx-frontend (`features/agents/ui-first-tools/tools/schemas.ts`) |
| `server:matrx_ai` | aidream — **no Python arg-model** (external tool; aidream's validator treats `source_app=matrx-extend` tools as informational, never drift) → **no aidream code change** |

So the contract must change in **the DB + matrx-extend + matrx-frontend**. aidream
only hosts the **DB migration**.

## Current state (live DB + each executor)

**`storage`** — target: `action ∈ {get,set,list,delete}` everywhere.
| | action enum | has `delete`? |
|---|---|---|
| live `tl_def` | `[get,set,list]` | ❌ add it |
| matrx-extend `StorageArgs` | `[get,set,list]` | ❌ add it |
| matrx-frontend `storageArgsSchema` | `[get,set,list,delete]` | ✅ already (currently drifting vs DB) |

**`request_user_takeover`** — target unified set:
`reason` (req), `instructions?`, `expected_action?`, `tab_id?`, `timeout_seconds?`.
| | reason | instructions | expected_action | tab_id | timeout_seconds |
|---|---|---|---|---|---|
| live `tl_def` | ✅ | ✅ | ✅ | ✅ | ❌ add |
| matrx-extend `TakeoverArgs` | ✅ | ✅ | ✅ | ✅ | ❌ add |
| matrx-frontend `requestTakeoverArgsSchema` | ✅ | ✅ | ✅ | ❌ add | ✅ |

Each surface ignores the optional field it doesn't use (matrx-extend ignores
`timeout_seconds`'s frontend semantics if unused; matrx-frontend ignores `tab_id`).

## The changes (apply in this order)

### 1. DB first — aidream migration (the ONLY way; admin API can't patch `parameters`)
Add a migration under `aidream/db/migrations/` (next number after `0040`) with:

```sql
-- storage: add the 'delete' action
UPDATE public.tl_def
SET parameters = jsonb_set(parameters, '{action,enum}', '["get","set","list","delete"]'::jsonb),
    version = version + 1, updated_at = now()
WHERE name = 'storage';

-- request_user_takeover: add optional timeout_seconds (keep tab_id)
UPDATE public.tl_def
SET parameters = parameters || '{"timeout_seconds": {"type": "number"}}'::jsonb,
    version = version + 1, updated_at = now()
WHERE name = 'request_user_takeover';
```

Apply with `python db/apply_migrations.py` (uses `SUPABASE_MATRIX_*` Postgres
creds). **Caveat:** the runner applies *all* pending migrations across
`aidream`/`matrx-graph`/`matrx-ai`, not just this one — review what's pending
first, or run the two `UPDATE`s surgically via `psql`. Both changes are
backward-compatible (new enum value + new optional field).

### 2. matrx-extend (this repo)
- `src/lib/tools/handlers/canonical-mergers.ts` — `StorageArgs.action` enum: add
  `'delete'`; route `delete` → a new `delete_extension_storage` handler.
- `src/lib/tools/handlers/privileged.ts` — add `delete_extension_storage`
  (`chrome.storage.local.remove`, mirroring the get/set/list key namespacing).
- `src/lib/tools/handlers/user.ts` — `TakeoverArgs`: add
  `timeout_seconds: z.number().int().min(1).max(900).optional()`; use it for the
  `awaitUserResponse` deadline when present (else the 15-min default).
- Verify: `pnpm catalog:tools:drift` green.

### 3. matrx-frontend
- `features/agents/ui-first-tools/tools/schemas.ts` —
  `requestTakeoverArgsSchema`: add `tab_id: z.string().optional()`. (storage
  already has `delete`.)
- Verify: `pnpm gate:tools` (its drift check) green.

## Related GAP-4 item (separate change, not included above)
matrx-frontend still registers the ephemeral KV tool under the name **`memory`**
(`memoryArgsSchema`), colliding with the persistent semantic `memory`. GAP 4
says rename it to **`scratchpad`** (matrx-extend already uses `scratchpad`).
That needs its own DB + matrx-frontend change and is tracked separately.
