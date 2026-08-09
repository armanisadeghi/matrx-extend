# matrx-extend Migration Guide — Tool Registry Redesign

> Audience: matrx-extend (Chrome extension) developers.
>
> Authoritative reference for the current schema:
> [aidream/docs/official/tool_system_rules.md](../../aidream/docs/official/tool_system_rules.md) and
> [/Users/armanisadeghi/code/aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md).
> The "Companion docs" line that used to live here pointed at files
> (`TOOL_REGISTRY_REDESIGN.md`, `CLIENT_REGISTRATION_GUIDE.md`,
> `FRONTEND_TOOL_INJECTION_NOTES.md`) that never landed in this repo —
> removed to avoid dead links.

---

## ⚠️ HISTORICAL — superseded TWICE. Do not copy anything from the body.

This document describes the *original* mid-2026 redesign that moved the tool
catalog from JSON files into the database. It has been superseded by **two**
separate schema changes and is kept only as a record of how the wire format and
the PR sequence evolved. **Nothing below is a current instruction.**

For anything you actually need to do, go to:

- **[SURFACE_INTEGRATION_TODO.md](./SURFACE_INTEGRATION_TODO.md)** — live,
  executed SQL for the registry (claim a tool, register a surface, check drift).
- **[/Users/armanisadeghi/code/aidream/docs/official/tool_system_rules.md](../../aidream/docs/official/tool_system_rules.md)** —
  the canonical vocabulary and rules. aidream owns the schema.
- **[/Users/armanisadeghi/code/aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md)** —
  the 2026-05-27 refactor write-up.

### The names moved twice — most docs record only the first move

| In the body of this doc | 2026-05-27 clean break | 2026-06 schema split — **LIVE** |
|---|---|---|
| `public.tools` / `public.tl_def` | `public.tool_def` | **`tool.definition`** |
| `public.tl_executor` (M2M) | `public.tool_binding` | **`tool.binding`** |
| `public.tl_executor_kind` | `public.tool_executor` | **`tool.executor`** |
| `public.tl_def_surface` | dropped → `tool_surface_defaults` | **`tool.surface_defaults`** |
| `public.tl_bundle` | `public.tool_bundle` | **`tool.bundle`** |
| `public.tl_bundle_member` | `public.tool_bundle_member` | **gone** — bundles point at a `lister_tool_id` instead |
| `public.tl_mcp_*` | `public.tool_mcp_*` | **`tool.mcp_*`** |
| `public.cx_tl_call` | `public.cx_tool_call` | **`chat.tool_call`** |
| `public.tl_gate` | dropped | gate names in `tool.definition.gating` jsonb |
| `public.surfaces` | — | **`ui.ui_surface`** |

**Only the third column exists.** `public.tool_def` fails exactly as hard as
`tl_def` — `relation does not exist` in SQL, `PGRST205` over PostgREST. The
second move also pulled these out of `public`, so a client caller must select the
schema (`toolDb()` in this repo, or `Accept-Profile: tool` over raw REST); an
unqualified `.from()` resolves against `public` and fails at runtime where no
typecheck can see it.

Gone as **concepts**, not just names: `source_app`, `function_path`, `delegated`,
`priority`, `auto_load`. A surface's ownership of a tool is a row in
`tool.binding` — `(tool_id, executor_name, is_active)` — and nothing else.

| Old idea | Now |
|---|---|
| `tl_def.source_app = 'matrx-extend'` | `tool.binding.executor_name = 'chrome-extension'` |
| `tl_executor.surface = 'matrx-extend.browser'` | same row — ownership is the binding, not a column |

**What changed for the extension at the wire level: almost nothing.**
The capability envelope, the chat stream, and the tool dispatch flow
were left intact on purpose. What changed in this repo on 2026-05-27:

1. [src/lib/supabase/queries.ts](../src/lib/supabase/queries.ts) reads
   `cx_tool_call` instead of `cx_tl_call` when hydrating conversation
   history with persisted tool results.
2. [src/lib/tools/descriptions.ts](../src/lib/tools/descriptions.ts)
   queries `tool.definition` directly via Supabase REST (schema-qualified via
   `toolDb()`; it read `public.tool_def` until the 2026-06 split). The retired
   `GET /ai-tools/app/matrx-extend` aidream endpoint depended on
   `source_app`, which no longer exists; the replacement aidream
   endpoints (`/ai-tools/native/all`, `/ai-tools/source-kind/native`,
   `/ai-tools/{tool_id}`) don't filter by executor, so direct Supabase
   is the cleanest path now.
