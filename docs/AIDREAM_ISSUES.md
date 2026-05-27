# Open issues on the aidream side

> **Schema rename note (2026-05-27).** This doc references the
> pre-refactor table names (`tl_def`, `tl_executor`, `tl_def_surface`,
> `tl_bundle*`, `source_app`). aidream's clean-break refactor renamed all
> of them — see
> [/Users/armanisadeghi/code/aidream/docs/CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/CROSS_TEAM_TOOL_REFACTOR.md).
> Map: `tl_def` → `tool_def`; `tl_executor` → `tool_binding`
> (`executor_name`, not `surface`); `tl_def_surface` → DROPPED →
> `tool_surface_defaults.always_include_tools`; `tl_bundle*` →
> `tool_bundle*`; `source_app='matrx-extend'` →
> `tool_binding.executor_name='chrome-extension'`. Bug 1 was already
> fixed at the time; the doc remains as historical context.

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
(matched by `bundle_id`). matrx-extend's bundle rows were stale:

- 9 bundles named for OLD categories (`advanced`, `ask`, `cookies`,
  `debug`, `files`, `forms`, `history`, `interact`, `page`) — no longer
  match any tool's `tl_def.category` value after the 2026-05-19 category
  redesign.
- 5 bundles whose names overlap new categories (`core`, `ai`, `memory`,
  `tabs`, `webmcp`) had 0 or stale members.
- 9 new categories (`reading`, `interaction`, `capture`, `chrome`,
  `human`, `demos`, `guidance`, `devtools`, `desktop`) had no bundle rows
  at all.

### Fix applied (2026-05-19, ~22:55 UTC)

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

### Long-term fix (aidream side)

Per `TOOL_ROUTING_RULES.md` §2 ("DB is canonical") + §11 (amendments),
the discovery handler should derive the per-category tool list from
`tl_def.category` directly — not from a parallel `tl_bundle` table that
has to be kept in sync manually. Two options for aidream:

**Option A — keep `tl_bundle`, add a maintenance script.** Each surface
team's drift-check script populates `tl_bundle_member` from
`tl_def.category` on every release. Our `check-tool-db-drift.ts` can do
this now; we just need the policy.

**Option B — change the discovery handler to query `tl_def` directly.**
`SELECT name, description, parameters, tier, admin_only FROM tl_def
WHERE category = $1 AND is_active = true AND <surface_gate>`. Drops
`tl_bundle` for the matrx-extend discovery path. Other listers (MCP
marketplace) keep using `tl_bundle` for their own purposes.

Option B is cleaner. Option A unblocks today and trades a maintenance
script for the simplification.

---

## Bug 2 — Agent sees non-existent tools in its system prompt — NEEDS AIDREAM

### Symptom

From the agent's reasoning trace in the live test:

> "Based on my system prompt, these are always-on tools: `ask_user`,
> `notify_user`, `update_plan`"

The agent believed `ask_user` and `notify_user` were separate tools.
Neither exists in `tl_def`. They were absorbed into the single `user`
mega-tool's `type` discriminator months ago:

- `ask_user(question, options)` → `user(type='choice', question, options)`
- `notify_user(message)` → `user(type='notify', message)`

When the agent emits a `tool_call` for `ask_user`, the matrx-extend
dispatcher rejects it as unknown.

### Root cause (best guess)

aidream's system-prompt assembly is using a cached / static list of
tool names. The list still includes the consolidated-away
`ask_user` / `notify_user` names. The actual `tl_def` only has `user`.

### What aidream needs to do

Two checks:

1. **Audit the prompt assembly.** Grep aidream's prompt-building code
   for hardcoded references to `ask_user`, `notify_user`. Replace with
   `user` + a one-line explanation of the `type` discriminator.
2. **Source the prompt from live `tl_def`.** Per `TOOL_ROUTING_RULES.md`
   §16 ("Definitions are immutable per name") + §3 (cache invalidates
   on the admin cache-bust API), the system prompt's tool descriptions
   should come from `tl_def.description` at session-resolution time, not
   from a hand-maintained tool-list constant. If the prompt is read from
   `tl_def.description`, it cannot mention non-existent tools.

If the prompt is correct in code but the agent still saw the old
names, the cache may need bursting.

---

## Bug 3 (possible) — Surface name mismatch between gates and executors

### Symptom

Not directly proven by the live test, but worth flagging while we're
here.

- `tl_executor.surface` for matrx-extend is `matrx-extend.browser` (75
  rows + 4 new = 79 active bindings).
- `tl_def_surface.surface_name` for matrx-extend is
  `chrome-extension/assistant` (45 rows) + `chrome-extension/pilot`
  (74 rows) = 119 gates.

These use different surface-name conventions. If aidream's discovery
handler joins them (e.g., "load tools for the active surface, filtered
by surface gating"), the join will return zero matches.

### What aidream needs to clarify

What is the canonical surface-name format? Pick one of:
- Dotted: `matrx-extend.browser`, `matrx-frontend.web`, `matrx-local.desktop`
- Slashed: `chrome-extension/assistant`, `chrome-extension/pilot`,
  `matrx-frontend/admin`

When the answer's clear, we'll migrate the gates accordingly. Until
then, this asymmetry is a potential foot-gun. Worth checking whether
the discovery handler actually uses `tl_def_surface` at all — if it
ignores it and only uses `tl_executor`, the inconsistency doesn't bite.

---

## What to do with this doc

Hand this file to the aidream team. They own Bug 2 and Bug 3
definitively. Bug 1's data fix is in place; the long-term-fix question
(Option A vs B) is theirs to decide.

When they fix Bug 2, re-test from a real chat session:
1. New conversation, ask "use the `user` tool to ask me yes/no."
2. Agent should call `user({type:'confirm', question:'…'})`.
3. Card renders; user clicks.
4. Agent continues with the answer.

If the agent calls `ask_user` instead of `user`, Bug 2 is still live.
