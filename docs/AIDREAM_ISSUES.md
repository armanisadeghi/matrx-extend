# Open issues on the aidream side

> **Schema rename note — the names moved TWICE.** This doc was written against
> the pre-refactor tables (`tl_def`, `tl_executor`, `tl_def_surface`,
> `tl_bundle*`, `source_app`). The 2026-05-27 clean break renamed them, and the
> 2026-06 schema split moved them out of `public` and dropped the prefix. Verified
> against the live DB 2026-08-09:
>
> | In this doc | 2026-05-27 | **LIVE** |
> |---|---|---|
> | `tl_def` | `tool_def` | **`tool.definition`** |
> | `tl_executor` | `tool_binding` (`executor_name`, not `surface`) | **`tool.binding`** |
> | `tl_def_surface` | dropped → `tool_surface_defaults.always_include_tools` | **`tool.surface_defaults`** |
> | `tl_bundle` | `tool_bundle` | **`tool.bundle`** |
> | `tl_bundle_member` | `tool_bundle_member` | **gone** — see Bug 1 |
> | `source_app='matrx-extend'` | — | **`tool.binding.executor_name='chrome-extension'`** |
>
> Only the last column exists. Client callers must select the schema (`toolDb()`
> or `Accept-Profile: tool`). Canonical vocabulary and rules:
> [aidream/docs/official/tool_system_rules.md](../../aidream/docs/official/tool_system_rules.md);
> refactor write-up:
> [CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md).
>
> Bug 1 was fixed on our end at the time and has since been resolved
> structurally — see its updated "Long-term fix" note. The doc remains as
> historical context.

> Two bugs surfaced from a live agent test on 2026-05-19. One was on
> our DB (fixed). The other(s) sit in aidream and need their team.

---

## Bug 1 — `load_browser_tools` returned 0 tools for every category — FIXED on our end

### Symptom

In the live session, the agent called `load_browser_tools` repeatedly
with various categories and got either `error: unknown_category` or a
successful response with 0 tools loaded. The agent eventually gave up
and just described what the tools would do instead of using them.

### Root cause

aidream's `load_browser_tools` discovery handler resolves a category
by reading `public.tl_bundle` (matched by `name`) + `public.tl_bundle_member`
(matched by `bundle_id`). [Today: `tool.bundle` with a `lister_tool_id`; the
member table is gone.] matrx-extend's bundle rows were stale:

- 9 bundles named for OLD categories (`advanced`, `ask`, `cookies`,
  `debug`, `files`, `forms`, `history`, `interact`, `page`) — no longer
  match any tool's `tool.definition.category` value after the 2026-05-19 category
  redesign.
- 5 bundles whose names overlap new categories (`core`, `ai`, `memory`,
  `tabs`, `webmcp`) had 0 or stale members.
- 9 new categories (`reading`, `interaction`, `capture`, `chrome`,
  `human`, `demos`, `guidance`, `devtools`, `desktop`) had no bundle rows
  at all.

### Fix applied (2026-05-19, ~22:55 UTC)

> **Historical record — do NOT run this.** Every table below (`tl_bundle_member`,
> `tl_def`, `tl_bundle`) was renamed and then removed or restructured. This is
> what executed on 2026-05-19, preserved so the counts make sense.

In one transaction:
1. `DELETE` the 9 obsolete matrx-extend bundles and their members.
2. `UPSERT` 14 new bundles, one per category, with rich descriptions.
3. Repopulate `tl_bundle_member` by joining `tl_def.category` = `tl_bundle.name`:

```sql
INSERT INTO public.tl_bundle_member (bundle_id, tool_id, local_alias, sort_order)
SELECT b.id, d.id, d.name,
       row_number() OVER (PARTITION BY b.id ORDER BY d.name) AS sort_order
FROM public.tl_def d
JOIN public.tl_bundle b ON b.name = d.category
WHERE d.source_app = 'matrx-extend'
  AND d.is_active = true
  AND b.lister_tool_id = '3dd2eef1-212c-4ca2-a128-ec5c95e086de';
```