3. [scripts/check-tool-db-drift.ts](../scripts/check-tool-db-drift.ts),
   [scripts/dump-tools-from-db.ts](../scripts/dump-tools-from-db.ts),
   and [scripts/dump-tool-db-to-md.mjs](../scripts/dump-tool-db-to-md.mjs)
   were rewritten against the new tables.

**How to add a new tool now:** see
**[SURFACE_INTEGRATION_TODO.md](./SURFACE_INTEGRATION_TODO.md)** §0–§1, which
carries the only maintained copy of that SQL — every statement there has been
executed against the live DB.

> A `public.tool_def` / `public.tool_binding` / `public.tool_surface_defaults`
> recipe used to sit here. It was written for the 2026-05-27 names and broke
> when the 2026-06 split moved those tables into the `tool` schema. Two copies
> of the same SQL in one repo is how that happened; there is now one.

The historical text below remains as background on how the pre-refactor
system worked. Ignore its concrete SQL — every `tl_*` table it
references is HTTP 404 today.

---

## TL;DR

The aidream backend now stores the **tool catalog in a database**, not in JSON files you ship. Your build step (`pnpm catalog:tools`) used to be the source of truth for browser-dom tools — that's no longer true. From now on:

- **Tool definitions** (name, description, parameters, gating, surface assignments) live in `public.tools` in the aidream DB. [Now `tool.definition`; surface assignment moved to `tool.surface_defaults`.]
- **Tool handlers** (the actual code that runs when a browser tool fires) live in matrx-extend at [`src/lib/tools/handlers/`](file:///Users/armanisadeghi/code/matrx-extend/src/lib/tools/handlers/) — **unchanged**.
- The wire format for tool names is changing from bare local names to a namespaced form (`matrx-extend:<local>` canonical, `matrx-extend__<local>` on the wire).
- Bundles (loaded via discovery tools like `load_browser_tools`) may re-namespace tools at runtime, e.g. `forms__fill_form` instead of `matrx-extend__fill_form`.

You will need three small PRs in matrx-extend (detailed below). The aidream backend handles every other change.

---

## Conceptual shift — what changed and why

### Before this redesign

- matrx-extend's [`pnpm catalog:tools`](file:///Users/armanisadeghi/code/matrx-extend/scripts/dump-tool-catalog.ts) script generated two JSON files:
  - `types/tool-catalog.json` (agent-facing manifest)
  - `types/server-handoff/browser-dom-capability.json` (server routing manifest)
- aidream consumed those JSONs at startup via [`packages/matrx-ai/matrx_ai/capabilities/browser_dom.py`](../../aidream/packages/matrx-ai/matrx_ai/capabilities/browser_dom.py).
- The 118 tools were registered in-memory at startup by a hook (`register_browser_dom_tools_in_registry`).
- Every restart re-read the JSONs.
- Tool names traveled the wire as bare local names (`take_screenshot`, `click_element`).

### After this redesign

- Tool definitions live in `public.tools` rows under canonical names `matrx-extend:<local>` (e.g. `matrx-extend:take_screenshot`). [Now `tool.definition`; the `matrx-extend:` colon namespace was itself retired on 2026-05-19 — names are bare, `chrome_*`, or `cdp_*`.]
- Tools are loaded into `ToolRegistryV2` from the DB at startup via `load_from_database()`.
- The 0022 seed script ingested today's catalog once and the in-memory registration hook is retired.
- Tool names traveled the wire as `<namespace>__<local>` (the `:` becomes `__` for provider compatibility — Anthropic/OpenAI/Gemini reject `:` in tool names).
- Bundles can rebrand a tool at load time: when the agent calls `load_browser_tools(category="forms")`, those tools may arrive on your side as `forms__fill_form` instead of `matrx-extend__fill_form` — the dispatch layer must alias-map back to the local handler.

The aidream redesign was documented in full in `TOOL_REGISTRY_REDESIGN.md` (§4 naming conventions, three name layers; §9 MCP — same lister mechanism) — that doc never landed in either repo (see the note at the top of this file) and this whole document is superseded by [CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md) below anyway.

---

## What stays the same

| Piece | Status |
|---|---|
| Tool handler files in [`src/lib/tools/handlers/`](file:///Users/armanisadeghi/code/matrx-extend/src/lib/tools/handlers/) (18 files, one per domain) | **Unchanged.** Same signatures, same Zod schemas, same return shapes. |
| Central registry in [`src/lib/tools/registry.ts`](file:///Users/armanisadeghi/code/matrx-extend/src/lib/tools/registry.ts) (`lookup(name)`) | Unchanged in shape, but the input string format is changing. See "What changes" below. |
| Service-worker dispatch in [`src/lib/tools/dispatch.ts`](file:///Users/armanisadeghi/code/matrx-extend/src/lib/tools/dispatch.ts) (listens for `STREAM_CHUNK` `tool_started` events) | Same flow; aliasing layer in front of the lookup needs updates. |
| Capability envelope in your stream handshake: `client.capabilities=["browser-dom"]`, `client.state["browser-dom"]={current_url, is_admin, …}` | **Unchanged.** This contract is locked. |
| Tier semantics (`read` / `action` / `privileged` / `ask-user`) | Unchanged. |
| Permission gating logic (your local `tierFor()`, `permissionMode`) | Unchanged. |

---

## What changes

### 1. Wire format — `:` becomes `__`

| Layer | Format | Example |
|---|---|---|
| **Canonical** (DB identity) | `<namespace>:<local>` | `matrx-extend:take_screenshot` |
| **Wire** (provider serialization) | `<namespace>__<local>` | `matrx-extend__take_screenshot` |

The `:` ↔ `__` translation happens at the provider boundary on aidream's side. From your side, you'll see `__` everywhere except possibly in canonical-name fields on event payloads.

**Action:** update [`src/lib/tools/aliases.ts`](file:///Users/armanisadeghi/code/matrx-extend/src/lib/tools/aliases.ts) to strip the `matrx-extend__` prefix before dispatching to the local handler. The local handler library remains keyed on bare local names (`take_screenshot`, not `matrx-extend__take_screenshot`).

```ts
// Pseudocode for the transformation:
function resolveToLocalName(wireName: string): string {
  // Strip the matrx-extend prefix.
  if (wireName.startsWith("matrx-extend__")) {
    return wireName.slice("matrx-extend__".length);
  }
  // Bundle-aliased tools (see §2 below) — handle separately.
  if (wireName.includes("__")) {
    // Bundle-prefixed; consult `tool_started.canonicalName` if available,
    // otherwise fall back to the segment after the first '__'.
    const [, localPart] = wireName.split("__", 2);
    return localPart;
  }
  return wireName;
}
```

### 2. Bundle-aliased tool names

After Step 2 of the redesign ships, the aidream backend may load your tools into the active set under a *different* namespace from `matrx-extend`. If a user has a bundle named `forms` that includes some of your form-handling tools, those tools arrive as:

```
forms__fill_form         (instead of matrx-extend__fill_form)
forms__submit_form       (instead of matrx-extend__submit_form)
```

The local handler is still `fill_form` — only the wire name changed. To handle this safely, **the server now provides the canonical name on every `tool_started` event** as a separate field (Step 2 wire shape). Read it instead of trying to parse the wire name yourself:

```jsonc
// new tool_started event shape (Step 2):
{
  "event": "tool_started",
  "callId": "call-abc",
  "wireName": "forms__fill_form",         // what the model called
  "canonicalName": "matrx-extend:fill_form", // what aidream resolved it to
  "args": { ... }
}
```

In [`src/lib/tools/dispatch.ts`](file:///Users/armanisadeghi/code/matrx-extend/src/lib/tools/dispatch.ts), prefer `canonicalName.split(":", 2)[1]` (the local part) over parsing the wire name. This handles every case: direct namespace, bundle alias, future redirections.

### 3. Catalog publishing — your build no longer ships the source of truth

The `pnpm catalog:tools` script's two JSON outputs are **deprecated as runtime sources** for aidream:
- [`types/tool-catalog.json`](file:///Users/armanisadeghi/code/matrx-extend/types/tool-catalog.json) — keep emitting if your own dev tooling uses it; aidream ignores it.
- [`types/server-handoff/browser-dom-capability.json`](file:///Users/armanisadeghi/code/matrx-extend/types/server-handoff/browser-dom-capability.json) — fully obsolete. aidream's `tl_def` rows are the source of truth. [`tl_def` is now `tool.definition`.]

**When you add, remove, or rename a tool**, the aidream DB must be updated. Three options:

1. **Admin API** (preferred when available): the matrx-frontend admin UI exposes `POST /admin/tools/<canonical-name>` for create/update/delete. Use this for individual changes.
2. **SQL seed PR**: open a PR against the aidream repo with an additive seed in `db/migrations/_seed_<num>_<feature>.py`. Mirrors the pattern in [`_seed_0022_browser_dom.py`](../../aidream/db/migrations/_seed_0022_browser_dom.py).
3. **Bulk re-import**: a one-shot rebuild from your source-of-truth — kept as an emergency reset path. The 0022 seed is the example.

**Don't re-run `pnpm catalog:tools` and expect aidream to pick up changes.** It won't.

### 4. Single-`_` separator anywhere is gone

Today's [`packages/matrx-ai/matrx_ai/tools/external_mcp.py`](../../aidream/packages/matrx-ai/matrx_ai/tools/external_mcp.py) had a `_strip_namespace` that split on first `_` (legacy MCP convention). After Step 4 of the redesign, that's gone. **Any place in matrx-extend code that uses single-`_` for namespacing should be updated to `__`.**

The alias map that used to live in `src/lib/tools/aliases.ts` handled legacy renames — that file was retired along with the `matrx-extend:` colon namespace in the 2026-05-19 global tool namespace redesign; there is no longer a `__` rule to preserve.

---

## What dies

- The need to ship JSON catalog files from matrx-extend's build to aidream's `packages/matrx-ai/matrx_ai/capabilities/`. Stop doing that.
- Any single-`_` separator in tool name parsing. Use `__`.
- The pre-redesign assumption that aidream's startup re-reads your catalog on every boot. It doesn't.

---

## Migration steps

### PR 1 — Wire-format alias support

Update [`src/lib/tools/aliases.ts`](file:///Users/armanisadeghi/code/matrx-extend/src/lib/tools/aliases.ts) to:

1. Strip `matrx-extend__` prefix from incoming wire names → local lookup.
2. Recognize and strip arbitrary bundle prefixes (`<bundle>__`) when no canonical name is available.
3. Keep all existing legacy-rename aliases intact (drift-fix entries from the existing alias table).

Update [`src/lib/tools/dispatch.ts`](file:///Users/armanisadeghi/code/matrx-extend/src/lib/tools/dispatch.ts) to:

- After receiving a `tool_started` event, prefer `event.canonicalName` if present (Step 2 of the aidream redesign provides it); fall back to wire-name parsing only if the field is missing (transitional).

Run your existing tests to confirm dispatch behavior is unchanged for legacy names.

### PR 2 — Adopt `canonicalName` field after aidream Step 2 ships

Once the aidream `tool_started` event includes `canonicalName`, switch [`dispatch.ts`](file:///Users/armanisadeghi/code/matrx-extend/src/lib/tools/dispatch.ts) to use it as the primary lookup key. This makes your dispatch alias-resilient: any bundle the user creates that includes your tools will route correctly without code changes on your side.

### PR 3 (optional cleanup, after PR 1+2 are deployed)

- Delete [`types/server-handoff/browser-dom-capability.json`](file:///Users/armanisadeghi/code/matrx-extend/types/server-handoff/browser-dom-capability.json) (no longer consumed by anyone).
- Decide whether to keep [`types/tool-catalog.json`](file:///Users/armanisadeghi/code/matrx-extend/types/tool-catalog.json) — if your own dev tooling uses it, fine; otherwise drop.
- Consider renaming the `pnpm catalog:tools` script to something like `pnpm catalog:dev-debug` to signal it's no longer authoritative.

---
## Adding a new browser tool — see SURFACE_INTEGRATION_TODO.md

> **The recipe that used to live here has been removed, not updated.** It wrote
> `public.tools` / `tl_executor` / `tl_def_surface` rows with `source_app`,
> `delegated`, and `priority` columns. Every one of those tables and columns is
> gone, so following it produced `relation does not exist` — a failure that
> reads like a permissions problem and has cost real time.
>
> Live, executed-against-the-DB SQL for claiming a tool, registering a surface,
> and checking both gates lives in **one** place:
> **[SURFACE_INTEGRATION_TODO.md](./SURFACE_INTEGRATION_TODO.md)** §0–§1.
> A second copy here would just drift again.

The shape of the flow, for orientation (the linked doc has the runnable SQL):

1. **Write the handler** — `src/lib/tools/handlers/<domain>.ts`. Unchanged.
2. **Define the Zod schema** in the handler module. Unchanged. This is what the
   dispatcher validates against, so it IS the contract on our side.
3. **Decide durable or inline.** Did this tool exist before the request arrived?
   Shipping in this repo means durable → it gets a `tool.definition` row. Only
   tools authored at runtime take the inline path. (See the canonical doc's
   Part 1; inline is permanent and first-class, just not for this.)
4. **Register the definition** — a row in `tool.definition`. No `source_app`, no
   `function_path`; those columns do not exist.
5. **Claim it** — a row in `tool.binding` with `executor_name = 'chrome-extension'`.
   This is the *only* statement of ownership. Missing it is the step historically
   missed most often, and the symptom is the server having no executor to route to.
6. **Offer it** — add the name to `tool.surface_defaults.always_include_tools`
   for `chrome-extension/assistant` and/or `chrome-extension/pilot`.
   **Skip this deliberately if the tool needs live UI state** — such a tool is
   *armed* per conversation instead, and advertising it here promises the agent a
   capability it cannot use (canonical doc R16).
7. **Ship the handler.** No version handshake exists — aidream does not track
   extension versions. If the handler ships before the DB rows exist the model
   cannot call it, so order the two.

Steps 4–6 are three independent gates. A tool needs all three, and the drift
guard (`pnpm catalog:tools:drift`) checks each separately for exactly that reason.

---

## Surface registration

Already done: `chrome-extension/assistant` and `chrome-extension/pilot` exist in
`ui.ui_surface` (both parented to `matrx-default/default`) with matching
`tool.surface_defaults` rows. Adding a new surface means an `ui.ui_surface` row
first — `tool.surface_defaults.surface_name` is a foreign key to it — then a
defaults row only if the surface needs to differ from its parent. Executed SQL
for both is in [SURFACE_INTEGRATION_TODO.md](./SURFACE_INTEGRATION_TODO.md) §1.1.

---

## Reference — inspecting your tool data

All three queries below were executed against the live DB (project
`txzxabzwovsujtloxrus`) on 2026-08-09. Direct SQL uses schema-qualified names; a
supabase-js caller goes through `toolDb()` from
[src/lib/supabase/schemas.ts](../src/lib/supabase/schemas.ts), and raw REST needs
the `Accept-Profile: tool` header.

```sql
-- Every tool this extension can run (~80 active).
SELECT d.name, d.category, d.tier, d.admin_only, d.gating
FROM tool.definition d
JOIN tool.binding b ON b.tool_id = d.id
WHERE b.executor_name = 'chrome-extension'
  AND b.is_active
  AND d.is_active
ORDER BY d.category, d.name;

-- What each surface actually advertises (~81 per surface).
SELECT sd.surface_name, t AS tool_name
FROM tool.surface_defaults sd
CROSS JOIN LATERAL unnest(sd.always_include_tools) AS t
WHERE sd.surface_name LIKE 'chrome-extension/%'
ORDER BY sd.surface_name, t;

-- Bundles. NOTE: there is no membership join table anymore -- a bundle points at
-- a "lister" tool that enumerates it (ours is `load_browser_tools`).
SELECT b.name AS bundle, b.is_system, ld.name AS lister_tool
FROM tool.bundle b
LEFT JOIN tool.definition ld ON ld.id = b.lister_tool_id
WHERE b.is_active
ORDER BY b.name;
```

The old bundle-membership query in this section joined `tl_bundle_member` — that
table did not survive the schema split (only `graveyard.bundle_member` remains),
so it has been replaced rather than renamed.

If anything looks wrong (missing tool, miscategorized, wrong surface), open an
issue against the aidream repo with the tool name and the expected change.

---

## Questions

Two common ones up front:

**"Do I lose autocompleted tool names in my IDE if the catalog moves to the DB?"**
No. Your handler files in `src/lib/tools/handlers/` still define the local names + Zod schemas in TypeScript. The Zod-typed handler interface is the source of truth for *your* code. The DB is the source of truth for *aidream's* runtime. Two distinct concerns; both stay.

**"What if my handler signature drifts from the DB row's `parameters`?"**
The model sends args validated against the DB row's schema. Your local handler validates against its own Zod schema. If they drift, dispatch fails — your Zod validation rejects the args. The fix is to update the DB row to match the new Zod shape (Admin API or SQL seed PR). There's no automatic sync; this is intentional friction so renames are deliberate.

For anything not covered here, the `TOOL_REGISTRY_REDESIGN.md` decision log (never landed in either repo — see the note at the top of this file) would have answered most questions; the implementation in [`packages/matrx-ai/matrx_ai/tools/`](../../aidream/packages/matrx-ai/matrx_ai/tools/) shows the contract on the aidream side.
