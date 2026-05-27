# aidream server — tool-reconciliation tasks (2026-05-24) — ✅ COMPLETE

> **Schema rename note (2026-05-27).** The body below references the
> pre-refactor table names (`tl_def`, `tl_executor`, `tl_def_surface`,
> `cx_tl_call`, `source_app`, `function_path`). aidream's clean-break
> tool refactor renamed all of them — see
> [/Users/armanisadeghi/code/aidream/docs/CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/CROSS_TEAM_TOOL_REFACTOR.md).
> Map: `tl_def` → `tool_def`; `tl_executor` (M2M) → `tool_binding`
> (`executor_name` not `surface`); `tl_def_surface` → DROPPED →
> `tool_surface_defaults.always_include_tools` arrays;
> `cx_tl_call` → `cx_tool_call`; `source_app='matrx-extend'` →
> `tool_binding.executor_name='chrome-extension'`; `function_path` is
> gone entirely (Python dispatch path lives in the owning runtime's
> registry, not the DB). The historical conclusions in this doc are
> still accurate; only the table identifiers moved.

All items below were verified/closed on the aidream side. Details live in
aidream's `TOOL_SOURCE_OF_TRUTH.md`.

- ✅ **V1 — `server:matrx_ai` executor rows are intentional & safe.** They're inert
  placeholders (66 of 80 matrx-extend tools carry the same empty-`function_path`
  row); nothing selects them — the registry builds one definition per tool and
  `resolve_executor_binding` only consults `delegated=true` rows. A forced server
  route can't crash: it returns a typed `no_viable_executor` / unregistered-handler
  error. No DB change needed.
- ✅ **V2 — shared `user` / `request_user_takeover` rows confirmed.** Both live on
  `chrome-extension/{assistant,pilot}` + `matrx-default/default`; the rewritten
  `user` description (Other escape, `additional_instructions`, `wrote_instead`) is the
  live DB text shown on every surface. Info-only; no change.
- ✅ **Acceptance — advertised surface matches.** The server's chrome-extension
  surface (80 tools) is an exact set-match with matrx-extend's
  `docs/TOOLS.generated.md` (80). Zero `tl_def` edits needed.
- ✅ **GAP 1 — Python contract real for all 116 tools.** Already fixed; validator
  green (`unverified == 0`).
- ✅ **GAP 2 — descriptions removed from code.** All `Field(description=...)` stripped
  from aidream's `arg_models/*.py` (129 → 0); validator still green. matrx-extend half
  done.
- ✅ **GAP 3 — aidream now diffs per-field enum members** (incl. one-sided; two-sided
  mismatch = ERROR, one-sided = WARNING). Surfaced 22 one-sided advisories (tracked
  follow-up). *Still open:* a single shared comparison spec/artifact consumed by all
  three surfaces (they now agree on enum semantics but remain three implementations).