Result: every category now resolves to a real tool list. Counts:

| bundle | members |
|---|---:|
| `reading` | 18 |
| `devtools` | 15 |
| `interaction` | 11 |
| `capture` | 5 |
| `demos` | 5 |
| `human` | 5 |
| `chrome` | 4 |
| `guidance` | 4 |
| `tabs` | 4 |
| `memory` | 3 |
| `core` | 2 |
| `ai` | 1 |
| `desktop` | 1 |
| `webmcp` | 1 |
| **total** | **79** |

### Long-term fix — ✅ RESOLVED by the schema split (verified 2026-08-09)

**Option B shipped.** The manual-sync problem is gone because the membership
table is gone: `tool_bundle_member` did not survive the 2026-06 split — its 88
rows now sit in `graveyard.bundle_member`, and `tool.bundle` carries a
`lister_tool_id` instead. All 14 category bundles (`ai`, `capture`, `chrome`,
`core`, `demos`, `desktop`, `devtools`, `guidance`, `human`, `interaction`,
`memory`, `reading`, `tabs`, `webmcp`) point at `load_browser_tools` as their
lister, so the handler derives each category's tool list itself rather than
reading a parallel table someone has to keep in sync.

Nothing for a drift script to maintain here. Verify with:

```sql
SELECT b.name AS bundle, b.is_system, ld.name AS lister_tool
FROM tool.bundle b
LEFT JOIN tool.definition ld ON ld.id = b.lister_tool_id
WHERE b.is_active
ORDER BY b.name;
```

The two options below are kept only to show what was considered; neither needs
action.

<details>
<summary>Original Option A / Option B (superseded)</summary>

**Option A — keep the bundle table, add a maintenance script.** Each surface
team's drift-check script repopulates bundle membership from the tool category
on every release.

**Option B — change the discovery handler to query the definitions directly**,
dropping the bundle table from the matrx-extend discovery path while other
listers (MCP marketplace) keep using it. *This is effectively what happened.*

</details>

---

## Bug 2 — Agent sees non-existent tools in its system prompt — NEEDS AIDREAM

### Symptom

From the agent's reasoning trace in the live test:

> "Based on my system prompt, these are always-on tools: `ask_user`,
> `notify_user`, `update_plan`"

The agent believed `ask_user` and `notify_user` were separate tools.
Neither exists in `tool.definition`. They were absorbed into the single `user`
mega-tool's `type` discriminator months ago:

- `ask_user(question, options)` → `user(type='choice', question, options)`
- `notify_user(message)` → `user(type='notify', message)`

When the agent emits a `tool_call` for `ask_user`, the matrx-extend
dispatcher rejects it as unknown.

### Root cause (best guess)

aidream's system-prompt assembly is using a cached / static list of
tool names. The list still includes the consolidated-away
`ask_user` / `notify_user` names. The actual `tool.definition` only has `user`.

### What aidream needs to do

Two checks:

1. **Audit the prompt assembly.** Grep aidream's prompt-building code
   for hardcoded references to `ask_user`, `notify_user`. Replace with
   `user` + a one-line explanation of the `type` discriminator.
2. **Source the prompt from live `tool.definition`.** Per aidream's [`tool_system_rules.md`](../../aidream/docs/official/tool_system_rules.md)
   S8 ("Tool names are stable, tool UUIDs are immutable") and rule 4 of
   matrx-extend's [TOOL_SOURCE_OF_TRUTH.md](./TOOL_SOURCE_OF_TRUTH.md)
   (descriptions live only in the DB), the system prompt's tool descriptions
   should come from `tool.definition.description` at session-resolution time, not
   from a hand-maintained tool-list constant. If the prompt is read from
   `tool.definition.description`, it cannot mention non-existent tools.

If the prompt is correct in code but the agent still saw the old
names, the cache may need bursting.

---

## Bug 3 (possible) — Surface name mismatch between gates and executors

### Symptom

Not directly proven by the live test, but worth flagging while we're
here.

