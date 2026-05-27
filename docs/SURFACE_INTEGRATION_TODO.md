# Surface integration — to-do list for matrx-frontend and matrx-local

> **Schema rename note (2026-05-27).** This doc was written against the
> pre-refactor schema. aidream's clean-break refactor renamed every
> `tl_*` table — the *concepts* below (executor binding, surface gates,
> drift check) are unchanged but the **names and shapes moved**. See
> [/Users/armanisadeghi/code/aidream/docs/CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/CROSS_TEAM_TOOL_REFACTOR.md)
> for the authoritative current schema. Key translations:
> - `public.tl_executor` → `public.tool_binding` (pure
>   `(tool_id, executor_name, is_active)` — no more `function_path`,
>   `source_app`, `delegated`, `priority`, `auto_load`).
> - `public.tl_def_surface` → DROPPED, replaced by per-surface
>   `tool_surface_defaults.always_include_tools` / `never_include_tools`
>   string arrays on a `ui_surface`-keyed row.
> - `surface='server:matrx_ai'` / `surface='matrx-extend.browser'` →
>   `executor_name='matrx-ai-core'` / `executor_name='chrome-extension'`.
> - `source_app` column is gone — claim a tool by inserting a
>   `tool_binding` row, not by setting a column on `tool_def`.
> - The "concretizer" / "executor binding" language matches the new
>   shape exactly: `tool_binding` IS the binding.
>
> The SQL templates in the body need to be rewritten to the new tables
> before re-use; the conceptual checklist is still valid.

> Per [TOOL_ROUTING_RULES.md](https://github.com/) the DB is canonical. Each
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

---

## 0. Shared invariants (both surfaces read this first)

- **The DB tool registry is the source of truth.** You don't tell the server
  what tools you have on every request — you declare them in
  `public.tl_def` + `public.tl_executor` once, and the server caches the
  manifest from there. Amendments (per-request overrides) are an escape
  hatch logged loudly, not a maintenance pattern.
- **One name → one definition, forever.** If a capability exists under a
  canonical name (e.g. `clipboard`, `navigate`, `read_page`), you bind your
  executor to that name. You don't make up `myapp_clipboard`.
- **Categories are pure UX.** They affect Tools-tab grouping and discovery
  helpers, never routing. The current 14 categories are: `core`, `reading`,
  `interaction`, `tabs`, `capture`, `chrome`, `human`, `memory`, `ai`,
  `demos`, `guidance`, `devtools`, `webmcp`, `desktop`.
- **A drift-check script is mandatory.** Every surface team maintains a
  script that compares local code against `tl_def` + `tl_executor` +
  `tl_def_surface` and fails the release on divergence. matrx-extend's lives
  at [`scripts/check-tool-db-drift.ts`](../scripts/check-tool-db-drift.ts) —
  copy the pattern.

---

## 1. matrx-frontend (Next.js admin UI)

Status today: **no rows in `public.surfaces`, no rows in `public.tl_executor`,
no handlers in code.** Starting from zero. The capabilities to bring online
are the **UI-first tools** — they're surface-agnostic and run as React state +
Supabase reads/writes.

### 1.1 — Register the surface

One row in `public.surfaces` (or whatever the canonical surface registry is —
in practice the surface name is what `tl_executor.surface` references):

| field | value |
|---|---|
| `surface` (in tl_executor.surface) | `matrx-frontend.web` |
| `source_app` | `matrx-frontend` |

### 1.2 — Add executor bindings for the UI-first tools

Six tools to claim. Insert one row per tool in `public.tl_executor`:

| tool name | tier | auto_load | delegated | notes |
|---|---|---|---|---|
| `user` | ask-user | true | true | The six-mode ask card (confirm/choice/choice_many/text/secret/notify). |
| `update_plan` | ask-user | true | true | Plan-propose-and-approve. |
| `request_user_takeover` | ask-user | false | true | Hand control to the user. Lower auto_load — niche. |
| `tasks` | action | true | true | Agent's per-conversation tasklist. |
| `user_todos` | action | true | true | Items agent assigns to the user. |
| `scratchpad` | read | true | true | Session-scoped kv. |

SQL skeleton:

```sql
INSERT INTO public.tl_executor
  (tool_id, surface, function_path, source_app, delegated, priority, is_active, auto_load)
SELECT d.id, 'matrx-frontend.web', '', 'matrx-frontend', true, 50, true,
       CASE WHEN d.name IN ('user','update_plan','tasks','user_todos','scratchpad') THEN true ELSE false END
FROM public.tl_def d
WHERE d.name IN ('user','update_plan','request_user_takeover','tasks','user_todos','scratchpad');
```

### 1.3 — Add surface gates

If matrx-frontend has a sub-surface concept like matrx-extend's
`chrome-extension/assistant` vs `chrome-extension/pilot`, register the gates
in `public.tl_def_surface`. If matrx-frontend is one surface, skip this
step (gates default to "available").

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
- **Storage layer** — Supabase table per concept (suggested):
  - `cx_plan(conversation_id PK, title, steps[], reasoning, domains[], status, created_at, updated_at)`
  - `cx_task(id PK, conversation_id, title, status, note, order, created_by, created_at, updated_at)`
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

Every chat send POSTs `client.state['matrx-frontend.web']` (or whatever
namespace you adopt). Mirror matrx-extend's
[`src/lib/chat/context/v2-bundled.ts`](../src/lib/chat/context/v2-bundled.ts)
for the three per-conversation slices when populated:

- `current_plan` — `{title, steps, status, reasoning, domains, …}` when a
  plan exists.
- `task_list` — `[{id, title, status, note}]` when ≥1 task.
- `user_todos` — `{open: [...], recent_done: [up to 5]}` when ≥1 todo.

These ride the request payload, not the tl_def manifest. The model sees
them every turn alongside whatever else the surface ships.

### 1.6 — Drift check script

Mirror [`scripts/check-tool-db-drift.ts`](../scripts/check-tool-db-drift.ts).
On every release, fail loudly if:

- A canonical name in your local registry has no row in `tl_def`
- A canonical name in `tl_def` for `surface='matrx-frontend.web'` has no
  handler in code
- A handler's Zod schema diverges from `tl_def.parameters` (description,
  type, enum, required)
