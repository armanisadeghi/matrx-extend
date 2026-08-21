# Surface integration — to-do list for matrx-frontend and matrx-local

> **Every SQL statement in this doc was executed against the live database
> (Supabase project `txzxabzwovsujtloxrus`, Matrx Main) on 2026-08-09.**
> Reads were run as-is; writes were run inside a rolled-back transaction so
> they proved out against the real constraints, triggers, and foreign keys
> without persisting. Row counts quoted in the prose are from that same run —
> re-run the inventory queries before acting, they move.

> Per aidream's authoritative
> [tool_system_rules.md](../../aidream/docs/official/tool_system_rules.md)
> (referred to elsewhere in this repo as "TOOL_ROUTING_RULES.md" — there is no
> such file; that is the doc) the DB is canonical. Each
> surface declares its tool set + executor bindings in the DB, then
> validates its local code against that declaration on every release.
> matrx-extend completed its migration in May 2026. The other two
> well-known surfaces — matrx-frontend (Next.js) and matrx-local (Tauri
> desktop) — need to follow the same pattern.
>
> This doc tells each surface team **exactly what rows to touch and what
> code to write**. Reference, not a wishlist.
>
> Sibling docs:
> - [UI_FIRST_TOOLS.md](./UI_FIRST_TOOLS.md) — port-guide patterns for the
>   UI-first tools (`user`, `update_plan`, `tasks`, `user_todos`,
>   `scratchpad`, `request_user_takeover`).
> - [REQUEST_PAYLOAD_CONTRACT.md](./REQUEST_PAYLOAD_CONTRACT.md) — wire shape
>   for every chat send.
> - [CROSS_REPO_INTEGRATION.md](./CROSS_REPO_INTEGRATION.md) — repo topology.
> - Cross-repo system-of-record for the registry schema:
>   `/Users/armanisadeghi/code/common-docs/systems/agents/agent-tools/FEATURE.md`.
>   Master reference (aidream owns the schema):
>   [CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md).

---

## 0. Shared invariants (both surfaces read this first)

### 0.1 — The four tables, and where they actually live

The registry went through **two** renames. Both are already applied; there is
no shim for either, and a reference to any retired name fails immediately —
`PGRST205` from PostgREST, `relation does not exist` from SQL.

| What you may have read | What it is now |
|---|---|
| `public.tl_def` → `public.tool_def` | **`tool.definition`** |
| `public.tl_executor` (M2M) → `public.tool_binding` | **`tool.binding`** |
| `public.tl_executor_kind` → `public.tool_executor` | **`tool.executor`** |
| `public.tl_def_surface` (dropped) → `public.tool_surface_defaults` | **`tool.surface_defaults`** |
| `public.surfaces` | **`ui.ui_surface`** |

Two moves happened: the 2026-05-27 clean-break refactor renamed `tl_*` → `tool_*`,
and the 2026-06 schema split moved them out of `public` into the `tool` schema and
dropped the now-redundant `tool_` prefix from each table name. Only the second
column of that table is real today.

Also gone as concepts, not just as names: **`source_app` is not a column on
anything.** Ownership of a tool by a surface is a row in `tool.binding`, nothing
else. So are `function_path`, `delegated`, `priority`, and `auto_load` — the
binding is a pure `(tool_id, executor_name, is_active)` join with no flags.

**Direct SQL callers** (migrations, `psql`, the Supabase SQL editor) write the
schema-qualified name: `tool.definition`, `tool.binding`, `tool.surface_defaults`,
`ui.ui_surface`. Every statement in this doc is written that way.

**Client callers** (supabase-js / PostgREST) must select the schema explicitly —
PostgREST resolves an unqualified `.from('x')` against `public` only, and the
failure is a runtime `PGRST205` that no typecheck or build can see. In this repo
that goes through the one accessor map,
[`src/lib/supabase/schemas.ts`](../src/lib/supabase/schemas.ts) — never a
hand-written `.schema('tool')`:

```ts
import { toolDb } from '@/lib/supabase/schemas';

const { data } = await toolDb()
  .from('binding')                       // → tool.binding
  .select('tool_id, executor_name, is_active')
  .eq('executor_name', 'chrome-extension');
```

