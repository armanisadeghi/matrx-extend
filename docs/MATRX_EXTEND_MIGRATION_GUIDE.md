# matrx-extend Migration Guide — Tool Registry Redesign

> Audience: matrx-extend (Chrome extension) developers.
>
> Authoritative reference for the current schema:
> [docs/official/tool_system_rules.md](./official/tool_system_rules.md) and
> [/Users/armanisadeghi/code/aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md).
> The "Companion docs" line that used to live here pointed at files
> (`TOOL_REGISTRY_REDESIGN.md`, `CLIENT_REGISTRATION_GUIDE.md`,
> `FRONTEND_TOOL_INJECTION_NOTES.md`) that never landed in this repo —
> removed to avoid dead links.

---

## ⚠️ Superseded by the 2026-05-27 schema refactor

The document below describes the *original* mid-2026 redesign that moved
the tool catalog from JSON files into `public.tools` / `tl_def`. On
**2026-05-27** aidream rolled out a clean break of the same schema —
**no legacy support, no shim** — that renamed every table and dropped
the `source_app` / `function_path` columns entirely. The authoritative
write-up is:

  • [/Users/armanisadeghi/code/aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md)

Quick translation table for anything you read in the body below:

| Old name (in the body of this doc) | Current name (2026-05-27+) |
|---|---|
| `public.tools` / `public.tl_def` | `public.tool_def` |
| `public.tl_executor` (M2M) | `public.tool_binding` |
| `public.tl_def_surface` | DROPPED → `public.tool_surface_defaults.always_include_tools` arrays |
| `public.tl_gate` | DROPPED → gate names referenced in `tool_def.gating` jsonb |
| `public.tl_bundle{,_member}` | `public.tool_bundle{,_member}` (no shape change) |
| `public.tl_mcp_*` | `public.tool_mcp_*` (no shape change) |
| `public.cx_tl_call` | `public.cx_tool_call` (no shape change) |
| `tl_def.source_app = 'matrx-extend'` | `tool_binding.executor_name = 'chrome-extension'` |
| `tl_executor.surface = 'matrx-extend.browser'` | same as above — ownership lives on the executor binding |

**What changed for the extension at the wire level: almost nothing.**
The capability envelope, the chat stream, and the tool dispatch flow
were left intact on purpose. What changed in this repo on 2026-05-27:

1. [src/lib/supabase/queries.ts](../src/lib/supabase/queries.ts) reads
   `cx_tool_call` instead of `cx_tl_call` when hydrating conversation
   history with persisted tool results.
2. [src/lib/tools/descriptions.ts](../src/lib/tools/descriptions.ts)
   queries `public.tool_def` directly via Supabase REST. The retired
   `GET /ai-tools/app/matrx-extend` aidream endpoint depended on
   `source_app`, which no longer exists; the replacement aidream
   endpoints (`/ai-tools/native/all`, `/ai-tools/source-kind/native`,
   `/ai-tools/{tool_id}`) don't filter by executor, so direct Supabase
   is the cleanest path now.
3. [scripts/check-tool-db-drift.ts](../scripts/check-tool-db-drift.ts),
   [scripts/dump-tools-from-db.ts](../scripts/dump-tools-from-db.ts),
   and [scripts/dump-tool-db-to-md.mjs](../scripts/dump-tool-db-to-md.mjs)
   were rewritten against the new tables.