At the time, `tl_executor.surface` said `matrx-extend.browser` while
`tl_def_surface.surface_name` said `chrome-extension/assistant` — two different
naming conventions for what looked like the same thing, so any join between them
would have returned zero rows.

### ✅ RESOLVED — they were never the same thing (verified 2026-08-09)

The refactor answered this by separating the two concepts, and the answer is now
a hard rule:

- **Executor names** are single-segment kebab-case, with dots reserved for
  sub-executors: `chrome-extension`, `matrx-user`, `matrx-local`, `mcp.<slug>`.
  Enforced by a CHECK constraint on the regex in
  [tool_system_rules.md](../../aidream/docs/official/tool_system_rules.md) R7.
  The old `matrx-extend.browser` form is explicitly dead per R11.
- **Surface names** are `client/panel`: `chrome-extension/assistant`,
  `chrome-extension/pilot`, `matrx-user/chat`, `matrx-local/desktop`.

There is no join between them to get wrong: `tool.binding.executor_name` →
`tool.executor.name`, and `tool.surface_defaults.surface_name` → `ui.ui_surface.name`.
The link is `ui.ui_surface.executor_name`, a real FK. Live state for this
extension: 80 active bindings on `chrome-extension`, and two surfaces advertising
81 tools each.

---

## What to do with this doc

**Only Bug 2 is still open.** Bugs 1 and 3 were resolved structurally by the
2026-06 schema split (see each section) — re-verified against the live DB on
2026-08-09. Hand this file to the aidream team for Bug 2: the system prompt
advertising `ask_user` / `notify_user`, which have not existed since they were
folded into the `user` mega-tool's `type` discriminator.

When they fix Bug 2, re-test from a real chat session:
1. New conversation, ask "use the `user` tool to ask me yes/no."
2. Agent should call `user({type:'confirm', question:'…'})`.
3. Card renders; user clicks.
4. Agent continues with the answer.

If the agent calls `ask_user` instead of `user`, Bug 2 is still live.

---

## From the 2026-06-10 full-repo audit (see docs/AUDIT_2026_06_10.md)

### 1. RLS disabled on shared platform tables the extension touches with the anon key — P1
Runtime-verified via Supabase security advisors on `txzxabzwovsujtloxrus`:

- `tool.definition`, `tool.binding`, `tool.executor`, `tool.surface_defaults`,
  `tool.bundle`, `tool_bundle_member` — **RLS disabled**. The extension reads
  `tool.definition` live with the publishable key (committed in its `.env` files),
  so the tool registry is anon-readable — and unless write GRANTs are revoked
  for `anon`, anon-WRITABLE. Tool descriptions/tiers shown to users on
  approval cards come from here.
- `cx_user_usage_summary` — **RLS disabled**, and `guest_executions` /
  `guest_execution_log` have **always-true policies**. A guest holding the
  public anon key can read (and possibly tamper with) the rolling-usage
  summary that guest rate limits are designed to read. Latent today (no 429
  enforcement is wired yet) but the data surface is open now.
- `cx_pending_injection`, `cx_request_snapshot` — RLS disabled; these carry
  user message content.

Ask: enable owner/role RLS (or at minimum revoke anon write) on these tables.

### 2. `create_agent_task` RPC for atomic agenda task creation — P2
`createTask` in matrx-extend (`src/lib/agenda/queries.ts`) is three sequential
inserts (`sch_task` → `sch_agent_task` → `sch_trigger`) with best-effort,
unchecked cleanup. A failure between inserts leaves an orphaned trigger-less
`sch_task`, which then poisons the per-minute scanner. The code already
documents the right fix: a single Postgres RPC doing all three in one
transaction. Extension-side guards have been added, but the RPC is the real
fix.

### 3. `sch_run_unique_active_per_task` index missing from the shared migration record — P3
The index EXISTS in the live DB (verified) but is absent from
matrx-extend's `migrations/2026_05_10_sch_v0.sql`. Wherever it was applied
from, please make sure it's in a tracked migration so a DB rebuild doesn't
silently lose double-run protection.
