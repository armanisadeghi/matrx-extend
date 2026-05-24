# Tools: The Database Is the Source of Truth — Rules & Open Gaps

> **Why this exists.** A review found that some UI surfaces had created their own
> duplicate definitions for tools — their own descriptions, their own argument
> shapes — that drifted from the database. The model was being shown one contract
> while a client validated a different one, silently breaking tool calls. This
> document is the single, authoritative statement of how tools are defined in this
> platform. It leaves nothing to interpretation. If code disagrees with this
> document, the code is wrong.

_Last updated: 2026-05-23._

---

## The Rules (non-negotiable)

1. **The database is the source of truth. The `public.tl_def` table.** Every tool's
   name, description, parameters (arguments), tier, category, and per-surface
   availability live in the database. Nothing in the codebase is authoritative.

2. **A tool's name and its availability in any UI/surface come from the database.**
   `tl_def` (the definition) + `tl_executor` (which surface runs it) +
   `tl_def_surface` (which surface is allowed to see it). A surface MUST NOT invent,
   rename, re-scope, or hide a tool in code. If it isn't in the database for that
   surface, it does not exist for that surface.

3. **A tool's arguments in code must be exactly verifiable against the database.**
   Code may declare ONLY arguments that match `tl_def.parameters` — same names,
   types, required-ness, defaults, and enum values.
   - **Python** → a **Pydantic model** (a `ToolArgs` subclass) registered with
     `@tool(args=...)` in `matrx_ai.tools.declared`, **and the executor validates
     every incoming tool call against that exact model** before dispatch
     (`packages/matrx-ai/matrx_ai/tools/executor.py`, `args_model.model_validate`).
     The model the executor runs against IS the contract — not a sibling model, not
     a generated mirror.
   - **TypeScript** (matrx-extend, matrx-frontend) → a **Zod schema** (`argsSchema`)
     **and the dispatcher validates every incoming call against that exact schema**
     (`.safeParse`). The schema the dispatcher runs against IS the contract.

4. **Descriptions and other non-code metadata do NOT live in the codebase.** They
   live only in the database. The ONLY copy allowed in the repo is an
   **AUTO-GENERATED, always-fresh `.md`** produced from the database
   (`docs/TOOLS.generated.md`, regenerated on every `release.sh`). No hand-written
   tool or argument descriptions in code — Python or TypeScript. Ever.

5. **No code may generate its argument contract FROM the database and then validate
   that copy back against the database.** That is circular and proves nothing. The
   contract is hand-owned code; the validator's job is to prove the hand-owned code
   matches the DB. A generator may *scaffold* a new model once, but the committed,
   hand-owned model is what runs and what is checked.

6. **One validation engine checks code ↔ database and is VERY LOUD on any mismatch.**
   Big, red, descriptive output naming the tool, the field, what the code says, what
   the DB says, and how to fix it. It runs at server boot and on every `release.sh`.
   It is **NEVER gated by an environment variable** — the behavior is identical
   everywhere, always. It is **NEVER allowed to block a build or boot** — it screams,
   it does not stop the world. Loud and annoying, never a gatekeeper.

7. **To change a tool, change the database first** (a migration or
   `PATCH /admin/tools/{name}`), then bring the code into alignment until the engine
   is quiet. **There is no code→database sync.** Never push code into the DB.

### What "match" means (exactly what the engine checks)

For every tool the code claims to run: **identity** (name), **location**
(`function_path`), **ownership** (`source_app` / executor surface), and the **argument
set** — for every field: name, type, required-ness, default, and enum values.
Descriptions are NOT checked (they are not code).

---

## Open Gaps (violations to fix)

These are the known violations of the rules above, in priority order. Each is a
defect, not a preference.

### GAP 1 — The Python contract is real for only 18 of 116 tools  🔴 CRITICAL
The multi-action "dispatcher" tools take `args: dict` and validate the **per-action**
model the body actually uses (e.g. `web` → `WebSearchArgs`), but that per-action model
is **neither registered with `@tool` nor checked against the DB**. The engine only
checks the *outer* model (`WebArgs`) — which was generated from the DB and which the
body ignores. So for ~57 of the 75 tools-that-take-arguments, the check is the
forbidden circular pattern (Rule 5) and the real runtime contract escapes validation
entirely (violates Rule 3).
- **Correct today (18):** `fs_*`, `shell_*`, `text_analyze`, `git_ingest`,
  `llms_txt_fetch`, `package_info`, `rag_*` — they do `Model(**args)` with the
  registered model.
- **Broken (~57):** `web`, `sql`, `dataset`, `memory`, `note`, `picklist`, `seo`,
  `task`, `cloud_file`, and the `ctx_*`, `code_*`, `widget_*`, `toolcomp_*`,
  `travel_*`, `debug_traces_*` families.
- **Fix (APPROVED):** register the **per-action** arg models (`WebSearchArgs`,
  `DbQueryArgs`, …) so the executor validates against the model the code truly runs
  AND the engine diffs that model against the DB. Requires a DB modeling decision:
  one `tl_def` row per action, or per-action sub-schemas under one row.