- A tool has no `tl_executor` row for your surface
- (When applicable) a gate is missing or orphaned

Wire it into your release pipeline. Treat warnings as bugs.

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
1. Server delegates the call (visible in SSE `tool_event: tool_delegated`).
2. Your dispatcher validates args with Zod.
3. Handler renders the plan card inline in the chat.
4. User clicks Approve.
5. Handler POSTs the result back.
6. Auto-populate hook creates one task per plan step in `cx_task`.
7. Next agent turn shows `task_list` in context.

If all seven steps fire, the integration is complete.

---

## 2. matrx-local (Tauri desktop engine)

Status today: **62 active executor bindings** in `tl_executor` for
`surface='server:matrx_local'`. 14 browser-duplicate tools were dropped on
2026-05-19 (see "Convergence with the canonical namespace" below). The
remaining work is **(a) drop more duplicates** and **(b) bind to canonical
names instead of inventing `local_*` variants**.

### 2.1 — What was already dropped (2026-05-19)

These 14 `local_*` tools were deleted from `tl_def`, `tl_executor`,
`tl_def_surface`, and `tl_bundle_member`:

`local_browser_click`, `local_browser_eval`, `local_browser_extract`,
`local_browser_navigate`, `local_browser_screenshot`, `local_browser_tabs`,
`local_browser_type`, `local_clipboard_read`, `local_clipboard_write`,
`local_fetch_with_browser`, `local_scrape`, `local_search`, `local_research`,
`record_gif` (the matrx_local copy; matrx-extend keeps `chrome_record_gif`)

### 2.2 — What stays with the `local_*` prefix (genuinely desktop-only)

Per the rule "if Playwright can do it, no one owns it" — anything that's
truly OS-level keeps the `local_*` prefix because no other surface can
implement it:

**Shell / scripting:** `local_bash`, `local_bash_output`, `local_powershell`,
`local_applescript`, `local_task_stop`