Over raw REST the equivalent is the `Accept-Profile: tool` header against
`/rest/v1/binding` — which is what
[`scripts/check-tool-db-drift.ts`](../scripts/check-tool-db-drift.ts) does. The
anon/publishable key can **read** all four tables (verified: HTTP 200 on
`definition`, `binding`, `surface_defaults`, and `ui_surface`); it cannot write
them. Registry writes are DDL/DML from a repo with real DB credentials.

### 0.2 — A tool is the CODE. An executor is WHERE that code lives. A surface is WHO can reach it.

Keep these three apart and the registry is obvious; collapse any two and every
question about it gets confusing.

- **The tool** is the thing that actually runs and does something. That is what
  `tool.definition` describes: name, arg contract, tier, policy. It knows nothing
  about who runs it or who is allowed to ask.
- **The executor** is where that code physically lives — a process, a package, a
  browser context. Two UI panels that call the *same* functions through the *same*
  dispatcher are **one executor**, not two. Separate executors mean separate
  implementations, not separate front doors. `tool.binding` records this and
  nothing else.
- **The surface** is a front door: who can see and reach the tool from where.
  That is `ui.ui_surface` + `tool.surface_defaults`.

Worked example, because it is the one people get wrong: matrx-extend ships an
Assistant panel and a Pilot panel. They look like two things. They share one
dispatcher (`src/lib/tools/dispatch.ts`) and one handler registry — the same
function object runs either way. So they are **one executor** (`chrome-extension`,
80 bindings) with **two surfaces** (`chrome-extension/{assistant,pilot}`). Any
difference between what the two panels can do is an access decision expressed in
surface defaults, never a second binding and never a second executor.

Ask "is there a second copy of the code?" If no, you do not need a second executor
— you need a surface.

### 0.3 — Executor names are a closed, canonical set

`tool.binding.executor_name` is a foreign key to `tool.executor.name`. You cannot
invent one in an INSERT; you register the executor first. The non-MCP executors
today are:

`matrx-ai-core` · `aidream` · `chrome-extension` · `matrx-local` · `matrx-user`
(plus one `mcp.<slug>` per connected MCP server)

Sub-executors use dot notation (`chrome-extension.pilot`) and inherit the
parent's bindings — which is why every query below matches
`= 'x' OR LIKE 'x.%'` rather than a bare equality.

**There is no `matrx-frontend` executor and there will not be one.** The Next.js
client is `matrx-user`. See §1.

### 0.4 — Everything else

- **The DB tool registry is the source of truth.** You don't tell the server
  what tools you have on every request — you declare them in `tool.definition`
  + `tool.binding` once, and the server caches the manifest from there.
  Amendments (per-request overrides) are an escape hatch logged loudly, not a
  maintenance pattern.
- **One name → one definition, forever.** If a capability exists under a
  canonical name (e.g. `clipboard`, `navigate`, `read_page`), you bind your
  executor to that name. You don't make up `myapp_clipboard`.
- **Two independent gates.** A binding says *you can run it*;
  `tool.surface_defaults.always_include_tools` says *the model gets offered it
  on this surface*. Both are required. A tool with a binding but no surface
  inclusion is silently invisible — that is the single most common integration
  failure, and §1.6 has the query that catches it.
- **Categories are pure UX.** They affect Tools-tab grouping and discovery
  helpers, never routing. matrx-extend's 14 categories are: `core`, `reading`,
  `interaction`, `tabs`, `capture`, `chrome`, `human`, `memory`, `ai`,
  `demos`, `guidance`, `devtools`, `webmcp`, `desktop`.
- **Retire, don't delete.** Flip `tool.binding.is_active = false`. The 115
  retired matrx-local bindings (§2) are exactly this — history the registry
  keeps.
- **A drift-check script is mandatory.** Every surface team maintains a
  script that compares local code against `tool.definition` + `tool.binding` +
  `tool.surface_defaults` and reports divergence loudly on release.
  matrx-extend's lives at
  [`scripts/check-tool-db-drift.ts`](../scripts/check-tool-db-drift.ts) —
  copy the pattern.

---

## 1. matrx-frontend (Next.js) — executor `matrx-user`

**Status is no longer zero.** The Next.js client registered as the `matrx-user`
executor: **132 rows** in `ui.ui_surface` with `client_name = 'matrx-user'`,
**6 active bindings**, and a populated `matrx-user/chat` surface-defaults row.
The remaining work is per-surface coverage and a drift script, not bootstrap.

Confirm the live state before planning anything:

