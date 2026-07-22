# Tool DB dump

Generated: 2026-05-27 21:30 UTC

- **Total tools (`tool_def`):** 245
- **Total bindings (`tool_binding`, active):** 312
- **Total bundles (`tool_bundle`):** 53
- **Total bundle members (`tool_bundle_member`):** 82
- **Total executors (`tool_executor`):** 43

Read order:
1. **Tool inventory** — every executor and its bound tools.
2. **chrome-extension detail** — full per-tool description + params.
3. **Bundles** — server-side groupings + their members.
4. **Sources-of-truth audit** — divergences between DB and local code.

---

## 1. Tool inventory by `tool_binding.executor_name`

A tool can appear under multiple executors if it has multiple active bindings.

### `(unbound)` — 9 tools

| name | tier | admin | cat | source_kind | description |
|---|---|---|---|---|---|
| `cloud_file` | _(null)_ |  | files | native | Unified tool for working with the user's cloud files (cld_files). Actions: list (paginated, filter by folder or mime_prefix), get (one file's metadata by file_id), delete (soft-delete by default; pass hard=true to purge) |
| `dataset` | _(null)_ |  | datasets | native | Unified tool for working with the user's structured datasets (spreadsheet-like tabular data). All operations are dispatched via the `action` field. Replaces the legacy usertable_* tools. Resource id is `dataset_id` (requ |
| `memory` | _(null)_ |  | memory | native | Unified tool for agent memory associated with the user. All operations are dispatched via the `action` field. Replaces the legacy memory_* tools. Memories are keyed semantically and scoped to user (default), project, or  |
| `note` | _(null)_ |  | productivity | native | Unified tool for the user's markdown notes. All operations are dispatched via the `action` field. Replaces the legacy note_* tools. Resource id is `note_id`. Actions: list (summaries only — no body), get (full note), cre |
| `picklist` | _(null)_ |  | picklists | native | Unified tool for working with the user's picklists (checklists, option sets, label sets). All operations are dispatched via the `action` field. Replaces the legacy userlist_* tools. Resource id is `picklist_id`. Actions: |
| `seo` | _(null)_ |  | seo | native | Unified SEO analysis tool. Actions: check_titles (validate meta titles against Google display + character limits), check_descriptions (same for meta descriptions), check_batch (analyze an array of title+description pairs |
| `sql` | _(null)_ |  | database | native | Unified SQL tool against the user's Supabase database. Actions: query (read-only SELECT — other statements rejected), insert (one row or array; user_id auto-stamped), update (with required `match` filters), delete (with  |
| `task` | _(null)_ |  | productivity | native | Unified tool for the user's tasks. All operations are dispatched via the `action` field. Replaces the legacy task_* tools. Resource id is `task_id`. Actions: list (compact list, optionally scoped to a project or parent t |
| `web` | _(null)_ |  | web | native | Unified web tool. Actions: search (Brave-style search; pass `queries` array), read (fetch and extract text from a single `url`; optional AI summarization), batch_read (concurrent fetch of many `urls` — ~N× faster than se |

### `aidream` — 8 tools

| name | tier | admin | cat | source_kind | description |
|---|---|---|---|---|---|
| `rag_get_chunk` | _(null)_ |  | retrieval | native | Fetch the full content of a single chunk by chunk_id, optionally including its parent chunk for surrounding context. Use after a search hit when you need more than the truncated snippet. |
| `rag_get_data_store` | _(null)_ |  | retrieval | native | Get one data store's details + the list of documents it contains. Use this AFTER rag_list_data_stores to see whether a particular store has the document(s) the user is asking about, BEFORE running a search. |
| `rag_list_data_stores` | _(null)_ |  | retrieval | native | List the curated data stores (named buckets of documents) the calling user can see. Use this BEFORE rag_search when the user asks about a topic that might live in a specific case / project / library — pick the matching s |
| `rag_list_sources` | _(null)_ |  | retrieval | native | List the documents and code files indexed for the current user + org, with chunk counts and section breakdowns. Use BEFORE running a search to understand what content is available — especially helpful when a question imp |
| `rag_search` | _(null)_ |  | retrieval | native | Hybrid retrieval (vector + lexical, RRF, optional Cohere rerank, MMR) across the user's files, notes, code, and the global reference library (MTUS, statutes). Returns ranked chunks with citations. ACL-correct: only conte |
| `rag_search_cross_doc` | _(null)_ |  | retrieval | native | Two-document retrieval. Use this for questions that cross a regulatory / library document AND a case / personal document — e.g. 'is the patient's gabapentin prescription consistent with MTUS?' or 'does this code follow o |
| `rag_search_data_store` | _(null)_ |  | retrieval | native | Search WITHIN a specific data store. Sugar over rag_search with data_store_id pinned. The store's members define the scope — only chunks from those (source_kind, source_id) pairs are returned. Use this as the canonical r |
| `rag_verify_answer` | _(null)_ |  | verification | native | Verify the faithfulness of a generated answer against a list of evidence chunks (typically the chunks rag_search returned). The judge (Claude Haiku) splits the answer into atomic claims and scores each against the eviden |

### `chrome-extension` — 80 tools

| name | tier | admin | cat | source_kind | description |
|---|---|---|---|---|---|
| `ai` | read |  | ai | native | On-device AI (Gemini Nano + siblings). Free, offline, multimodal, no network. Actions: 'check_availability' (probe per-API readiness), 'summarize' (text→summary), 'classify' (text+categories→label), 'extract_json' (text+ |
| `browser_batch` | read |  | core | native | Execute up to 20 read-tier tool calls in one round trip. Pass `calls: [{ name, arguments }]`. Returns `results: [{ name, ok, output \| error }]` in order. Action / ask-user / privileged tools are NOT permitted inside a ba |
| `cdp_a11y_tree` | privileged |  | devtools | native | Dump the accessibility tree of the active tab via Accessibility.getFullAXTree. Each node has { role, name, value, description, properties, children }. Use INSTEAD of read_active_page when you want a clean semantic view o |
| `cdp_emulate` | privileged |  | devtools | native | Override viewport / device metrics on an attached CDP tab for responsive testing. Actions: 'set' (apply `width`+`height`+optional `device_scale_factor`/`mobile`/`user_agent`), 'clear' (revert overrides). Tab must be atta |
| `cdp_full_page_screenshot` | privileged |  | devtools | native | Capture the FULL scrollable page (beyond the viewport) — use instead of computer/take_screenshot for long-form pages. Auto-scales so the long edge fits the `profile`'s vision-model target (same profiles as take_screensho |
| `cdp_input_click_xy` | privileged |  | devtools | native | Synthesize a real mouse click at viewport coordinates (x, y) via Input.dispatchMouseEvent. Bypasses event-handler shadowing, works through shadow DOM and cross-origin iframes (OOPIFs) — the most reliable click in existen |
| `cdp_input_type` | privileged |  | devtools | native | Type literal text into whatever element currently has focus, via Input.insertText. Fires beforeinput / input / compositionend events correctly so React-controlled inputs accept it. Use after focus_element + when type_int |
| `cdp_network_capture_drain` | privileged |  | devtools | native | Drain captured Network events from a tab's buffer. Each entry has { request_id, url, method, status, mime_type, request_headers, response_headers, finished, failed, ts_ms }. Use cdp_network_get_body with a request_id to  |
| `cdp_network_capture_start` | privileged |  | devtools | native | Begin capturing every Network event on a tab (default: active). After this, navigate or interact with the page; calls accumulate in a buffer. Use cdp_network_capture_drain to read them. Use cdp_network_capture_stop when  |
| `cdp_network_capture_stop` | privileged |  | devtools | native | Stop capturing Network events on a tab and clear its buffer. |
| `cdp_network_get_body` | privileged |  | devtools | native | Fetch the response body for a captured request, by request_id (from cdp_network_capture_drain). Returns { body, base64_encoded }. Bodies are large so we don't buffer them eagerly. |
| `cdp_perf_metrics` | read |  | devtools | native | Read Performance.getMetrics for a tab. Returns { Documents, Frames, JSHeapUsedSize, LayoutCount, RecalcStyleCount, ScriptDuration, TaskDuration, … }. Useful when an action triggered chaos and you need to measure it. |
| `cdp_print_pdf` | privileged |  | devtools | native | Print a tab to PDF via Page.printToPDF. Returns base64 PDF data. Useful for archival, sharing, or feeding the PDF to a downstream model. |
| `cdp_session` | privileged |  | devtools | native | Manage Chrome DevTools Protocol attachments. Actions: 'attach' (begin debugger session on `tab_id` — required before any other cdp_* tool), 'detach' (end session), 'list' (which tabs are currently attached). Admin + `deb |
| `chrome_bookmarks` | read |  | chrome | native | Read the user's bookmarks. Actions: 'search' (free-text against title and URL; pass `query`), 'tree' (folder tree starting at `folder_id` or root, `max_depth` deep). Each bookmark has id/title/url/parent_id/date_added. |
| `chrome_cookies` | privileged |  | chrome | native | Manage cookies for any domain. Actions: 'get' (read; pass `name` for a specific cookie or omit for all matching), 'set' (write; requires `name` + `value`; optional `domain`/`path`/`expires_in_seconds`/`same_site`/`http_o |
| `chrome_history` | read |  | chrome | native | Read browsing history. Actions: 'search' (free-text against title/URL; pass `query`, optional `start_time_ms`/`end_time_ms`/`limit`), 'recent' (last N `minutes`, default 60). |
| `chrome_recently_closed` | action |  | chrome | native | Recently-closed tabs and windows. Actions: 'list' (returns sessions with id/url/title/lastModified), 'restore' (reopens; `session_id` optional — defaults to the most recently closed). |
| `chrome_record_gif` | action |  | capture | native | Record browser actions and export as an animated GIF. Actions: 'start_recording', 'stop_recording', 'export' (generates and either downloads or drops onto a page element), 'clear' (discard frames). Take a screenshot righ |
| `chrome_record_tab_video` | action |  | capture | native | Record video of a tab via chrome.tabCapture + MediaRecorder and upload to cld_files. Args: duration_ms (default 5000, max 60000), audio (default false), tab_id? (defaults to assigned tab), filename?. Returns { ok, file_i |
| `chrome_save_page_as_mhtml` | action |  | capture | native | Snapshot a tab as a self-contained MHTML archive (HTML + every resource inlined). Returns base64 MHTML data. Use for: archival, sharing a frozen page, feeding the agent a stable snapshot it can reanalyze later. |
| `chrome_tab_audio_inspect` | read |  | tabs | native | Report which open tabs are currently making noise, were recently audible (within the last 60s), or are muted. Each entry: { id, title, url, audible, muted, active, window_id, last_audible_at }. Useful for finding 'the no |
| `chrome_webmcp` | action |  | webmcp | native | Discover and invoke tools that pages have registered via `navigator.modelContext.registerTool` (Chrome 146+). Actions: 'check' (probe API + count tools), 'list' (enumerate page-registered tools), 'call' (invoke; pass `to |
| `clipboard` | action |  | interaction | native | Read from or write to the system clipboard. Actions: 'read' (returns current clipboard text), 'write' (sets clipboard text — pass `text`). Useful for 'copy this for the user' and 'paste what I just copied' workflows. |
| `computer` | action |  | interaction | native | Mouse, keyboard, and screenshot interactions. Prefer 'ref' over 'coordinate' when targeting elements; coordinates survive poorly across scrolls and layout changes. The 'screenshot' action persists the image to cloud and  |
| `delete_demo` | action |  | demos | native | Delete a saved demo by id. Cannot be undone. |
| `delete_guidance_item` | action |  | guidance | native | Delete a saved guidance item by id. Cannot be undone. For demo references, this only removes the guidance index entry — the underlying demo lives in its own storage and must be deleted via `delete_demo`. |
| `describe_demo` | read |  | demos | native | Return the full step list for a saved demo. Each step has { kind, url, selector_chain, element_snapshot, input_text, param_placeholder, is_sensitive }. Use before replay to verify what the demo will do. |
| `desktop_run_command` | privileged |  | desktop | native | Invoke a command on the matrx-local desktop bridge. Available commands depend on what matrx-local exposes (file ops, system info, window control, etc.). Returns { ok, data?, error? }. Fails fast with reason="desktop unav |
| `downloads` | action |  | capture | native | Manage file downloads. Actions: 'list' (recent downloads with id/filename/url/state/bytes), 'cancel' (abort a pending download), 'confirm' (no-op; Chrome auto-completes downloads), 'download_url' (trigger a download from |
| `drop_file` | action |  | interaction | native | Synthesize a drag-and-drop of a single file onto a target element or coordinate. Use for drop zones that aren't backed by <input type='file'>. Provide ref OR coordinate. file_id is a MediaRef (e.g. from a prior screensho |
| `evaluate_javascript` | privileged |  | interaction | native | Evaluate JavaScript in the page context. Returns the value of the last expression — do NOT use 'return' at top level. Prefer DOM tools (read_page, find, computer, form_input) when possible — JS exec is XSS-equivalent and |
| `extract_microdata` | read |  | reading | native | Extract every structured-data signal on the active page in one call: { snapshot, json_ld, microdata, schema_org_types, counts }. `snapshot` is the OG/Twitter/canonical/JSON-LD snapshot used by the Showcase tab. `json_ld` |
| `extract_table` | read |  | reading | native | Extract a table on the active page as structured JSON. Handles native <table> with thead/tbody, rowspan/colspan, multi-row headers, and ARIA role="table" / role="grid" patterns. Provide `ref` (preferred) from a prior rea |
| `fetch_url_as_markdown` | read |  | reading | native | Fetch an HTTP(S) URL and return its readable content as Markdown — the same defuddle + readability + turndown pipeline the Scrape tab uses against the active page, but pointed at any URL without opening a tab. Returns {  |
| `find` | read |  | reading | native | Find elements on the active page by natural-language description ("the sign-in button", "the search input near the top", "the paragraph about pricing"). Returns matching refs you can immediately pass to interaction tools |
| `find_text_on_page` | read |  | reading | native | Ctrl+F-style literal text search within a tab. Returns matches with surrounding context + the nearest enclosing element selector. Pass regex=true to use a regular expression. Use when read_active_page would be overkill — |
| `form_input` | action |  | interaction | native | Set the value of a form element by reference. Use string for text inputs, boolean for checkboxes/radios, value or visible label for selects. The handler dispatches on element type — you don't need to specify it. |
| `get_computed_style` | read |  | reading | native | Read computed CSS for an element. Pass `properties` to limit (e.g. ["color","font-size"]) — without it returns a useful default subset (color, background, font, padding, margin, border, display, position, dimensions). Us |
| `get_element_at_point` | read |  | reading | native | Identify the DOM element at viewport coordinates (x, y). Returns tag, text, attrs, and a stable selector. Useful when correlating something seen in a screenshot to a clickable element. |
| `get_element_details` | read |  | reading | native | Deep inspection of a single element by ref: full attribute set, bounding box, visibility, optional computed styles and innerHTML. Use when read_page's summary isn't enough — e.g. reading data-* attributes or checking if  |
| `get_form_fields` | read |  | reading | native | Discover forms on the active tab. For each form, returns id, action, method, and a list of fields: { name, type, value, label, required, placeholder, selector }. Use this BEFORE typing to find the right selector and labe |
| `get_guidance_item` | read |  | guidance | native | Return the full record for one guidance item by id. Notes include their text; screenshots/GIFs include their cld_files URL; demo references include the linked demo_id (use `replay_demo` to run). |
| `get_page_links` | read |  | reading | native | Return anchor links from the active tab. Each entry is { href, text, title, rel, target }. Filter by href substring, link text substring, or same-origin only. Lighter than read_active_page when you only need link discove |
| `get_page_selection` | read |  | reading | native | Return the user’s currently selected text on the active tab. Empty string if nothing is selected. |
| `get_page_text` | read |  | reading | native | Extract clean readable text from the active page — strips chrome / nav / ads / scripts / hidden DOM. Lighter than read_active_page (which returns full markdown + media + structured data). Best for "read me this article"  |
| `get_request_body` | privileged |  | devtools | native | Fetch the response body for a specific request seen by read_network_requests. Returns inline text. Pass request_id from a prior drain. |
| `inspect_element` | read |  | reading | native | Deep snapshot of a single element: tag, text, full attributes, bounding rect, key computed styles, ancestor chain (tag + class), and child counts. Useful when a click or type call is failing and you need to understand wh |
| `list_browser_tools` | read |  | core | native | Index of every browser-tool category the extension exposes. Returns one entry per category: name, label, description, count of tools, name of the category-specific list tool. To get the full schemas for a category, call  |
| `list_demos` | read |  | demos | native | List every saved demo as { id, name, description, start_url, step_count, parameter_names, created_at, updated_at }. Use to find a demo to replay or describe. |
| `list_guidance` | read |  | guidance | native | List saved guidance items (notes, screenshots, GIFs, demo references). Pass `domain` to filter; omit to return everything. Returns lightweight summaries — call `get_guidance_item` for full details. |
| `list_highlights` | read |  | reading | native | List highlights the user captured on web pages (text passages and elements) via the Highlight tab. Each entry includes the captured text plus a reference (CSS selector, data-matrx-ref when still valid, role/tag, and a te |
| `mutation_watch` | read |  | reading | native | Observe an element for `duration_ms` (default 3000, max 30000) and report what changed. Set `kinds` to a subset of ['text','attributes','children','visibility'] to filter; default watches all four. Events: { ts_ms, kind, |
| `navigate` | action |  | interaction | native | Navigate a tab to a URL, or move through history with 'back'/'forward'. Protocol defaults to https:// if omitted. After navigating, refs from prior read_page calls are invalidated — call read_page again before referencin |
| `query_elements` | read |  | reading | native | Run document.querySelectorAll on the active tab and return up to `limit` matches as { tag, text, attrs }. `attrs` is a list of attribute names to extract. Use this to find CSS selectors that subsequent action tools can t |
| `read_active_page` | read |  | reading | native | Read the active tab and return a structured snapshot: cleaned article (markdown + html), title, byline, full image/video/link/audio lists, JSON-LD, schema types, SEO signals (headings, meta, alt-text coverage). Pass deep |
| `read_console_messages` | privileged |  | devtools | native | Read console messages from a tab. Auto-starts CDP console capture if not already running. Filter by level, text regex, or use errors_only=true. Returns { count, messages: [{ level, text, url, line, ts_ms }] }. Console ca |
| `read_network_requests` | privileged |  | devtools | native | Read HTTP requests (XHR, fetch, documents, etc.) from a tab. Auto-cleared on cross-domain navigation. Filter with url_pattern to keep output manageable. Response bodies are NOT included by default — use get_request_body  |
| `read_page` | read |  | reading | native | Return an accessibility-style summary of the active page. Each interactive element gets a reference id (`ref:N`) you can pass to click_element / type_into_element / scroll_into_view / etc. instead of a CSS selector — ref |
| `read_pdf` | read |  | reading | native | Extract text and structure from a PDF — either one loaded in a browser tab, or one already in cld_files (pass file_id). Returns text by page with optional page range. Use file_id when you have a MediaRef in hand (e.g. fr |
| `record_demo` | action |  | demos | native | Record a user demonstration that can later be replayed by the agent. Actions: 'start' (begin recording on a tab; clicks, typed text, submits, navigations, and scrolls are captured automatically as the user demonstrates), |
| `remember_for_domain` | action |  | memory | native | Remember something about a domain so it shows up in `domain_memo` context on every future visit. Use for site-specific lessons: "the PO submit button is the third primary", "DOB format is MM/DD/YYYY here", "this site req |
| `replay_demo` | privileged |  | demos | native | Replay a saved demo against a tab. Always requires confirmation — the demo can click, type, submit, and navigate. Pass `dry_run: true` to test selector resolution without taking action. Pass `params` to substitute placeh |
| `request_user_takeover` | ask-user |  | human | native | Hand keyboard/mouse control to the user so they can perform an action the agent cannot or should not (logging in, MFA, CAPTCHA, sensitive form filling, decisions only the user can make). The user types/clicks directly in |
| `resize_window` | action |  | tabs | native | Resize the browser window containing a tab. Useful for responsive testing. If tab_id is omitted, resizes the active tab's window. Note: this changes the OS window size, which in turn changes the viewport. |
| `save_guidance_note` | action |  | guidance | native | Save a domain-scoped note for the user (or for yourself on the next visit). The note auto-surfaces in chat context whenever the user opens a tab on this domain. Use for site-specific lessons that don't fit in `remember_f |
| `scratchpad` | read |  | memory | native | Session-scoped, in-process scratchpad for stashing structured notes across turns without burning context tokens. Distinct from the canonical `memory` tool which is the persistent long-term memory system. Use scratchpad f |
| `screenshot_region` | read |  | capture | native | Capture a bounded region of the active tab's viewport — 5-20× cheaper than a full screenshot for focused vision calls. Target with `ref` (preferred, from read_page), `selector`, or explicit viewport `rect:{x,y,w,h}`; off |
| `sleep` | action |  | interaction | native | Pause the agent for `ms` milliseconds (50ms–5min). Use when waiting for time-based things the page does on its own — a video to play before capturing transcript, an animation to finish, a debounced search to settle, a ra |
| `storage` | privileged |  | memory | native | Persistent agent-namespaced storage that survives across runs. Distinct from canonical `memory` which is session-scoped (cleared on SW restart). Actions: 'get' (returns value at key), 'set' (writes any JSON-serializable  |
| `stylesheet` | privileged |  | interaction | native | Inject or remove a CSS stylesheet on the active (or specified) tab. Actions: 'inject' (apply `css`; pass `persistent: true` to survive navigations), 'remove' (drop a previously-injected `css` block — must match exactly). |
| `submit_form` | action |  | interaction | native | Submit a form. By default the tool clicks the form's primary submit button (so HTML5 validation + framework handlers run). Set via_button=false to fall back to HTMLFormElement.submit() — skips validation but works for fo |
| `tab_groups` | action |  | tabs | native | Manage tab groups. Actions: 'list' (returns all groups across windows), 'create' (groups `tab_ids` together; optional `title`/`color`), 'add' (puts more `tab_ids` into existing `group_id`), 'remove' (ungroups `tab_ids`), |
| `tabs` | action |  | tabs | native | Manage browser tabs. Actions: 'list' (all tabs in current window), 'create' (opens new tab; pass url to open at a URL), 'close', 'switch' (brings tab to foreground), 'reload', 'active' (returns the currently active tab — |
| `tasks` | action |  | human | native | Manage the agent's own tasklist for the current conversation. Actions: 'add' (one via `title` or many via `items`), 'list' (read current tasks), 'set_status' (`id` + `status`), 'update' (`id` + `title` and/or `note`; pas |
| `update_plan` | ask-user |  | human | native | Propose a step-by-step plan and wait for the user to approve, modify, or reject it. Use this BEFORE a multi-step action sequence so you align on intent up front. Returns { approved: true, note?: string } or { approved: f |
| `upload_file` | action |  | interaction | native | Upload one or more files to a <input type='file'> element by reference. Pass file_ids — these are MediaRef IDs (e.g. from a previous /files/upload, or from computer.action=screenshot). The handler resolves each file_id t |
| `user` | ask-user |  | human | native | Pause and interact with the user. ONE tool, six types — pick the right one. ASK types (resolve with the user's answer): 'confirm' (yes/no), 'choice' (pick exactly one from `options`), 'choice_many' (pick zero-or-more fro |
| `user_todos` | action |  | human | native | Assign tasks TO THE USER for the current conversation. The user sees them in a dedicated panel and checks them off; you'll see their state in `user_todos` context on every turn. Actions: 'add' (`title` + optional `contex |
| `wait_for` | read |  | interaction | native | Poll until a condition is met or timeout. Use after navigation or actions that trigger async loads — far more reliable than fixed sleeps. Conditions: 'element' (ref or selector exists and is visible; pass scroll=true to  |

### `matrx-ai-core` — 168 tools

| name | tier | admin | cat | source_kind | description |
|---|---|---|---|---|---|
| `ai` | read |  | ai | native | On-device AI (Gemini Nano + siblings). Free, offline, multimodal, no network. Actions: 'check_availability' (probe per-API readiness), 'summarize' (text→summary), 'classify' (text+categories→label), 'extract_json' (text+ |
| `browser_batch` | read |  | core | native | Execute up to 20 read-tier tool calls in one round trip. Pass `calls: [{ name, arguments }]`. Returns `results: [{ name, ok, output \| error }]` in order. Action / ask-user / privileged tools are NOT permitted inside a ba |
| `bundle:list_amplitude` | _(null)_ |  | mcp | native | Discovery tool — loads the Amplitude MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_asana` | _(null)_ |  | mcp | native | Discovery tool — loads the Asana MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_atlassian` | _(null)_ |  | mcp | native | Discovery tool — loads the Atlassian (Jira & Confluence) MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_box` | _(null)_ |  | mcp | native | Discovery tool — loads the Box MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_brave-search` | _(null)_ |  | mcp | native | Discovery tool — loads the Brave Search MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_canva` | _(null)_ |  | mcp | native | Discovery tool — loads the Canva MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_clay` | _(null)_ |  | mcp | native | Discovery tool — loads the Clay MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_cloudflare` | _(null)_ |  | mcp | native | Discovery tool — loads the Cloudflare MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_code_ingest` | _(null)_ |  | code | native | Discovery tool — loads the code-ingestion toolkit (git_ingest, llms_txt_fetch, package_info) for coding agents. Call this when you need to pull external code, library docs, or package metadata into context; it loads thos |
| `bundle:list_context7` | _(null)_ |  | mcp | native | Discovery tool — loads the Context7 MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_deepwiki` | _(null)_ |  | mcp | native | Discovery tool — loads the DeepWiki MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_figma` | _(null)_ |  | mcp | native | Discovery tool — loads the Figma MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_github` | _(null)_ |  | mcp | native | Discovery tool — loads the GitHub MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_google-drive` | _(null)_ |  | mcp | native | Discovery tool — loads the Google Drive & Docs MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_google-workspace` | _(null)_ |  | mcp | native | Discovery tool — loads the Google Workspace MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_hex` | _(null)_ |  | mcp | native | Discovery tool — loads the Hex MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_hubspot` | _(null)_ |  | mcp | native | Discovery tool — loads the HubSpot MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_intercom` | _(null)_ |  | mcp | native | Discovery tool — loads the Intercom MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_linear` | _(null)_ |  | mcp | native | Discovery tool — loads the Linear MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_make` | _(null)_ |  | mcp | native | Discovery tool — loads the Make MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_miro` | _(null)_ |  | mcp | native | Discovery tool — loads the Miro MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_monday` | _(null)_ |  | mcp | native | Discovery tool — loads the Monday.com MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_neon` | _(null)_ |  | mcp | native | Discovery tool — loads the Neon MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_notion` | _(null)_ |  | mcp | native | Discovery tool — loads the Notion MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_paypal` | _(null)_ |  | mcp | native | Discovery tool — loads the PayPal MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_playwright` | _(null)_ |  | mcp | native | Discovery tool — loads the Playwright MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_postgres` | _(null)_ |  | mcp | native | Discovery tool — loads the PostgreSQL MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_resend` | _(null)_ |  | mcp | native | Discovery tool — loads the Resend MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_salesforce` | _(null)_ |  | mcp | native | Discovery tool — loads the Salesforce MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_sentry` | _(null)_ |  | mcp | native | Discovery tool — loads the Sentry MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_slack` | _(null)_ |  | mcp | native | Discovery tool — loads the Slack MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_square` | _(null)_ |  | mcp | native | Discovery tool — loads the Square MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_stripe` | _(null)_ |  | mcp | native | Discovery tool — loads the Stripe MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_supabase` | _(null)_ |  | mcp | native | Discovery tool — loads the Supabase MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_vercel` | _(null)_ |  | mcp | native | Discovery tool — loads the Vercel MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_webflow` | _(null)_ |  | mcp | native | Discovery tool — loads the Webflow MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_wix` | _(null)_ |  | mcp | native | Discovery tool — loads the Wix MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_zapier` | _(null)_ |  | mcp | native | Discovery tool — loads the Zapier MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_zoho` | _(null)_ |  | mcp | native | Discovery tool — loads the Zoho MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `cdp_a11y_tree` | privileged |  | devtools | native | Dump the accessibility tree of the active tab via Accessibility.getFullAXTree. Each node has { role, name, value, description, properties, children }. Use INSTEAD of read_active_page when you want a clean semantic view o |
| `cdp_emulate` | privileged |  | devtools | native | Override viewport / device metrics on an attached CDP tab for responsive testing. Actions: 'set' (apply `width`+`height`+optional `device_scale_factor`/`mobile`/`user_agent`), 'clear' (revert overrides). Tab must be atta |
| `cdp_full_page_screenshot` | privileged |  | devtools | native | Capture the FULL scrollable page (beyond the viewport) — use instead of computer/take_screenshot for long-form pages. Auto-scales so the long edge fits the `profile`'s vision-model target (same profiles as take_screensho |
| `cdp_input_click_xy` | privileged |  | devtools | native | Synthesize a real mouse click at viewport coordinates (x, y) via Input.dispatchMouseEvent. Bypasses event-handler shadowing, works through shadow DOM and cross-origin iframes (OOPIFs) — the most reliable click in existen |
| `cdp_input_type` | privileged |  | devtools | native | Type literal text into whatever element currently has focus, via Input.insertText. Fires beforeinput / input / compositionend events correctly so React-controlled inputs accept it. Use after focus_element + when type_int |
| `cdp_network_capture_drain` | privileged |  | devtools | native | Drain captured Network events from a tab's buffer. Each entry has { request_id, url, method, status, mime_type, request_headers, response_headers, finished, failed, ts_ms }. Use cdp_network_get_body with a request_id to  |
| `cdp_network_capture_start` | privileged |  | devtools | native | Begin capturing every Network event on a tab (default: active). After this, navigate or interact with the page; calls accumulate in a buffer. Use cdp_network_capture_drain to read them. Use cdp_network_capture_stop when  |
| `cdp_network_capture_stop` | privileged |  | devtools | native | Stop capturing Network events on a tab and clear its buffer. |
| `cdp_network_get_body` | privileged |  | devtools | native | Fetch the response body for a captured request, by request_id (from cdp_network_capture_drain). Returns { body, base64_encoded }. Bodies are large so we don't buffer them eagerly. |
| `cdp_perf_metrics` | read |  | devtools | native | Read Performance.getMetrics for a tab. Returns { Documents, Frames, JSHeapUsedSize, LayoutCount, RecalcStyleCount, ScriptDuration, TaskDuration, … }. Useful when an action triggered chaos and you need to measure it. |
| `cdp_print_pdf` | privileged |  | devtools | native | Print a tab to PDF via Page.printToPDF. Returns base64 PDF data. Useful for archival, sharing, or feeding the PDF to a downstream model. |
| `cdp_session` | privileged |  | devtools | native | Manage Chrome DevTools Protocol attachments. Actions: 'attach' (begin debugger session on `tab_id` — required before any other cdp_* tool), 'detach' (end session), 'list' (which tabs are currently attached). Admin + `deb |
| `chrome_cookies` | privileged |  | chrome | native | Manage cookies for any domain. Actions: 'get' (read; pass `name` for a specific cookie or omit for all matching), 'set' (write; requires `name` + `value`; optional `domain`/`path`/`expires_in_seconds`/`same_site`/`http_o |
| `chrome_record_gif` | action |  | capture | native | Record browser actions and export as an animated GIF. Actions: 'start_recording', 'stop_recording', 'export' (generates and either downloads or drops onto a page element), 'clear' (discard frames). Take a screenshot righ |
| `chrome_tab_audio_inspect` | read |  | tabs | native | Report which open tabs are currently making noise, were recently audible (within the last 60s), or are muted. Each entry: { id, title, url, audible, muted, active, window_id, last_audible_at }. Useful for finding 'the no |
| `chrome_webmcp` | action |  | webmcp | native | Discover and invoke tools that pages have registered via `navigator.modelContext.registerTool` (Chrome 146+). Actions: 'check' (probe API + count tools), 'list' (enumerate page-registered tools), 'call' (invoke; pass `to |
| `clipboard` | action |  | interaction | native | Read from or write to the system clipboard. Actions: 'read' (returns current clipboard text), 'write' (sets clipboard text — pass `text`). Useful for 'copy this for the user' and 'paste what I just copied' workflows. |
| `code_execute_python` | _(null)_ |  | code | native | Execute a Python code snippet in a sandboxed workspace. Accepts raw code or code wrapped in ```python ... ``` markers. Returns stdout, stderr, and exit code. |
| `code_fetch_code` | _(null)_ |  | code | native | Fetch code from a local project directory using one of three output modes. Use 'signatures' for large codebases to get just function/class signatures (~5-10% token cost). Use 'clean' for focused code review with comments |
| `code_fetch_tree` | _(null)_ |  | code | native | Get the directory and file tree of a project or subdirectory. Returns only structure — no file content (~1% token cost). Use this first to orient yourself before deciding which subdirectory to fetch with code_fetch_code. |
| `code_store_html` | _(null)_ |  | code | native | Store an HTML string to an external service and return a unique ID. Useful for persisting generated HTML pages for later retrieval or sharing. |
| `computer` | action |  | interaction | native | Mouse, keyboard, and screenshot interactions. Prefer 'ref' over 'coordinate' when targeting elements; coordinates survive poorly across scrolls and layout changes. The 'screenshot' action persists the image to cloud and  |
| `ctx_batch` | _(null)_ |  | context | native | Retrieve up to 20 deferred context objects in one round trip. Pass `requests: [{key, mode?, offset?, chars?}, ...]` — each entry uses the same vocabulary as ctx_get (modes: full, page, summary). Returns `results` in the  |
| `ctx_create` | _(null)_ |  | context | native | Create a new context object in the current request manifest. Use this to stash a fresh artifact (draft, analysis, structured record, generated document) so it becomes available to ctx_get, ctx_patch, and downstream turns |
| `ctx_get` | _(null)_ |  | context | native | Retrieve a single deferred context object by key. Modes: `full` (entire content), `page` (slice via offset+chars; returns has_more+next_offset), `summary` (AI-generated summary, requires a configured summary agent). When |
| `ctx_patch` | _(null)_ |  | context | native | Edit the content of any context object listed in the Available Context manifest. Uses the same command vocabulary as the built-in code edit tools you already know. Commands:   - str_replace: find old_str verbatim and re |
| `debug_traces_by_call` | _(null)_ | 🔒 | debug | native | Forensic deep-dive for a single call_id. Returns trace events AND the joined cx_tl_call row (when present — pre-flight rejects have no cx_tl_call row). Output: {call_id, events, tool_call}. |
| `debug_traces_by_conv` | _(null)_ | 🔒 | debug | native | Full event timeline for one conversation, oldest first. Use to reconstruct the causal sequence of what happened in a single run. Returns {events, count, filter_summary}. |
| `debug_traces_failures_since` | _(null)_ | 🔒 | debug | native | All FAIL events since a given ISO-8601 timestamp. Convenience wrapper used by the scheduled triage agent — equivalent to debug_traces_recent with event=FAIL and limit=1000. |
| `debug_traces_get_file` | _(null)_ | 🔒 | debug | native | Fetch the full text contents of one tool-trace file by basename (e.g. tool-trace-2026-05-16_20-38-19.log). Returns {filename, size_bytes, content}. Filename must match tool-trace-*.log; path components are rejected. |
| `debug_traces_list_files` | _(null)_ | 🔒 | debug | native | List tool-trace files in .matrx-debug/ on the server's local filesystem. Returns name, size_bytes, modified_at, and is_header_only (true for ≤100-byte stubs). Use to discover which trace files exist before fetching one w |
| `debug_traces_recent` | _(null)_ | 🔒 | debug | native | Query cx_tool_trace for recent tool-dispatch events. Defaults to last hour. Optional filters: event (OK\|FAIL\|SURFACE_REJECT\|NO_EXECUTOR\|LOOP_BLOCK), tool_name, and limit (default 200, max 1000). Returns {events, count, f |
| `delete_demo` | action |  | demos | native | Delete a saved demo by id. Cannot be undone. |
| `delete_guidance_item` | action |  | guidance | native | Delete a saved guidance item by id. Cannot be undone. For demo references, this only removes the guidance index entry — the underlying demo lives in its own storage and must be deleted via `delete_demo`. |
| `describe_demo` | read |  | demos | native | Return the full step list for a saved demo. Each step has { kind, url, selector_chain, element_snapshot, input_text, param_placeholder, is_sensitive }. Use before replay to verify what the demo will do. |
| `downloads` | action |  | capture | native | Manage file downloads. Actions: 'list' (recent downloads with id/filename/url/state/bytes), 'cancel' (abort a pending download), 'confirm' (no-op; Chrome auto-completes downloads), 'download_url' (trigger a download from |
| `drop_file` | action |  | interaction | native | Synthesize a drag-and-drop of a single file onto a target element or coordinate. Use for drop zones that aren't backed by <input type='file'>. Provide ref OR coordinate. file_id is a MediaRef (e.g. from a prior screensho |
| `evaluate_javascript` | privileged |  | interaction | native | Evaluate JavaScript in the page context. Returns the value of the last expression — do NOT use 'return' at top level. Prefer DOM tools (read_page, find, computer, form_input) when possible — JS exec is XSS-equivalent and |
| `extract_microdata` | read |  | reading | native | Extract every structured-data signal on the active page in one call: { snapshot, json_ld, microdata, schema_org_types, counts }. `snapshot` is the OG/Twitter/canonical/JSON-LD snapshot used by the Showcase tab. `json_ld` |
| `extract_table` | read |  | reading | native | Extract a table on the active page as structured JSON. Handles native <table> with thead/tbody, rowspan/colspan, multi-row headers, and ARIA role="table" / role="grid" patterns. Provide `ref` (preferred) from a prior rea |
| `fetch_url_as_markdown` | read |  | reading | native | Fetch an HTTP(S) URL and return its readable content as Markdown — the same defuddle + readability + turndown pipeline the Scrape tab uses against the active page, but pointed at any URL without opening a tab. Returns {  |
| `find` | read |  | reading | native | Find elements on the active page by natural-language description ("the sign-in button", "the search input near the top", "the paragraph about pricing"). Returns matching refs you can immediately pass to interaction tools |
| `find_text_on_page` | read |  | reading | native | Ctrl+F-style literal text search within a tab. Returns matches with surrounding context + the nearest enclosing element selector. Pass regex=true to use a regular expression. Use when read_active_page would be overkill — |
| `form_input` | action |  | interaction | native | Set the value of a form element by reference. Use string for text inputs, boolean for checkboxes/radios, value or visible label for selects. The handler dispatches on element type — you don't need to specify it. |
| `fs_list` | _(null)_ |  | filesystem | native | List files and directories in a workspace directory. Supports recursive listing and glob pattern filtering. Returns entry names, relative paths, type (file/dir), and sizes. Capped at 500 entries. |
| `fs_mkdir` | _(null)_ |  | filesystem | native | Create a directory in the user workspace. Can create nested parent directories. |
| `fs_patch` | _(null)_ |  | filesystem | native | Apply one or more anchor-based search-and-replace edits to a single file in the user's workspace. For each edit, finds an exact old_text block in the file's current content and swaps it for new_text. Edits are applied se |
| `fs_read` | _(null)_ |  | filesystem | native | Read the contents of a file from the user's workspace. Returns the text content, file size, and whether the output was truncated. Supports reading from a byte offset and limiting read size (max 1MB). |
| `fs_search` | _(null)_ |  | filesystem | native | Search for files by name pattern (glob) or by content (regex) within a workspace directory. File name search returns paths and sizes. Content search returns paths and matching text snippets. Capped at configurable max re |
| `fs_write` | _(null)_ |  | filesystem | native | Write content to a file in the user's workspace. Supports creating new files, overwriting existing files, or appending. Automatically creates parent directories by default. |
| `get_computed_style` | read |  | reading | native | Read computed CSS for an element. Pass `properties` to limit (e.g. ["color","font-size"]) — without it returns a useful default subset (color, background, font, padding, margin, border, display, position, dimensions). Us |
| `get_element_at_point` | read |  | reading | native | Identify the DOM element at viewport coordinates (x, y). Returns tag, text, attrs, and a stable selector. Useful when correlating something seen in a screenshot to a clickable element. |
| `get_element_details` | read |  | reading | native | Deep inspection of a single element by ref: full attribute set, bounding box, visibility, optional computed styles and innerHTML. Use when read_page's summary isn't enough — e.g. reading data-* attributes or checking if  |
| `get_form_fields` | read |  | reading | native | Discover forms on the active tab. For each form, returns id, action, method, and a list of fields: { name, type, value, label, required, placeholder, selector }. Use this BEFORE typing to find the right selector and labe |
| `get_guidance_item` | read |  | guidance | native | Return the full record for one guidance item by id. Notes include their text; screenshots/GIFs include their cld_files URL; demo references include the linked demo_id (use `replay_demo` to run). |
| `get_open_trace_incidents` | _(null)_ | 🔒 | debug | native | Read open rows from the Tool Trace Incident queue (user_feedback rows with category=tool-trace-incident and resolved_at IS NULL). Returns up to limit incidents newest-first with priority, ai_assessment, ai_solution_propo |
| `get_page_links` | read |  | reading | native | Return anchor links from the active tab. Each entry is { href, text, title, rel, target }. Filter by href substring, link text substring, or same-origin only. Lighter than read_active_page when you only need link discove |
| `get_page_selection` | read |  | reading | native | Return the user’s currently selected text on the active tab. Empty string if nothing is selected. |
| `get_page_text` | read |  | reading | native | Extract clean readable text from the active page — strips chrome / nav / ads / scripts / hidden DOM. Lighter than read_active_page (which returns full markdown + media + structured data). Best for "read me this article"  |
| `get_request_body` | privileged |  | devtools | native | Fetch the response body for a specific request seen by read_network_requests. Returns inline text. Pass request_id from a prior drain. |
| `git_ingest` | _(null)_ |  | code | native | Ingest a Git repository, subdirectory, gist, or LOCAL path into a single LLM-friendly digest (summary + file tree + concatenated source). Use to pull a whole codebase or folder into context. Remote URLs need the git CLI; |
| `inspect_element` | read |  | reading | native | Deep snapshot of a single element: tag, text, full attributes, bounding rect, key computed styles, ancestor chain (tag + class), and child counts. Useful when a click or type call is failing and you need to understand wh |
| `list_browser_tools` | read |  | core | native | Index of every browser-tool category the extension exposes. Returns one entry per category: name, label, description, count of tools, name of the category-specific list tool. To get the full schemas for a category, call  |
| `list_demos` | read |  | demos | native | List every saved demo as { id, name, description, start_url, step_count, parameter_names, created_at, updated_at }. Use to find a demo to replay or describe. |
| `list_guidance` | read |  | guidance | native | List saved guidance items (notes, screenshots, GIFs, demo references). Pass `domain` to filter; omit to return everything. Returns lightweight summaries — call `get_guidance_item` for full details. |
| `llms_txt_fetch` | _(null)_ |  | code | native | Fetch and parse a documentation site's llms.txt / llms-full.txt — the standard LLM-readable docs index many projects now publish. Use to pull a library or product's official docs into context in compact, structured form. |
| `load_browser_tools` | _(null)_ |  | browser | native | Load the relevant subset of browser-control tools for a specific category. Call this when you need to interact with the page beyond the always-on capabilities — pick the category whose tools match the user's task. Catego |
| `math_calculate` | _(null)_ |  | math | native | Evaluate a mathematical expression. Supports arithmetic operations (+, -, *, /, **, %), trigonometric functions (sin, cos, tan), logarithms (log, log2, log10), square root (sqrt), rounding, and Python math module functio |
| `mutation_watch` | read |  | reading | native | Observe an element for `duration_ms` (default 3000, max 30000) and report what changed. Set `kinds` to a subset of ['text','attributes','children','visibility'] to filter; default watches all four. Events: { ts_ms, kind, |
| `navigate` | action |  | interaction | native | Navigate a tab to a URL, or move through history with 'back'/'forward'. Protocol defaults to https:// if omitted. After navigating, refs from prior read_page calls are invalidated — call read_page again before referencin |
| `news_get_headlines` | _(null)_ |  | news | native | Fetch current top news headlines. Filter by country, category, sources, or keyword query. Returns article titles, sources, descriptions, and URLs. At least one of country, sources, or category is required. Sources cannot |
| `package_info` | _(null)_ |  | code | native | Look up a software package on PyPI or npm: latest version, summary, dependencies, homepage, license, and README. Use to get a library's CURRENT API and version instead of relying on possibly-stale model knowledge. |
| `query_elements` | read |  | reading | native | Run document.querySelectorAll on the active tab and return up to `limit` matches as { tag, text, attrs }. `attrs` is a list of attribute names to extract. Use this to find CSS selectors that subsequent action tools can t |
| `read_active_page` | read |  | reading | native | Read the active tab and return a structured snapshot: cleaned article (markdown + html), title, byline, full image/video/link/audio lists, JSON-LD, schema types, SEO signals (headings, meta, alt-text coverage). Pass deep |
| `read_console_messages` | privileged |  | devtools | native | Read console messages from a tab. Auto-starts CDP console capture if not already running. Filter by level, text regex, or use errors_only=true. Returns { count, messages: [{ level, text, url, line, ts_ms }] }. Console ca |
| `read_network_requests` | privileged |  | devtools | native | Read HTTP requests (XHR, fetch, documents, etc.) from a tab. Auto-cleared on cross-domain navigation. Filter with url_pattern to keep output manageable. Response bodies are NOT included by default — use get_request_body  |
| `read_page` | read |  | reading | native | Return an accessibility-style summary of the active page. Each interactive element gets a reference id (`ref:N`) you can pass to click_element / type_into_element / scroll_into_view / etc. instead of a CSS selector — ref |
| `read_pdf` | read |  | reading | native | Extract text and structure from a PDF — either one loaded in a browser tab, or one already in cld_files (pass file_id). Returns text by page with optional page range. Use file_id when you have a MediaRef in hand (e.g. fr |
| `record_demo` | action |  | demos | native | Record a user demonstration that can later be replayed by the agent. Actions: 'start' (begin recording on a tab; clicks, typed text, submits, navigations, and scrolls are captured automatically as the user demonstrates), |
| `remember_for_domain` | action |  | memory | native | Remember something about a domain so it shows up in `domain_memo` context on every future visit. Use for site-specific lessons: "the PO submit button is the third primary", "DOB format is MM/DD/YYYY here", "this site req |
| `replay_demo` | privileged |  | demos | native | Replay a saved demo against a tab. Always requires confirmation — the demo can click, type, submit, and navigate. Pass `dry_run: true` to test selector resolution without taking action. Pass `params` to substitute placeh |
| `report_trace_incident` | _(null)_ | 🔒 | debug | native | Write a tool-trace incident into the user_feedback queue (category: Tool Trace Incident) so the dev team / remediation agent can act on it. Dedup-aware: if an open row already exists for the same (tool, err_type, environ |
| `request_user_takeover` | ask-user |  | human | native | Hand keyboard/mouse control to the user so they can perform an action the agent cannot or should not (logging in, MFA, CAPTCHA, sensitive form filling, decisions only the user can make). The user types/clicks directly in |
| `research_web` | _(null)_ |  | research | native | Perform deep web research on a topic. Searches the web using multiple queries concurrently, scrapes and reads the top results in full, then uses an AI research agent to analyze and condense the findings into a comprehens |
| `resize_window` | action |  | tabs | native | Resize the browser window containing a tab. Useful for responsive testing. If tab_id is omitted, resizes the active tab's window. Note: this changes the OS window size, which in turn changes the viewport. |
| `save_guidance_note` | action |  | guidance | native | Save a domain-scoped note for the user (or for yourself on the next visit). The note auto-surfaces in chat context whenever the user opens a tab on this domain. Use for site-specific lessons that don't fit in `remember_f |
| `screenshot_region` | read |  | capture | native | Capture a bounded region of the active tab's viewport — 5-20× cheaper than a full screenshot for focused vision calls. Target with `ref` (preferred, from read_page), `selector`, or explicit viewport `rect:{x,y,w,h}`; off |
| `shell_execute` | _(null)_ |  | shell | native | Execute a shell command in a sandboxed user workspace directory. Returns stdout, stderr, and exit code. Dangerous commands are blocked. Max timeout is 60s. |
| `shell_python` | _(null)_ |  | shell | native | Execute a Python script in the user workspace. Writes the code to a temporary file and runs it with python3. Returns stdout, stderr, and exit code. |
| `sleep` | action |  | interaction | native | Pause the agent for `ms` milliseconds (50ms–5min). Use when waiting for time-based things the page does on its own — a video to play before capturing transcript, an animation to finish, a debounced search to settle, a ra |
| `storage` | privileged |  | memory | native | Persistent agent-namespaced storage that survives across runs. Distinct from canonical `memory` which is session-scoped (cleared on SW restart). Actions: 'get' (returns value at key), 'set' (writes any JSON-serializable  |
| `stylesheet` | privileged |  | interaction | native | Inject or remove a CSS stylesheet on the active (or specified) tab. Actions: 'inject' (apply `css`; pass `persistent: true` to survive navigations), 'remove' (drop a previously-injected `css` block — must match exactly). |
| `submit_form` | action |  | interaction | native | Submit a form. By default the tool clicks the form's primary submit button (so HTML5 validation + framework handlers run). Set via_button=false to fall back to HTMLFormElement.submit() — skips validation but works for fo |
| `tabs` | action |  | tabs | native | Manage browser tabs. Actions: 'list' (all tabs in current window), 'create' (opens new tab; pass url to open at a URL), 'close', 'switch' (brings tab to foreground), 'reload', 'active' (returns the currently active tab — |
| `text_analyze` | _(null)_ |  | text | native | Analyze text with multiple analysis types: summary (word/char/sentence/paragraph counts), keywords (top 20 by frequency), entities (emails, URLs, phones, dates), or language (word stats, unique words, avg word length). |
| `text_regex_extract` | _(null)_ |  | text | native | Extract matches from text using a regular expression pattern. Returns all matches with count (find_all=true) or the first match with span position (find_all=false). Supports capture group selection. |
| `toolcomp_create_component` | _(null)_ |  | internal | native | Create a new tool UI component record for a tool that doesn't have one yet. Provide tool_id, display_name, and inline_code at minimum. overlay_code is optional but recommended for tools with rich output. Fails safely if  |
| `toolcomp_get_code` | _(null)_ |  | internal | native | Retrieve the full source code for a specific tool UI component. Specify which sections to return: inline_code, overlay_code, utility_code, header_extras_code, header_subtitle_code. Defaults to inline_code and overlay_cod |
| `toolcomp_get_context` | _(null)_ |  | internal | native | Fetch a complete, curated context bundle for a specific tool's UI component. Returns the tool definition (parameters, output_schema), a summary of all component code sections with lengths, condensed test samples (event t |
| `toolcomp_get_incident_detail` | _(null)_ |  | internal | native | Get full details for a specific tool UI component incident (error report). Includes the complete error stack trace and the tool_update_snapshot — the exact data the component received when it crashed. Use to diagnose com |
| `toolcomp_get_sample_detail` | _(null)_ |  | internal | native | Get the complete data for a specific tool test sample. By default returns a condensed view: arguments, event timeline, output preview. Set full_events=true only when you need to inspect raw streaming chunks or a specific |
| `toolcomp_list_tools` | _(null)_ |  | internal | native | List and discover available tools. Supports flat paginated listing and grouped views. group_by=prefix groups tools by name prefix (e.g. web for web_search/web_read, toolcomp for all toolcomp_* tools) — best for seeing wh |
| `toolcomp_patch_code` | _(null)_ |  | internal | native | Apply one or more targeted string replacements to a tool UI component's code without rewriting the entire section. Each patch specifies an old_string to find and a new_string to replace it with. Patches apply in order, e |
| `toolcomp_resolve_incident` | _(null)_ |  | internal | native | Mark a tool UI component incident as resolved. Call this after deploying a fix so the incident no longer appears in the open incidents list. Optionally add resolution notes. |
| `toolcomp_update_code` | _(null)_ |  | internal | native | Write updated source code to one or more sections of a tool UI component. Always provide the COMPLETE replacement code for each section — never partial snippets. Optionally bump the patch version automatically and add no |
| `toolcomp_update_settings` | _(null)_ |  | internal | native | Update non-code settings on a tool UI component: display_name, results_label, allowed_imports, keep_expanded_on_stream, language, is_active, or notes. Does NOT accept code fields — use toolcomp_update_code for those. |
| `travel_create_summary` | _(null)_ |  | travel | native | Create a comprehensive travel summary combining location, weather, restaurants, activities, and events into a formatted text report. |
| `travel_get_activities` | _(null)_ |  | travel | native | Get activity recommendations based on city and weather. Returns indoor activities for rainy/snowy weather, outdoor for others (mock data for demo/testing). |
| `travel_get_events` | _(null)_ |  | travel | native | Get local events happening in a city, taking weather into account. Returns indoor events for rainy/snowy weather, outdoor for others (mock data for demo/testing). |
| `travel_get_location` | _(null)_ |  | travel | native | Get the user's current location city. Returns a randomly selected city (mock data for demo/testing). |
| `travel_get_restaurants` | _(null)_ |  | travel | native | Get restaurant recommendations for a specified city. Returns a list of restaurant names (mock data for demo/testing). |
| `travel_get_weather` | _(null)_ |  | travel | native | Get current weather conditions for a specified city. Returns condition, temperature, and unit (mock data for demo/testing). |
| `update_plan` | ask-user |  | human | native | Propose a step-by-step plan and wait for the user to approve, modify, or reject it. Use this BEFORE a multi-step action sequence so you align on intent up front. Returns { approved: true, note?: string } or { approved: f |
| `upload_file` | action |  | interaction | native | Upload one or more files to a <input type='file'> element by reference. Pass file_ids — these are MediaRef IDs (e.g. from a previous /files/upload, or from computer.action=screenshot). The handler resolves each file_id t |
| `user` | ask-user |  | human | native | Pause and interact with the user. ONE tool, six types — pick the right one. ASK types (resolve with the user's answer): 'confirm' (yes/no), 'choice' (pick exactly one from `options`), 'choice_many' (pick zero-or-more fro |
| `vsc_get_state` | _(null)_ |  | ide | native | Returns current VSCode IDE state fields for this request. Call this when you need the user's active file content, selected text, diagnostics, workspace folders, or git status. Pass the exact field names you need. Availab |
| `wait_for` | read |  | interaction | native | Poll until a condition is met or timeout. Use after navigation or actions that trigger async loads — far more reliable than fixed sleeps. Conditions: 'element' (ref or selector exists and is visible; pass scroll=true to  |
| `widget_attach_media` | _(null)_ |  | productivity | native | Attach a media asset (image, video, audio) to the widget. The widget decides where to place it. |
| `widget_create_artifact` | _(null)_ |  | productivity | native | Create a new structured artifact owned by the widget (flashcard, note, code block, task, etc.). The widget's host decides what kinds of artifacts it accepts. |
| `widget_text_append` | _(null)_ |  | text | native | Append text to the end of the widget's full content (not relative to a selection). |
| `widget_text_insert_after` | _(null)_ |  | text | native | Insert text immediately after the widget's current selection without removing the selection. |
| `widget_text_insert_before` | _(null)_ |  | text | native | Insert text immediately before the widget's current selection without removing the selection. |
| `widget_text_patch` | _(null)_ |  | text | native | Find-and-replace a verbatim excerpt inside the widget's content. Uses fuzzy matching (exact -> whitespace-normalized -> blank-lines-stripped -> lenient) like note_patch. Returns which pass matched. |
| `widget_text_prepend` | _(null)_ |  | text | native | Prepend text to the start of the widget's full content (not relative to a selection). |
| `widget_text_replace` | _(null)_ |  | text | native | Replace the widget's currently-selected text with new text. Used when an agent rewrites, translates, or otherwise transforms a user's selection inline. |
| `widget_update_field` | _(null)_ |  | productivity | native | Update a single named field on the widget's underlying record. The widget decides which record this applies to (a note, a flashcard, a form field, etc.). |
| `widget_update_record` | _(null)_ |  | productivity | native | Patch multiple fields on the widget's underlying record in one call. |

### `matrx-local` — 49 tools

| name | tier | admin | cat | source_kind | description |
|---|---|---|---|---|---|
| `local_applescript` | _(null)_ |  | local_os | native | Execute AppleScript on macOS. Controls Finder, Mail, Calendar, Safari, and any scriptable application. |
| `local_archive_create` | _(null)_ |  | local_media | native | Create a zip or tar archive from files and directories. |
| `local_archive_extract` | _(null)_ |  | local_media | native | Extract a zip, tar, or 7z archive. |
| `local_bash` | _(null)_ |  | local_execution | native | Run a shell command on the local system with full OS access. Tracks working directory across calls via session state. |
| `local_bash_output` | _(null)_ |  | local_execution | native | Read accumulated output from a background shell command started with local_bash (run_in_background=true). |
| `local_battery_status` | _(null)_ |  | local_system | native | Get battery level, charging status, and estimated time remaining. |
| `local_disk_usage` | _(null)_ |  | local_system | native | Get disk usage statistics for all mounted volumes or a specific path. |
| `local_edit_file` | _(null)_ |  | local_file_ops | native | Apply a precise string replacement to a file. old_string must match exactly (including whitespace) and be unique in the file. |
| `local_fetch_url` | _(null)_ |  | local_network | native | Fetch content from a URL using HTTP (curl-cffi). Returns status, headers, and body. |
| `local_focus_app` | _(null)_ |  | local_process | native | Bring an application window to the foreground. Uses AppleScript on macOS, PowerShell on Windows. |
| `local_focus_window` | _(null)_ |  | local_window | native | Bring a window to the foreground by app name and optional title. |
| `local_get_installed_apps` | _(null)_ |  | local_os | native | List installed applications on the system, optionally filtered by name. |
| `local_glob` | _(null)_ |  | local_file_ops | native | Find files matching a glob pattern on the local filesystem. |
| `local_grep` | _(null)_ |  | local_file_ops | native | Search file contents for a regex pattern on the local filesystem. |
| `local_hotkey` | _(null)_ |  | local_input | native | Send a keyboard shortcut (e.g. 'cmd+c', 'ctrl+shift+s', 'alt+tab'). Modifiers: cmd/command, ctrl/control, alt/option, shift. |
| `local_image_ocr` | _(null)_ |  | local_media | native | Extract text from an image file using OCR (Tesseract). |
| `local_image_resize` | _(null)_ |  | local_media | native | Resize or convert an image file. |
| `local_kill_process` | _(null)_ |  | local_process | native | Kill a running process by PID or name. |
| `local_launch_app` | _(null)_ |  | local_process | native | Launch an application on the local system by name or path. |
| `local_list_directory` | _(null)_ |  | local_file_ops | native | List the contents of a directory on the local filesystem. |
| `local_list_document_folders` | _(null)_ |  | local_documents | native | List all folders in the local document store. |
| `local_list_documents` | _(null)_ |  | local_documents | native | List documents in the local document store (~/.matrx/documents/). |
| `local_list_ports` | _(null)_ |  | local_process | native | List listening TCP/UDP ports and the processes bound to them. |
| `local_list_processes` | _(null)_ |  | local_process | native | List running processes with PID, name, CPU%, and memory usage. |
| `local_list_windows` | _(null)_ |  | local_window | native | List all visible windows with title, app name, position, and size. |
| `local_mdns_discover` | _(null)_ |  | local_network | native | Discover mDNS/Bonjour services on the local network (smart devices, printers, AirPlay, HomeKit, etc.). |
| `local_minimize_window` | _(null)_ |  | local_window | native | Minimize, maximize, or restore a window. |
| `local_mouse_click` | _(null)_ |  | local_input | native | Click the mouse at specific screen coordinates. |
| `local_mouse_move` | _(null)_ |  | local_input | native | Move the mouse cursor to specific screen coordinates. |
| `local_move_window` | _(null)_ |  | local_window | native | Move and/or resize a window by app name. |
| `local_network_info` | _(null)_ |  | local_network | native | Get local network information: IPs, interfaces, gateway, DNS, MAC addresses. |
| `local_network_scan` | _(null)_ |  | local_network | native | Scan the local network for active hosts using ARP. |
| `local_notify` | _(null)_ |  | local_system | native | Show a desktop notification on the local system. |
| `local_open_path` | _(null)_ |  | local_system | native | Open a file or directory in the system's default application (Finder on macOS, Explorer on Windows). |
| `local_open_url` | _(null)_ |  | local_system | native | Open a URL in the default web browser on the local system. |
| `local_pdf_extract` | _(null)_ |  | local_media | native | Extract text (and optionally images) from a PDF file. |
| `local_port_scan` | _(null)_ |  | local_network | native | Scan a host for open TCP ports. |
| `local_powershell` | _(null)_ |  | local_os | native | Execute a PowerShell script on Windows. Has access to COM, WMI, .NET APIs, and the registry. |
| `local_read_document` | _(null)_ |  | local_documents | native | Read the full content of a document from the local document store. |
| `local_read_file` | _(null)_ |  | local_file_ops | native | Read a file from the local filesystem. Returns line-numbered content. Supports offset and limit for large files. |
| `local_screenshot` | _(null)_ |  | local_system | native | Take a screenshot of the local screen and return it as a base64-encoded image. |
| `local_search_documents` | _(null)_ |  | local_documents | native | Search document content in the local store by keyword. |
| `local_system_info` | _(null)_ |  | local_system | native | Get detailed information about the local system: OS, CPU, RAM, disk, hostname. |
| `local_system_resources` | _(null)_ |  | local_system | native | Get real-time CPU, memory, disk, and network usage statistics. |
| `local_task_stop` | _(null)_ |  | local_execution | native | Stop a background shell task started with local_bash. |
| `local_top_processes` | _(null)_ |  | local_system | native | Get top N processes by CPU or memory usage. |
| `local_type_text` | _(null)_ |  | local_input | native | Type text using the system keyboard (simulates keystrokes). |
| `local_write_document` | _(null)_ |  | local_documents | native | Create or update a Markdown document in the local document store. |
| `local_write_file` | _(null)_ |  | local_file_ops | native | Write content to a file on the local filesystem. Creates parent directories as needed. |

### `matrx-user` — 7 tools

| name | tier | admin | cat | source_kind | description |
|---|---|---|---|---|---|
| `request_user_takeover` | ask-user |  | human | native | Hand keyboard/mouse control to the user so they can perform an action the agent cannot or should not (logging in, MFA, CAPTCHA, sensitive form filling, decisions only the user can make). The user types/clicks directly in |
| `scratchpad` | read |  | memory | native | Session-scoped, in-process scratchpad for stashing structured notes across turns without burning context tokens. Distinct from the canonical `memory` tool which is the persistent long-term memory system. Use scratchpad f |
| `storage` | privileged |  | memory | native | Persistent agent-namespaced storage that survives across runs. Distinct from canonical `memory` which is session-scoped (cleared on SW restart). Actions: 'get' (returns value at key), 'set' (writes any JSON-serializable  |
| `tasks` | action |  | human | native | Manage the agent's own tasklist for the current conversation. Actions: 'add' (one via `title` or many via `items`), 'list' (read current tasks), 'set_status' (`id` + `status`), 'update' (`id` + `title` and/or `note`; pas |
| `update_plan` | ask-user |  | human | native | Propose a step-by-step plan and wait for the user to approve, modify, or reject it. Use this BEFORE a multi-step action sequence so you align on intent up front. Returns { approved: true, note?: string } or { approved: f |
| `user` | ask-user |  | human | native | Pause and interact with the user. ONE tool, six types — pick the right one. ASK types (resolve with the user's answer): 'confirm' (yes/no), 'choice' (pick exactly one from `options`), 'choice_many' (pick zero-or-more fro |
| `user_todos` | action |  | human | native | Assign tasks TO THE USER for the current conversation. The user sees them in a dedicated panel and checks them off; you'll see their state in `user_todos` context on every turn. Actions: 'add' (`title` + optional `contex |

---

## 2. chrome-extension tool details

Each entry includes the full description + parameter summary so
the reviewer can spot redundant fields, stale text, or schema gaps.
Required params are **bold**.

### `ai`

- **tier:** read · **category:** ai · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> On-device AI (Gemini Nano + siblings). Free, offline, multimodal, no network. Actions: 'check_availability' (probe per-API readiness), 'summarize' (text→summary), 'classify' (text+categories→label), 'extract_json' (text+schema→object), 'translate' (text+target_lang), 'detect_language' (text→BCP-47), 'proofread' (text→corrections), 'describe_image' (image_url OR image_base64+mime_type → caption), 'check_prompt_injection' (text→risk assessment). Use BEFORE expensive cloud calls when on-device quality permits.

**Params:** text: `string`, **action**: `string[check_availability\|summarize\|classify\|extract_json\|translate\|detect_language\|proofread\|describe_image\|check_prompt_injection]`, prompt: `string`, schema: `?`, image_url: `string`, mime_type: `string`, categories: `array`, source_lang: `string`, target_lang: `string`, image_base64: `string`

### `browser_batch`

- **tier:** read · **category:** core · **active:** ✅ · **version:** 10 · **also bound to:** `matrx-ai-core`

> Execute up to 20 read-tier tool calls in one round trip. Pass `calls: [{ name, arguments }]`. Returns `results: [{ name, ok, output \| error }]` in order. Action / ask-user / privileged tools are NOT permitted inside a batch — call them individually so the user can approve. Use this for predictable multi-step reads (read_page + take_screenshot + list_open_tabs) where each call is independent.

**Params:** **calls**: `array`, stop_on_error: `boolean`

### `cdp_a11y_tree`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Dump the accessibility tree of the active tab via Accessibility.getFullAXTree. Each node has { role, name, value, description, properties, children }. Use INSTEAD of read_active_page when you want a clean semantic view of the page — it omits decorative DOM and surfaces aria-roles, button labels, form-field associations directly. Best for vision-free reasoning.

**Params:** tab_id: `integer`, max_nodes: `integer`

### `cdp_emulate`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 9 · **also bound to:** `matrx-ai-core`

> Override viewport / device metrics on an attached CDP tab for responsive testing. Actions: 'set' (apply `width`+`height`+optional `device_scale_factor`/`mobile`/`user_agent`), 'clear' (revert overrides). Tab must be attached via cdp_session first.

**Params:** width: `integer`, **action**: `string[set\|clear]`, height: `integer`, mobile: `boolean`, tab_id: `integer`, user_agent: `string`, device_scale_factor: `number`

### `cdp_full_page_screenshot`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 9 · **also bound to:** `matrx-ai-core`

> Capture the FULL scrollable page (beyond the viewport) — use instead of computer/take_screenshot for long-form pages. Auto-scales so the long edge fits the `profile`'s vision-model target (same profiles as take_screenshot). Uploads to cloud; returns { ok, media_type, format, width, height, image_base64, byte_length, capture_scale, profile, est_tokens, file_id, file_url }. Render/share file_url (durable); image_base64 feeds the vision model — pass media_type through verbatim, never stringify the object.

**Params:** format: `string[png\|jpeg\|webp]`, tab_id: `integer`, profile: `string[auto\|auto-final\|anthropic-default\|anthropic-hires\|openai-original\|openai-high\|openai-low\|gemini-screenshot\|gemini-overview\|gemini-2.5-default\|ocr-heavy\|lossless]`, quality: `integer`, full_page: `boolean`, capture_scale: `number`

### `cdp_input_click_xy`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Synthesize a real mouse click at viewport coordinates (x, y) via Input.dispatchMouseEvent. Bypasses event-handler shadowing, works through shadow DOM and cross-origin iframes (OOPIFs) — the most reliable click in existence. Use when click_element fails because the page intercepts synthetic clicks.

**Params:** **x**: `number`, **y**: `number`, button: `string[left\|right\|middle]`, tab_id: `integer`, click_count: `integer`

### `cdp_input_type`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Type literal text into whatever element currently has focus, via Input.insertText. Fires beforeinput / input / compositionend events correctly so React-controlled inputs accept it. Use after focus_element + when type_into_element fails.

**Params:** **text**: `string`, tab_id: `integer`

### `cdp_network_capture_drain`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 7 · **also bound to:** `matrx-ai-core`

> Drain captured Network events from a tab's buffer. Each entry has { request_id, url, method, status, mime_type, request_headers, response_headers, finished, failed, ts_ms }. Use cdp_network_get_body with a request_id to fetch a response body lazily.

**Params:** max: `integer`, tab_id: `integer`, url_contains: `string`

### `cdp_network_capture_start`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Begin capturing every Network event on a tab (default: active). After this, navigate or interact with the page; calls accumulate in a buffer. Use cdp_network_capture_drain to read them. Use cdp_network_capture_stop when finished.

**Params:** tab_id: `integer`

### `cdp_network_capture_stop`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Stop capturing Network events on a tab and clear its buffer.

**Params:** tab_id: `integer`

### `cdp_network_get_body`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Fetch the response body for a captured request, by request_id (from cdp_network_capture_drain). Returns { body, base64_encoded }. Bodies are large so we don't buffer them eagerly.

**Params:** tab_id: `integer`, **request_id**: `string`

### `cdp_perf_metrics`

- **tier:** read · **category:** devtools · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Read Performance.getMetrics for a tab. Returns { Documents, Frames, JSHeapUsedSize, LayoutCount, RecalcStyleCount, ScriptDuration, TaskDuration, … }. Useful when an action triggered chaos and you need to measure it.

**Params:** tab_id: `integer`

### `cdp_print_pdf`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Print a tab to PDF via Page.printToPDF. Returns base64 PDF data. Useful for archival, sharing, or feeding the PDF to a downstream model.

**Params:** tab_id: `integer`, landscape: `boolean`, print_background: `boolean`

### `cdp_session`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 9 · **also bound to:** `matrx-ai-core`

> Manage Chrome DevTools Protocol attachments. Actions: 'attach' (begin debugger session on `tab_id` — required before any other cdp_* tool), 'detach' (end session), 'list' (which tabs are currently attached). Admin + `debugger` permission.

**Params:** **action**: `string[attach\|detach\|list]`, tab_id: `integer`

### `chrome_bookmarks`

- **tier:** read · **category:** chrome · **active:** ✅ · **version:** 8

> Read the user's bookmarks. Actions: 'search' (free-text against title and URL; pass `query`), 'tree' (folder tree starting at `folder_id` or root, `max_depth` deep). Each bookmark has id/title/url/parent_id/date_added.

**Params:** limit: `integer`, query: `string`, **action**: `string[search\|tree]`, folder_id: `string`, max_depth: `integer`

### `chrome_cookies`

- **tier:** privileged · **category:** chrome · **active:** ✅ · **version:** 9 · **also bound to:** `matrx-ai-core`

> Manage cookies for any domain. Actions: 'get' (read; pass `name` for a specific cookie or omit for all matching), 'set' (write; requires `name` + `value`; optional `domain`/`path`/`expires_in_seconds`/`same_site`/`http_only`/`secure`), 'delete' (requires `name`). Always pass `url` (or `domain` for 'get'). Admin-only.

**Params:** **url**: `string`, name: `string`, path: `string`, value: `string`, **action**: `string[get\|set\|delete]`, domain: `string`, secure: `boolean`, http_only: `boolean`, same_site: `string[strict\|lax\|no_restriction]`, expires_in_seconds: `integer`

### `chrome_history`

- **tier:** read · **category:** chrome · **active:** ✅ · **version:** 8

> Read browsing history. Actions: 'search' (free-text against title/URL; pass `query`, optional `start_time_ms`/`end_time_ms`/`limit`), 'recent' (last N `minutes`, default 60).

**Params:** limit: `integer`, query: `string`, **action**: `string[search\|recent]`, minutes: `integer`, end_time_ms: `integer`, start_time_ms: `integer`

### `chrome_recently_closed`

- **tier:** action · **category:** chrome · **active:** ✅ · **version:** 8

> Recently-closed tabs and windows. Actions: 'list' (returns sessions with id/url/title/lastModified), 'restore' (reopens; `session_id` optional — defaults to the most recently closed).

**Params:** **action**: `string[list\|restore]`, session_id: `string`

### `chrome_record_gif`

- **tier:** action · **category:** capture · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Record browser actions and export as an animated GIF. Actions: 'start_recording', 'stop_recording', 'export' (generates and either downloads or drops onto a page element), 'clear' (discard frames). Take a screenshot right after start and right before stop to capture clean first/last frames. 'export' returns {file_id, file_url} when not dropping. Drop target accepts ref (preferred) or coordinate.

**Params:** ref: `string`, **action**: `string[start_recording\|stop_recording\|export\|clear]`, **tab_id**: `string`, options: `object`, download: `boolean`, filename: `string`, coordinate: `array`

### `chrome_record_tab_video`

- **tier:** action · **category:** capture · **active:** ✅ · **version:** 6

> Record video of a tab via chrome.tabCapture + MediaRecorder and upload to cld_files. Args: duration_ms (default 5000, max 60000), audio (default false), tab_id? (defaults to assigned tab), filename?. Returns { ok, file_id, file_url, mime_type, duration_ms, size_bytes }. Requires `tabCapture` optional permission — when missing returns ok:false with a remediation hint pointing the user to Settings → Advanced → Tab video capture.

**Params:** audio: `boolean`, tab_id: `integer`, filename: `string`, duration_ms: `integer`

### `chrome_save_page_as_mhtml`

- **tier:** action · **category:** capture · **active:** ✅ · **version:** 6

> Snapshot a tab as a self-contained MHTML archive (HTML + every resource inlined). Returns base64 MHTML data. Use for: archival, sharing a frozen page, feeding the agent a stable snapshot it can reanalyze later.

**Params:** tab_id: `integer`

### `chrome_tab_audio_inspect`

- **tier:** read · **category:** tabs · **active:** ✅ · **version:** 7 · **also bound to:** `matrx-ai-core`

> Report which open tabs are currently making noise, were recently audible (within the last 60s), or are muted. Each entry: { id, title, url, audible, muted, active, window_id, last_audible_at }. Useful for finding 'the noisy tab' and for media-aware automation.

**Params:** _(no parameters)_

### `chrome_webmcp`

- **tier:** action · **category:** webmcp · **active:** ✅ · **version:** 9 · **also bound to:** `matrx-ai-core`

> Discover and invoke tools that pages have registered via `navigator.modelContext.registerTool` (Chrome 146+). Actions: 'check' (probe API + count tools), 'list' (enumerate page-registered tools), 'call' (invoke; pass `tool_name` and `arguments`). Admin-only experimental capability.

**Params:** **action**: `string[check\|list\|call]`, arguments: `?`, tool_name: `string`

### `clipboard`

- **tier:** action · **category:** interaction · **active:** ✅ · **version:** 9 · **also bound to:** `matrx-ai-core`

> Read from or write to the system clipboard. Actions: 'read' (returns current clipboard text), 'write' (sets clipboard text — pass `text`). Useful for 'copy this for the user' and 'paste what I just copied' workflows.

**Params:** text: `string`, **action**: `string[read\|write]`

### `computer`

- **tier:** action · **category:** interaction · **active:** ✅ · **version:** 10 · **also bound to:** `matrx-ai-core`

> Mouse, keyboard, and screenshot interactions. Prefer 'ref' over 'coordinate' when targeting elements; coordinates survive poorly across scrolls and layout changes. The 'screenshot' action persists the image to cloud and returns {file_id, file_url, width, height, mime_type} — use that file_id with upload_file or drop_file later. Use wait_for for synchronization, NOT a fixed sleep.

**Params:** ref: `string`, text: `string`, **action**: `string[left_click\|right_click\|double_click\|triple_click\|type\|key\|scroll\|hover\|screenshot\|left_click_drag\|scroll_to\|focus\|blur]`, repeat: `integer`, **tab_id**: `string`, modifiers: `string`, coordinate: `array`, scroll_amount: `integer`, scroll_direction: `string[up\|down\|left\|right]`, start_coordinate: `array`

### `delete_demo`

- **tier:** action · **category:** demos · **active:** ✅ · **version:** 7 · **also bound to:** `matrx-ai-core`

> Delete a saved demo by id. Cannot be undone.

**Params:** **demo_id**: `string`

### `delete_guidance_item`

- **tier:** action · **category:** guidance · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Delete a saved guidance item by id. Cannot be undone. For demo references, this only removes the guidance index entry — the underlying demo lives in its own storage and must be deleted via `delete_demo`.

**Params:** **id**: `string`

### `describe_demo`

- **tier:** read · **category:** demos · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Return the full step list for a saved demo. Each step has { kind, url, selector_chain, element_snapshot, input_text, param_placeholder, is_sensitive }. Use before replay to verify what the demo will do.

**Params:** **demo_id**: `string`

### `desktop_run_command`

- **tier:** privileged · **category:** desktop · **active:** ✅ · **version:** 6

> Invoke a command on the matrx-local desktop bridge. Available commands depend on what matrx-local exposes (file ops, system info, window control, etc.). Returns { ok, data?, error? }. Fails fast with reason="desktop unavailable" if the bridge isn't connected — check via the desktop:availability channel before calling.

**Params:** args: `object`, **command**: `string`

### `downloads`

- **tier:** action · **category:** capture · **active:** ✅ · **version:** 10 · **also bound to:** `matrx-ai-core`

> Manage file downloads. Actions: 'list' (recent downloads with id/filename/url/state/bytes), 'cancel' (abort a pending download), 'confirm' (no-op; Chrome auto-completes downloads), 'download_url' (trigger a download from a URL). download_id required for cancel/confirm; url required for download_url.

**Params:** url: `string`, **action**: `string[list\|confirm\|cancel\|download_url]`, filename: `string`, download_id: `string`

### `drop_file`

- **tier:** action · **category:** interaction · **active:** ✅ · **version:** 10 · **also bound to:** `matrx-ai-core`

> Synthesize a drag-and-drop of a single file onto a target element or coordinate. Use for drop zones that aren't backed by <input type='file'>. Provide ref OR coordinate. file_id is a MediaRef (e.g. from a prior screenshot or upload).

**Params:** ref: `string`, **tab_id**: `string`, **file_id**: `string`, filename: `string`, coordinate: `array`

### `evaluate_javascript`

- **tier:** privileged · **category:** interaction · **active:** ✅ · **version:** 12 · **also bound to:** `matrx-ai-core`

> Evaluate JavaScript in the page context. Returns the value of the last expression — do NOT use 'return' at top level. Prefer DOM tools (read_page, find, computer, form_input) when possible — JS exec is XSS-equivalent and bypasses our safety nets.

**Params:** arg: `?`, **text**: `string`, tab_id: `string`

### `extract_microdata`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 7 · **also bound to:** `matrx-ai-core`

> Extract every structured-data signal on the active page in one call: { snapshot, json_ld, microdata, schema_org_types, counts }. `snapshot` is the OG/Twitter/canonical/JSON-LD snapshot used by the Showcase tab. `json_ld` returns each JSON-LD block (flattens @graph; honors `ld_type` filter). `microdata` walks every [itemscope][itemtype] tree (honors `itemtype` filter). `schema_org_types` unions all detected types so you can answer 'is this a Product page?' in one read. Same code paths as the user-facing Showcase → JSON-LD / Microdata / Snapshot sub-tabs, so improvements to either surface flow both ways.

**Params:** kinds: `array`, ld_type: `string`, itemtype: `string`

### `extract_table`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 7 · **also bound to:** `matrx-ai-core`

> Extract a table on the active page as structured JSON. Handles native <table> with thead/tbody, rowspan/colspan, multi-row headers, and ARIA role="table" / role="grid" patterns. Provide `ref` (preferred) from a prior read_page, or `selector` (any CSS), or omit both to pick the largest visible table. Returns { columns: [{ index, path: [headerLevels...] }], rows: [{ cells: [{ value, is_header, colspan?, rowspan? }] }], merged_cells, row_count, column_count }. Use this instead of cell-by-cell scraping — one call versus dozens.

**Params:** ref: `string`, max_rows: `integer`, selector: `string`, normalize: `boolean`, compute_header_paths: `boolean`

### `fetch_url_as_markdown`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Fetch an HTTP(S) URL and return its readable content as Markdown — the same defuddle + readability + turndown pipeline the Scrape tab uses against the active page, but pointed at any URL without opening a tab. Returns { title, markdown, byline, excerpt, extractor, word_count, reading_time_minutes, metadata, ld_json, http_status, final_url, content_type, truncated }. Pass `use_session: true` to attach the user's cookies (paywalled / logged-in pages). Pass `include_extras: true` to also get links / images / videos / SEO audit. Non-HTML URLs (PDFs, JSON, etc.) are rejected with a clear error — use `read_pdf` for PDFs.

**Params:** **url**: `string`, max_chars: `integer`, user_agent: `string`, use_session: `boolean`, include_extras: `boolean`, follow_redirects: `boolean`

### `find`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 11 · **also bound to:** `matrx-ai-core`

> Find elements on the active page by natural-language description ("the sign-in button", "the search input near the top", "the paragraph about pricing"). Returns matching refs you can immediately pass to interaction tools. Uses on-device AI for matching when available; falls back to text similarity. Reuses any fresh `read_page` scrape — call it once before a series of finds. By default also searches non-interactive content (headings/paragraphs) so you can locate sections by topic; set `include_content:false` to restrict to clickable elements only. Returns { matches: [{ ref, name, role, score, reason }] }.

**Params:** limit: `integer`, **query**: `string`, tab_id: `string`, max_candidates: `integer`, include_content: `boolean`

### `find_text_on_page`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 11 · **also bound to:** `matrx-ai-core`

> Ctrl+F-style literal text search within a tab. Returns matches with surrounding context + the nearest enclosing element selector. Pass regex=true to use a regular expression. Use when read_active_page would be overkill — e.g. "where on this page does it say 'click here to download'?". For natural-language search, use find instead.

**Params:** limit: `integer`, **query**: `string`, regex: `boolean`, tab_id: `string`, context_chars: `integer`, case_sensitive: `boolean`

### `form_input`

- **tier:** action · **category:** interaction · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Set the value of a form element by reference. Use string for text inputs, boolean for checkboxes/radios, value or visible label for selects. The handler dispatches on element type — you don't need to specify it.

**Params:** **ref**: `string`, **value**: `string\|number\|boolean`, **tab_id**: `string`

### `get_computed_style`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Read computed CSS for an element. Pass `properties` to limit (e.g. ["color","font-size"]) — without it returns a useful default subset (color, background, font, padding, margin, border, display, position, dimensions). Useful for debugging visual issues or matching styles.

**Params:** **selector**: `string`, properties: `array`

### `get_element_at_point`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Identify the DOM element at viewport coordinates (x, y). Returns tag, text, attrs, and a stable selector. Useful when correlating something seen in a screenshot to a clickable element.

**Params:** **x**: `number`, **y**: `number`

### `get_element_details`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 10 · **also bound to:** `matrx-ai-core`

> Deep inspection of a single element by ref: full attribute set, bounding box, visibility, optional computed styles and innerHTML. Use when read_page's summary isn't enough — e.g. reading data-* attributes or checking if something is hidden by CSS. Avoids needing evaluate_javascript for routine introspection. innerHTML is capped at 50 KB; response includes truncated:true when exceeded.

**Params:** **ref**: `string`, tab_id: `string`, include_html: `boolean`, include_styles: `boolean`

### `get_form_fields`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Discover forms on the active tab. For each form, returns id, action, method, and a list of fields: { name, type, value, label, required, placeholder, selector }. Use this BEFORE typing to find the right selector and label so you fill the right field.

**Params:** selector: `string`

### `get_guidance_item`

- **tier:** read · **category:** guidance · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Return the full record for one guidance item by id. Notes include their text; screenshots/GIFs include their cld_files URL; demo references include the linked demo_id (use `replay_demo` to run).

**Params:** **id**: `string`

### `get_page_links`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Return anchor links from the active tab. Each entry is { href, text, title, rel, target }. Filter by href substring, link text substring, or same-origin only. Lighter than read_active_page when you only need link discovery.

**Params:** limit: `integer`, href_contains: `string`, text_contains: `string`, same_origin_only: `boolean`

### `get_page_selection`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Return the user’s currently selected text on the active tab. Empty string if nothing is selected.

**Params:** _(no parameters)_

### `get_page_text`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 11 · **also bound to:** `matrx-ai-core`

> Extract clean readable text from the active page — strips chrome / nav / ads / scripts / hidden DOM. Lighter than read_active_page (which returns full markdown + media + structured data). Best for "read me this article" style asks. Returns { url, title, byline, text, char_count }.

**Params:** tab_id: `string`, max_chars: `integer`

### `get_request_body`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 10 · **also bound to:** `matrx-ai-core`

> Fetch the response body for a specific request seen by read_network_requests. Returns inline text. Pass request_id from a prior drain.

**Params:** tab_id: `string`, **request_id**: `string`

### `inspect_element`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 7 · **also bound to:** `matrx-ai-core`

> Deep snapshot of a single element: tag, text, full attributes, bounding rect, key computed styles, ancestor chain (tag + class), and child counts. Useful when a click or type call is failing and you need to understand why.

**Params:** **selector**: `string`

### `list_browser_tools`

- **tier:** read · **category:** core · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Index of every browser-tool category the extension exposes. Returns one entry per category: name, label, description, count of tools, name of the category-specific list tool. To get the full schemas for a category, call its `list_tool` (e.g. `list_page_tools`). Use this whenever the model needs more capabilities than its current toolset offers.

**Params:** _(no parameters)_

### `list_demos`

- **tier:** read · **category:** demos · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> List every saved demo as { id, name, description, start_url, step_count, parameter_names, created_at, updated_at }. Use to find a demo to replay or describe.

**Params:** _(no parameters)_

### `list_guidance`

- **tier:** read · **category:** guidance · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> List saved guidance items (notes, screenshots, GIFs, demo references). Pass `domain` to filter; omit to return everything. Returns lightweight summaries — call `get_guidance_item` for full details.

**Params:** domain: `string`

### `list_highlights`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 1

> List highlights the user captured on web pages (text passages and elements) via the Highlight tab. Each entry includes the captured text plus a reference (CSS selector, data-matrx-ref when still valid, role/tag, and a text-quote anchor) so you can act on the exact element or passage with click/type/extract tools. scope: "page" (current URL, default), "site" (current domain), or "all".

**Params:** url: `string`, limit: `integer`, scope: `string[page\|site\|all]`

### `mutation_watch`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 7 · **also bound to:** `matrx-ai-core`

> Observe an element for `duration_ms` (default 3000, max 30000) and report what changed. Set `kinds` to a subset of ['text','attributes','children','visibility'] to filter; default watches all four. Events: { ts_ms, kind, before?, after?, attribute?, added_count?, removed_count?, visible? }. Use this instead of polling read_page when waiting for async UI to settle.

**Params:** ref: `string`, kinds: `array`, selector: `string`, max_events: `integer`, duration_ms: `integer`

### `navigate`

- **tier:** action · **category:** interaction · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Navigate a tab to a URL, or move through history with 'back'/'forward'. Protocol defaults to https:// if omitted. After navigating, refs from prior read_page calls are invalidated — call read_page again before referencing elements.

**Params:** **url**: `string`, force: `boolean`, **tab_id**: `string`

### `query_elements`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Run document.querySelectorAll on the active tab and return up to `limit` matches as { tag, text, attrs }. `attrs` is a list of attribute names to extract. Use this to find CSS selectors that subsequent action tools can target.

**Params:** limit: `integer`, **selector**: `string`, attributes: `array`

### `read_active_page`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Read the active tab and return a structured snapshot: cleaned article (markdown + html), title, byline, full image/video/link/audio lists, JSON-LD, schema types, SEO signals (headings, meta, alt-text coverage). Pass deep=true to scroll the page top→bottom first to trigger lazy-loaded images and infinite-scroll content before reading. Use this whenever you need to understand or quote the page.

**Params:** deep: `boolean`

### `read_console_messages`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 11 · **also bound to:** `matrx-ai-core`

> Read console messages from a tab. Auto-starts CDP console capture if not already running. Filter by level, text regex, or use errors_only=true. Returns { count, messages: [{ level, text, url, line, ts_ms }] }. Console capture stays on until cdp_detach or tab close.

**Params:** max: `integer`, clear: `boolean`, limit: `integer`, tab_id: `string`, pattern: `string`, auto_start: `boolean`, errors_only: `boolean`, level_filter: `array`

### `read_network_requests`

- **tier:** privileged · **category:** devtools · **active:** ✅ · **version:** 10 · **also bound to:** `matrx-ai-core`

> Read HTTP requests (XHR, fetch, documents, etc.) from a tab. Auto-cleared on cross-domain navigation. Filter with url_pattern to keep output manageable. Response bodies are NOT included by default — use get_request_body to fetch a specific body. The buffer is per-tab and bounded; old entries fall off the back.

**Params:** clear: `boolean`, limit: `integer`, tab_id: `string`, auto_start: `boolean`, url_pattern: `string`, include_body: `boolean`

### `read_page`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 11 · **also bound to:** `matrx-ai-core`

> Return an accessibility-style summary of the active page. Each interactive element gets a reference id (`ref:N`) you can pass to click_element / type_into_element / scroll_into_view / etc. instead of a CSS selector — refs are stable across DOM mutations within the same page lifetime. Pass interactive_only=false to include headings, paragraphs, and labels too. Refs invalidate on navigation; call this again after navigating. Returns { url, title, count, elements: [{ ref, role, name, tag, text, visible, bounds? }] }.

**Params:** filter: `string[interactive\|all]`, tab_id: `string`, max_chars: `integer`, max_nodes: `integer`, include_text: `boolean`, include_bounds: `boolean`, include_hidden: `boolean`, interactive_only: `boolean`, trigger_lazy_load: `boolean`

### `read_pdf`

- **tier:** read · **category:** reading · **active:** ✅ · **version:** 10 · **also bound to:** `matrx-ai-core`

> Extract text and structure from a PDF — either one loaded in a browser tab, or one already in cld_files (pass file_id). Returns text by page with optional page range. Use file_id when you have a MediaRef in hand (e.g. from a prior download); use tab_id when the PDF is open in the browser.

**Params:** tab_id: `string`, file_id: `string`, page_end: `integer`, max_chars: `integer`, page_start: `integer`

### `record_demo`

- **tier:** action · **category:** demos · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Record a user demonstration that can later be replayed by the agent. Actions: 'start' (begin recording on a tab; clicks, typed text, submits, navigations, and scrolls are captured automatically as the user demonstrates), 'stop' (save the recording with a name + parameter declarations; sensitive fields like passwords are auto-parameterised), 'discard' (throw away the in-flight recording without saving), 'status' (read; report whether a recording is active and how many steps have been captured). Coach the user: ask them to walk through the workflow, then call stop when they say they're done. Saved demos are replayed via `replay_demo`.

**Params:** _(no parameters)_

### `remember_for_domain`

- **tier:** action · **category:** memory · **active:** ✅ · **version:** 7 · **also bound to:** `matrx-ai-core`

> Remember something about a domain so it shows up in `domain_memo` context on every future visit. Use for site-specific lessons: "the PO submit button is the third primary", "DOB format is MM/DD/YYYY here", "this site requires SSO via Okta". Notes are free-form prose; hints are structured key/value pairs you can look up by name. Memos on a parent domain (e.g., atlassian.net) automatically apply to subdomains. Returns the updated memo so you can see what is remembered now.

**Params:** note: `string`, hints: `object`, **domain**: `string`

### `replay_demo`

- **tier:** privileged · **category:** demos · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Replay a saved demo against a tab. Always requires confirmation — the demo can click, type, submit, and navigate. Pass `dry_run: true` to test selector resolution without taking action. Pass `params` to substitute placeholders (sensitive fields like passwords MUST be supplied this way; the agent should ask the user via `user(type='secret', ...)` first). Returns per-step results with `resolved_via` showing which selector strategy hit.

**Params:** params: `object`, tab_id: `integer`, **demo_id**: `string`, dry_run: `boolean`

### `request_user_takeover`

- **tier:** ask-user · **category:** human · **active:** ✅ · **version:** 12 · **also bound to:** `matrx-user`, `matrx-ai-core`

> Hand keyboard/mouse control to the user so they can perform an action the agent cannot or should not (logging in, MFA, CAPTCHA, sensitive form filling, decisions only the user can make). The user types/clicks directly into the page; when they're done they signal completion in the UI. The agent should re-read the page after takeover ends to see what changed. Distinct from `user` (Q&A) — this is full page handoff.

**Params:** **reason**: `string`, tab_id: `string`, instructions: `string`, expected_action: `string`, timeout_seconds: `integer`

### `resize_window`

- **tier:** action · **category:** tabs · **active:** ✅ · **version:** 10 · **also bound to:** `matrx-ai-core`

> Resize the browser window containing a tab. Useful for responsive testing. If tab_id is omitted, resizes the active tab's window. Note: this changes the OS window size, which in turn changes the viewport.

**Params:** **width**: `integer`, **height**: `integer`, tab_id: `integer`

### `save_guidance_note`

- **tier:** action · **category:** guidance · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Save a domain-scoped note for the user (or for yourself on the next visit). The note auto-surfaces in chat context whenever the user opens a tab on this domain. Use for site-specific lessons that don't fit in `remember_for_domain`'s structured hints — full prose explanations, workflow hints, gotchas.

**Params:** **text**: `string`, **domain**: `string`, caption: `string`, origin_url: `string`

### `scratchpad`

- **tier:** read · **category:** memory · **active:** ✅ · **version:** 2 · **also bound to:** `matrx-user`

> Session-scoped, in-process scratchpad for stashing structured notes across turns without burning context tokens. Distinct from the canonical `memory` tool which is the persistent long-term memory system. Use scratchpad for ephemeral state inside a single run; use `memory` for things the agent should remember about the user across sessions. Actions: 'set' (write a value to a key), 'get' (read by key), 'list' (all keys), 'delete' (remove a key). Values are stringified — stringify objects before passing. Caps: 8 KB per value, 100 keys per session. Cleared at session end.

**Params:** key: `string`, value: `string`, **action**: `string[set\|get\|list\|delete]`

### `screenshot_region`

- **tier:** read · **category:** capture · **active:** ✅ · **version:** 8 · **also bound to:** `matrx-ai-core`

> Capture a bounded region of the active tab's viewport — 5-20× cheaper than a full screenshot for focused vision calls. Target with `ref` (preferred, from read_page), `selector`, or explicit viewport `rect:{x,y,w,h}`; off-screen targets are scrolled into view, optional `padding` in CSS px. Uploads to cloud; returns { ok, media_type, format, width, height, source_rect, image_base64, byte_length, file_id, file_url }. Render/share file_url (durable); image_base64 feeds the vision model.

**Params:** ref: `string`, rect: `object`, format: `string[png\|jpeg]`, padding: `integer`, profile: `string[auto\|auto-final\|anthropic-default\|anthropic-hires\|openai-original\|openai-high\|openai-low\|gemini-screenshot\|gemini-overview\|gemini-2.5-default\|ocr-heavy\|lossless]`, quality: `integer`, selector: `string`

### `sleep`

- **tier:** action · **category:** interaction · **active:** ✅ · **version:** 7 · **also bound to:** `matrx-ai-core`

> Pause the agent for `ms` milliseconds (50ms–5min). Use when waiting for time-based things the page does on its own — a video to play before capturing transcript, an animation to finish, a debounced search to settle, a rate-limit window to clear. The server is non-blocking during the pause; only the agent waits. Prefer `wait_for` when you have a concrete condition (selector or readyState) — `sleep` is for unconditional waits. Returns { ok, slept_ms }.

**Params:** **ms**: `integer`, reason: `string`

### `storage`

- **tier:** privileged · **category:** memory · **active:** ✅ · **version:** 9 · **also bound to:** `matrx-ai-core`, `matrx-user`

> Persistent agent-namespaced storage that survives across runs. Distinct from canonical `memory` which is session-scoped (cleared on SW restart). Actions: 'get' (returns value at key), 'set' (writes any JSON-serializable value), 'list' (returns all keys). Use for user preferences, scratchpads, progress markers between conversations.

**Params:** key: `string`, value: `?`, **action**: `string[get\|set\|list\|delete]`

### `stylesheet`

- **tier:** privileged · **category:** interaction · **active:** ✅ · **version:** 9 · **also bound to:** `matrx-ai-core`

> Inject or remove a CSS stylesheet on the active (or specified) tab. Actions: 'inject' (apply `css`; pass `persistent: true` to survive navigations), 'remove' (drop a previously-injected `css` block — must match exactly).

**Params:** **css**: `string`, **action**: `string[inject\|remove]`, tab_id: `integer`, persistent: `boolean`

### `submit_form`

- **tier:** action · **category:** interaction · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-ai-core`

> Submit a form. By default the tool clicks the form's primary submit button (so HTML5 validation + framework handlers run). Set via_button=false to fall back to HTMLFormElement.submit() — skips validation but works for form elements that lack a button.

**Params:** selector: `string`, via_button: `boolean`

### `tab_groups`

- **tier:** action · **category:** tabs · **active:** ✅ · **version:** 9

> Manage tab groups. Actions: 'list' (returns all groups across windows), 'create' (groups `tab_ids` together; optional `title`/`color`), 'add' (puts more `tab_ids` into existing `group_id`), 'remove' (ungroups `tab_ids`), 'update' (rename/recolor/collapse `group_id`).

**Params:** color: `string[grey\|blue\|red\|yellow\|green\|pink\|purple\|cyan\|orange]`, title: `string`, **action**: `string[list\|create\|add\|remove\|update]`, tab_ids: `array`, group_id: `integer`, collapsed: `boolean`

### `tabs`

- **tier:** action · **category:** tabs · **active:** ✅ · **version:** 11 · **also bound to:** `matrx-ai-core`

> Manage browser tabs. Actions: 'list' (all tabs in current window), 'create' (opens new tab; pass url to open at a URL), 'close', 'switch' (brings tab to foreground), 'reload', 'active' (returns the currently active tab — call when you don't know your tab_id), 'info' (full info for a specific tab_id), 'pin' (toggle pin via `on`), 'mute' (toggle mute via `on`), 'duplicate', 'move' (to `index` and optionally `window_id`), 'zoom' (set `zoom_factor`, e.g. 1.5 for 150%). tab_id required for close/switch/reload/info/pin/mute/duplicate/move/zoom.

**Params:** on: `boolean`, url: `string`, index: `integer`, **action**: `string[list\|create\|close\|switch\|reload\|active\|info\|pin\|mute\|duplicate\|move\|zoom]`, tab_id: `string`, window_id: `integer`, zoom_factor: `number`

### `tasks`

- **tier:** action · **category:** human · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-user`

> Manage the agent's own tasklist for the current conversation. Actions: 'add' (one via `title` or many via `items`), 'list' (read current tasks), 'set_status' (`id` + `status`), 'update' (`id` + `title` and/or `note`; pass note=null to clear), 'remove' (`id`), 'reorder' (`ids` in desired order), 'clear_completed' (drop done + skipped), 'clear_all'. Statuses: pending, in_progress, done, blocked, skipped. The list and any user edits to it are surfaced to you in `task_list` context on every turn — set statuses as you work so the user can see live progress.

**Params:** id: `string`, ids: `array`, note: `?`, items: `array`, title: `string`, **action**: `string[add\|list\|set_status\|update\|remove\|reorder\|clear_completed\|clear_all]`, status: `string[pending\|in_progress\|done\|blocked\|skipped]`

### `update_plan`

- **tier:** ask-user · **category:** human · **active:** ✅ · **version:** 10 · **also bound to:** `matrx-ai-core`, `matrx-user`

> Propose a step-by-step plan and wait for the user to approve, modify, or reject it. Use this BEFORE a multi-step action sequence so you align on intent up front. Returns { approved: true, note?: string } or { approved: false, note?: string } so you can adjust.

**Params:** steps: `array`, title: `string`, domains: `array`, approach: `array`, reasoning: `string`, timeout_seconds: `integer`, estimated_minutes: `integer`

### `upload_file`

- **tier:** action · **category:** interaction · **active:** ✅ · **version:** 10 · **also bound to:** `matrx-ai-core`

> Upload one or more files to a <input type='file'> element by reference. Pass file_ids — these are MediaRef IDs (e.g. from a previous /files/upload, or from computer.action=screenshot). The handler resolves each file_id to bytes and sets the input. Do NOT click file inputs — that opens a native picker the agent cannot see. For drag-and-drop targets, use drop_file instead.

**Params:** **ref**: `string`, **tab_id**: `string`, **file_ids**: `array`

### `user`

- **tier:** ask-user · **category:** human · **active:** ✅ · **version:** 12 · **also bound to:** `matrx-ai-core`, `matrx-user`

> Pause and interact with the user. ONE tool, six types — pick the right one. ASK types (resolve with the user's answer): 'confirm' (yes/no), 'choice' (pick exactly one from `options`), 'choice_many' (pick zero-or-more from `options`, checklist UI), 'text' (free-form input), 'secret' (sensitive input — masked in UI and storage, response tagged sensitive). NOTIFY type (does not require an answer, nudges the user to take action elsewhere): 'notify' — surface `message` with optional `actions` buttons (e.g. ['Done — I clicked it']) and an always-appended 'Other' freeform fallback. All types accept an optional `timeout_seconds` — if no response arrives in time the call resolves with `{ timed_out: true }` and the agent continues. Prefer this over guessing on destructive or sensitive actions. For full control transfer (user types directly into the page), use request_user_takeover instead — different lifecycle. NEVER add your own 'Other', 'None of these', or free-text choice to `options` — the UI ALWAYS appends a freeform 'Other' escape to every choice/choice_many/confirm, so list only the substantive options. The user can also reply outside your structure: every result may carry `additional_instructions` (an optional freeform note the user attached to their answer — always read and honor it) and `wrote_instead: true` (the user declined the structured question(s) and typed a freeform reply in `freeform`; treat that as their answer and re-ask later only if you still genuinely need it).

**Params:** type: `string[confirm\|choice\|choice_many\|text\|secret\|notify]`, level: `string[info\|success\|warning\|error]`, header: `string`, actions: `array`, context: `string`, message: `string`, options: `array`, question: `string`, questions: `array`, allow_other: `boolean`, timeout_seconds: `integer`

### `user_todos`

- **tier:** action · **category:** human · **active:** ✅ · **version:** 6 · **also bound to:** `matrx-user`

> Assign tasks TO THE USER for the current conversation. The user sees them in a dedicated panel and checks them off; you'll see their state in `user_todos` context on every turn. Actions: 'add' (`title` + optional `context` for why + optional `due` hint; fires a Chrome notification unless `silent:true`), 'list', 'update' (`id` + `title`/`context`/`due`; pass null to clear), 'remove' (`id`), 'mark_done' (`id`; `done:false` un-checks), 'clear_done' (purge completed). Use this to delegate work back to the user — e.g. 'forward the email I just drafted', 'pick a date for the meeting'.

**Params:** id: `string`, due: `?`, done: `boolean`, title: `string`, **action**: `string[add\|list\|update\|remove\|mark_done\|clear_done]`, silent: `boolean`, context: `?`

### `wait_for`

- **tier:** read · **category:** interaction · **active:** ✅ · **version:** 10 · **also bound to:** `matrx-ai-core`

> Poll until a condition is met or timeout. Use after navigation or actions that trigger async loads — far more reliable than fixed sleeps. Conditions: 'element' (ref or selector exists and is visible; pass scroll=true to scroll the page while polling — handles infinite scroll), 'text' (text appears anywhere on page), 'url' (tab URL matches substring or regex), 'network_idle' (no in-flight requests for ~500ms).

**Params:** scroll: `boolean`, **tab_id**: `string`, target: `string`, **condition**: `string[element\|text\|url\|network_idle]`, timeout_ms: `integer`

---

## 3. Bundles (`tool_bundle`)

Every row in `tool_bundle` + its members. Empty bundles are explicitly
flagged — they advertise themselves to the LLM but resolve to nothing.

### matrx-extend / chrome-extension category bundles (14)

| bundle | active | members | tool names |
|---|---|---|---|
| `ai` | ✅ | 1  | `ai` |
| `capture` | ✅ | 5  | `chrome_record_gif`, `chrome_record_tab_video`, `chrome_save_page_as_mhtml`, `downloads`, `screenshot_region` |
| `chrome` | ✅ | 4  | `chrome_bookmarks`, `chrome_cookies`, `chrome_history`, `chrome_recently_closed` |
| `core` | ✅ | 2  | `browser_batch`, `list_browser_tools` |
| `demos` | ✅ | 5  | `delete_demo`, `describe_demo`, `list_demos`, `record_demo`, `replay_demo` |
| `desktop` | ✅ | 1  | `desktop_run_command` |
| `devtools` | ✅ | 15  | `cdp_a11y_tree`, `cdp_emulate`, `cdp_full_page_screenshot`, `cdp_input_click_xy`, `cdp_input_type`, `cdp_network_capture_drain`, `cdp_network_capture_start`, `cdp_network_capture_stop`, `cdp_network_get_body`, `cdp_perf_metrics`, `cdp_print_pdf`, `cdp_session`, `get_request_body`, `read_console_messages`, `read_network_requests` |
| `guidance` | ✅ | 4  | `delete_guidance_item`, `get_guidance_item`, `list_guidance`, `save_guidance_note` |
| `human` | ✅ | 5  | `request_user_takeover`, `tasks`, `update_plan`, `user`, `user_todos` |
| `interaction` | ✅ | 11  | `clipboard`, `computer`, `drop_file`, `evaluate_javascript`, `form_input`, `navigate`, `sleep`, `stylesheet`, `submit_form`, `upload_file`, `wait_for` |
| `memory` | ✅ | 3  | `remember_for_domain`, `scratchpad`, `storage` |
| `reading` | ✅ | 18  | `extract_microdata`, `extract_table`, `fetch_url_as_markdown`, `find`, `find_text_on_page`, `get_computed_style`, `get_element_at_point`, `get_element_details`, `get_form_fields`, `get_page_links`, `get_page_selection`, `get_page_text`, `inspect_element`, `mutation_watch`, `query_elements`, `read_active_page`, `read_page`, `read_pdf` |
| `tabs` | ✅ | 4  | `chrome_tab_audio_inspect`, `resize_window`, `tab_groups`, `tabs` |
| `webmcp` | ✅ | 1  | `chrome_webmcp` |

### Other bundles (39)

MCP marketplace + any non-chrome-extension surface bundles.

| bundle | members | description |
|---|---|---|
| `amplitude` | 0 | Access product analytics with 24+ tools. |
| `asana` | 0 | Manage tasks, projects, and workflows directly from AI. |
| `atlassian` | 0 | Manage Jira issues, projects, workflows, and Confluence wiki pages. |
| `box` | 0 | File management, document Q&A, summarization, and workflows. |
| `brave-search` | 0 | Live web search using Brave independent index. 2,000 free queries/month. |
| `canva` | 0 | Create and manage designs through AI. |
| `clay` | 0 | Data enrichment and outreach automation. |
| `cloudflare` | 0 | Deploy Workers, manage KV, R2, D1, DNS, and more. |
| `code_ingest` | 3 | Code & docs ingestion toolkit for coding agents: ingest repos/gists/paths, fetch llms.txt docs, and  |
| `context7` | 0 | Live, version-specific library documentation for AI prompts. |
| `deepwiki` | 0 | Instant documentation and architecture diagrams for any GitHub repo. |
| `figma` | 0 | Pull design context, generate code from frames, access components and variables. |
| `github` | 0 | Manage repositories, pull requests, issues, and actions. |
| `google-drive` | 0 | Search, read, and manage Google Drive files, Docs, and Sheets. |
| `google-workspace` | 0 | Gmail, Calendar, Drive, Docs, Sheets, Slides, Forms, Tasks, and Contacts. |
| `hex` | 0 | Query data, create notebooks, and build visualizations. |
| `hubspot` | 0 | Access CRM contacts, companies, deals, tickets, and more. |
| `intercom` | 0 | Access conversations, contacts, and customer messaging data. |
| `linear` | 0 | Track issues, manage projects and cycles, and search across your Linear workspace. |
| `make` | 0 | Turn Make scenarios into callable AI tools. |
| `miro` | 0 | Create sticky notes, manage whiteboards, and collaborate visually with 80+ tools. |
| `monday` | 0 | Manage boards, items, and workflows on Monday.com. |
| `neon` | 0 | Manage serverless PostgreSQL databases. |
| `notion` | 0 | Connect your Notion workspace to search pages, manage databases, and create content. |
| `paypal` | 0 | Manage orders, invoices, disputes, shipping, transactions, and subscriptions. |
| `playwright` | 0 | Browser automation — navigate, click, fill forms, take screenshots, and test. |
| `postgres` | 0 | Query databases, inspect schemas, and manage data directly. |
| `resend` | 0 | Send emails, manage contacts, broadcasts, domains, and campaigns. |
| `salesforce` | 0 | Manage CRM data, leads, opportunities, and reports. |
| `sentry` | 0 | Monitor errors, track performance, and get AI-powered root cause analysis. |
| `slack` | 0 | Search channels, send messages, manage canvases, and access your team conversations. |
| `square` | 0 | Process payments and manage inventory. |
| `stripe` | 0 | Manage payments, subscriptions, invoices, and customers. |
| `supabase` | 0 | Manage your database, auth, realtime, and edge functions. |
| `vercel` | 0 | Manage deployments, projects, domains, and view logs. |
| `webflow` | 0 | Manage CMS content, improve SEO, localize content, and publish sites. |
| `wix` | 0 | Build and manage websites through AI. |
| `zapier` | 0 | Connect to 8,000+ apps and trigger automated workflows. |
| `zoho` | 0 | CRM, Mail, Calendar, Desk, and 500+ apps. |

---

## 4. Sources-of-truth audit

Where two systems claim authority over the same fact, list the divergence.

### 4a. `CANONICAL_SURFACE` (local) ↔ `tool_def` (DB, bound to `chrome-extension`)

- Local CANONICAL_SURFACE entries: **80**
- DB tools bound to chrome-extension: **80**
- ✅ Sets match exactly. Drift-check enforces this on every release.

### 4b. `CATEGORY_BY_TOOL` (local) ↔ `tool_def.category` (DB)

- ✅ All category assignments match.

### 4c. Per-handler `surface_bundles` vs `CANONICAL_SURFACE` membership

Each `ToolHandler.surface_bundles` declares which bundles (assistant /
pilot / pilot+privileged) it ships with. CANONICAL_SURFACE is the set
actually emitted to the LLM. These should agree.

- Local handlers with non-empty surface_bundles: **169**
- Local handlers with empty surface_bundles: **0** ✅
- ⚠️ Handler advertises bundle but not in CANONICAL_SURFACE: `list_core_tools`, `list_reading_tools`, `list_interaction_tools`, `list_tabs_tools`, `list_capture_tools`, `list_chrome_tools`, `list_human_tools`, `list_memory_tools`, `list_ai_tools`, `list_demos_tools`, `list_guidance_tools`, `list_devtools_tools`, `list_webmcp_tools`, `list_desktop_tools`, `get_active_tab`, `take_screenshot`, `list_open_tabs`, `get_tab_groups`, `get_tab_info`, `search_bookmarks`, `list_bookmark_tree`, `search_history`, `list_recent_history`, `list_downloads`, `get_extension_storage`, `list_extension_storage`, `ai_check_availability`, `ai_summarize`, `ai_classify`, `ai_extract_json`, `ai_translate`, `ai_detect_language`, `ai_proofread`, `ai_describe_image`, `ai_check_prompt_injection`, `navigate_active_tab`, `click_element`, `type_into_element`, `scroll_page`, `set_clipboard`, `press_keys`, `hover_element`, `focus_element`, `blur_element`, `right_click_element`, `select_dropdown_option`, `set_checkbox`, `set_radio`, `file_upload`, `open_new_tab`, `close_tab`, `switch_to_tab`, `duplicate_tab`, `pin_tab`, `mute_tab`, `reload_tab`, `go_back`, `go_forward`, `set_tab_zoom`, `move_tab`, `create_tab_group`, `add_tabs_to_group`, `remove_tabs_from_group`, `update_tab_group`, `download_url`, `cancel_download`, `list_recently_closed`, `restore_recently_closed`, `get_cookies`, `set_cookie`, `delete_cookie`, `cdp_attach`, `cdp_detach`, `cdp_attached_tabs`, `cdp_emulate_device`, `cdp_clear_emulation`, `get_system_info`, `list_network_blocking_rules`, `webmcp_check_availability`, `webmcp_list_page_tools`, `webmcp_call_page_tool`, `execute_javascript`, `inject_stylesheet`, `remove_stylesheet`, `set_extension_storage`, `delete_extension_storage`, `parallel_for_each_tab`, `get_clipboard`

### 4d. DB `tool_bundle` (chrome-extension) ↔ local categories

- DB chrome-extension bundles: **14**
- Local categories: **14**
- ✅ Bundle/category names align.

### 4e. Empty `tool_bundle` rows (DB advertises but resolves to nothing)

- ✅ No empty chrome-extension bundles.

---

## 5. Suggested review focus

- **Pick descriptions to tighten** — Section 2 has every description verbatim. Look for context bloat, stale field references, or generic text.
- **Confirm tier + admin_only** — Tier drives the approval UX; admin_only gates visibility. Eyeball any tool where the surface looks risky for the tier shown.
- **Decide bundle strategy** — Section 4d/4e show DB bundles drifting from local categories. Three options: deprecate `tool_bundle` for chrome-extension (use local categories only), populate the DB bundles to match local, or split-domain (DB bundles for MCP marketplace, local categories for browser tools).
- **Hunt missing parameters** — Section 2 shows the param summary. Look for tools where the LLM has no signal about what to pass (no required fields, generic types).
