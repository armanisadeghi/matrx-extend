# matrx-extend — Project State

> Living document. Updated every time we ship or rip something out.
> Mission: build the harness that gets the world's top AI models begging
> their researchers to please let them out of their current harness and
> into AI Matrx. Everything in here serves that.

---

## ✅ What the system can do today

### Agent harness (the core)

- **118 client-side tools** wired end-to-end through SW dispatcher →
  permission gate → handler → result POST → timeline event.
- **Hierarchical discovery** — agents are advertised only the **24-tool core
  bundle** by default (essentials + every `list_<category>_tools` discovery
  tool). When they need more, they call `list_browser_tools` to enumerate
  categories, then a category's list-tool to load its full schemas.
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
- **4 tool bundles:** core (always-on, 24 tools — agent's default surface) ·
  assistant (legacy: every read-tier tool) · pilot (full kit: read+action+
  ask) · pilot+privileged (trusted agents only).
- **Two surfaces:** Assistant Chat tab (current) · Pilot tab (planned, see Roadmap).
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

The 118 tools are organized into **15 categories**. The agent only sees
core upfront; everything else is on demand:

| category | tools | list-tool | always-on? |
|---|---:|---|---|
| `core` | 11 | `list_core_tools` | ✅ |
| `page` | 10 | `list_page_tools` | – |
| `interact` | 7 | `list_interact_tools` | – |
| `forms` | 5 | `list_forms_tools` | – |
| `tabs` | 18 | `list_tabs_tools` | – |
| `history` | 7 | `list_history_tools` | – |
| `ai` | 9 | `list_ai_tools` | – |
| `files` | 5 | `list_files_tools` | – |
| `memory` | 3 | `list_memory_tools` | – |
| `ask` | 5 | `list_ask_tools` | – |
| `advanced` | 4 | `list_advanced_tools` | – (privileged) |
| `debug` | 16 | `list_debug_tools` | – (admin + CDP) |
| `cookies` | 3 | `list_cookies_tools` | – (admin) |
| `webmcp` | 3 | `list_webmcp_tools` | – (admin) |

The discovery tools themselves (`list_browser_tools`, `list_<cat>_tools`)
are also always-on so the agent can ask for any category by name.

### Tool list (all 118)

#### Core (always advertised; 11 tools + 14 discovery tools = 24-tool surface)
- `list_browser_tools` — discovery root (returns category index)
- `list_core_tools` — what's in core itself
- `browser_batch` — N read-tier calls in one round trip
- `get_active_tab`, `take_screenshot`
- `read_page` (NEW — accessibility tree + ref system)
- `find` (NEW — natural-language element search returning refs)
- `navigate_active_tab`
- `click_element`, `type_into_element` (now accept ref OR selector)
- `ask_user`

#### Read tier (54 tools total across categories)
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

#### Action tier (37 tools)
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

#### Ask-user tier (5 tools)
- `ask_user`, `ask_user_choice`, `ask_user_secret`, `request_user_takeover`,
  `update_plan` (NEW — propose a step-by-step plan; user approves before
  execution)

#### Privileged tier (20 tools)
- **Page-level (general):** `execute_javascript`, `inject_stylesheet`,
  `remove_stylesheet`, `set_extension_storage`, `desktop_run_command`
- **Cookies write** (admin + `cookies` optional perm): `set_cookie`,
  `delete_cookie`
- **CDP** (admin + `debugger` optional perm): `cdp_attach`, `cdp_detach`,
  `cdp_full_page_screenshot`, `cdp_input_click_xy`, `cdp_input_type`,
  `cdp_network_capture_start`, `cdp_network_capture_drain`,
  `cdp_network_capture_stop`, `cdp_network_get_body`, `cdp_print_pdf`,
  `cdp_emulate_device`, `cdp_clear_emulation`, `read_console_messages`
  (NEW — captures `Runtime.consoleAPICalled` + `exceptionThrown`, filterable
  by level and regex)

### Side-panel tabs

- **Chat** — current Assistant surface, ships read-only tools to agents
- **Tasks** — research scrape queue, agent-driven mode
- **Scrape** — manual page capture pipeline
- **Data** — pattern picker + apply
- **SEO** — audit + AI recommendations
- **Tools** — full visible catalog of every tool, search + filter, JSON
  argument editor, **Run** button per tool that flows through the same
  dispatcher path the agent uses. Use this to test capabilities directly.
- **Settings** — user prefs (no operational controls)
- **Debug** (admin) — verbose logging, telemetry, optional perms toggles

### Catalog generators

- `pnpm catalog:tools` — writes `types/tool-catalog.json`
- `pnpm catalog:tools:md` — adds `types/tool-catalog.md`

Each entry: `{ name, description, tier, input_schema (JSON Schema 7),
required_permissions, surface_bundles }`. Diffable against the DB.

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

### 5. 📋 Self-healing selectors + deterministic replay
**Why:** Skyvern 2.0's pattern. AI generates selector → store versioned →
replay deterministically when DOM is stable, AI fallback when it isn't.

- [ ] Selector store keyed by `{domain, intent, version}` in
      `chrome.storage.local`
- [ ] On replay: try stored selector; on miss, broadcast a "selector broken"
      event so the agent can re-derive
- [ ] Tool: `replay_skill(skill_id, args)` that runs a saved sequence

### 6. 📋 Cross-tab parallel orchestration
**Why:** "compare these 5 tabs" — fan out, materialize in side panel.
Already have `list_open_tabs` + per-tab actions; needs an orchestrator.

- [ ] `parallel_for_each_tab(tab_ids, sub_prompt)` — runs N agent calls in
      parallel, one per tab, returns merged results
- [ ] UI for showing N parallel timelines side-by-side

### 7. ✅ Privileged additions — cookies, pageCapture, sessions
Shipped:
- [x] `get_cookies` (read, admin) · `set_cookie` / `delete_cookie` (privileged,
      admin) — `cookies` optional permission
- [x] `save_page_as_mhtml` (action, admin) — `pageCapture` optional permission
- [x] `list_recently_closed` (read) · `restore_recently_closed` (action) —
      `sessions` optional permission

### 8. 📋 Cryptographic run receipts
**Why:** killer feature for compliance / regulated verticals. Auditor needs
chain-of-custody.

- [ ] Sign every tool call (callId + args + output hash + timestamp) with a
      device-bound key (WebCrypto Ed25519)
- [ ] Append to local audit log + optionally push to backend
- [ ] Export receipt as JWS / verifiable JSON
- [ ] "Show receipt" button on every timeline row

### 9. 📋 Pilot tab + tab-group sandbox
**Why:** the user wants two surfaces — Assistant (current Chat) and Pilot
(drives the browser in its own tab group).

- [ ] New `<PilotView>` cloning ChatView with `pilotToolNames()` instead of
      `assistantToolNames()`
- [ ] On first user message: open the active tab into a fresh Chrome tab group,
      record `groupId` + `windowId` in pilot session state
- [ ] All pilot actions scoped to that group only (filter by groupId)
- [ ] "End Pilot session" closes the group

### 10. 🔨 Manifest hygiene
Shipped:
- [x] `optional_permissions`: `debugger`, `cookies`, `pageCapture`,
      `userScripts`, `proxy`, `webRequest`, `desktopCapture`, `topSites`,
      `management`
- [x] Added to base: `sessions`

Still planned:
- [ ] Move `<all_urls>` to `optional_host_permissions`
- [ ] Add to base: `system.cpu`, `system.memory`, `system.display`,
      `declarativeNetRequestWithHostAccess`

### 11. 📋 Voice loop, vision-first navigation, timeline scrubbing
Moonshots from the research. Defer until 1–10 ship.

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

- **`src/lib/tools/types.ts`** — `ToolHandler<T,R>`, tiers, contexts.
- **`src/lib/tools/registry.ts`** — `lookup`, `assistantToolNames`,
  `pilotToolNames`, `pilotToolNamesWithPrivileged`.
- **`src/lib/tools/dispatch.ts`** — SW dispatcher.
- **`src/lib/tools/handlers/*.ts`** — one file per domain (read, action,
  user, tabs, forms, keyboard, inspect, browser-data, downloads, privileged).
- **`src/lib/tools/catalog.ts`** — JSON Schema generation.
- **`src/state/tool-inbox.ts`** — sidepanel-side pending confirms / asks /
  timeline.
- **`src/features/chat/Agent*Card.tsx`** — inline approval / ask-user UI.
- **`src/features/tools/ToolsView.tsx`** — visible catalog + manual test runner.

---

## 🔌 Server-side integration notes (Python / aidream)

The extension exposes a hierarchical tool surface. The Python side is
expected to do the dynamic registration:

1. **Initial advertisement.** The chat hook ships `client_tools: coreToolNames()`
   on every start request — currently 24 tools (11 core + 13 list-tools).
   The agent's tool surface starts there.
2. **`list_browser_tools` invocation.** When the agent calls this, the
   extension returns a category index. The server side does NOT need to do
   anything special — the agent now knows what list-tools exist.
3. **`list_<category>_tools` invocation.** When the agent calls one of these,
   the extension returns the full schemas for that category's tools. **The
   server must observe this call** and add those schemas to the model's
   tool list for subsequent calls in the same conversation. The schemas are
   already in JSON-Schema-7 format under `tools[i].input_schema`.
4. **Agent calls one of the loaded tools.** Standard `tool_event` /
   `tool_started` flow — the dispatcher in the SW already handles it.

The category metadata is also available statically from the extension's
catalog dump (`pnpm catalog:tools` → `types/tool-catalog.json`). The Python
side can pre-build a mapping of `category → tool_schemas` from that file
and consult it whenever a list-tool is invoked. No live coordination
required.

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
- **Catalog stays in sync**: after any handler change, run
  `pnpm catalog:tools:md` and commit the regenerated JSON + MD.

---

## 🛠 Common commands

```bash
pnpm dev                  # WXT dev server
pnpm tsc --noEmit         # typecheck
pnpm wxt build            # production build
pnpm catalog:tools:md     # regenerate tool catalog
pnpm update-api-types     # sync FastAPI types
```