```sql
-- Which surfaces this client owns, and which have a tool-defaults row.
SELECT s.name AS surface_name,
       s.executor_name,
       s.parent_surface_name,
       s.execution_mode,
       (sd.surface_name IS NOT NULL) AS has_tool_defaults
FROM ui.ui_surface s
LEFT JOIN tool.surface_defaults sd ON sd.surface_name = s.name
WHERE s.client_name = 'matrx-user'
ORDER BY s.name;
```

Only **2 of those 132 surfaces** have a `tool.surface_defaults` row today
(`matrx-user/chat`, `matrx-user/transcript-scribe`). Surfaces with no row of
their own inherit down the `parent_surface_name` chain — which is the intended
design, not a gap. Add a row only for a surface that needs to differ from its
parent.

### 1.1 — Register a surface

`tool.surface_defaults.surface_name` is a foreign key to `ui.ui_surface.name`,
so the surface row must exist first. Existing rows use the
`<client>/<panel>` naming convention and parent to `matrx-default/default`:

```sql
INSERT INTO ui.ui_surface
  (name, client_name, executor_name, parent_surface_name, execution_mode, description)
VALUES
  ('matrx-user/example-panel', 'matrx-user', 'matrx-user',
   'matrx-default/default', 'python-stream', 'Example panel')
ON CONFLICT (name) DO NOTHING;

INSERT INTO tool.surface_defaults (surface_name, always_include_tools)
VALUES ('matrx-user/example-panel', ARRAY['user','update_plan'])
ON CONFLICT (surface_name) DO NOTHING;
```

### 1.2 — Executor bindings for the UI-first tools

These six are **already bound and active** for `matrx-user`:

| tool name | tier | category | notes |
|---|---|---|---|
| `user` | ask-user | human | The six-mode ask card (confirm/choice/choice_many/text/secret/notify). |
| `update_plan` | ask-user | human | Plan-propose-and-approve. |
| `request_user_takeover` | ask-user | human | Hand control to the user. |
| `user_todos` | action | human | Items the agent assigns to the user. |
| `scratchpad` | read | memory | Session-scoped kv. |
| `storage` | privileged | memory | Persistent kv. |

`tasks` and `memory` are advertised on `matrx-user/chat` but deliberately have
**no** `matrx-user` binding — both execute server-side on `matrx-ai-core`
(`tasks` writes `chat.agent_task`). That is correct, and §1.6's query is written
to expect it.

Verify:

```sql
SELECT d.name, d.tier, d.category, d.admin_only, b.executor_name, b.is_active
FROM tool.binding b
JOIN tool.definition d ON d.id = b.tool_id
WHERE b.executor_name = 'matrx-user'
   OR b.executor_name LIKE 'matrx-user.%'
ORDER BY d.name;
```

Claiming further tools is an insert against the pure join — no `surface`, no
`source_app`, no `function_path`, no `priority`, no `auto_load`. The primary key
is `(tool_id, executor_name)`, so the upsert is re-runnable and doubles as an
un-retire:

```sql
INSERT INTO tool.binding (tool_id, executor_name, is_active)
SELECT d.id, 'matrx-user', true
FROM tool.definition d
WHERE d.name IN ('user','update_plan','request_user_takeover',
                 'tasks','user_todos','scratchpad')
ON CONFLICT (tool_id, executor_name)
DO UPDATE SET is_active = true, updated_at = now();
```

Retiring one is a flag flip, never a `DELETE`:

```sql
UPDATE tool.binding b
SET is_active = false, updated_at = now()
FROM tool.definition d
WHERE d.id = b.tool_id
  AND b.executor_name = 'matrx-user'
  AND d.name = 'scratchpad';
```

### 1.3 — Surface inclusion (the second gate)

A binding alone advertises nothing. The discovery handler reads
`always_include_tools`:

```sql
SELECT surface_name, always_include_tools, always_include_bundles, never_include_tools
FROM tool.surface_defaults
WHERE surface_name = 'matrx-user/chat';
```

Live today: `{memory, request_user_takeover, scratchpad, storage, tasks,
update_plan, user, user_todos}`.

Add to it idempotently (the sort keeps diffs readable and the `DISTINCT` makes
re-runs harmless):

```sql
UPDATE tool.surface_defaults
SET always_include_tools = ARRAY(
      SELECT DISTINCT unnest(always_include_tools || ARRAY['user','update_plan'])
      ORDER BY 1
    ),
    updated_at = now()
WHERE surface_name = 'matrx-user/chat';
```