**Filesystem (user's real disk):** `local_read_file`, `local_write_file`,
`local_edit_file`, `local_list_directory`, `local_glob`, `local_grep`,
`local_archive_create`, `local_archive_extract`

**Documents (~/.matrx/documents/):** `local_list_documents`,
`local_list_document_folders`, `local_read_document`, `local_write_document`,
`local_search_documents`

**Process / window control:** `local_focus_app`, `local_focus_window`,
`local_get_installed_apps`, `local_kill_process`, `local_launch_app`,
`local_list_processes`, `local_list_ports`, `local_list_windows`,
`local_minimize_window`, `local_move_window`, `local_top_processes`

**Input simulation:** `local_hotkey`, `local_mouse_click`, `local_mouse_move`,
`local_type_text`

**Network (user's network context):** `local_network_info`,
`local_network_scan`, `local_mdns_discover`, `local_port_scan`,
`local_fetch_url` (raw HTTP from user's machine)

**Media (OS-level):** `local_screenshot` (desktop screen, NOT browser),
`local_image_ocr`, `local_image_resize`, `local_pdf_extract` (local file path)

**System info:** `local_battery_status`, `local_disk_usage`,
`local_system_info`, `local_system_resources`

**Convenience:** `local_notify`, `local_open_path`, `local_open_url`

### 2.3 — Suggested next deletions (matrx-local team decides)

These look like further candidates if matrx-local wants to consolidate, but
the matrx-local team should validate against actual usage:

| matrx_local | possible canonical | reasoning |
|---|---|---|
| `local_fetch_url` | `fetch_url_as_markdown` (or a new `fetch_url` canonical) | If a server-side equivalent exists, bind to it instead. Keep only if "fetches from user's network context" is materially different. |
| `local_screenshot` | (none — keep) | Captures the user's full screen, including non-browser apps. matrx-extend can't do this. **Stays distinct.** |
| `local_open_url` | (none — keep) | Launches user's default browser app (could be Safari, Chrome, Firefox). Different from `navigate` which navigates a Playwright-controlled tab. **Stays distinct.** |
| `local_pdf_extract` | `read_pdf`? | `read_pdf` takes a tab_id or cld_files file_id. `local_pdf_extract` takes a local filesystem path. Different shape — could converge by adding a `local_path` argument to canonical `read_pdf` and binding matrx-local to that, but it's a Zod-schema change. **Defer unless cross-surface value is high.** |

### 2.4 — Cross-surface canonical binding (the bigger move)

Some matrx-local tools have the SAME shape as canonical tools but currently
live under their own name. Per TOOL_ROUTING_RULES.md §4, they should share
the canonical name with an additional executor binding. **Per name, one
definition; multiple executors allowed.**

| matrx_local current | shape compatible with canonical | recommended |
|---|---|---|
| `local_notify` | `user(type='notify')` mostly | Add a tl_executor binding for matrx_local on `user`. Drop `local_notify`. |
| `local_list_processes`, `local_list_ports`, `local_top_processes`, `local_battery_status`, `local_disk_usage`, `local_system_info`, `local_system_resources` | (no canonical exists today) | Keep `local_*`. No canonical to bind to. |
| `local_mouse_click`, `local_mouse_move`, `local_type_text`, `local_hotkey` | `computer(action=…)` — but works at OS level, not in a browser | **Keep `local_*`.** Same shape, different target (OS screen vs browser tab). Two separate canonicals: `computer` for browser, `local_*` for OS. |
| Filesystem (`local_read_file`, `local_write_file`, `local_edit_file`, `local_list_directory`, …) | matrx_ai's `fs_*` family | These already exist on matrx_ai server-side. matrx-local could **bind to the same names** (`fs_read`, `fs_write`, `fs_list`, …) as additional executors. The difference: matrx_ai's `fs_*` works against the server's workspace; matrx-local's works against the user's machine. The active surface's binding wins per §6 of the routing rules. |

This last row is the biggest leverage point. If matrx-local binds to
`fs_read` / `fs_write` / `fs_list` / `fs_search` / `fs_patch` / `fs_mkdir`
instead of `local_read_file` / etc., the model uses one set of names
regardless of which surface is active. Cost: ~12 deletions + ~12 new
executor bindings.

### 2.5 — Drift check script for matrx-local

Same template as matrx-extend's. Comparator goals:

- Every name in matrx-local's local registry must exist in `tl_def`.
- Every `tl_executor` row with `surface='server:matrx_local'` must point at
  a name the local registry implements.
- Zod schemas (or matrx-local's equivalent) match `tl_def.parameters`.
- Categories match (UX-only but worth flagging).

### 2.6 — Verification

End-to-end test: from a matrx-extend chat session, ask the agent something
that requires the desktop bridge. Expect:

1. Agent calls `desktop_run_command({command: 'list_processes'})` from
   matrx-extend. Or, post-§2.4, the agent calls
   `local_list_processes` directly (matrx-local routes it).
2. matrx-local executes, returns result via the bridge / SSE.
3. The next agent turn quotes the process list.

---

## 3. Cross-surface ownership map

When you find yourself unsure who owns a name, use this table:

| Capability | Canonical name | Owners (executor bindings) |
|---|---|---|
| Read DOM | `read_page` | matrx-extend, matrx-frontend (when implemented), eventually server playwright |
| Click / type / screenshot | `computer` | matrx-extend, matrx-frontend, eventually server playwright |
| Navigate to URL | `navigate` | matrx-extend, matrx-frontend, server |
| Tabs | `tabs` | matrx-extend (only — Playwright contexts are different) |
| Form input | `form_input`, `submit_form` | matrx-extend, matrx-frontend |
| Clipboard | `clipboard` | matrx-extend, matrx-frontend (browser-clipboard API) |
| Files (server workspace) | `fs_read`, `fs_write`, … | matrx_ai (server), matrx-local |
| Files (user's real disk) | `local_*` | matrx-local |
| Cookies (user's real) | `chrome_cookies` | matrx-extend |
| Cookies (Playwright session) | `chrome_cookies`? or new canonical | TBD |
| Bookmarks / history | `chrome_*` | matrx-extend |
| Screen capture (browser) | `screenshot_region` | matrx-extend, matrx-frontend (Playwright fallback) |
| Screen capture (desktop full) | `local_screenshot` | matrx-local |
| Plan / tasks / todos / user | `update_plan`, `tasks`, `user_todos`, `user` | matrx-extend, matrx-frontend |
| Scratchpad | `scratchpad` | matrx-extend, matrx-frontend |
| Memory (persistent) | `memory` | matrx_ai (server) |
| Shell exec | `shell_execute`, `shell_python` | matrx_ai (server sandbox), matrx-local (real shell) |
| Web search | `web` (matrx_ai mega-tool), `research_web` | matrx_ai |
| Run from desktop | `desktop_run_command` | matrx-extend (bridge) |
| CDP | `cdp_*` | matrx-extend only |
| WebMCP | `chrome_webmcp` | matrx-extend only |
| RAG | `rag_*` | aidream |

If the capability isn't in the table, it's either (a) not implemented anywhere
yet, or (b) you should add it to the table when you build it.

---

## 4. Checklist (cut + paste into your issue tracker)

### matrx-frontend

- [ ] Decide surface name (suggest `matrx-frontend.web`).
- [ ] Insert `tl_executor` rows binding the six UI-first tools to your
      surface.
- [ ] Implement Zod schemas + handlers for `user`, `update_plan`,
      `request_user_takeover`, `tasks`, `user_todos`, `scratchpad`.
- [ ] Implement Supabase tables (`cx_plan`, `cx_task`, `cx_user_todo`).
- [ ] Implement the pending-request inbox (zustand + cards).
- [ ] Implement context injection (`current_plan`, `task_list`,
      `user_todos`).
- [ ] Implement the `POST /tool_results` helper.
- [ ] Write the drift-check script.
- [ ] Verify end-to-end with a real chat session.

### matrx-local

- [ ] Confirm the 14-tool delete pass on 2026-05-19 didn't break
      anything in the desktop client.
- [ ] Decide on the further-consolidation items in §2.3 (`local_fetch_url`,
      etc.).
- [ ] Decide on the canonical-binding moves in §2.4 (`fs_*` instead of
      `local_read_file` family).
- [ ] Drop the `tl_def` rows + `tl_executor` rows for any newly-converged
      tools.
- [ ] Add `tl_executor` rows for any canonical names matrx-local now binds
      to (e.g. `fs_read` with `surface='server:matrx_local'`).
- [ ] Write the drift-check script for matrx-local.
- [ ] Verify end-to-end via a matrx-extend chat that triggers a
      desktop-bridge call.

---

## 5. Owner per row

| Row | Owner |
|---|---|
| §1.1–1.7 (matrx-frontend) | matrx-frontend team |
| §2.1 (already done) | matrx-extend team |
| §2.2 (keep `local_*`) | matrx-local team |
| §2.3–2.6 (further consolidation) | matrx-local team (matrx-extend can help map) |
| §3 (canonical names) | aidream backend team owns the registry; surface teams add bindings |
| §4 (checklists) | each surface team owns their section |
