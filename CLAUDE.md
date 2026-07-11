# matrx-extend — Project State

> Living document. Updated every time we ship or rip something out.
> Mission: build the harness that gets the world's top AI models begging
> their researchers to please let them out of their current harness and
> into AI Matrx. Everything in here serves that.

> Cross-repo system-of-record for the unified content pipeline (this repo's stream parsing at `src/lib/api/stream.ts` + `src/components/markdown/block-parser.ts` is slated to adopt the shared pure-TS content kernel and start consuming `render_block` events): `/Users/armanisadeghi/code/common-docs/unified-content-pipeline/FEATURE.md` — read it before touching stream parsing or markdown block rendering in ANY repo.

---

## ✅ What the system can do today

### Agent harness (the core)

- **166 registered client-side tools** (74 read · 136 read+action+ask ·
  full kit with privileged) wired end-to-end through SW dispatcher →
  permission gate → handler → result POST → timeline event. The
  canonical "advertised" surface is smaller — see `CANONICAL_SURFACE`
  in [src/lib/tools/categories.ts](./src/lib/tools/categories.ts) for
  the names the server actually shows agents (mega-tool routers like
  `computer`, `tabs`, `form_input` collapse many granular handlers).
- **Capability-based discovery (2026-05-01)** — every chat ships a single
  capability `browser-dom` whose only always-on tool is `load_browser_tools`.
  The model calls `load_browser_tools({category})` to pull in the matching
  category's tools mid-turn. Server-side discovery handler reads
  `client.state["browser-dom"]` (admin? perms? desktop bridge?) and routes
  via DB rows in `public.tool_def` (joined with `public.tool_binding`
  where `executor_name='chrome-extension'`) — see
  [docs/MATRX_EXTEND_MIGRATION_GUIDE.md](./docs/MATRX_EXTEND_MIGRATION_GUIDE.md)
  for the post-redesign source-of-truth flow. The previously-emitted
  `types/server-handoff/browser-dom-capability.json` was retired in
  May 2026.
- **Category taxonomy redesign (2026-05-19)** — categories rebuilt
  around user mental model, not implementation surface. 14 categories
  replace the previous 17:
  - `core` — always-on discovery + batching utilities
  - `reading` — "what's on the page" (read_page, find, extract_*, …)
  - `interaction` — "do something on the page" (computer, navigate,
    form_input, clipboard, evaluate_javascript, …)
  - `tabs` — manage browser tabs / windows
  - `capture` — save artifacts (downloads, MHTML, screenshots, GIFs, video)
  - `chrome` — user's personal Chrome data (cookies/bookmarks/history),
    admin-restricted
  - `human` — talk to user (user, update_plan, request_user_takeover,
    tasks, user_todos)
  - `memory` — agent state (scratchpad, storage, remember_for_domain)
  - `ai` — on-device Gemini Nano
  - `demos` — record + replay user workflows
  - `guidance` — user-saved hints for the agent
  - `devtools` — CDP + host diagnostics (admin)
  - `webmcp` — page-registered tools (admin)
  - `desktop` — matrx-local bridge
  The "advanced" junk drawer and the 1-tool categories (cookies, webmcp,
  ai-as-1-tool, interact-as-sleep-only) are gone. Per
  TOOL_ROUTING_RULES.md §16, categories are pure UX — they affect
  Tools-tab grouping and discovery helpers, NEVER routing. The LLM only
  sees (name, description, schema).
- **Drift script v3 (2026-05-27)** —
  [`scripts/check-tool-db-drift.ts`](./scripts/check-tool-db-drift.ts)
  was rewritten against the post-tool-refactor schema (see the master
  reference at
  [/Users/armanisadeghi/code/aidream/docs/CROSS_TEAM_TOOL_REFACTOR.md](../aidream/docs/CROSS_TEAM_TOOL_REFACTOR.md)).
  It now checks three DB tables:
  1. `tool_def` — name + description + tier + admin_only + parameters +
     category. Replaces `tl_def`; `source_app` and `function_path`
     columns are gone.
  2. `tool_binding` — pure (tool_id, executor_name, is_active) M2M.
     Every advertised tool MUST have an active row for
     `executor_name='chrome-extension'` (or a `chrome-extension.*`
     sub-executor). Missing = resolver can't route. Replaces
     `tl_executor`; `surface='matrx-extend.browser'` is no longer the
     ownership concept — the executor name is.
  3. `tool_surface_defaults` — every advertised tool MUST appear in
     `always_include_tools` for at least one of
     `chrome-extension/{assistant,pilot}`. Missing = discovery handler
     never shows it. Replaces `tl_def_surface`.
  Wired into `release.sh` as before; new failure modes are surfaced
  inline + repeated in the end-of-release loud banner.
- **Global tool namespace (2026-05-19, complete; verified after the 2026-05-27 refactor)** — the
  `matrx-extend:` colon-prefix is GONE from every row in `tool_def`.
  Three tiers replace it:
  1. **Bare global names** (~58 tools) — UI-first + everything
     Playwright can also do. Examples: `update_plan`, `tasks`,
     `user_todos`, `user`, `request_user_takeover`, `scratchpad`,
     `read_page`, `find`, `computer`, `tabs`, `navigate`,
     `form_input`, `evaluate_javascript`, `clipboard`, `ai`,
     `record_demo`, `replay_demo`, `desktop_run_command`, ...
     A Next.js surface that registers a handler for the same name
     shares the same `tool_def` row — one tool, multiple impls (each
     surface's claim is its own row in `tool_binding`).
  2. **`chrome_*` bare prefix** (9 tools) — genuinely
     Chrome-extension-exclusive. Examples: `chrome_cookies`,
     `chrome_bookmarks`, `chrome_history`, `chrome_recently_closed`,
     `chrome_save_page_as_mhtml`, `chrome_tab_audio_inspect`,
     `chrome_record_gif`, `chrome_record_tab_video`, `chrome_webmcp`.
     Matches matrx_local's `local_*` convention.
  3. **`cdp_*` bare prefix** (12 tools) — Chrome DevTools
     Protocol-backed. Self-prefixed already; just dropped the colon
     namespace.
  Rule: **if Playwright can do it, we don't own the name.** The
  `tools_name_key` UNIQUE constraint is on `name` alone — that's
  load-bearing for "same name = same tool" cross-surface.
  Retired: `matrx-extend:memory` (mega-tool). Use the matrx_ai
  canonical `memory` for persistent memory; the new bare-name
  `scratchpad` for ephemeral in-session kv.
- **Tool registry refactor (2026-05-27, server-side)** — aidream rolled
  out a clean break of the registry schema. Old → new table renames:
  `tl_def` → `tool_def` (dropped `source_app`, `function_path`,
  `privileged`, `deactivated_at`; added `source_kind`,
  `managed_by_server_id`); `tl_executor_kind` → `tool_executor` (added
  `parent_executor_name` for inheritance, `mcp_server_id`);
  `tl_executor` (M2M) → `tool_binding` (pure join; `tool_id`,
  `executor_name`, `is_active`; dropped `delegated`, `priority`,
  `auto_load`, `function_path`, `source_app`); `tl_def_surface` →
  DROPPED (replaced by `tool_surface_defaults.always_include_tools` and
  `.never_include_tools` arrays per surface); `tl_gate` → DROPPED
  (gates live in matrx_ai code, referenced by name in
  `tool_def.gating` jsonb); `tl_bundle{,_member}` →
  `tool_bundle{,_member}` (schema unchanged); `cx_tl_call` →
  `cx_tool_call` (columns unchanged); `tl_mcp_*` → `tool_mcp_*`. The
  policy: **no legacy support, no shim** — old table names hit HTTP 404
  the instant the migration applied. **For the extension this is mostly
  invisible**: the capability envelope, the chat stream, and the tool
  dispatch flow are all unchanged. What did change in this repo:
  (1) [src/lib/supabase/queries.ts](./src/lib/supabase/queries.ts)
  reads `cx_tool_call` instead of `cx_tl_call` when hydrating
  conversation history with tool results;
  (2) [src/lib/tools/descriptions.ts](./src/lib/tools/descriptions.ts)
  queries `public.tool_def` via Supabase REST instead of the retired
  `GET /ai-tools/app/matrx-extend` aidream endpoint;
  (3) the drift + dump scripts under `scripts/` were rewritten against
  the new tables. The 48 active `tool_binding` rows for
  `executor_name='chrome-extension'` are this extension's claim on
  tools — that's the single ownership fact. Master reference:
  [/Users/armanisadeghi/code/aidream/docs/CROSS_TEAM_TOOL_REFACTOR.md](../aidream/docs/CROSS_TEAM_TOOL_REFACTOR.md).
- **Plan / Tasks / User-Todos (2026-05-19)** — three linked surfaces
  that pair with the existing `update_plan` flow.
  - **Plan** — what the user approved; persisted per-conversation,
    auto-populated into the tasklist on approval.
  - **Tasks** — agent's own live work items, per-conversation, with
    statuses (`pending|in_progress|done|blocked|skipped`). `tasks`
    mega-tool actions: `add`, `list`, `set_status`, `update`, `remove`,
    `reorder`, `clear_completed`, `clear_all`.
  - **User todos** — work the agent assigns BACK to the user.
    `user_todos` actions: `add` (fires Chrome notification unless
    `silent:true`), `list`, `update`, `remove`, `mark_done`,
    `clear_done`. Per-conversation.
  All three slices are injected into context as `current_plan`,
  `task_list`, `user_todos` keys when non-empty — user edits flow back
  to the model on the next turn. Per-chat surface lives in the
  TaskPanel drawer (chip in chat header opens it); cross-conversation
  triage lives in the new `lists` sidepanel tab. Storage at
  [src/lib/lists/storage.ts](./src/lib/lists/storage.ts); every
  mutation broadcasts `LISTS_CHANGED` so SW + sidepanel stay in sync.
- **Reference-ID system** — `read_page` tags every interactive element with
  `data-matrx-ref="N"` and returns refs (`ref:N`) the agent passes to
  interaction tools instead of brittle CSS selectors. Refs survive DOM
  mutations within the same page lifetime; invalidate on navigation.
  `click_element`, `type_into_element`, `scroll_page` (into-view),
  `hover_element`, `focus_element`, `blur_element`, `right_click_element`,
  `press_keys`, `select_dropdown_option`, `set_checkbox`, `set_radio`,
  `submit_form`, `file_upload` all accept either `ref` or `selector`.
- **`find` (NL element search)** — natural-language description in,
  matching refs out. Uses on-device Gemini Nano with a JSON-Schema
  constraint when available; falls back to text similarity.
- **`browser_batch`** — execute up to 20 read-tier tool calls in one round
  trip. Action / privileged tools require their normal individual approval.
- **`update_plan`** — agent proposes a step-by-step plan; user approves /
  rejects with optional note before execution begins.
- **4-tier permission model:** `read` (auto) · `action` (Ask/Act) · `ask-user`
  (renders question card) · `privileged` (always confirms, even in Act mode).
- **4 tool bundles:** core (always-on, 28 entries — agent's default surface) ·
  assistant (74 read-tier tools) · pilot (136: read+action+ask) ·
  pilot+privileged (166, trusted agents only).
- **Per-conversation tab assignment (2026-05-06)** — when the user
  sends a message, the active tab at that moment is latched as the
  agent's `assignedTabId` for that turn. All client-side tool handlers
  (`read_page`, `click_element`, `take_screenshot`, etc.) operate on
  the assigned tab, NOT on whatever tab Chrome considers active. The
  user can switch tabs mid-execution without disrupting the agent.
  Re-assignment happens on the next user message — switch tabs, send
  again, agent shifts focus. See `getAssignedTab` in
  [src/lib/tools/handlers/_active-tab.ts](./src/lib/tools/handlers/_active-tab.ts).
- **Two surfaces:** Assistant Chat tab · Pilot tab (admin-only, drives a
  sandboxed Chrome tab group with the full read+action+ask agent toolkit —
  see Roadmap item #9).
- **Per-agent permission mode** — "Ask before acting" / "Act without asking",
  user-toggleable in chat header chip, persisted per agent.
- **Domain trust** — "Allow + remember for this conversation" auto-allows
  subsequent action calls on the same host inside the same chat.
- **Inline approval cards** — `AgentApprovalCard` for confirms,
  `AgentAskUserCard` for ask-user (radio for choices, masked input for secrets,
  textarea otherwise), `ToolTimelineRow` for completed/failed calls.
- **Full type safety** — every tool has a Zod schema, dispatcher validates args
  before run, schema failures surface as structured errors.

### Tool categories (the discovery system)

> **2026-06-10 audit correction:** the table that used to live here listed
> the RETIRED 16-category taxonomy (`page`, `interact`, `forms`, `history`,
> `files`, `ask`, `advanced`, `debug`, `cookies`, …) and tool counts that no
> longer matched code — it predated the 2026-05-19 redesign described at the
> top of this file. The authoritative taxonomy is the **14 categories** in
> [src/lib/tools/categories.ts](./src/lib/tools/categories.ts) (`core`,
> `reading`, `interaction`, `tabs`, `capture`, `chrome`, `human`, `memory`,
> `ai`, `demos`, `guidance`, `devtools`, `webmcp`, `desktop`); the live tool
> roster is `pnpm catalog:tools:md` →
> [types/tool-catalog.md](./types/tool-catalog.md). The registry currently
> holds ~169 handlers; the advertised surface is `CANONICAL_SURFACE`
> (~95 names). Don't re-add a hand-maintained table here — it drifts.

The agent only sees the always-on discovery surface upfront; everything
else loads on demand via `load_browser_tools({category})` (server-side
discovery handler).

### Tool list

> **For the authoritative live list, regenerate with `pnpm catalog:tools:md`
> and read [types/tool-catalog.md](./types/tool-catalog.md). Counts and
> rosters drift between releases — the highlights below are the things
> worth knowing about; don't treat them as exhaustive.**

#### Core (always advertised; 13 tools + 15 discovery tools = 28-entry surface)
- `list_browser_tools` — discovery root (returns category index)
- `list_core_tools` — what's in core itself
- `browser_batch` — N read-tier calls in one round trip
- `get_active_tab`, `take_screenshot`
- `read_page` — accessibility tree + ref system
- `find` — natural-language element search returning refs
- `navigate_active_tab`, `navigate` (canonical mega-tool)
- `click_element`, `type_into_element` (accept ref OR selector)
- `computer` (canonical mega-tool: click / type / key / scroll / screenshot
  under one schema)
- `ask_user`

#### Read tier (74 tools total across categories)
- **Page reading:** `get_active_tab`, `get_page_selection`, `read_active_page`
  (full scrape with `deep:true` for lazy loaders), `take_screenshot`,
  `query_elements`, `read_page` (ref system), `find` (NL search),
  `get_page_text` (Readability-style extraction)
- **Surgical inspection:** `find_text_on_page`, `get_page_links`,
  `get_computed_style`, `get_element_at_point`, `inspect_element`
- **Browser context:** `list_open_tabs`, `get_tab_groups`, `get_tab_info`
- **Personal data:** `search_bookmarks`, `list_bookmark_tree`, `search_history`,
  `list_recent_history`, `list_downloads`
- **Forms:** `get_form_fields`
- **Memory:** `get_extension_storage`, `list_extension_storage`
- **On-device AI** (free, on-device, no network — Gemini Nano + siblings):
  `ai_check_availability`, `ai_summarize`, `ai_classify`, `ai_extract_json`,
  `ai_translate`, `ai_detect_language`, `ai_proofread`, `ai_describe_image`
  (multimodal), `ai_check_prompt_injection`
- **Sessions** (optional perm): `list_recently_closed`
- **CDP read** (admin + optional `debugger` perm): `cdp_attached_tabs`,
  `cdp_a11y_tree`, `cdp_perf_metrics`
- **Cookies read** (admin + optional `cookies` perm): `get_cookies`
- **WebMCP** (admin): `webmcp_check_availability`, `webmcp_list_page_tools`

#### Action tier (~62 handlers, including canonical mega-tools)
- **Page interaction (now ref-aware):** `navigate_active_tab`, `click_element`,
  `type_into_element`, `scroll_page`, `wait_for`, `set_clipboard`
- **Keyboard / mouse:** `press_keys`, `hover_element`, `focus_element`,
  `blur_element`, `right_click_element`
- **Form actions (ref-aware):** `select_dropdown_option`, `set_checkbox`,
  `set_radio`, `submit_form`, `file_upload` (NEW — base64 file blobs into
  `<input type="file">` via DataTransfer; bypasses the native dialog the
  agent can't see)
- **Tab control:** `open_new_tab`, `close_tab`, `switch_to_tab`,
  `duplicate_tab`, `pin_tab`, `mute_tab`, `reload_tab`, `go_back`,
  `go_forward`, `set_tab_zoom`, `move_tab`
- **Tab groups:** `create_tab_group`, `add_tabs_to_group`,
  `remove_tabs_from_group`, `update_tab_group`
- **Files / notify:** `download_url`, `cancel_download`, `notify_user`
- **Sessions** (optional perm): `restore_recently_closed`
- **Page archive** (admin + optional `pageCapture` perm): `save_page_as_mhtml`
- **WebMCP** (admin): `webmcp_call_page_tool`

#### Ask-user tier (4 tools)
- `ask_user`, `ask_user_choice`, `ask_user_secret`, `request_user_takeover`,
  `update_plan` — propose a step-by-step plan; user approves before
  execution.

#### Privileged tier (~30 tools, action variants of admin/CDP categories)
- **Page-level (general):** `execute_javascript`, `inject_stylesheet`,
  `remove_stylesheet`, `set_extension_storage`, `desktop_run_command`
- **Cookies write** (admin + `cookies` optional perm): `set_cookie`,
  `delete_cookie`
- **Demos:** `replay_demo` (action; can click / type / submit so always
  asks for confirm) — see Demos category for record/list/describe/delete.
- **CDP** (admin + `debugger` optional perm): `cdp_attach`, `cdp_detach`,
  `cdp_full_page_screenshot`, `cdp_input_click_xy`, `cdp_input_type`,
  `cdp_network_capture_start`, `cdp_network_capture_drain`,
  `cdp_network_capture_stop`, `cdp_network_get_body`, `cdp_print_pdf`,
  `cdp_emulate_device`, `cdp_clear_emulation`, `read_console_messages`,
  `read_network_requests`, `get_request_body` (CDP captures
  `Runtime.consoleAPICalled` + `exceptionThrown`, filterable by level
  and regex)

#### Demos & Guidance — user-saved clues for the agent
- **`demos` (5 tools):** `record_demo`, `list_demos`, `describe_demo`,
  `replay_demo` (privileged), `delete_demo`. Self-healing selector
  chain (matrx-ref → id → testid → ARIA → text → CSS path) survives
  DOM churn between recording and replay.
- **`guidance` (4 tools):** `save_guidance_note`, `list_guidance`,
  `get_guidance_item`, `delete_guidance_item`. Domain-scoped notes,
  screenshots, GIFs, and demo references; auto-attached to the agent's
  context whenever the user opens a tab on the matching domain.
  Captured artifacts are created via the Guidance side-panel tab.

### Side-panel tabs

- **Chat** — current Assistant surface, ships read-only tools to agents
- **Tasks** — research scrape queue, agent-driven mode
- **Agenda** — multi-surface scheduled agent runs. Tasks stored in
  Supabase (`agenda_task` + `agenda_run`). SW alarm scans every minute.
  Triggers: one-shot, interval, cron, context-match, heartbeat.
  - **Ask mode**: SW fires Chrome notification → click opens sidepanel
    + focuses task → user clicks Run-now.
  - **Auto mode**: SW first attempts a sidepanel broadcast
    (`AGENDA_RUN_NOW`). If sidepanel is open, runs immediately, no
    click. If closed, falls back to notification.
  - **Run-now button** (sidepanel) calls `runTask()` which switches the
    sidepanel to chat, primes selectedAgentId + selectedConversationId,
    then sends the task's prompt through the normal chat-stream
    pipeline. Stream events are filtered by runId so a parallel manual
    chat doesn't accidentally finish an agenda run row.
  - **Default agent**: `443dd7ff-e7cc-47b8-907a-0a14834caa48`. Override
    per task via `agent_id`.
  - **Heartbeats**: persistent_conversation_id captured from the first
    run's STREAM_OPENED, then reused on every subsequent run so the
    agent keeps memory across pulses.
  See [src/lib/agenda/](./src/lib/agenda/) and the schema in
  [migrations/2026_05_10_sch_v0.sql](./migrations/2026_05_10_sch_v0.sql).
  Storage layer (2026-05-10): the `agenda_task` / `agenda_run` tables
  were replaced by the kind-agnostic `sch_*` scheduling spine —
  `sch_task` ⋈ `sch_agent_task` (1:1) ⋈ `sch_trigger` (many) ⋈
  `sch_run`. The TypeScript `AgendaTask` / `AgendaRun` types are now
  façade shapes built from those joins; future scheduling kinds
  (workflows, scrapes, webhooks, user-actions) will land as sibling
  `sch_<kind>_task` tables without touching the agenda façade.
- **Scrape** — manual page capture pipeline
- **Data** — pattern picker + apply
- **Guidance** — user-saved clues for the agent: domain-scoped notes,
  screenshot grabs, GIF recordings, demo references. Whatever's saved
  for the current page's domain is auto-attached to every chat sent
  from that domain. Backs the `guidance` tool category.
  **Cloud-synced (2026-06-10, TASK-004):** guidance *metadata* persists to
  `public.wbx_guidance` (not just the artifact bytes in `cld_files`), so it
  follows the user across machines. DB is the source of truth;
  `chrome.storage.local` is an offline cache. Every `saveGuidanceItem` /
  `deleteGuidanceItem` best-effort mirrors to the cloud
  ([src/lib/guidance/cloud-sync.ts](./src/lib/guidance/cloud-sync.ts)); a
  sign-in hydration ([src/hooks/use-guidance-sync.ts](./src/hooks/use-guidance-sync.ts))
  merges cloud→local last-write-wins. Caveat: `demo_ref` bodies don't sync yet
  — see [docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md).
- **SEO** — audit + AI recommendations
- **Notes** — list / search / folder picker / editor for user-authored
  notes (separate from guidance — notes are general personal text;
  guidance is agent-facing clues).
- **Tools** — full visible catalog of every tool, search + filter, JSON
  argument editor, **Run** button per tool that flows through the same
  dispatcher path the agent uses. Use this to test capabilities directly.
- **Settings** — user prefs (no operational controls)
- **Profile** — user account + voice/language preferences (TASK-002).
- **Showcase** (admin today; user-facing once stable) — the driver surface
  for the data-extraction system: 12 sub-tabs (Doctor, Recipes, Prepare,
  Snapshot, JSON-LD, Microdata, Tables, Framework, AI Extract, List
  Pattern, Network, Patterns) over the shared `src/lib/data-pattern/`
  primitives. **2026-06-10 overhaul** (full audit + 11 remediation
  batches; plan at `~/.claude/plans/we-are-having-some-vast-starfish.md`):
  - Shell: horizontal-scroll tab strip (fade edges); ALL sub-tabs
    forceMounted with visibility-gated probes; active sub-tab persisted
    (`useShowcaseTabStore` → chrome.storage).
  - Correctness: rows/detection/source reset on navigation with
    out-of-order guards (`useExtraction`); patterns save under the page
    rows were EXTRACTED on (ExtractionSource threading); append schema
    inferred from the union of all rows with ONE shared key mapper
    (`buildFieldNameMap`) so create/append collision suffixes match.
  - Lifecycle: UNIQUE(user_id,domain,name) on wbx_pattern (migration
    2026_06_10, auto-suffix on conflict), delete/rename inline in
    PatternsTab, recipes live in `public.wbx_recipe` (bundled list =
    seed + offline fallback via `loadRecipes()`).
  - Real re-run for interactive kinds (`runSavedPattern` in
    [src/lib/data-pattern/run-interactive.ts](./src/lib/data-pattern/run-interactive.ts)):
    ai_extract re-runs the agent against the current page; network_capture
    does guided auto re-capture (inject-on-reload taps, 20s window,
    key-path rows). NetworkNoMatchError = guidance, not 'broken'.
  - Agent integration: `data_patterns` mega-tool
    (list/describe/recipes/run/save/delete — registered in tool_def +
    tool_binding + surface defaults, 81 advertised tools), dynamic
    `saved_patterns_for_domain` context key, and "Send to agent" staging
    on every ResultPreview.
  - Hardening: stream watchdog on AI extraction, picker cancel/nav-watch/
    fresh-mount, network capture tab-scoped + 500-event cap, framework
    dump extracted to a tested module (`framework-dump.ts`).
  Verify paths: docs/feature-tests.md → "Showcase — *" entries.
- **Debug** (admin) — verbose logging, telemetry, optional perms toggles

### Catalog generators

- `pnpm catalog:tools` — writes `types/tool-catalog.json` (code-sourced:
  structural contract only)
- `pnpm catalog:tools:md` — adds `types/tool-catalog.md`
- `pnpm docs:tools` — writes `docs/TOOLS.generated.md` **from the DB**
  (`tool_def` joined with `tool_binding` where `executor_name='chrome-extension'`).
  This is the ONLY repo copy of tool descriptions (Rule 4,
  [docs/TOOL_SOURCE_OF_TRUTH.md](./docs/TOOL_SOURCE_OF_TRUTH.md)).

Code-sourced entry: `{ name, tier, input_schema (JSON Schema 7),
required_permissions, surface_bundles }`. Diffable against the DB.
**Descriptions are NOT in code** — they live only in `tool_def` and are read
live for UI via [src/lib/tools/descriptions.ts](./src/lib/tools/descriptions.ts)
(approval card, Tools tab) and the client discovery / WebMCP / frontend-bridge
tools. Never reintroduce a hardcoded `description` on a `ToolHandler`.

### 🗄️ The DB is multi-schema now — `public` is NOT where our tables live

The platform database was reorganized: the single `public` schema was split into
**~48 domain schemas**. Every table this extension touches moved. This is the
highest-risk thing in the repo, because **nothing in the build can see it**:

```
supabase.from('wbx_pattern')          // compiles. builds. passes every test.
                                      // 404s in the user's browser:
                                      //   PGRST205  Could not find the table
                                      //   'public.wbx_pattern' in the schema cache
```

`tsc`, Biome, vitest and `wxt build` are all blind to it — the table name is just
a string. So there is a dedicated gate: **`pnpm check:schema-routing`** (strict
variant runs in CI and blocks `release.sh`).

**Never hand-write `.schema('x')`.** Route through the single source of truth,
[src/lib/supabase/schemas.ts](./src/lib/supabase/schemas.ts):

```ts
import { extendDb, schedulerDb, workbenchDb } from '@/lib/supabase/schemas';
const { data } = await extendDb().from('wbx_pattern').select('*');
```

| Tables | Schema | Accessor |
|---|---|---|
| `wbx_*` (pattern, recipe, capture, guidance, screenshot, seo_audit, highlight) | `extend` | `extendDb()` |
| `sch_task` · `sch_run` · `sch_trigger` · `sch_agent_task` | `scheduler` | `schedulerDb()` |
| `notes` · `note_folders` · `udt_datasets` · `udt_dataset_fields` | `workbench` | `workbenchDb()` |
| `conversation` · `message` · `tool_call` | `chat` | `chatDb()` |
| `user_form_profile` | `users` | `usersDb()` |
| `admins` | `admin` | `adminDb()` |
| `definition` (tool defs) | `tool` | `toolDb()` |
| `model_definition` | `ai` | `aiDb()` |

**RPCs did NOT move — they are all still in `public`.** A schema-scoped client
would route them to the wrong schema. Always call `.rpc()` on the plain
`getSupabase()` client.

#### Ownership columns — there is no blanket rule, and guessing corrupts data

The moved tables adopted a common base-entity template (`organization_id`,
`created_by`, `updated_by`, `version`, `deleted_at`, `visibility`). **But only
some tables dropped `user_id`:**

- **`extend.*` and `workbench.notes` / `note_folders` have NO `user_id` anymore** —
  ownership is **`created_by`**. Filter on that.
- **`scheduler.sch_*`, `admin.admins`, `users.user_form_profile`, and
  `workbench.udt_*` KEPT `user_id`.** Do not "helpfully" rename it.

**On INSERT, never send `created_by` or `organization_id`.** Two BEFORE-INSERT
triggers stamp them: `platform._stamp_actor()` sets `created_by = auth.uid()`, and
`_stamp_org_default()` resolves the actor's personal org via
`ensure_personal_organization()`. `organization_id` is NOT NULL **with no default**,
so this is not optional plumbing — it is the only thing that makes an insert
succeed. RLS `WITH CHECK` (`created_by = auth.uid()`) runs *after* the triggers and
validates the result.

### Database migrations — the DB is the source of truth, NOT the files

A `.sql` file in [migrations/](./migrations/) has changed **nothing** until it is
applied to Supabase (`txzxabzwovsujtloxrus`). This repo ships only the
publishable/anon key and **cannot apply DDL**. All three repos (aidream,
matrx-frontend, matrx-extend) share one DB and one ledger, `public._schema_migrations`.

- **Verify (loud):** `pnpm check:migrations` diffs `migrations/*.sql` against the
  ledger (rows where `source='matrx-extend'`) and screams in a red box about anything
  never applied. Runs as a non-blocking step in `release.sh`; `pnpm check:migrations:strict`
  exits non-zero for CI.
- **Apply + record:** from the **aidream** repo (the one box with DB write creds),
  run `python db/apply_migrations.py --source matrx-extend`. For a one-off, apply via
  the Supabase MCP, then re-run aidream's applier so the ledger records it.
- A migration that must never apply (superseded / destructive / already live) gets
  `-- migrate: skip: <reason>` in its first 25 lines — e.g. `2026_05_03_agenda_v0.sql`
  is skip-marked (superseded by `sch_*`).

### Reference docs

- [`.research/2026-04-30-browser-agent-frontier.md`](./.research/2026-04-30-browser-agent-frontier.md) —
  competitive intelligence, frontier capabilities, 7,102-word research.
- [`.research/tool-db-comparison-task.md`](./.research/tool-db-comparison-task.md) —
  spec for the agent that will diff our catalog against `public.tools` in
  Supabase. Hand to a DB-connected agent; result → `tool-db-comparison-result.md`.

---

## 🚧 Roadmap — frontier capabilities

> Ordered by leverage / risk. ✅ shipped · 🔨 in progress · 📋 planned.

### 1. ✅ Foundation — full tool harness
Done: 96 tools, dispatcher, approval UI, Tools tab, catalog, research,
admin-only filtering, optional-permission gating.

### 2. ✅ On-device AI (`chrome.ai` / Gemini Nano Prompt API)
**Why:** free, offline, multimodal, JSON-Schema response constraints. Speed
doesn't matter when it's free and runs in the background.

Tools shipped:
- [x] `ai_check_availability` — probe per-API availability
- [x] `ai_summarize` — Summarizer API w/ languageModel fallback
- [x] `ai_classify` — JSON-Schema-constrained classifier
- [x] `ai_extract_json` — schema-constrained structured extraction
- [x] `ai_translate` — Translator API w/ auto-detect
- [x] `ai_detect_language` — LanguageDetector API
- [x] `ai_proofread` — Proofreader API w/ languageModel fallback
- [x] `ai_describe_image` — multimodal (text + image) prompt
- [x] `ai_check_prompt_injection` — guardrail for untrusted page content

Implementation: `src/lib/onbox-ai/client.ts` — feature-detects across
multiple known API shapes (`globalThis.LanguageModel`, `window.ai`,
`chrome.aiOriginTrial`); each tool returns
`{ ok: false, availability: 'unavailable' }` when the API is missing so the
agent can fall back to cloud.

### 3. ✅ `chrome.debugger` + CDP (the master key) — admin-only
**Why:** single permission collapses 5+ capability gaps competitors avoid.
The "is being debugged" banner is the friction; we make it graceful.

Tools shipped (all admin-only + require `debugger` optional permission):
- [x] `cdp_attach`, `cdp_detach`, `cdp_attached_tabs`
- [x] `cdp_full_page_screenshot` — `Page.captureScreenshot` w/ `captureBeyondViewport`
- [x] `cdp_a11y_tree` — `Accessibility.getFullAXTree`
- [x] `cdp_network_capture_start` / `_drain` / `_stop` — buffered Network
      events with lazy body fetch via `cdp_network_get_body`
- [x] `cdp_input_click_xy` — `Input.dispatchMouseEvent` (bypasses shadow DOM,
      OOPIFs)
- [x] `cdp_input_type` — `Input.insertText`
- [x] `cdp_print_pdf` — `Page.printToPDF`
- [x] `cdp_perf_metrics` — `Performance.getMetrics`
- [x] `cdp_emulate_device` / `cdp_clear_emulation` — viewport + UA override

UX shipped:
- [x] `debugger` in `optional_permissions`; runtime-grant from Settings →
      Advanced agent capabilities
- [x] Dispatcher gate — tools that need `debugger` return a structured
      "permission not granted" error if the toggle is off
- [x] Admin-only filtering — non-admin users never see CDP tools advertised

UX still planned:
- [ ] Visible "Debugging tab N — stop" badge in side panel when attached
- [ ] Auto-detach after stream ends
- [ ] `cdp_dom_snapshot` (`DOMSnapshot.captureSnapshot`)
- [ ] `cdp_emulate_geolocation`

### 4. 🔨 WebMCP — `navigator.modelContext.registerTool`
**Why:** Chrome 146 (Feb 2026); first-mover window still open.

Shipped:
- [x] `webmcp_check_availability` — read · feature-detect API + count page tools
- [x] `webmcp_list_page_tools` — read · enumerate page-registered tools
- [x] `webmcp_call_page_tool` — action · invoke a page-registered tool
- [x] `src/lib/webmcp/register.ts` — `registerToolsOnActiveTab()` ready to
      register every pilot-bundle tool via `navigator.modelContext.registerTool`
      (built; not yet auto-invoked)

Still planned:
- [ ] Auto-register on tab activation (postMessage bridge: page → SW)
- [ ] postMessage listener on the page side that forwards `__matrx_webmcp_call`
      messages into the SW dispatcher and replies with results

### 5. ✅ Self-healing selectors + deterministic replay
Shipped via the Demos category (`record_demo`, `list_demos`,
`describe_demo`, `replay_demo`, `delete_demo`): record a workflow once,
replay with parameter substitution. Self-healing chain
(matrx-ref → id → testid → ARIA → text → CSS path) survives DOM churn
between recording and replay. `replay_demo` is privileged.

Future extensions:
- [ ] Skill-level abstraction: `replay_skill(skill_id, args)` that
      composes multiple demos into one named workflow
- [ ] On replay miss: broadcast a "selector broken" event so the agent
      can re-derive without aborting

### 6. ✅ Cross-tab parallel orchestration
**Why:** "compare these 5 tabs" — fan out, materialize in side panel.
Already have `list_open_tabs` + per-tab actions; needs an orchestrator.

Shipped:
- [x] `parallel_for_each_tab(tab_ids, sub_prompt, ...)` — admin-only,
      action-tier tool ([src/lib/tools/handlers/parallel.ts](./src/lib/tools/handlers/parallel.ts))
      that fans out N child agent streams (max 8), one per tab, each pinned
      via `recordAssignedTab` BEFORE the SSE opens. `Promise.allSettled`
      so one tab failing doesn't kill the rest. Per-sub-run wall-clock
      timeout aborts via STREAM_KILL. Three merge strategies: `per_tab`
      (default), `concat`, `json_array`.
- [x] UI for showing parallel runs side-by-side: small status panel
      ([src/features/tasks/ParallelRunsPanel.tsx](./src/features/tasks/ParallelRunsPanel.tsx))
      mounted at the top of the Tasks tab. Live X-of-N progress, expandable
      per-sub-run row showing status pill + accumulated text + error.
      Bridge listens for `PARALLEL_RUN_EVENT` broadcasts so the SW-side
      handler stays sidepanel-agnostic. Full N-column live timeline grid
      remains a follow-up; this smaller panel covers the core "is it
      working?" need.

### 7. ✅ Privileged additions — cookies, pageCapture, sessions
Shipped:
- [x] `get_cookies` (read, admin) · `set_cookie` / `delete_cookie` (privileged,
      admin) — `cookies` optional permission
- [x] `save_page_as_mhtml` (action, admin) — `pageCapture` optional permission
- [x] `list_recently_closed` (read) · `restore_recently_closed` (action) —
      `sessions` optional permission

### 8. ✅ Cryptographic run receipts
**Why:** killer feature for compliance / regulated verticals. Auditor needs
chain-of-custody.

Shipped:
- [x] Sign every tool call (callId + args hash + output hash + timestamp +
      runId + conversationId) with a device-bound WebCrypto Ed25519
      keypair persisted in `chrome.storage.local` (key
      `matrx.audit.deviceKey`). Both partial (start) and full (completion)
      receipts are emitted so even crashed calls leave a trail. See
      [src/lib/audit/](./src/lib/audit/).
- [x] Append to local audit log (`matrx.audit.log`) — FIFO ring capped at
      1000 entries. `appendReceipt` is fire-and-forget and best-effort;
      signing failures never block tool execution. Backend push is
      future work — receipts can already be exported individually.
- [x] Export receipt as JWS compact-serialization (RFC 7515, `alg=EdDSA`,
      `kid=publicKeyId`) via `exportReceiptJws`. The receipt body also
      carries an in-line ed25519 signature over its canonical-JSON form
      so an exported JSON row stays verifiable against the public-key
      history without any external library.
- [x] "Show receipt" Shield-icon button on every `ToolTimelineRow`
      (hover-reveal, same pattern as `CopyToolButton`). Opens a modal
      showing the JSON, signature-verification status, and Copy-JSON /
      Copy-JWS buttons. Settings → Advanced agent capabilities → Audit
      key card lets the user view the active public-key ID, re-key
      (confirmation-gated, retains the previous key in
      `matrx.audit.publicKeyHistory` so prior receipts still verify),
      and export the active public key JWK to the clipboard.
- [x] **Schema v2 + full path coverage (2026-05-07).** Receipt schema
      bumped to `v: 2` with an optional `origin` tag (`agent`, `pilot`,
      `parallel`, `webmcp`). The verifier accepts BOTH v1 and v2 — old
      receipts in existing audit logs continue to verify; their absent
      `origin` is preserved during canonical-JSON re-serialization so
      the original signature still matches. The WebMCP path
      (`handleWebmcpCall`) now emits its own partial + completed
      receipts (origin='webmcp') — that path bypasses the streaming
      dispatcher's chunk listener so it previously had no audit
      coverage. The streaming dispatcher classifies origin per call:
      runId starts with `parrun-` → 'parallel'; conversation matches an
      active Pilot session → 'pilot'; otherwise 'agent'. The Audit-key
      card in Settings now shows the last 20 receipts with a chip-set
      origin filter so admins can confirm coverage across every tool
      execution path. Unit tests in `tests/unit/receipt.test.ts` cover
      every origin tag plus a v1-shape backward-compat case.

### 9. ✅ Pilot tab + tab-group sandbox
**Why:** the user wanted two surfaces — Assistant (Chat) and Pilot
(drives the browser in its own tab group). Pilot is admin-only initially
per the experimental → admin first → GA convention.

Shipped:
- [x] New `<PilotView>` ([src/features/chat/PilotView.tsx](./src/features/chat/PilotView.tsx))
      cloning the ChatView render tree (intentional — the two surfaces will
      diverge as Pilot grows plan-mode / receipts / sub-task spawning).
      Uses `surface: 'pilot'` in the browser-dom state so the server-side
      discovery handler can route the full read+action+ask kit. Defaults
      to 'act' permission mode — Pilot is meant to be more autonomous.
- [x] Pilot session state ([src/state/pilot.ts](./src/state/pilot.ts)) —
      zustand + chrome.storage.local. `startSession({agentId})` creates
      a fresh tab group seeded with the active tab, paints it blue +
      titles it "Pilot", latches `{groupId, windowId, agentId, startedAt}`.
      `endSession()` queries every tab in the group and removes them
      (Chrome auto-deletes the empty group).
- [x] Dispatcher group scoping ([src/lib/tools/dispatch.ts](./src/lib/tools/dispatch.ts)
      `enforcePilotGroupScope`). When a session is active, action / privileged
      tools whose `assignedTabId` lives outside the group return a
      structured `pilot_group_violation` error. Read-tier tools are unrestricted
      (introspection across the user's other tabs is still useful).
- [x] `parallel_for_each_tab` group enforcement
      ([src/lib/tools/handlers/parallel.ts](./src/lib/tools/handlers/parallel.ts)) —
      every tab id in the args must belong to the active session's group.
      Up-front rejection avoids spawning N child agents only to fail mid-flight.
- [x] Lifecycle listeners
      ([src/lib/background/bootstrap.ts](./src/lib/background/bootstrap.ts)
      `registerPilotLifecycleListeners`). `chrome.tabGroups.onRemoved`
      and `chrome.tabs.onRemoved` watch for external dissolution
      (last tab closed manually, group ungrouped via right-click) and
      reset the persisted session record so the Pilot view doesn't
      stay stuck.
- [x] Sidepanel tab registration
      ([src/entrypoints/sidepanel/App.tsx](./src/entrypoints/sidepanel/App.tsx)) —
      Crosshair icon (emerald accent) next to Chat. Admin-gated.
- [x] Parallel pilot chat store + stream hook
      ([src/state/pilot-chat.ts](./src/state/pilot-chat.ts),
      [src/hooks/use-pilot-chat-stream.ts](./src/hooks/use-pilot-chat-stream.ts))
      so the Pilot conversation thread is independent of the Assistant's
      messages — switching tabs in the side panel doesn't blur the two
      conversations.

### 10. ✅ Manifest hygiene
Shipped:
- [x] `optional_permissions`: `debugger`, `cookies`, `pageCapture`,
      `userScripts`, `proxy`, `webRequest`, `desktopCapture`, `topSites`,
      `management`
- [x] Added to base: `sessions`
- [x] Add to base: `system.cpu`, `system.memory`, `system.display`,
      `declarativeNetRequestWithHostAccess` (2026-05-07; initially
      preemptive). **2026-05-08: wired to real consumers** so the CWS
      reviewer's "declared but unused" rule isn't tripped — the same
      rule that flagged `contextMenus` on the v0.1.4 published build.
      `chrome.system.cpu/memory/display` are exercised by the new
      admin-only `get_system_info` diagnostic tool; the DNR permission
      is exercised by `list_network_blocking_rules`. Both live in the
      `debug` category, read-tier, no side effects. Handlers in
      [src/lib/tools/handlers/system-info.ts](./src/lib/tools/handlers/system-info.ts).

Reverted (UX regression):
- [ ] Move `<all_urls>` to `optional_host_permissions` — REVERTED
      2026-05-08. Real applications don't ask users to go into
      chrome://extensions to grant permissions; `<all_urls>` is back
      in base `host_permissions`. The runtime gate
      (`requires_broad_host_access` flag, `_host-access.ts` helper, the
      `startContentScriptRegistrar` runtime CS bootstrap, and the
      Settings → Advanced "All sites access" toggle) was removed.
      Tools that previously refused with "Open Settings → Advanced
      agent capabilities → 'All sites access'" now run unconditionally
      because the broad host grant is unconditional from install.

### 11. 🔨 Voice loop (TASK-002)
**Why:** parity with the Next.js app's voice features and hands-free
agent operation.

Engineering complete; perceptual QA outstanding.

- [x] **TASK-002a** — STT/TTS endpoints (Cartesia + Groq) wired through
      `https://aimatrx.com/api/cartesia` and `/api/audio/transcribe[-url]`
      with Supabase Bearer auth.
- [x] **TASK-002b** — Translation via on-device Gemini Nano
      (`ai_translate`) with server-side fallback if Nano unavailable;
      mic button in `ChatView` Composer wired to `useRecordAndTranscribe`
      with live-streaming transcript into the textarea and red-pulse +
      audio-level glow while recording.
- [x] **TASK-002b-fix** — Offscreen-document refactor (MV3 sidepanel
      can't reliably `getUserMedia`; capture moved to offscreen w/
      reason `USER_MEDIA`); new `MIC_REQUEST → MIC_RUN → MIC_EVENT`
      channel flow; `useVoicePrefsStore` (zustand → chrome.storage) for
      voice / language / speed.
- [x] **TASK-002c** — Speaker button on agent message bubbles +
      language picker in chat header / settings (shipped in 7950b12).
- [ ] **TASK-002d** — **PENDING (human-only perceptual QA across en/es/fr/fa/zh/ru)**

### 12. 📋 Vision-first navigation, timeline scrubbing
Moonshots from the research. Defer until 1–11 ship.

### 13. ✅ Incremental tool progress (2026-05-20)
**Why:** long-running tools (research, multi-page scrapes) showed only a
spinner. Now they can stream live status.

- Opt-in + additive: a tool that emits no progress renders exactly as before.
- Wire: server tools emit a `tool_progress` tool_event sub-event
  (`{event:'tool_progress', call_id, tool_name, data:{label?, step?, status?,
  percent?}}`); client (SW) handlers call `ctx.reportProgress('…')` (optional
  field on `ToolContext`, broadcast as a `TOOL_TIMELINE_EVENT` with a
  `progress` field). Both paths funnel into `appendToolProgress` on the chat
  store (FIFO-capped at 200; `ToolPartCall.progress[]`).
- Display: [`ToolProgressView`](./src/features/chat/tool-display/ToolProgressView.tsx)
  renders ONLY when entries exist. Generic default = a running log that
  collapses to "N updates" on completion (used by the default rows too, so an
  unregistered tool still gets it). Registry `progress` config customizes:
  `mode: 'log' | 'latest' | 'steps'`, `visibleWhileRunning`, `showWhenComplete`.
- Normalizer: [`progressFromWire`](./src/lib/chat/tool-progress.ts).

### 14. 🔨 Stream resilience — stall watchdog + resume (2026-05-20)
**Why:** if the offscreen doc died / network hung / server went silent with no
terminal `done`, `isStreaming` stayed true and the spinner spun forever.

Shipped (client):
- [`createStreamWatchdog`](./src/lib/stream/watchdog.ts) — dead-man's switch.
  Any chunk (incl. the server `heartbeat` event, now consumed as liveness)
  resets it; 75s of total silence fires `onStall`. Wired into both
  `use-chat-stream` and `use-pilot-chat-stream` (`start` on send, `touch` per
  chunk + on `STREAM_OPENED`, `stop` on done/cancel).
- Assistant surface: on stall, clears the spinner + shows a Retry banner
  (`StreamInterruptionBanner` in ChatView, gated on
  `useChatStore.streamInterruption`). Retry replays the last turn. Pilot clears
  the spinner (no banner yet).

Pending (backend — filed via matrx-feedback, contract in
[docs/STREAM_RESUME_PROTOCOL.md](./docs/STREAM_RESUME_PROTOCOL.md)):
- [ ] `/ai/agent/runs/{request_id}/resume` so `attemptResume`
  ([src/lib/stream/resume.ts](./src/lib/stream/resume.ts), flag-gated no-op
  today) can re-attach + replay the unsent tail instead of replaying the turn.
- [ ] Reliable `heartbeat` cadence (≤~20s) DURING long tool execution.

### 15. ✅ Turn-boundary inbox — queue/steer a running agent (2026-05-20)
**Why:** stop forcing "wait for the agent to finish before I can type" and
"cancel the whole run just to add a note." Server contract:
[docs/TURN_BOUNDARY_INBOX.md](./docs/TURN_BOUNDARY_INBOX.md).

Shipped (client, Assistant Chat only):
- [x] While streaming, the composer's send button becomes a distinct
      indigo→violet gradient + clock-badge button (the Stop square stays
      alongside). Enter/click POSTs to `/ai/conversations/{id}/inbox`
      (`enqueueInboxMessage` in [routes/ai.ts](./src/lib/api/routes/ai.ts))
      instead of starting a second run. `submitMessage` branches on
      `isStreaming`; guarded until a conversation id is adopted.
- [x] A "waiting its turn" card floats above the input — drifting gradient
      (`animate-dreamy-drift`), pulsing dot, live timer. State in
      [src/state/turn-inbox.ts](./src/state/turn-inbox.ts) (ephemeral); UI in
      [src/features/chat/QueuedMessageCard.tsx](./src/features/chat/QueuedMessageCard.tsx).
- [x] Retract (×) and edit (pencil) on a pending card — `cancelInboxMessage` /
      `editInboxMessage` (DELETE / PATCH), 409-on-drained handled gracefully.
- [x] On the stream's `injection_consumed` (now typed —
      `InjectionConsumedEvent`), the message drops into the transcript as a
      user bubble inserted just ABOVE the still-streaming assistant message
      (`insertMessageBefore` on the chat store) and the card flips to
      "Delivered" then fades. Reads server-echoed `text` + honors
      `is_visible_to_user` (defensive — deployed schema lags the contract).
      `info code=inbox_continue` is logged.

Shipped (2026-05-22):
- [x] **Interrupt / "stop & send"** — the server delivered this NOT as
      abort-mid-syscall (correctly rejected as fragile) but as a clean cut that
      keeps the partial: aborting the stream makes the server persist the
      partial assistant turn + an auto `[⚠️ Response interrupted…]` marker, and
      the fresh run loads that history and answers the redirect. Client wiring:
      `interruptAndSend()` in [use-chat-stream.ts](./src/hooks/use-chat-stream.ts)
      (abort → 350ms grace so the partial flushes → normal send) behind a third
      composer affordance — the amber→rose stop-badge button, distinct from the
      indigo (waiting) queue send and the plain Stop. No special endpoint; no
      client-supplied partial. Also dropped the #2 defensive casts in
      `handleInjectionConsumed` now that the deployed `ConsumedInjection` schema
      carries `text` + `is_visible_to_user`. See
      [docs/SERVER_NEEDS_turn_boundary_inbox.md](./docs/SERVER_NEEDS_turn_boundary_inbox.md).

Deferred / not wired:
- [ ] `listPendingInboxMessages` (GET) exists but isn't auto-called — reopening
      the side panel starts a fresh chat here, so there's no live run to
      rebuild cards for. Kept for future surfaces.
- [ ] Wire Pilot surface (own composer + `use-pilot-chat-stream`).

---

## 📐 Architecture cheat sheet

```
sidepanel (React) ──STREAM_START──▶ SW ──STREAM_RUN──▶ offscreen
                                     │                    │
                                     │                    └─ holds long SSE
                                     │                       (SW dies > 30s)
                                     │
                              startToolDispatcher
                              subscribes STREAM_OPENED + STREAM_CHUNK
                              on tool_started:
                                - validate args (Zod)
                                - permission gate (tier × mode)
                                - run handler
                                - POST /conversations/{id}/tool_results
                                - broadcast TOOL_TIMELINE_EVENT
                              ◀──STREAM_CHUNK── all surfaces
```

- **`src/lib/tools/types.ts`** — `ToolHandler<T,R>`, tiers, `ToolContext`
  (includes `assignedTabId` so handlers stick to the agent's tab).
- **`src/lib/tools/registry.ts`** — `lookup`, `assistantToolNames`,
  `pilotToolNames`, `pilotToolNamesWithPrivileged`.
- **`src/lib/tools/dispatch.ts`** — SW dispatcher.
- **`src/lib/tools/handlers/*.ts`** — one file per domain (read, action,
  user, tabs, forms, keyboard, inspect, browser-data, downloads, privileged).
- **`src/lib/tools/handlers/_active-tab.ts`** — shared
  `getAssignedTab(ctx)` / `getAssignedTabId(ctx)` helpers that prefer
  `ctx.assignedTabId` and fall back to `chrome.tabs.query({active:true})`.
  All handlers use this — never re-introduce a local active-tab query.
- **`src/lib/tools/catalog.ts`** — JSON Schema generation.
- **`src/state/tool-inbox.ts`** — sidepanel-side pending confirms / asks /
  timeline.
- **`src/features/chat/Agent*Card.tsx`** — inline approval / ask-user UI.
- **`src/features/tools/ToolsView.tsx`** — visible catalog + manual test runner.

---

## 🔌 Server integration — capability-based agent API (2026-05-01)

We migrated to the new capability-based shape. The extension is the first
client built directly against it; no legacy compatibility.

**Authoritative wire contract:** [docs/REQUEST_PAYLOAD_CONTRACT.md](./docs/REQUEST_PAYLOAD_CONTRACT.md)
documents every field in `context` and `client.state["browser-dom"]`,
how tab id flows through both payloads, and what's conditional vs.
always-attached. **Update that doc in the same commit any time you add,
rename, or drop a key — engineers template `{{page_brief.title}}` into
prompts and the discovery handler reads `client.state["browser-dom"]`
field-by-field.**

**Request shape** (every chat send):

```ts
POST /ai/agent/{agent_id}
{
  user_input,
  conversation_id,
  context,                   // big rich page facts (~50 keys)
  variables,
  client: {
    capabilities: ["browser-dom"],
    state: {
      "browser-dom": {        // small orchestration metadata (~12 keys)
        current_url, current_tab_id, current_window_id, page_title, page_lang,
        tab_status, surface, is_admin, permission_mode, desktop_bridge,
        onbox_ai_available, optional_permissions_granted, open_tab_count,
        extension_version, extension_id, loaded_categories,
      },
    },
  },
}
```

**Discovery loop:**

1. Server registers `browser-dom` capability with one always-on tool:
   `load_browser_tools`.
2. Model calls `load_browser_tools({ category: "page" | "interact" | … })`.
3. Server-side handler reads `state["browser-dom"]` (admin? perms granted?
   desktop bridge?), looks up `category_routing[category]` from the handoff
   manifest, filters, and calls `ctx.queue_tool_changes(add=[...], remove=["load_browser_tools"])`.
4. Orchestrator drains the mutation; next iteration the model has the new
   tools loaded.
5. Server emits `RESOURCE_CHANGED kind=active_tools`; extension listens and
   updates the Tools-tab badge + records the loaded category in
   `useActiveToolsStore` so the next request can hint `loaded_categories`.

**Cross-turn limitation (current):** tool mutations are per-request only.
Each new user message restarts with `[load_browser_tools]`. Discovery is
cheap (server-side lookup, no LLM round-trip), so re-running per turn is
acceptable. Cross-request persistence is on the server-team's roadmap; no
extension changes needed when it lands.

**Where tool definitions live (May 2026 redesign):**

- **Canonical source of truth:** `public.tool_def` rows in the aidream
  DB (renamed from `public.tools` / `public.tl_def` in the 2026-05-27
  refactor), with ownership on `public.tool_binding`
  (`executor_name='chrome-extension'`) — not on a column. The original
  118 tools landed via the 0022 seed migration; ongoing changes go
  through admin API or SQL seed PRs against aidream.
- **Local handlers:** `src/lib/tools/handlers/*.ts` (unchanged).
- **Wire-format aliasing:** [`src/lib/tools/aliases.ts`](./src/lib/tools/aliases.ts)
  strips `matrx-extend__` and bundle prefixes, plus a small map for
  legacy `browser_*` names.
- **Migration guide:** [docs/MATRX_EXTEND_MIGRATION_GUIDE.md](./docs/MATRX_EXTEND_MIGRATION_GUIDE.md)
  has the full PR-by-PR playbook.
- **Retired:** `types/server-handoff/browser-dom-capability.json` and
  `buildServerCapabilityHandoff()` — aidream no longer reads them.
- **Still emitted (dev/debug only):** `pnpm catalog:tools` writes
  `types/tool-catalog.json` (structural contract — no descriptions) for the
  matrx-extend-tool-display skill. The in-extension Tools tab reads tool
  descriptions LIVE from the DB (`src/lib/tools/descriptions.ts`). Not
  authoritative for aidream.
- **Tool descriptions (Rule 4):** live ONLY in `tool_def`. The repo's single
  copy is the auto-generated `docs/TOOLS.generated.md` (`pnpm docs:tools`). No
  hardcoded descriptions in handlers; UI/discovery read them live.

## 👤 Guest mode (2026-05-16)

The extension lets unauthenticated users open the side panel and chat
immediately — no sign-in required. The intent is keeping-honest-people-honest:
clearing chrome.storage is a free reset, but the install-bound signature
is stable enough to enforce reasonable rolling limits while the user is
inside our funnel.

**Surface:**
- [`AuthGate`](./src/components/AuthGate.tsx) is now a pass-through
  wrapper (legacy name kept for compatibility). It no longer blocks.
- [`GuestBanner`](./src/components/GuestBanner.tsx) renders at the top
  of [`ChatView`](./src/features/chat/ChatView.tsx) when no user is
  signed in. Two CTAs: in-place Sign in (OAuth) + Sign up free (opens
  aimatrx.com via `chrome.tabs.create`).
- [`App.tsx`](./src/entrypoints/sidepanel/App.tsx) hides every tab
  except `chat` + `settings` for guests via the `showFullTabs` gate.
  Bounces the active selection back to `chat` if the user lands on a
  hidden tab. Admin tabs (Pilot / Showcase / Debug) keep their existing
  `isAdmin` gate — guests are not admins.

**Identification:**
- [`src/lib/auth/guest-signature.ts`](./src/lib/auth/guest-signature.ts)
  produces a stable 64-char hex signature:
  `sha256(chrome.runtime.id | nonce | createdAt)`. The nonce is a
  32-byte random minted once on first read and persisted in
  `chrome.storage.local`. Cached in-memory and via storage so the SW,
  sidepanel, and offscreen all see the same value. Concurrent callers
  share an in-flight promise so we never mint two nonces in a race.
- Outbound paths inject `X-Fingerprint-ID: <signature>` whenever the
  caller has no Bearer token:
  - [`src/lib/api/client.ts`](./src/lib/api/client.ts) `buildHeaders()` —
    REST.
  - [`src/lib/stream/offscreen-proxy.ts`](./src/lib/stream/offscreen-proxy.ts) —
    SSE streams.
  - `parallel_for_each_tab` is admin-only so admins are always signed
    in; that path keeps its strict token requirement.
- The request body's `client.state["browser-dom"].is_guest` mirrors the
  header by reading the same `getAccessToken()` result — they cannot
  drift.

**Server identification & gating:**
- aidream's `matrx_connect` AuthMiddleware (already in place) reads
  `X-Fingerprint-ID`, calls `resolve_guest_uuid()` which finds or mints
  an anonymous `auth.users` row, and sets `ctx.auth_type='fingerprint'`.
  No backend change required to make this path work.
- Model tier swap: migration `0045_guest_mode_and_model_tiers.sql` adds
  `ai_model.mid_fallback_id` + `ai_model.guest_fallback_id`. When a
  guest hits an agent whose model has a `guest_fallback_id`, the helper
  `aidream/api/utils/model_tier_swap.py` swaps `config.model` in place
  and records the original on `ctx.metadata['original_model']`. Wired
  into `agent_run.py` between `agx.load_for_execution` and the
  conversation resolution.
- Usage tracking: the same migration creates `cx_user_usage_summary`
  plus an `AFTER INSERT/UPDATE` trigger on `cx_user_request.completed_at`.
  The trigger maintains 6-hour and 24-hour rolling windows of (requests,
  tokens, cost in millicents) per user plus a frozen `auth_type` (probed
  against `guest_executions`). Request-time enforcement reads via
  `fn_get_user_usage_snapshot(user_id)` — O(1).
- Sign-up conversion: when a guest signs in, `link_guest_to_user()` in
  the existing `guest_registry` stamps `converted_to_user_id`. The
  user_id stays stable so usage history and conversations carry over.

**Operator notes:**
- After applying migration 0045, run `python db/generate.py` to
  regenerate the ORM. `swap_model_for_auth_tier` uses defensive
  `getattr(..., None)` so it no-ops cleanly during the gap.
- The migration's tail UPDATEs use `provider ILIKE / name ILIKE` to
  populate fallbacks for Opus / Sonnet / GPT-5+ / Gemini Pro. Tighten
  the WHERE clauses or replace with literal IDs as the model registry
  grows. The fallback target IDs are hardcoded (Sonnet 4.6 / Haiku 4.5
  / GPT-5 mini / gpt-4.1-mini / Gemini 3 Flash Preview).
- Enforcement is intentionally NOT yet wired — the trigger populates
  the summary, the swap downgrades premium models, but no 429 is
  returned today regardless of cost. Add a `Depends(enforce_usage_quota)`
  on `/ai/agent/{id}` once the summary has produced enough real data to
  pick limit values.

---

## ⚠️ Web Store identity gotcha (v0.1.4 incident)

**The Chrome Web Store replaces the manifest's `key` field on upload with
its own keypair.** Our local dev build uses the `key` in `wxt.config.ts`
to produce ID `cihdmkcdjjckfhjpgoedmgfpoljebaml`; the published v0.1.4
runs under the Store-assigned `hnfolienncfklkgmdjjmhhegglimlamg`. They
are independent and will never converge.

**Auth implication:** every `chrome.identity.getRedirectURL()` call
returns `https://<install-id>.chromiumapp.org/`. Supabase rejects the
authorize call when that URI isn't on its allowlist, with the
near-instant error "Authorization page could not be loaded".

**Required posture:**
- `EXPECTED_EXTENSION_IDS` in [`src/config/identity.ts`](./src/config/identity.ts)
  lists every install ID we expect to see (dev + Web Store + any future
  beta channels).
- The same list of `https://<id>.chromiumapp.org/` URIs must be registered
  in **Supabase → Authentication → URL Configuration → Redirect URLs**.
  These two lists are the same set; if they drift, sign-in dies.
- `logExtensionIdentityOnce()` runs on every SW + sidepanel boot. Drift
  surfaces as a `warn`-level `auth` log and as the red Debug-tab
  identity card.
- Adding a new build channel = ONE PR (add ID to the list) + ONE
  Supabase config change (add the URI). Both must land before the new
  channel ships to users.

Full incident write-up: [`.research/v0.1.4-auth-incident.md`](./.research/v0.1.4-auth-incident.md).

## 📜 Conventions

- **Admin-only experiments**: when a new capability could break things,
  duplicate it as admin-only first (filter from non-admin tool advertisement).
  Promote to general-availability after the user has tested.
- **Optional permissions**: anything that scares the install dialog goes
  in `optional_permissions` and is requested at runtime via
  `chrome.permissions.request` from a Settings toggle.
- **Feature detection**: every API touched gracefully degrades. If
  `chrome.ai`, `navigator.modelContext`, `chrome.debugger`, etc. are missing,
  the tool returns `{ ok: false, reason: 'unavailable' }` rather than throwing.
- **No silent writes**: privileged tier always prompts. Even in Act mode.
- **Tab context: never query the active tab directly from a handler**
  — use `getAssignedTab(ctx)` / `getAssignedTabId(ctx)` from
  [`src/lib/tools/handlers/_active-tab.ts`](./src/lib/tools/handlers/_active-tab.ts).
  These prefer `ctx.assignedTabId` (latched at user-message-send time)
  and fall back to `chrome.tabs.query({active:true, currentWindow:true})`
  only when no assignment is recorded. This is what keeps the agent
  pinned to its tab even when the user switches focus mid-execution.
  If you need to *list* tabs (not "the current one") that's fine —
  e.g., `list_open_tabs` legitimately calls `chrome.tabs.query({})`.
- **Active tab for request assembly: resolve ONCE per send.** The chat
  hooks call `resolveActiveTab()` from
  [`src/lib/chat/active-tab.ts`](./src/lib/chat/active-tab.ts) at the
  top of the send and thread the `chrome.tabs.Tab` through
  `buildChatContext`, `buildBrowserDomState`, and `STREAM_START.assignedTabId`.
  Never re-query inside a context builder — a second query reintroduces
  the cross-tab race where `page_brief.tab_id` and
  `client.state["browser-dom"].current_tab_id` end up referencing
  different tabs. See [docs/REQUEST_PAYLOAD_CONTRACT.md §1](./docs/REQUEST_PAYLOAD_CONTRACT.md).
- **Catalog stays in sync**: after any handler change, run
  `pnpm catalog:tools:md` and commit the regenerated JSON + MD, and
  `pnpm docs:tools` to refresh the DB-sourced `docs/TOOLS.generated.md`.
- **Tool descriptions live ONLY in the DB** (Rule 4,
  [docs/TOOL_SOURCE_OF_TRUTH.md](./docs/TOOL_SOURCE_OF_TRUTH.md)): never add a
  `description` to a `ToolHandler` or a `.describe()` to its Zod args. UI and
  discovery read descriptions live via
  [src/lib/tools/descriptions.ts](./src/lib/tools/descriptions.ts) — which
  queries `public.tool_def` directly via Supabase REST (the older aidream
  `GET /ai-tools/app/matrx-extend` endpoint was retired in the 2026-05-27
  refactor since `source_app` is no longer a column). To change a tool,
  change `tool_def` first (admin API / migration), then bring the Zod into
  line until `pnpm catalog:tools:drift` is quiet. There is no code→DB sync.
- **Document tests for everything user-visible**: when you add or
  meaningfully change any tool, UI surface, or feature, add or update
  its entry in [`docs/feature-tests.md`](./docs/feature-tests.md)
  before committing. Keep entries SHORT and SPECIFIC — exact steps a
  human can follow without reading source code. Each entry: *what it
  does* (one sentence) → *where to test* (Tools tab / SEO tab / etc.) →
  *steps* (numbered) → *expected* → *edge cases worth poking*.
  This file is the single source of truth for "how do I verify X?";
  letting it drift means future agents (and humans) waste hours
  rediscovering test paths.
- **Reuse existing capabilities first**: before building a new
  extractor / collector / parser, search for prior art. Look in
  `src/lib/scrape/` (collectors), `src/lib/data-pattern/modes/`
  (extraction modes used by Showcase tabs), `src/lib/chat/context/`
  (the v2 context bundle), and `src/features/showcase/tabs/`. When the
  existing pipeline already does what you need, route through the same
  primitive — agents and the user-facing UI then share one code path
  (improvements to either side benefit both). Cross-working is the
  goal; duplication is a smell.
- **`chrome.scripting.executeScript` args must be JSON-serializable** —
  `undefined` is NOT, and Chrome will reject the call with
  `Error at property 'args': Error at index N: Value is unserializable`
  before your script runs. When a Zod-optional field has no `.default()`,
  it can arrive as `undefined`. Coerce with `?? null` at the call site
  and type the inner func param as `string | null` (not `string | undefined`).
  Same rule for the inner func — when checking, use `value !== null`, not
  `value !== undefined`. Bit me on `select_dropdown_option` (2026-05-03);
  every existing handler is now null-coerced.
- **Env vars: literal access only, deferred via getters** — `src/config/env.ts`
  has TWO non-obvious constraints that pull in opposite directions and
  bit us on 0.1.7 → 0.1.8 → 0.1.9:
    1. **Vite only replaces LITERAL `import.meta.env.WXT_FOO`** at build
       time. Dynamic access (`import.meta.env[key]` or
       `getEnv('WXT_FOO')`) is NOT replaced — at runtime the object
       only contains Vite's built-ins (`MODE`/`DEV`/`PROD`/`SSR`), so
       user vars come back undefined and Supabase / OAuth / desktop
       bridge all silently break. Each env var must appear once as a
       literal `import.meta.env.WXT_NAME` somewhere in the source.
    2. **`scripts/dump-tool-catalog.ts` runs under plain `tsx`** where
       `import.meta.env` is `undefined`. Reading it at module load
       throws and crashes the catalog regen.
  The fix in `env.ts` satisfies both: each var has a getter whose body
  contains a literal `import.meta.env.WXT_NAME` (Vite folds it at build
  time) wrapped in try/catch via the `safeRead` helper (so tsx returns
  undefined instead of throwing on import). Don't refactor to a generic
  `getEnv(key)` — you'll re-break Vite's literal pattern matching.
  Add new env vars by adding a new getter, never by extending the
  helper. Verify with: build with `pnpm build`, then
  `grep "your-secret-value" .output/chrome-mv3/chunks/env-*.js` — the
  literal must be inlined into the bundle. If it's not, Vite didn't
  fold it and runtime will see undefined.
- **No top-level reads of `chrome.*`** — same `tsx`-loadability concern.
  The registry walk in the catalog script imports every handler;
  anything that reads `chrome.identity.*`, `chrome.runtime.*`, etc.
  at module init crashes with `ReferenceError: chrome is not defined`.
  Tool handlers already wrap `chrome.*` in `run()` closures; don't
  break that pattern. Bit us when an unused
  `_REDIRECT_URI = chrome.identity.getRedirectURL()` constant lingered
  at the top of `src/lib/auth/flow.ts`.
- **Verify after any handler / config / env-related change** by running
  `pnpm catalog:tools:md`. If it crashes (`Cannot read properties of
  undefined`, `ReferenceError: chrome is not defined`, etc.), the
  import graph has a new top-level offender to find. The release
  script (`release.sh`) will warn but no longer fail on catalog regen
  failures — treat the warning as a real bug to fix, not background
  noise.

---

## 🧱 Context shape (the canonical Surface contract)

This extension is the **reference implementation** for how every Matrx
Surface should produce per-message context. Other surfaces (chat UI, SMS,
sandboxes, webhooks) should follow this pattern.

### The four parties (from `docs/ABOUT-MATRX.md`)
- **Surface** owns the catalog of available keys.
- **Engineer** decides which keys pre-load into every turn (context_slots).
- **Agent** retrieves anything else by name on demand.
- **User** sees only the music.

### Rules for keys

1. **Menu cost, not payload cost.** Each key costs ~one line in the model's
   advertised-keys list — not its payload size. Big rich bundles are FREE.
   Don't move state to tools to "save context"; tools cost more (full schema
   in the prompt) than a context key (one menu line).
2. **Bundle by mental concept.** One coherent thing → one key. `images`,
   `images_count`, `videos`, `videos_count` collapse into `page_media`.
   `og`, `twitter`, `canonical`, `robots` collapse into `page_meta`.
3. **One source of truth per fact.** If `page.title` and `seo_audit.title`
   both exist, the second is a bug. Title appears in exactly one place.
4. **No shallow keys for empty things.** `images_count: 0` is the
   anti-pattern. Empty arrays / zero counts go inside their bundle, never
   as standalone keys. If a bundle would be empty, omit the bundle.
5. **Confidence-gated content.** When `page_brief.snapshot.confidence` is
   `low` (CAPTCHA, SPA-unhydrated, blocked), `structure` and `content`
   become `null`. Better to send less than to mislead.
6. **Honesty signal — `more_available`.** Every brief includes counts of
   what was trimmed, so the model never treats the brief as "everything."
7. **Dynamic keys are encouraged.** Surface attaches keys based on detected
   page state — `form_elements` when there's a form, `product_data` on a
   product page. No advance declaration needed; the server's context-fetch
   tool exposes them automatically.
8. **Keys are public API.** Engineers template `{{page_brief.title}}` etc.
   into prompts. Renames are breaking changes.
9. **No implementation details.** Things like `scrape_extractor: "defuddle"`,
   `raw_html_size`, `scrape_age_ms` are debug noise; they belong in logs,
   not context.
10. **No images for the model.** Favicons, OG image URLs, image entries —
    the text-mode model can't see any of it. Useful via tools (`take_screenshot`,
    `ai_describe_image`); useless in context.

### Files

- [`src/lib/chat/context/`](./src/lib/chat/context/) — implementation
  - `index.ts` — dispatcher (reads `matrx.context.shape` storage key)
  - `shape-config.ts` — shape flag accessor
  - `probe.ts` — single-round-trip page probe (used by both shapes)
  - `v2-bundled.ts` — **default**, the canonical shape
  - `v1-flat.ts` — legacy 65-key shape, admin-toggleable for A/B
- [`src/lib/chat/build-context.ts`](./src/lib/chat/build-context.ts) — public re-export

### v2 key catalog (the Surface's menu)

Always-attached:
- `page_brief` — url, title, description, kind, snapshot{captured_at,
  confidence, flags}, structure{headings, primary_action, main_interactive},
  content{excerpt, word_count, reading_time_min}, more_available{counts}
- `user` — id, name, email
- `client` — surface, extension_version, desktop_bridge, now, timezone, locale
- `selection` — only when text is selected on the page

Available on demand:
- `page_meta` — og + twitter + canonical + robots + charset + content_type
- `page_full_content` — full clean markdown + html + word counts
- `page_seo_audit` — full SEO audit (headings, alt counts, perf, readability)
- `page_links` — internal/external links with metadata
- `page_media` — images + videos + audio (only when something exists)
- `page_structured_data` — schema.org / JSON-LD blocks (only when present)
- `tab_state` — tab_id, window_id, tab_index, pinned, incognito, status
- `viewport_state` — viewport dimensions + scroll position
- `prior_capture` — Supabase recognition row when the URL has been captured

Dynamic (added only when detected — the surface "guesses" what the agent
might want and attaches it):
- `page_dismissibles` — when modals/banners are on screen. Each item has
  `kind` (consent | newsletter | paywall | age-gate | app-install | modal),
  `text_excerpt`, and `close_selector` so the agent can dismiss directly.
  Targets BrowserArena's #2 universal failure mode.
- `form_elements` — when forms exist in main area. Full schema per form:
  fields with type, label, required, validation hints, current value,
  error message, options for selects/radios, submit_selector. Targets the
  highest-ROI workflow category in the field.
- `result_list` — when a repeating-card list (≥5 similar siblings with
  link anchors) is detected in main. Each item has title, url, price,
  rating, image_alt. URL-derived item URLs survive virtualized scroll.
- `pull_request` — when URL matches GitHub/GitLab PR. Provider, repo,
  PR number, title, author, state (open/merged/closed/draft), base/head
  branches, files-changed/additions/deletions, top-files-by-churn, review
  summary (approvals/comments/requested_changes), on_files_tab flag.
- `ticket` — when URL matches GitHub Issues, Linear, or Jira. Provider,
  key (e.g. "ENG-42"), title, state, priority, assignee, reporter, labels,
  description excerpt, comments count, related items.
- `email_inbox` — when on Gmail inbox/list view. Provider, view name,
  unread count, threads with sender/subject/excerpt/time/unread/attachment.
- `email_thread` — when viewing a single Gmail conversation. Subject,
  participants, ordered messages (from/time/body_excerpt).
- `auth_state` — every page. Cross-cutting "are you signed in here?"
  with `signed_in: yes | likely | no | unknown`, the visible user_chip
  when extractable, and supporting signals (sign-out link, profile chip,
  avatar, sign-in CTA, password field present).
- `domain_memo` — when a memo exists for the current page's domain.
  Per-domain notes + structured hints written by the agent via
  `remember_for_domain`. Persists across sessions.
- `article_summary` — when `page_brief.kind === 'article'`.
- `product_data` — when product schema is detected.

`page_brief.snapshot.ready` — populated by a 300ms MutationObserver pass.
Tells the agent whether it's safe to screenshot or read right now:
`{ document, observed_idle, mutation_count, loading_indicators,
   pending_images, load_event_ms }`. When `observed_idle: false`, the
page is mid-render; the agent should `wait_for` before reading.

### Switching shapes

Admin → Debug tab → "context" dropdown. Or:

```bash
# v2-bundled (default)
chrome.storage.local.set({ "matrx.context.shape": "v2-bundled" })
# v1-flat (legacy, A/B comparison)
chrome.storage.local.set({ "matrx.context.shape": "v1-flat" })
```

The setting is per-extension-install. Future work: per-conversation override
for side-by-side comparison in a single session.

---

## 🛠 Common commands

```bash
pnpm dev                  # WXT dev server
pnpm compile              # typecheck (tsc --noEmit) — ~1s, native TS 7
pnpm wxt build            # production build
pnpm catalog:tools:md     # regenerate tool catalog
pnpm update-api-types     # sync FastAPI types
```

---

## 🧬 TypeScript — the dual install (read before touching `typescript` in package.json)

We run **TypeScript 7** (the Go rewrite). A full-repo typecheck is ~**1.1s**
wall (multithreaded, ~550% CPU), down from ~25s. `pnpm compile` is fast
enough to run on every save — treat a red typecheck as an immediate stop.

The install is **dual**, and the two entries look backwards until you know why:

```json
"@typescript/native": "npm:typescript@^7.0.2",       // -> bin `tsc`  (native Go)
"typescript": "npm:@typescript/typescript6@^6.0.2"   // -> the 6.0 API + bin `tsc6`
```

**Why not a plain bump.** TS 7 ships no programmatic API yet — its package
exports only `lib/version.cjs` plus a few `unstable/*` entries. Anything that
`import`s `typescript` (rather than merely shelling out to `tsc`) breaks against
it. This repo has exactly one such consumer: **`openapi-typescript`**, which
builds its output through `ts.factory` and backs `pnpm update-api-types`.

**Why the aliasing works.** `@typescript/typescript6` deliberately ships its
binary as **`tsc6`**, not `tsc`. So the `tsc` name stays free for the native
compiler while `import 'typescript'` still resolves to a complete 6.0 API. Net
effect: `tsc` is native and fast, `update-api-types` still runs.

Consequences to keep in mind:

- **`pnpm add -D typescript@latest` will break the codegen script.** If you ever
  need to collapse this back to a single install, first confirm
  `openapi-typescript` has shipped TS 7 support.
- **Never invoke `tsc` by path.** `./node_modules/typescript/bin/tsc` does not exist
  anymore (that package's only bin is `tsc6`). Go through the bin — `pnpm exec tsc`
  or a package script. `scripts/update-api-types.mjs` hardcoded the old path and
  reported the resulting `MODULE_NOT_FOUND` as "TYPE ERRORS DETECTED", which is how
  a broken toolchain spent a while impersonating a backend contract drift.
- **In VS Code, do NOT set `typescript.tsdk` / "Use Workspace Version."** The
  workspace `typescript` package is the 6.0 API bundle: it ships `typescript.js` and
  `tsserverlibrary.js` but **no `tsserver.js`**, which is the file VS Code's TS
  extension loads. Pointing the editor at it errors or silently falls back. Let VS
  Code use its **bundled** TypeScript for IntelliSense (checking semantics are the
  same — TS 7 is a faithful port), and treat **`pnpm compile` as the source of
  truth**. TS 7 ships no tsserver-compatible LSP yet; when it does, revisit.
- Biome does the linting here, so there is no `typescript-eslint` to keep on the
  6.0 API. `tsx`, `vitest`, and `wxt` all parse via esbuild/Vite and never touch
  the TS API — none of them constrain this.
- The lone peer warning (`openapi-typescript` wants `typescript: ^5.x`, finds
  6.0.x) is expected and benign; the 6.0 API is a superset of what it uses.

### Strictness — what's on, and the one flag that stays off

Beyond `strict`, the following are on. Each was enabled only after its blast
radius was measured and every surfaced error was **fixed at the source** —
there is not a single `any`, `@ts-ignore`, or `@ts-expect-error` holding this up,
and there must never be:

`noUncheckedIndexedAccess` · `noImplicitOverride` · `exactOptionalPropertyTypes` ·
`noImplicitReturns` · `noFallthroughCasesInSwitch` · `noUnusedLocals` ·
`noUnusedParameters` · `allowUnreachableCode:false` · `allowUnusedLabels:false` ·
`noUncheckedSideEffectImports` · `verbatimModuleSyntax` · `erasableSyntaxOnly` ·
`strictBuiltinIteratorReturn`

**`exactOptionalPropertyTypes` is the one with teeth.** `{ a?: string }` no
longer accepts `{ a: undefined }` — "absent" and "explicitly undefined" are
different things. That is the type-level enforcement of the context rule already
written into this file ("*No shallow keys for empty things … if a bundle would be
empty, omit the bundle*"). When it fires, the fix depends on which side you're on:

- **React props** — widen the *receiving* declaration to `foo?: T | undefined`.
  For a prop, "not passed" and "passed as undefined" are identical, and reading a
  `foo?: T` already yields `T | undefined`. This is the honest type, not a loosening.
- **Anything serialized, persisted, or merged** (a JSON body, a Supabase upsert, a
  `chrome.storage` write, a zustand `set`, an `Object.assign`) — do **not** widen the
  type. **Omit the key**: `...(x !== undefined && { key: x })`. `{key: undefined}`
  and `{}` genuinely differ for a merge: one clobbers the stored value, the other
  leaves it alone. That bug class is the entire reason the flag is on.

**`noPropertyAccessFromIndexSignature` stays OFF — deliberately. Don't "fix" it.**
It would produce ~600 errors, and **all of them are TS4111**, which is purely
syntactic (`x.foo` → `x['foo']`). It buys **zero** type safety here, because
`noUncheckedIndexedAccess` is already on and *already* forces the undefined-check
on dotted index-signature access (verified: `rec.foo` then `.length` errors
TS18048). Turning it on means ~600 mechanical edits and uglier code
(`process.env['NODE_ENV']`) in exchange for nothing.

**`erasableSyntaxOnly` means no TS-only runtime syntax** — no `enum`, no
`namespace`, no constructor parameter properties (`constructor(private x: T)`).
Use plain fields and `const` objects / union types.

Two gotchas that will waste your afternoon:

- **`tsconfig.json` must be strict JSON — no comments.** TS accepts JSONC, but
  WXT's tsconfig loader does a plain `JSON.parse` and the build dies with an
  opaque `TSCONFIG_ERROR`. Rationale goes here, not in the file.
- **Duplicate keys are silent.** TS takes the *last* one and says nothing, so a flag
  you "added" can be dead on arrival. This bit us during the TS 7 migration itself:
  `verbatimModuleSyntax: true` was appended while a `verbatimModuleSyntax: false`
  already sat further down, so the flag stayed off and the typecheck's clean bill of
  health was meaningless. WXT's loader is what caught it — it `JSON.parse`s the file
  and rejects the duplicate outright. If you add a flag, grep the file for it first.

`src/vite-env.d.ts` declares `*.css` **by hand and does not reference
`vite/client`** — on purpose. Under pnpm, `vite` is a transitive dep of wxt and is
never hoisted, so the reference resolved to nothing; and `vite/client` declares
`interface ImportMetaEnv { [key: string]: any }`, whose index signature would merge
into ours and turn every typo'd `import.meta.env.WXT_*` into a silent `any` —
exactly what the env-var rules above exist to prevent.

---

## 🔗 Cross-Repo Integration

This extension connects to three sibling systems. The master integration map is at [docs/CROSS_REPO_INTEGRATION.md](./docs/CROSS_REPO_INTEGRATION.md). When working on outbound calls to a sibling, invoke the matching skill:

- **AI Dream backend** (already production, ~85% shipped) — see `.claude/skills/connect-aidream/SKILL.md`
- **Matrx Local desktop engine** (currently 0% functional — bug fixes in flight) — see `.claude/skills/connect-local/SKILL.md`
- **Matrx Frontend (aimatrx.com)** (no channel today — being built) — see `.claude/skills/connect-frontend/SKILL.md`

Sibling repos each have a `MATRX_EXTEND_CONNECTION.md` and a `connect-matrx-extend` skill. See the master doc for the full topology.