### GAP 2 — Descriptions are still hardcoded in code  🔴 MUST REMOVE (Rule 4)
- **matrx-extend:** ✅ FIXED. The 166 hardcoded `description` strings were removed
  from `src/lib/tools/handlers/*.ts` and the `description` field dropped from
  `ToolHandler` / `ToolCatalogEntry` / `PendingConfirmRequest`. (The earlier
  framing — "the permission-confirm card must read the description from the DB at
  runtime" — was imprecise: the extension never feeds descriptions to a model;
  aidream injects `tl_def` descriptions server-side. The only consumers were
  human-facing UI (approval card, Tools tab) and the client discovery / WebMCP /
  frontend-bridge tools.) Those now read descriptions **LIVE from the DB** via
  aidream's public `GET /ai-tools/app/matrx-extend`
  ([src/lib/tools/descriptions.ts](../src/lib/tools/descriptions.ts)) — no stale
  local copy. The single repo copy of descriptions is the auto-generated
  `docs/TOOLS.generated.md` (`pnpm docs:tools`, regenerated on every `release.sh`).
- **aidream:** ~128 `Field(description=...)` across
  `packages/matrx-ai/matrx_ai/tools/arg_models/*.py` (9 files). Dead today (the DB
  feeds the model) but they violate Rule 4 and must be removed.

### GAP 3 — It is not "one engine"  🟠 MUST UNIFY (Rule 6)
Three separate validators exist with different rigor and different output:
- aidream Python: `scripts/validate_tools.py` + `packages/matrx-ai/.../validation/engine.py`
  (does not diff enum *members*).
- matrx-extend: `scripts/check-tool-db-drift.ts` — ✅ now implements the full
  "what match means" spec (name, tier, admin_only, category + per-field type,
  required-ness, enum members **incl. one-sided**, and **default**), is loud +
  non-blocking + env-free, and shares its DB reader
  ([scripts/_supabase-rest.ts](../scripts/_supabase-rest.ts)) with the docs
  generator. Still a standalone script (no cross-repo shared package yet).
- matrx-frontend: `scripts/check-tool-db-drift.ts` (no `default` check yet).
They must become **one shared comparison spec** with identical semantics (the "what
match means" list above) and identical loud output, consumed by all three surfaces.

### GAP 4 — Three matrx-frontend tools drift from the DB  🟡 2 of 3 FIXED (Rules 2, 3)
See [GAP4_storage_takeover_cross_repo.md](./GAP4_storage_takeover_cross_repo.md) for
the cross-repo executor map (these tools each have 3 executors: matrx-extend.browser,
matrx-user.ui-first, server:matrx_ai).
- **`memory` (name collision).** 🟡 IN PROGRESS. The web app registered a client-side,
  single-session **scratchpad** (`get/set/list/delete` on `cx_agent_memory`) under the
  name `memory`, colliding with the server's persistent **semantic memory** tool
  (`source_app=matrx_ai`: `recall/search/store/update/forget`).
  **DECISION:** rename the ephemeral client tool to **`scratchpad`** (short-lived,
  one session) everywhere; **`memory`** is reserved exclusively for the persistent
  semantic tool. matrx-frontend now defines `scratchpadArgsSchema`; final DB +
  matrx-extend alignment (matrx-extend already ships `scratchpad`) tracked separately.
- **`storage`. ✅ FIXED.** `storage` now exposes **`get/set/list/delete`** on every
  surface. `delete` was added to `tl_def.parameters.action.enum` (aidream migration
  `0062_gap4_storage_delete_takeover_timeout.sql`, applied), to matrx-extend
  (`StorageArgs` + a new `delete_extension_storage` handler), and to matrx-frontend's
  `storageArgsSchema`. All three drift checks green.
- **`request_user_takeover`. ✅ FIXED.** The DB now declares the unified set —
  `reason` (required), `instructions?`, `expected_action?`, `tab_id?`,
  `timeout_seconds?` (migration 0062). matrx-extend added `timeout_seconds` (wired to
  the takeover deadline); matrx-frontend added `tab_id`. Each surface ignores the
  optional field it doesn't use. All three drift checks green.

### GAP 5 — Enforcement was env-gated and could block  ✅ FIXED (Rule 6)
The boot gate was gated by `AIDREAM_STRICT_TOOLS` (so it never fired) and `release.sh`
could fail the build on drift. Both removed: the engine now runs **always**, is
**very loud** on drift at boot and on `release.sh`, uses **no environment variable**,
and **never blocks** a build or boot.

---

## Definition of done

- Every tool-with-arguments, on every surface, validates incoming calls against a
  hand-owned model/schema that the engine proves equals `tl_def` (GAP 1 closed).
- Zero hand-written descriptions in code; `docs/TOOLS.generated.md` is the only copy
  (GAP 2 closed).
- One shared comparison spec + loud reporter used by all three surfaces (GAP 3 closed).
- `scratchpad` ≠ `memory`; `storage` and `request_user_takeover` identical everywhere
  (GAP 4 closed).
- The engine is loud, never-blocking, env-free, and green across all three surfaces.