Remove one:

```sql
UPDATE tool.surface_defaults
SET always_include_tools = array_remove(always_include_tools, 'storage'),
    updated_at = now()
WHERE surface_name = 'matrx-user/chat';
```

`never_include_tools` is the subtractive counterpart, used to suppress something
a parent surface includes.

### 1.4 — Code: implement the handlers

Reference: [`UI_FIRST_TOOLS.md`](./UI_FIRST_TOOLS.md) tool-by-tool sections.
Each tool needs:

- **Zod schema** — copy verbatim from
  [`src/lib/tools/handlers/user.ts`](../src/lib/tools/handlers/user.ts) and
  [`src/lib/tools/handlers/lists.ts`](../src/lib/tools/handlers/lists.ts).
- **Handler** — the React/server function that does the work. For
  `update_plan` / `user` / `request_user_takeover` it builds a pending-card
  request and awaits a user click; for `tasks` / `user_todos` / `scratchpad`
  it's a CRUD call against Supabase (recommended) or React state.
- **Storage layer** — `tasks` already has a canonical home in `chat.agent_task`
  (written server-side by the `tasks` mega-tool); read and edit that table
  rather than inventing a parallel one. For the rest, a table per concept:
  - `cx_plan(conversation_id PK, title, steps[], reasoning, domains[], status, created_at, updated_at)`
  - `cx_user_todo(id PK, conversation_id, title, context, due, done, done_at, created_at)`
  - `scratchpad` is session-scoped → `sessionStorage` or React context, no DB.
- **Pending-request inbox** — zustand store with `pendingAsks[]`, filtered
  by `conversationId`, rendered as inline cards inside the chat stream.
  Direct port of
  [`src/state/tool-inbox.ts`](../src/state/tool-inbox.ts) +
  [`src/hooks/use-tool-inbox.ts`](../src/hooks/use-tool-inbox.ts) +
  [`src/features/chat/AgentAskUserCard.tsx`](../src/features/chat/AgentAskUserCard.tsx).
- **Result POST** — mirror
  [`src/lib/api/routes/tool-results.ts`](../src/lib/api/routes/tool-results.ts).
  Hit `POST /ai/conversations/{conversation_id}/tool_results` with
  `{call_id, tool_name, output, is_error, error_message}`.

### 1.5 — Context injection

Every chat send POSTs `client.state[...]` under the surface's own namespace.
Mirror matrx-extend's
[`src/lib/chat/context/v2-bundled.ts`](../src/lib/chat/context/v2-bundled.ts)
for the three per-conversation slices when populated:

- `current_plan` — `{title, steps, status, reasoning, domains, …}` when a
  plan exists.
- `task_list` — `[{id, title, status, note}]` when ≥1 task.
- `user_todos` — `{open: [...], recent_done: [up to 5]}` when ≥1 todo.

These ride the request payload, not the registry. The model sees them every turn
alongside whatever else the surface ships.

### 1.6 — Drift check script

Mirror [`scripts/check-tool-db-drift.ts`](../scripts/check-tool-db-drift.ts).
On every release, report loudly if:

- A canonical name in your local registry has no row in `tool.definition`
- A tool advertised by one of your surfaces has no handler in code
- A handler's Zod schema diverges from `tool.definition.parameters` (fields,
  types, `required`, enum members, defaults)
- A tool you implement has no active `tool.binding` row for your executor
- A tool you implement is in no surface's `always_include_tools`

The last two are the ones the SQL can answer directly. **Advertised but not
runnable** — the failure that looks like a permissions bug:

```sql
SELECT t AS tool_name
FROM tool.surface_defaults sd
CROSS JOIN LATERAL unnest(sd.always_include_tools) AS t
WHERE sd.surface_name = 'matrx-user/chat'
  AND NOT EXISTS (
    SELECT 1
    FROM tool.definition d
    JOIN tool.binding b ON b.tool_id = d.id
    WHERE d.name = t
      AND d.is_active
      AND b.is_active
      AND (b.executor_name = 'matrx-user' OR b.executor_name LIKE 'matrx-user.%')
  )
ORDER BY 1;
```

Returns `memory` and `tasks` today — both expected (server-executed on
`matrx-ai-core`). Allow-list those two; anything else is a real defect.

**Runnable but never offered** — the silently-dead tool:

```sql
SELECT d.name
FROM tool.binding b
JOIN tool.definition d ON d.id = b.tool_id
WHERE b.is_active
  AND d.is_active
  AND (b.executor_name = 'matrx-user' OR b.executor_name LIKE 'matrx-user.%')
  AND NOT EXISTS (
    SELECT 1 FROM tool.surface_defaults sd
    WHERE sd.is_active
      AND sd.surface_name LIKE 'matrx-user/%'
      AND d.name = ANY(sd.always_include_tools)
  )
ORDER BY 1;
```

Returns zero rows today. Keep it that way.

Wire both into your release pipeline. Treat warnings as bugs.

### 1.7 — The `user` tool card — exact layout to implement

The `user` mega-tool is the most feature-rich UI-first tool. Mirror
matrx-extend's [`AgentAskUserCard.tsx`](../src/features/chat/AgentAskUserCard.tsx)
exactly so the user experience is consistent across surfaces:

| Field | Renders as |
|---|---|
| `header` | Small uppercase chip in the top-left corner of the card |
| `context` | Muted one-line caption above the question |
| `question` | Main question text |
| `batch_index` / `batch_total` (handler-injected) | "N of M" badge when batched |
| Countdown (if `expires_at_ms` set) | Top-right tabular-num pill, MM:SS format |
| `type: 'confirm'` | Yes / No buttons |
| `type: 'choice'` with bare-string options | Radio list |
| `type: 'choice'` with rich `options[].description` | Radio + muted description below each label |
| `type: 'choice'` with rich `options[].preview` (any option) | **Side-by-side grid:** vertical radio list on the left, monospace preview block on the right showing the focused option's preview (focus follows mouseover + selection) |
| `type: 'choice_many'` | Checkbox list (same option rules as `choice`) |
| `type: 'choice' \| 'choice_many'` with `allow_other: true` | Append a dashed-border "Other" option; when selected, expand to a `<Textarea>` and submit packs the response with `freeform: <typed text>` |
| `type: 'text'` | `<Textarea>` + Send button (Cmd/Ctrl+Enter submits) |
| `type: 'secret'` | `<Input type="password">` + Send button (Enter submits) |
| `type: 'notify'` | Banner styled by `level`, action buttons inline, always-appended "Other" freeform fallback |

**Response shape:**
- Single question → `respondToAsk(callId, AskUserResponse)`:
  - `confirm` → `{ confirmed: true|false }`
  - `choice` → `{ selected: [label] }` (or `{ selected: ['Other'], freeform: text }` for Other)
  - `choice_many` → `{ selected: [...labels] }` (Other adds 'Other' to selected + `freeform`)
  - `text` / `secret` → `{ answer: text }`
  - `notify` → `{ action: label, freeform: null }` or `{ action: 'Other', freeform: text }`
  - Cancel → `{ cancelled: true }`

The handler then maps that to the wire envelope `{answer, selected, confirmed, action, freeform, cancelled, timed_out}`.

### 1.8 — Verification

End-to-end test: send a chat message that triggers `update_plan`. Expect:
1. Server routes the call to the `matrx-user` executor (visible in the SSE
   `tool_event` stream).
2. Your dispatcher validates args with Zod.
3. Handler renders the plan card inline in the chat.
4. User clicks Approve.
5. Handler POSTs the result back.
6. Auto-populate hook creates one task per plan step in `chat.agent_task`.
7. Next agent turn shows `task_list` in context.

If all seven steps fire, the integration is complete.

---

## 2. matrx-local (Tauri desktop engine) — executor `matrx-local`

**Status: consolidated, not sprawling.** The `local_*` surface collapsed from
~130 granular tools into **19 active mega-tools**. `tool.binding` holds **134**
rows for this executor: 19 active, **115 retired** (`is_active = false`, kept as
history — the roster below is the whole live surface, not an excerpt).

```sql
SELECT count(*) FILTER (WHERE b.is_active)     AS active,
       count(*) FILTER (WHERE NOT b.is_active) AS retired,
       count(*)                                AS total
FROM tool.binding b
WHERE b.executor_name = 'matrx-local'
   OR b.executor_name LIKE 'matrx-local.%';
```

### 2.1 — The live roster (19 tools)

```sql
SELECT d.name, d.category, d.is_active AS def_active
FROM tool.binding b
JOIN tool.definition d ON d.id = b.tool_id
WHERE (b.executor_name = 'matrx-local' OR b.executor_name LIKE 'matrx-local.%')
  AND b.is_active
ORDER BY d.name;
```

