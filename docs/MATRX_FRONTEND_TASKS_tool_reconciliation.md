# matrx-frontend — tool reconciliation tasks (2026-05-24) — ✅ COMPLETE

> **Schema rename note (2026-05-27).** Every `tl_*` table name below was
> renamed in aidream's clean-break refactor. See
> [/Users/armanisadeghi/code/aidream/docs/CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/CROSS_TEAM_TOOL_REFACTOR.md).
> Quick map: `tl_def` → `tool_def`; the frontend's UI-first Zod drift
> check now diffs against `tool_def` filtered by
> `tool_binding.executor_name='matrx-user'` (no more `source_app` column).

All items from the matrx-extend tool reconciliation are done; the frontend's
UI-first Zod ↔ `public.tool_def` drift check is green (`pnpm gate:tools`).

- ✅ **F1 — `user` matches the shared description.** Verified the UI always appends a
  freeform "Other" escape on confirm/choice/choice_many/notify (forced in
  `user.handler.ts`, rendered in `AskCard.tsx`); the result envelope carries
  `additional_instructions` + `wrote_instead`; `secret` is masked in the UI
  (password input) and never persisted (no redux-persist) — envelope is identical
  to matrx-extend. `userArgsSchema` matches `tl_def.parameters`; no hardcoded description.
- ✅ **F2 — `scratchpad` rename aligned.** Schema/executor expose `get/set/list/delete`
  matching the DB; `value` tightened `z.unknown()`→`z.string()` for exact `tl_def` +
  matrx-extend parity; old `memory` client-tool registration is gone (only `scratchpad`
  in `names.ts`/`registry.ts`); stale `memory` doc/comment refs fixed. Drift green.
- ✅ **F3 — frontend drift check at the shared spec.** `check-tool-db-drift.ts` now also
  diffs each parameter's `default` (verified it fires), on top of the existing
  type/required/enum-incl-one-sided checks. tier/admin_only/category are DB-only on this
  surface (not declared in code) so are intentionally not diffed. Loud, non-blocking, env-free.
- ✅ **F4 — no hardcoded tool descriptions.** Frontend ships zero tool/arg description
  strings in code (no `.describe()`); it sends only tool names and aidream injects
  `tl_def` descriptions server-side. matrx-extend's `descriptions.ts` fetch pattern
  isn't needed here — no frontend UI renders these tool descriptions.