**How to add a new tool now** (replaces step 4 in the old "Adding a new
browser tool" section below):

```sql
-- 1. Define the tool.
WITH new_tool AS (
  INSERT INTO public.tool_def (name, description, parameters, category, tier, admin_only, source_kind)
  VALUES ('<your-tool>', '<desc>', '<parameters-jsonb>'::jsonb, '<category>', '<tier>', false, 'native')
  RETURNING id
)
-- 2. Bind it to the chrome-extension executor (ownership).
INSERT INTO public.tool_binding (tool_id, executor_name, is_active)
SELECT id, 'chrome-extension', true FROM new_tool;

-- 3. Add it to the always-include set on each surface that should see it.
UPDATE public.tool_surface_defaults
   SET always_include_tools = array_append(always_include_tools, '<your-tool>')
 WHERE surface_name IN ('chrome-extension/assistant', 'chrome-extension/pilot');
```

The historical text below remains as background on how the pre-refactor
system worked. Ignore its concrete SQL — every `tl_*` table it
references is HTTP 404 today.

---

## TL;DR

The aidream backend now stores the **tool catalog in a database**, not in JSON files you ship. Your build step (`pnpm catalog:tools`) used to be the source of truth for browser-dom tools — that's no longer true. From now on:

- **Tool definitions** (name, description, parameters, gating, surface assignments) live in `public.tools` in the aidream DB.
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

- Tool definitions live in `public.tools` rows under canonical names `matrx-extend:<local>` (e.g. `matrx-extend:take_screenshot`).
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
- [`types/server-handoff/browser-dom-capability.json`](file:///Users/armanisadeghi/code/matrx-extend/types/server-handoff/browser-dom-capability.json) — fully obsolete. aidream's `tl_def` rows are the source of truth.

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

## Adding a new browser tool — the new flow

1. **Write the handler** in matrx-extend at `src/lib/tools/handlers/<domain>.ts` (unchanged).
2. **Define the Zod schema** in your handler module (unchanged).
3. **Register the canonical name + schema in aidream's DB.** Two choices:
   - SQL seed PR: add a row to `public.tools` with `name='matrx-extend:<your-tool>'`, `source_app='matrx-extend'`, `category=<your-category>`, `parameters=<flat-prop-dict>`, `gating=<jsonb>`. See the 0022 seed for an exact example.
   - Admin API call: `POST /admin/tools` (when the dashboard ships).
4. **Insert the `tl_executor` row.** Without this, aidream's executor concretizer cannot route the tool to us — the server runs into a "no executor" path and the tool never reaches the extension. **This is the step we have most often missed** (auto-fixed once on 2026-05-05 for the guidance/demo tools by re-running the concretizer; don't rely on that).
   ```sql
   INSERT INTO public.tl_executor (tool_id, surface, delegated, priority) VALUES
     ('<tool_uuid>', 'matrx-extend.browser', true, 50);
   ```
5. **Assign your tool to the right surfaces.** Insert one `tl_def_surface` row per surface where it should appear:
   ```sql
   INSERT INTO public.tl_def_surface (tool_id, surface_name) VALUES
     ('<tool_uuid>', 'chrome-extension/assistant'),
     ('<tool_uuid>', 'chrome-extension/pilot');
   ```
6. **Optionally add to a bundle.** If your tool belongs to an existing category bundle, insert into `tl_bundle_member`. If it's a new bundle, create the bundle row first.
7. **Deploy your matrx-extend handler.** Build + ship the extension as usual.

There's no version handshake step today — aidream doesn't track matrx-extend versions. If you ship a new handler before the DB row exists, the model can't call it (no schema visible). Coordinate the order.

### Template — full seed block per new tool

Copy this and fill in `<tool_uuid>` (or use a `WITH` CTE that inserts into `public.tools` and returns its id):

```sql
WITH new_tool AS (
  INSERT INTO public.tools (name, source_app, category, tier, parameters, gating)
  VALUES ('matrx-extend:<your-tool>', 'matrx-extend', '<category>', '<tier>',
          '<parameters-jsonb>'::jsonb, '<gating-jsonb>'::jsonb)
  RETURNING id
)
INSERT INTO public.tl_executor (tool_id, surface, delegated, priority)
SELECT id, 'matrx-extend.browser', true, 50 FROM new_tool;

INSERT INTO public.tl_def_surface (tool_id, surface_name)
SELECT id, surface_name FROM new_tool, (VALUES
  ('chrome-extension/assistant'),
  ('chrome-extension/pilot')
) AS s(surface_name);
```

The matrx-ai live-DB invariant tests (`test_browser_tools_db_invariants.py`) catch missing executor rows after the fact, but only post-deploy. Use the template above to skip the round trip.

---

## Surface registration

You're already registered: the 0022 seed inserted `chrome-extension` (client) + `chrome-extension/assistant` and `chrome-extension/pilot` (surfaces). If matrx-extend later adds a new surface (e.g. a tab-strip widget), follow `CLIENT_REGISTRATION_GUIDE.md` Option A to seed it in — that doc never landed in either repo (see the note at the top of this file); ask the aidream team for the current seed procedure.

---

## Reference — your tool data right now

Live count and a sample query you can run against the aidream DB to inspect what's there:

```sql
-- All matrx-extend tools currently registered (~118)
SELECT name, category, tier, admin_only, gating
FROM public.tools
WHERE source_app = 'matrx-extend'
ORDER BY category, name;

-- Bundle membership (which tools are in which category bundles)
SELECT b.name AS bundle, m.local_alias, t.name AS canonical
FROM public.tl_bundle_member m
JOIN public.tl_bundle b ON b.id = m.bundle_id
JOIN public.tools t ON t.id = m.tool_id
WHERE t.source_app = 'matrx-extend'
ORDER BY b.name, m.local_alias;

-- Surface assignments
SELECT t.name AS canonical, s.surface_name
FROM public.tl_def_surface s
JOIN public.tools t ON t.id = s.tool_id
WHERE t.source_app = 'matrx-extend'
ORDER BY s.surface_name, t.name;
```

If anything looks wrong (missing tool, miscategorized, wrong surface), open an issue against the aidream repo with the canonical name + the expected change.

---

## Questions

Two common ones up front:

**"Do I lose autocompleted tool names in my IDE if the catalog moves to the DB?"**
No. Your handler files in `src/lib/tools/handlers/` still define the local names + Zod schemas in TypeScript. The Zod-typed handler interface is the source of truth for *your* code. The DB is the source of truth for *aidream's* runtime. Two distinct concerns; both stay.

**"What if my handler signature drifts from the DB row's `parameters`?"**
The model sends args validated against the DB row's schema. Your local handler validates against its own Zod schema. If they drift, dispatch fails — your Zod validation rejects the args. The fix is to update the DB row to match the new Zod shape (Admin API or SQL seed PR). There's no automatic sync; this is intentional friction so renames are deliberate.

For anything not covered here, the `TOOL_REGISTRY_REDESIGN.md` decision log (never landed in either repo — see the note at the top of this file) would have answered most questions; the implementation in [`packages/matrx-ai/matrx_ai/tools/`](../../aidream/packages/matrx-ai/matrx_ai/tools/) shows the contract on the aidream side.