| category | tools |
|---|---|
| `desktop` | `local_audio`, `local_clipboard`, `local_documents`, `local_file`, `local_input`, `local_mac_apps`, `local_media`, `local_monitor`, `local_ner`, `local_process`, `local_schedule`, `local_screen`, `local_shell`, `local_system`, `local_window`, `local_windows_ps` |
| `desktop-web` | `local_browser`, `local_net`, `local_web` |

The old one-verb-per-tool names this doc used to enumerate — `local_bash`,
`local_read_file`, `local_screenshot`, `local_notify`, `local_open_url`,
`local_fetch_url`, `local_pdf_extract`, `local_list_processes`, and the rest —
are all **retired**: `tool.definition.is_active = false` and their bindings
inactive. They are subsumed by the mega-tools above (`local_shell`,
`local_file`, `local_screen`, `local_process`, …). Do not resurrect a name from
that list; add an action to the mega-tool that owns the domain.

The consolidation also resolved the old "should we drop the duplicates?" and
"should we bind to canonical names instead?" open questions, which is why those
sections are gone. The remaining rule is unchanged and still governs new work:

> **If Playwright can do it, we don't own the name.** Anything genuinely OS-level
> — real shell, real disk, real screen, real window manager — keeps the
> `local_*` prefix, because no other surface can implement it. Anything a
> browser can do binds to the canonical name (`computer`, `navigate`,
> `read_page`, `clipboard`) instead of getting a `local_` twin.

The `desktop-web` category is where that line gets interesting: `local_browser`,
`local_net`, and `local_web` reach the web *from the user's machine and network
context*, which is materially different from a browser tab or a server-side
fetch. That distinction is the justification for those three, and it's the test
to apply to any fourth.

### 2.2 — Surface defaults

`matrx-local/desktop` advertises just three names:

```sql
SELECT surface_name, always_include_tools
FROM tool.surface_defaults
WHERE surface_name = 'matrx-local/desktop';
```

→ `{load_desktop_tools, local_file, local_shell}`

`load_desktop_tools` is the discovery root (executed by `matrx-ai-core`) — the
same on-demand pattern matrx-extend uses with `load_browser_tools`. The other 17
tools are pulled in mid-turn by that call, not advertised upfront. When you add a
mega-tool, add its binding **and** make sure the discovery handler routes to it;
only add it to `always_include_tools` if it truly belongs in every turn.

### 2.3 — Drift check script for matrx-local

Same template as matrx-extend's. Comparator goals:

- Every name in matrx-local's local dispatcher must exist in `tool.definition`.
- Every active `tool.binding` row for `executor_name = 'matrx-local'` must point
  at a name the local dispatcher implements.
- Arg schemas match `tool.definition.parameters`.
- Categories match (UX-only, but worth flagging).

Both §1.6 queries work here verbatim — swap `'matrx-user'` for `'matrx-local'`
and `'matrx-user/chat'` for `'matrx-local/desktop'`.

> Note for anyone reading the cross-repo system-of-record: it currently lists
> matrx-local as "not a consumer of this registry." That was true of the old
> `desktop_run_command`-only bridge; the 19 active bindings and the
> `matrx-local/desktop` surface row say otherwise now. Both routes are live —
> see §3.

### 2.4 — Verification

End-to-end test: from a matrx-extend chat session, ask the agent something
that requires the desktop bridge. Expect:

1. Agent calls `desktop_run_command` from matrx-extend (the bridge route), or
   the model calls `load_desktop_tools` and then a `local_*` mega-tool directly
   (the registry route).
2. matrx-local executes, returns the result via the bridge / SSE.
3. The next agent turn quotes the output.

---

## 3. Cross-surface ownership map

When you're unsure who owns a name, **ask the database** rather than this table —
it is a snapshot and this one is dated 2026-08-09:

```sql
SELECT d.name,
       d.tier,
       d.category,
       d.is_active AS def_active,
       coalesce(
         string_agg(b.executor_name, ', ' ORDER BY b.executor_name)
           FILTER (WHERE b.is_active),
         '(no active binding)'
       ) AS executors
FROM tool.definition d
LEFT JOIN tool.binding b ON b.tool_id = d.id
WHERE d.name IN ('read_page','computer','navigate','clipboard',
                 'fs_read','local_shell','memory','desktop_run_command')
GROUP BY d.name, d.tier, d.category, d.is_active
ORDER BY d.name;
```

| Capability | Canonical name | Active executor bindings |
|---|---|---|
| Read DOM | `read_page` | `chrome-extension` |
| Click / type / screenshot | `computer` | `chrome-extension` |
| Navigate to URL | `navigate` | `chrome-extension` |
| Tabs | `tabs` | `chrome-extension` |
| Form input | `form_input`, `submit_form` | `chrome-extension` |
| Clipboard (browser) | `clipboard` | `chrome-extension` |
| Screen capture (browser) | `screenshot_region` | `chrome-extension` |
| Cookies / bookmarks / history | `chrome_*` | `chrome-extension` |
| CDP | `cdp_*` (12 tools) | `chrome-extension` |
| WebMCP | `chrome_webmcp` | `chrome-extension` |
| Run from desktop (bridge) | `desktop_run_command` | `chrome-extension` |
| Files (server workspace) | `fs_read`, `fs_write`, `fs_list`, `fs_edit`, `fs_patch`, `fs_search`, `fs_mkdir` | `matrx-ai-core` |
| Shell exec (server sandbox) | `shell_execute`, `shell_python` | `matrx-ai-core` |
| Web search | `research_web` | `matrx-ai-core` |
| Desktop / real disk / real screen | `local_*` (19 mega-tools) | `matrx-local` |
| Plan / todos / ask-user / scratchpad | `update_plan`, `user_todos`, `user`, `request_user_takeover`, `scratchpad`, `storage` | `matrx-user` |
| Tasks | `tasks` | server-executed on `matrx-ai-core`; no client binding |
| Memory (persistent) | `memory` | server-executed; **no binding row at all** |
| RAG | `rag_*` | `aidream` — all four bindings currently **inactive** |

Two rows there are worth internalizing: **`memory` has no `tool.binding` row and
still works**, and `tasks` is advertised on a surface whose executor cannot run
it. Server-native tools are resolved by the orchestrator, not by a binding. So
"no binding" is not automatically a defect — but "no binding *and* you expected
your executor to run it" always is.

If the capability isn't in the table, it's either (a) not implemented anywhere
yet, or (b) you should add it to the table when you build it.

---

## 4. Checklist (cut + paste into your issue tracker)

### matrx-frontend (executor `matrx-user`)

- [ ] Run the §1 inventory query; confirm which of your 132 surfaces genuinely
      need their own `tool.surface_defaults` row versus inheriting from a parent.
- [ ] Implement Zod schemas + handlers for the six bound tools: `user`,
      `update_plan`, `request_user_takeover`, `user_todos`, `scratchpad`,
      `storage`.
- [ ] Read/write `tasks` against `chat.agent_task`; do not create a parallel table.
- [ ] Implement the remaining storage (`cx_plan`, `cx_user_todo`).
- [ ] Implement the pending-request inbox (zustand + cards).
- [ ] Implement context injection (`current_plan`, `task_list`, `user_todos`).
- [ ] Implement the `POST /tool_results` helper.
- [ ] Write the drift-check script; wire both §1.6 queries into it, with
      `memory` + `tasks` allow-listed on the first.
- [ ] Verify end-to-end with a real chat session.

### matrx-local (executor `matrx-local`)

- [ ] Confirm the desktop client implements all 19 active mega-tools and nothing
      that maps to a retired name.
- [ ] Confirm no code path still calls a retired `local_*` name.
- [ ] Decide whether any of the 17 non-advertised mega-tools belong in
      `matrx-local/desktop.always_include_tools` versus on-demand discovery.
- [ ] Write the drift-check script (§1.6 queries with the executor/surface
      swapped).
- [ ] Verify end-to-end via a matrx-extend chat that triggers a desktop call.

### Both

- [ ] Grep your repo for `tl_def`, `tl_executor`, `tl_def_surface`, `tool_def`,
      `tool_binding`, `tool_surface_defaults`, `source_app`, and
      `public.surfaces`. Every hit is a runtime failure waiting to happen.

---

## 5. Owner per row

| Row | Owner |
|---|---|
| §0 (schema invariants) | aidream backend team owns the schema |
| §1 (matrx-frontend / `matrx-user`) | matrx-frontend team |
| §2 (matrx-local) | matrx-local team (matrx-extend can help map) |
| §3 (canonical names) | aidream backend team owns the registry; surface teams add bindings |
| §4 (checklists) | each surface team owns their section |
