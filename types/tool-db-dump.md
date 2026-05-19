# Tool DB dump

Generated: 2026-05-19 17:23 UTC

- **Total tools (`tl_def`):** 273
- **Total bundles (`tl_bundle`):** 54
- **Total bundle members (`tl_bundle_member`):** 34

Read order:
1. **Tool inventory** — what every LLM call could see if discovery loads it.
2. **Bundles** — server-side groupings + their members.
3. **Sources-of-truth audit** — divergences between DB and local code.

---

## 1. Tool inventory by `source_app`

### `aidream` — 8 tools

| name | tier | admin | cat | description |
|---|---|---|---|---|
| `rag_get_chunk` | _(null)_ |  | retrieval | Fetch the full content of a single chunk by chunk_id, optionally including its parent chunk for surrounding context. Use after a search hit when you need more than the truncated snippet. |
| `rag_get_data_store` | _(null)_ |  | retrieval | Get one data store's details + the list of documents it contains. Use this AFTER rag_list_data_stores to see whether a particular store has the document(s) the user is asking about, BEFORE running a search. |
| `rag_list_data_stores` | _(null)_ |  | retrieval | List the curated data stores (named buckets of documents) the calling user can see. Use this BEFORE rag_search when the user asks about a topic that might live in a specific case / project / library — pick the matching s |
| `rag_list_sources` | _(null)_ |  | retrieval | List the documents and code files indexed for the current user + org, with chunk counts and section breakdowns. Use BEFORE running a search to understand what content is available — especially helpful when a question imp |
| `rag_search` | _(null)_ |  | retrieval | Hybrid retrieval (vector + lexical, RRF, optional Cohere rerank, MMR) across the user's files, notes, code, and the global reference library (MTUS, statutes). Returns ranked chunks with citations. ACL-correct: only conte |
| `rag_search_cross_doc` | _(null)_ |  | retrieval | Two-document retrieval. Use this for questions that cross a regulatory / library document AND a case / personal document — e.g. 'is the patient's gabapentin prescription consistent with MTUS?' or 'does this code follow o |
| `rag_search_data_store` | _(null)_ |  | retrieval | Search WITHIN a specific data store. Sugar over rag_search with data_store_id pinned. The store's members define the scope — only chunks from those (source_kind, source_id) pairs are returned. Use this as the canonical r |
| `rag_verify_answer` | _(null)_ |  | verification | Verify the faithfulness of a generated answer against a list of evidence chunks (typically the chunks rag_search returned). The judge (Claude Haiku) splits the answer into atomic claims and scores each against the eviden |

### `matrx-extend` — 79 tools

| name | tier | admin | cat | description |
|---|---|---|---|---|
| `ai` | read |  | advanced | On-device AI (Gemini Nano + siblings). Free, offline, multimodal, no network. Actions: 'check_availability' (probe per-API readiness), 'summarize' (text→summary), 'classify' (text+categories→label), 'extract_json' (text+ |
| `browser_batch` | read |  | core | Execute up to 20 read-tier tool calls in one round trip. Pass `calls: [{ name, arguments }]`. Returns `results: [{ name, ok, output \| error }]` in order. Action / ask-user / privileged tools are NOT permitted inside a ba |
| `cdp_a11y_tree` | privileged | 🔒 | debug | Dump the accessibility tree of the active tab via Accessibility.getFullAXTree. Each node has { role, name, value, description, properties, children }. Use INSTEAD of read_active_page when you want a clean semantic view o |
| `cdp_emulate` | privileged | 🔒 | advanced | Override viewport / device metrics on an attached CDP tab for responsive testing. Actions: 'set' (apply `width`+`height`+optional `device_scale_factor`/`mobile`/`user_agent`), 'clear' (revert overrides). Tab must be atta |
| `cdp_full_page_screenshot` | privileged | 🔒 | debug | Capture the FULL page (not just viewport) as base64. Use instead of take_screenshot for whole-article / long-form pages. Pass a `profile` to optimize for a specific vision model (same profile names as take_screenshot). T |
| `cdp_input_click_xy` | privileged | 🔒 | debug | Synthesize a real mouse click at viewport coordinates (x, y) via Input.dispatchMouseEvent. Bypasses event-handler shadowing, works through shadow DOM and cross-origin iframes (OOPIFs) — the most reliable click in existen |
| `cdp_input_type` | privileged | 🔒 | debug | Type literal text into whatever element currently has focus, via Input.insertText. Fires beforeinput / input / compositionend events correctly so React-controlled inputs accept it. Use after focus_element + when type_int |
| `cdp_network_capture_drain` | privileged | 🔒 | debug | Drain captured Network events from a tab's buffer. Each entry has { request_id, url, method, status, mime_type, request_headers, response_headers, finished, failed, ts_ms }. Use cdp_network_get_body with a request_id to  |
| `cdp_network_capture_start` | privileged | 🔒 | debug | Begin capturing every Network event on a tab (default: active). After this, navigate or interact with the page; calls accumulate in a buffer. Use cdp_network_capture_drain to read them. Use cdp_network_capture_stop when  |
| `cdp_network_capture_stop` | privileged | 🔒 | debug | Stop capturing Network events on a tab and clear its buffer. |
| `cdp_network_get_body` | privileged | 🔒 | debug | Fetch the response body for a captured request, by request_id (from cdp_network_capture_drain). Returns { body, base64_encoded }. Bodies are large so we don't buffer them eagerly. |
| `cdp_perf_metrics` | read | 🔒 | debug | Read Performance.getMetrics for a tab. Returns { Documents, Frames, JSHeapUsedSize, LayoutCount, RecalcStyleCount, ScriptDuration, TaskDuration, … }. Useful when an action triggered chaos and you need to measure it. |
| `cdp_print_pdf` | privileged | 🔒 | debug | Print a tab to PDF via Page.printToPDF. Returns base64 PDF data. Useful for archival, sharing, or feeding the PDF to a downstream model. |
| `cdp_session` | privileged | 🔒 | advanced | Manage Chrome DevTools Protocol attachments. Actions: 'attach' (begin debugger session on `tab_id` — required before any other cdp_* tool), 'detach' (end session), 'list' (which tabs are currently attached). Admin + `deb |
| `chrome_bookmarks` | read |  | advanced | Read the user's bookmarks. Actions: 'search' (free-text against title and URL; pass `query`), 'tree' (folder tree starting at `folder_id` or root, `max_depth` deep). Each bookmark has id/title/url/parent_id/date_added. |
| `chrome_cookies` | privileged | 🔒 | advanced | Manage cookies for any domain. Actions: 'get' (read; pass `name` for a specific cookie or omit for all matching), 'set' (write; requires `name` + `value`; optional `domain`/`path`/`expires_in_seconds`/`same_site`/`http_o |
| `chrome_history` | read |  | advanced | Read browsing history. Actions: 'search' (free-text against title/URL; pass `query`, optional `start_time_ms`/`end_time_ms`/`limit`), 'recent' (last N `minutes`, default 60). |
| `chrome_recently_closed` | action |  | advanced | Recently-closed tabs and windows. Actions: 'list' (returns sessions with id/url/title/lastModified), 'restore' (reopens; `session_id` optional — defaults to the most recently closed). |
| `chrome_record_gif` | action | 🔒 | advanced | Record browser actions and export as an animated GIF. Actions: 'start_recording', 'stop_recording', 'export' (generates and either downloads or drops onto a page element), 'clear' (discard frames). Take a screenshot righ |
| `chrome_record_tab_video` | action | 🔒 | advanced | Record video of a tab via chrome.tabCapture + MediaRecorder and upload to cld_files. Args: duration_ms (default 5000, max 60000), audio (default false), tab_id? (defaults to assigned tab), filename?. Returns { ok, file_i |
| `chrome_save_page_as_mhtml` | action | 🔒 | files | Snapshot a tab as a self-contained MHTML archive (HTML + every resource inlined). Returns base64 MHTML data. Use for: archival, sharing a frozen page, feeding the agent a stable snapshot it can reanalyze later. |
| `chrome_tab_audio_inspect` | read |  | tabs | Report which open tabs are currently making noise, were recently audible (within the last 60s), or are muted. Each entry: { id, title, url, audible, muted, active, window_id, last_audible_at }. Useful for finding 'the no |
| `chrome_webmcp` | action | 🔒 | advanced | Discover and invoke tools that pages have registered via `navigator.modelContext.registerTool` (Chrome 146+). Actions: 'check' (probe API + count tools), 'list' (enumerate page-registered tools), 'call' (invoke; pass `to |
| `clipboard` | action |  | files | Read from or write to the system clipboard. Actions: 'read' (returns current clipboard text), 'write' (sets clipboard text — pass `text`). Useful for 'copy this for the user' and 'paste what I just copied' workflows. |
| `computer` | action |  | core | Mouse, keyboard, and screenshot interactions. Prefer 'ref' over 'coordinate' when targeting elements; coordinates survive poorly across scrolls and layout changes. The 'screenshot' action persists the image to cloud and  |
| `delete_demo` | action |  | demos | Delete a saved demo by id. Cannot be undone. |
| `delete_guidance_item` | action |  | guidance | Delete a saved guidance item by id. Cannot be undone. For demo references, this only removes the guidance index entry — the underlying demo lives in its own storage and must be deleted via `delete_demo`. |
| `describe_demo` | read |  | demos | Return the full step list for a saved demo. Each step has { kind, url, selector_chain, element_snapshot, input_text, param_placeholder, is_sensitive }. Use before replay to verify what the demo will do. |
| `desktop_run_command` | privileged |  | advanced | Invoke a command on the matrx-local desktop bridge. Available commands depend on what matrx-local exposes (file ops, system info, window control, etc.). Returns { ok, data?, error? }. Fails fast with reason="desktop unav |
| `downloads` | action |  | files | Manage file downloads. Actions: 'list' (recent downloads with id/filename/url/state/bytes), 'cancel' (abort a pending download), 'confirm' (no-op; Chrome auto-completes downloads), 'download_url' (trigger a download from |
| `drop_file` | action |  | files | Synthesize a drag-and-drop of a single file onto a target element or coordinate. Use for drop zones that aren't backed by <input type='file'>. Provide ref OR coordinate. file_id is a MediaRef (e.g. from a prior screensho |
| `evaluate_javascript` | privileged | 🔒 | advanced | Evaluate JavaScript in the page context. Returns the value of the last expression — do NOT use 'return' at top level. Admin-gated. Prefer DOM tools (read_page, find, computer, form_input) when possible — JS exec is XSS-e |
| `extract_microdata` | read |  | page | Extract every structured-data signal on the active page in one call: { snapshot, json_ld, microdata, schema_org_types, counts }. `snapshot` is the OG/Twitter/canonical/JSON-LD snapshot used by the Showcase tab. `json_ld` |
| `extract_table` | read |  | page | Extract a table on the active page as structured JSON. Handles native <table> with thead/tbody, rowspan/colspan, multi-row headers, and ARIA role="table" / role="grid" patterns. Provide `ref` (preferred) from a prior rea |
| `fetch_url_as_markdown` | read |  | page | Fetch an HTTP(S) URL and return its readable content as Markdown — the same defuddle + readability + turndown pipeline the Scrape tab uses against the active page, but pointed at any URL without opening a tab. Returns {  |
| `find` | read |  | core | Find elements on the active page by natural-language description ("the sign-in button", "the search input near the top", "the paragraph about pricing"). Returns matching refs you can immediately pass to interaction tools |
| `find_text_on_page` | read |  | page | Ctrl+F-style literal text search within a tab. Returns matches with surrounding context + the nearest enclosing element selector. Pass regex=true to use a regular expression. Use when read_active_page would be overkill — |
| `form_input` | action |  | forms | Set the value of a form element by reference. Use string for text inputs, boolean for checkboxes/radios, value or visible label for selects. The handler dispatches on element type — you don't need to specify it. |
| `get_computed_style` | read |  | page | Read computed CSS for an element. Pass `properties` to limit (e.g. ["color","font-size"]) — without it returns a useful default subset (color, background, font, padding, margin, border, display, position, dimensions). Us |
| `get_element_at_point` | read |  | page | Identify the DOM element at viewport coordinates (x, y). Returns tag, text, attrs, and a stable selector. Useful when correlating something seen in a screenshot to a clickable element. |
| `get_element_details` | read |  | page | Deep inspection of a single element by ref: full attribute set, bounding box, visibility, optional computed styles and innerHTML. Use when read_page's summary isn't enough — e.g. reading data-* attributes or checking if  |
| `get_form_fields` | read |  | page | Discover forms on the active tab. For each form, returns id, action, method, and a list of fields: { name, type, value, label, required, placeholder, selector }. Use this BEFORE typing to find the right selector and labe |
| `get_guidance_item` | read |  | guidance | Return the full record for one guidance item by id. Notes include their text; screenshots/GIFs include their cld_files URL; demo references include the linked demo_id (use `replay_demo` to run). |
| `get_page_links` | read |  | page | Return anchor links from the active tab. Each entry is { href, text, title, rel, target }. Filter by href substring, link text substring, or same-origin only. Lighter than read_active_page when you only need link discove |
| `get_page_selection` | read |  | page | Return the user’s currently selected text on the active tab. Empty string if nothing is selected. |
| `get_page_text` | read |  | page | Extract clean readable text from the active page — strips chrome / nav / ads / scripts / hidden DOM. Lighter than read_active_page (which returns full markdown + media + structured data). Best for "read me this article"  |
| `get_request_body` | privileged | 🔒 | debug | Fetch the response body for a specific request seen by read_network_requests. Returns inline text. Pass request_id from a prior drain. |
| `inspect_element` | read |  | page | Deep snapshot of a single element: tag, text, full attributes, bounding rect, key computed styles, ancestor chain (tag + class), and child counts. Useful when a click or type call is failing and you need to understand wh |
| `list_browser_tools` | read |  |  | Index of every browser-tool category the extension exposes. Returns one entry per category: name, label, description, count of tools, name of the category-specific list tool. To get the full schemas for a category, call  |
| `list_demos` | read |  | demos | List every saved demo as { id, name, description, start_url, step_count, parameter_names, created_at, updated_at }. Use to find a demo to replay or describe. |
| `list_guidance` | read |  | guidance | List saved guidance items (notes, screenshots, GIFs, demo references). Pass `domain` to filter; omit to return everything. Returns lightweight summaries — call `get_guidance_item` for full details. |
| `mutation_watch` | read |  | page | Observe an element for `duration_ms` (default 3000, max 30000) and report what changed. Set `kinds` to a subset of ['text','attributes','children','visibility'] to filter; default watches all four. Events: { ts_ms, kind, |
| `navigate` | action |  | core | Navigate a tab to a URL, or move through history with 'back'/'forward'. Protocol defaults to https:// if omitted. After navigating, refs from prior read_page calls are invalidated — call read_page again before referencin |
| `query_elements` | read |  | page | Run document.querySelectorAll on the active tab and return up to `limit` matches as { tag, text, attrs }. `attrs` is a list of attribute names to extract. Use this to find CSS selectors that subsequent action tools can t |
| `read_active_page` | read |  | page | Read the active tab and return a structured snapshot: cleaned article (markdown + html), title, byline, full image/video/link/audio lists, JSON-LD, schema types, SEO signals (headings, meta, alt-text coverage). Pass deep |
| `read_console_messages` | privileged | 🔒 | debug | Read console messages from a tab. Auto-starts CDP console capture if not already running. Filter by level, text regex, or use errors_only=true. Returns { count, messages: [{ level, text, url, line, ts_ms }] }. Console ca |
| `read_network_requests` | privileged | 🔒 | debug | Read HTTP requests (XHR, fetch, documents, etc.) from a tab. Auto-cleared on cross-domain navigation. Filter with url_pattern to keep output manageable. Response bodies are NOT included by default — use get_request_body  |
| `read_page` | read |  | core | Return an accessibility-style summary of the active page. Each interactive element gets a reference id (`ref:N`) you can pass to click_element / type_into_element / scroll_into_view / etc. instead of a CSS selector — ref |
| `read_pdf` | read |  | files | Extract text and structure from a PDF — either one loaded in a browser tab, or one already in cld_files (pass file_id). Returns text by page with optional page range. Use file_id when you have a MediaRef in hand (e.g. fr |
| `record_demo` | action |  | demos | Record a user demonstration that can later be replayed by the agent. Actions: 'start' (begin recording on a tab; clicks, typed text, submits, navigations, and scrolls are captured automatically as the user demonstrates), |
| `remember_for_domain` | action |  | memory | Remember something about a domain so it shows up in `domain_memo` context on every future visit. Use for site-specific lessons: "the PO submit button is the third primary", "DOB format is MM/DD/YYYY here", "this site req |
| `replay_demo` | privileged |  | demos | Replay a saved demo against a tab. Always requires confirmation — the demo can click, type, submit, and navigate. Pass `dry_run: true` to test selector resolution without taking action. Pass `params` to substitute placeh |
| `request_user_takeover` | ask-user |  | ask | Hand keyboard/mouse control to the user so they can perform an action the agent cannot or should not (logging in, MFA, CAPTCHA, sensitive form filling, decisions only the user can make). The user types/clicks directly in |
| `resize_window` | action |  | tabs | Resize the browser window containing a tab. Useful for responsive testing. If tab_id is omitted, resizes the active tab's window. Note: this changes the OS window size, which in turn changes the viewport. |
| `save_guidance_note` | action |  | guidance | Save a domain-scoped note for the user (or for yourself on the next visit). The note auto-surfaces in chat context whenever the user opens a tab on this domain. Use for site-specific lessons that don't fit in `remember_f |
| `scratchpad` | read |  | memory | Session-scoped, in-process scratchpad for stashing structured notes across turns without burning context tokens. Distinct from the canonical `memory` tool which is the persistent long-term memory system. Use scratchpad f |
| `screenshot_region` | read |  | page | Capture a bounded region of the active tab's viewport. Provide `ref` (preferred) from a prior read_page, OR `selector`, OR an explicit viewport `rect: {x,y,w,h}`. The handler scrolls the target into view if needed, captu |
| `sleep` | action |  | interact | Pause the agent for `ms` milliseconds (50ms–5min). Use when waiting for time-based things the page does on its own — a video to play before capturing transcript, an animation to finish, a debounced search to settle, a ra |
| `storage` | privileged |  | advanced | Persistent agent-namespaced storage that survives across runs. Distinct from canonical `memory` which is session-scoped (cleared on SW restart). Actions: 'get' (returns value at key), 'set' (writes any JSON-serializable  |
| `stylesheet` | privileged |  | advanced | Inject or remove a CSS stylesheet on the active (or specified) tab. Actions: 'inject' (apply `css`; pass `persistent: true` to survive navigations), 'remove' (drop a previously-injected `css` block — must match exactly). |
| `submit_form` | action |  | forms | Submit a form. By default the tool clicks the form's primary submit button (so HTML5 validation + framework handlers run). Set via_button=false to fall back to HTMLFormElement.submit() — skips validation but works for fo |
| `tab_groups` | action |  | advanced | Manage tab groups. Actions: 'list' (returns all groups across windows), 'create' (groups `tab_ids` together; optional `title`/`color`), 'add' (puts more `tab_ids` into existing `group_id`), 'remove' (ungroups `tab_ids`), |
| `tabs` | action |  | tabs | Manage browser tabs. Actions: 'list' (all tabs in current window), 'create' (opens new tab; pass url to open at a URL), 'close', 'switch' (brings tab to foreground), 'reload', 'active' (returns the currently active tab — |
| `tasks` | action |  | plan | Manage the agent's own tasklist for the current conversation. Actions: 'add' (one via `title` or many via `items`), 'list' (read current tasks), 'set_status' (`id` + `status`), 'update' (`id` + `title` and/or `note`; pas |
| `update_plan` | ask-user |  | ask | Propose a step-by-step plan and wait for the user to approve, modify, or reject it. Use this BEFORE a multi-step action sequence so you align on intent up front. Returns { approved: true, note?: string } or { approved: f |
| `upload_file` | action |  | files | Upload one or more files to a <input type='file'> element by reference. Pass file_ids — these are MediaRef IDs (e.g. from a previous /files/upload, or from computer.action=screenshot). The handler resolves each file_id t |
| `user` | ask-user |  | core | Pause and talk to the user. Single tool, six modes via `type`: 'confirm' (yes/no — pass question), 'choice' (single pick — pass question + options[]), 'choice_many' (multi pick — pass question + options[]), 'text' (freef |
| `user_todos` | action |  | plan | Assign tasks TO THE USER for the current conversation. The user sees them in a dedicated panel and checks them off; you'll see their state in `user_todos` context on every turn. Actions: 'add' (`title` + optional `contex |
| `wait_for` | read |  | interact | Poll until a condition is met or timeout. Use after navigation or actions that trigger async loads — far more reliable than fixed sleeps. Conditions: 'element' (ref or selector exists and is visible; pass scroll=true to  |

### `matrx_ai` — 123 tools

| name | tier | admin | cat | description |
|---|---|---|---|---|
| `api_news_fetch_headlines` | _(null)_ |  | api | Fetches the top news headlines for a specified country. |
| `bundle:list_amplitude` | _(null)_ |  | mcp | Discovery tool — loads the Amplitude MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_asana` | _(null)_ |  | mcp | Discovery tool — loads the Asana MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_atlassian` | _(null)_ |  | mcp | Discovery tool — loads the Atlassian (Jira & Confluence) MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_box` | _(null)_ |  | mcp | Discovery tool — loads the Box MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_brave-search` | _(null)_ |  | mcp | Discovery tool — loads the Brave Search MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_canva` | _(null)_ |  | mcp | Discovery tool — loads the Canva MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_clay` | _(null)_ |  | mcp | Discovery tool — loads the Clay MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_cloudflare` | _(null)_ |  | mcp | Discovery tool — loads the Cloudflare MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_context7` | _(null)_ |  | mcp | Discovery tool — loads the Context7 MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_deepwiki` | _(null)_ |  | mcp | Discovery tool — loads the DeepWiki MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_figma` | _(null)_ |  | mcp | Discovery tool — loads the Figma MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_github` | _(null)_ |  | mcp | Discovery tool — loads the GitHub MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_google-drive` | _(null)_ |  | mcp | Discovery tool — loads the Google Drive & Docs MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_google-workspace` | _(null)_ |  | mcp | Discovery tool — loads the Google Workspace MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_hex` | _(null)_ |  | mcp | Discovery tool — loads the Hex MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_hubspot` | _(null)_ |  | mcp | Discovery tool — loads the HubSpot MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_intercom` | _(null)_ |  | mcp | Discovery tool — loads the Intercom MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_linear` | _(null)_ |  | mcp | Discovery tool — loads the Linear MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_make` | _(null)_ |  | mcp | Discovery tool — loads the Make MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_miro` | _(null)_ |  | mcp | Discovery tool — loads the Miro MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_monday` | _(null)_ |  | mcp | Discovery tool — loads the Monday.com MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_neon` | _(null)_ |  | mcp | Discovery tool — loads the Neon MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_notion` | _(null)_ |  | mcp | Discovery tool — loads the Notion MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_paypal` | _(null)_ |  | mcp | Discovery tool — loads the PayPal MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_playwright` | _(null)_ |  | mcp | Discovery tool — loads the Playwright MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_postgres` | _(null)_ |  | mcp | Discovery tool — loads the PostgreSQL MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_resend` | _(null)_ |  | mcp | Discovery tool — loads the Resend MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_salesforce` | _(null)_ |  | mcp | Discovery tool — loads the Salesforce MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_sentry` | _(null)_ |  | mcp | Discovery tool — loads the Sentry MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_slack` | _(null)_ |  | mcp | Discovery tool — loads the Slack MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_square` | _(null)_ |  | mcp | Discovery tool — loads the Square MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_stripe` | _(null)_ |  | mcp | Discovery tool — loads the Stripe MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_supabase` | _(null)_ |  | mcp | Discovery tool — loads the Supabase MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_vercel` | _(null)_ |  | mcp | Discovery tool — loads the Vercel MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_webflow` | _(null)_ |  | mcp | Discovery tool — loads the Webflow MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_wix` | _(null)_ |  | mcp | Discovery tool — loads the Wix MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_zapier` | _(null)_ |  | mcp | Discovery tool — loads the Zapier MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `bundle:list_zoho` | _(null)_ |  | mcp | Discovery tool — loads the Zoho MCP server's tool catalog into the active toolset. Triggers a cache-aware sync if the catalog is stale. |
| `cloud_file` | _(null)_ |  | files | Unified tool for working with the user's cloud files (cld_files). Actions: list (paginated, filter by folder or mime_prefix), get (one file's metadata by file_id), delete (soft-delete by default; pass hard=true to purge) |
| `code_execute_python` | _(null)_ |  | code | Execute a Python code snippet in a sandboxed workspace. Accepts raw code or code wrapped in ```python ... ``` markers. Returns stdout, stderr, and exit code. |
| `code_fetch_code` | _(null)_ |  | code | Fetch code from a local project directory using one of three output modes. Use 'signatures' for large codebases to get just function/class signatures (~5-10% token cost). Use 'clean' for focused code review with comments |
| `code_fetch_tree` | _(null)_ |  | code | Get the directory and file tree of a project or subdirectory. Returns only structure — no file content (~1% token cost). Use this first to orient yourself before deciding which subdirectory to fetch with code_fetch_code. |
| `code_fetcher_fetch` | _(null)_ |  | code | Fetches and analyzes code from a directory within a project root, returning formatted text based on the selected output type. |
| `code_python_execute` | _(null)_ |  | code | Executes Python code and returns the output or error. |
| `code_store_html` | _(null)_ |  | code | Store an HTML string to an external service and return a unique ID. Useful for persisting generated HTML pages for later retrieval or sharing. |
| `code_web_store_html` | _(null)_ |  | code | Stores HTML with React and Tailwind CSS for display in the frontend. |
| `core_math_calculate` | _(null)_ |  | core | Evaluates a mathematical expression with basic arithmetic and trigonometric functions. |
| `core_web_read_web_pages` | _(null)_ |  | core | Reads the text content of provided URLs. |
| `core_web_search` | _(null)_ |  | core | Searches the web for recent events, news or any topic. |
| `core_web_search_and_read` | _(null)_ |  | core | Searches the web for recent events, news or any topic and read the result pages |
| `ctx_batch` | _(null)_ |  | context | Retrieve up to 20 deferred context objects in one round trip. Pass `requests: [{key, mode?, offset?, chars?}, ...]` — each entry uses the same vocabulary as ctx_get (modes: full, page, summary). Returns `results` in the  |
| `ctx_create` | _(null)_ |  | context | Create a new context object in the current request manifest. Use this to stash a fresh artifact (draft, analysis, structured record, generated document) so it becomes available to ctx_get, ctx_patch, and downstream turns |
| `ctx_get` | _(null)_ |  | context | Retrieve a single deferred context object by key. Modes: `full` (entire content), `page` (slice via offset+chars; returns has_more+next_offset), `summary` (AI-generated summary, requires a configured summary agent). When |
| `ctx_patch` | _(null)_ |  | context | Edit the content of any context object listed in the Available Context manifest. Uses the same command vocabulary as the built-in code edit tools you already know. Commands:   - str_replace: find old_str verbatim and re |
| `data_sql_create_user_generated_table_data` | _(null)_ |  | data | Create a new table with user-provided data in the supabase_automation_matrix database. |
| `data_sql_execute_query` | _(null)_ |  | data | Execute a raw SQL query against a specified database. Handles INSERT, UPDATE, DELETE, and SELECT operations and returns the query results. |
| `data_sql_get_table_schema` | _(null)_ |  | data | Get detailed schema information for a specific table in the supabase_automation_matrix database. Returns column names, data types, nullability, and defaults. |
| `data_sql_list_tables` | _(null)_ |  | data | List all tables in a specified schema from the supabase_automation_matrix database. Use to discover available tables before querying. |
| `data_user_form_list_options` | _(null)_ |  | data | Create a list specifically for UI form elements like dropdowns, radio buttons, or checkboxes. This tool is optimized for generating form options that will be directly used in the UI. You MUST provide ALL metadata fields  |
| `data_user_lists_batch_update_items` | _(null)_ |  | data | Update multiple items in a list in a single operation. Useful for bulk edits or reorganizing items. The user_id is automatically supplied by the system. |
| `data_user_lists_create_list` | _(null)_ |  | data | Create a new list with multiple items. Use when you need to create a detailed list with items that have descriptions, help text, or grouping. The user_id is automatically supplied by the system. IMPORTANT: The contents o |
| `data_user_lists_create_simple_list` | _(null)_ |  | data | Create a simple list with just text labels. Perfect for quick lists, checklists, or bullet points without detailed metadata. The user_id is automatically supplied by the system. |
| `data_user_lists_get_list_details` | _(null)_ |  | data | Get detailed information about a specific list, including all its items. Use when you need to see the full contents of a list. The user_id is automatically supplied by the system. |
| `data_user_lists_get_user_lists` | _(null)_ |  | data | Get a paginated list of all lists belonging to a user. Use to browse or search through a user's lists. The user_id is automatically supplied by the system. |
| `data_user_lists_update_list_item` | _(null)_ |  | data | Update a specific item in a list. Use to modify the content or organization of a list item. The user_id is automatically supplied by the system. |
| `dataset` | _(null)_ |  | datasets | Unified tool for working with the user's structured datasets (spreadsheet-like tabular data). All operations are dispatched via the `action` field. Replaces the legacy usertable_* tools. Resource id is `dataset_id` (requ |
| `debug_traces_by_call` | _(null)_ | 🔒 | debug | Forensic deep-dive for a single call_id. Returns trace events AND the joined cx_tl_call row (when present — pre-flight rejects have no cx_tl_call row). Output: {call_id, events, tool_call}. |
| `debug_traces_by_conv` | _(null)_ | 🔒 | debug | Full event timeline for one conversation, oldest first. Use to reconstruct the causal sequence of what happened in a single run. Returns {events, count, filter_summary}. |
| `debug_traces_failures_since` | _(null)_ | 🔒 | debug | All FAIL events since a given ISO-8601 timestamp. Convenience wrapper used by the scheduled triage agent — equivalent to debug_traces_recent with event=FAIL and limit=1000. |
| `debug_traces_get_file` | _(null)_ | 🔒 | debug | Fetch the full text contents of one tool-trace file by basename (e.g. tool-trace-2026-05-16_20-38-19.log). Returns {filename, size_bytes, content}. Filename must match tool-trace-*.log; path components are rejected. |
| `debug_traces_list_files` | _(null)_ | 🔒 | debug | List tool-trace files in .matrx-debug/ on the server's local filesystem. Returns name, size_bytes, modified_at, and is_header_only (true for ≤100-byte stubs). Use to discover which trace files exist before fetching one w |
| `debug_traces_recent` | _(null)_ | 🔒 | debug | Query cx_tool_trace for recent tool-dispatch events. Defaults to last hour. Optional filters: event (OK\|FAIL\|SURFACE_REJECT\|NO_EXECUTOR\|LOOP_BLOCK), tool_name, and limit (default 200, max 1000). Returns {events, count, f |
| `fs_list` | _(null)_ |  | filesystem | List files and directories in a workspace directory. Supports recursive listing and glob pattern filtering. Returns entry names, relative paths, type (file/dir), and sizes. Capped at 500 entries. |
| `fs_mkdir` | _(null)_ |  | filesystem | Create a directory in the user workspace. Can create nested parent directories. |
| `fs_patch` | _(null)_ |  | filesystem | Apply one or more anchor-based search-and-replace edits to a single file in the user's workspace. For each edit, finds an exact old_text block in the file's current content and swaps it for new_text. Edits are applied se |
| `fs_read` | _(null)_ |  | filesystem | Read the contents of a file from the user's workspace. Returns the text content, file size, and whether the output was truncated. Supports reading from a byte offset and limiting read size (max 1MB). |
| `fs_search` | _(null)_ |  | filesystem | Search for files by name pattern (glob) or by content (regex) within a workspace directory. File name search returns paths and sizes. Content search returns paths and matching text snippets. Capped at configurable max re |
| `fs_write` | _(null)_ |  | filesystem | Write content to a file in the user's workspace. Supports creating new files, overwriting existing files, or appending. Automatically creates parent directories by default. |
| `get_open_trace_incidents` | _(null)_ | 🔒 | debug | Read open rows from the Tool Trace Incident queue (user_feedback rows with category=tool-trace-incident and resolved_at IS NULL). Returns up to limit incidents newest-first with priority, ai_assessment, ai_solution_propo |
| `load_browser_tools` | _(null)_ |  | browser | Load the relevant subset of browser-control tools for a specific category. Call this when you need to interact with the page beyond the always-on capabilities — pick the category whose tools match the user's task. Catego |
| `math_calculate` | _(null)_ |  | math | Evaluate a mathematical expression. Supports arithmetic operations (+, -, *, /, **, %), trigonometric functions (sin, cos, tan), logarithms (log, log2, log10), square root (sqrt), rounding, and Python math module functio |
| `memory` | _(null)_ |  | memory | Unified tool for agent memory associated with the user. All operations are dispatched via the `action` field. Replaces the legacy memory_* tools. Memories are keyed semantically and scoped to user (default), project, or  |
| `news_get_headlines` | _(null)_ |  | news | Fetch current top news headlines. Filter by country, category, sources, or keyword query. Returns article titles, sources, descriptions, and URLs. At least one of country, sources, or category is required. Sources cannot |
| `note` | _(null)_ |  | productivity | Unified tool for the user's markdown notes. All operations are dispatched via the `action` field. Replaces the legacy note_* tools. Resource id is `note_id`. Actions: list (summaries only — no body), get (full note), cre |
| `picklist` | _(null)_ |  | picklists | Unified tool for working with the user's picklists (checklists, option sets, label sets). All operations are dispatched via the `action` field. Replaces the legacy userlist_* tools. Resource id is `picklist_id`. Actions: |
| `report_trace_incident` | _(null)_ | 🔒 | debug | Write a tool-trace incident into the user_feedback queue (category: Tool Trace Incident) so the dev team / remediation agent can act on it. Dedup-aware: if an open row already exists for the same (tool, err_type, environ |
| `research_web` | _(null)_ |  | research | Perform deep web research on a topic. Searches the web using multiple queries concurrently, scrapes and reads the top results in full, then uses an AI research agent to analyze and condense the findings into a comprehens |
| `seo` | _(null)_ |  | seo | Unified SEO analysis tool. Actions: check_titles (validate meta titles against Google display + character limits), check_descriptions (same for meta descriptions), check_batch (analyze an array of title+description pairs |
| `shell_execute` | _(null)_ |  | shell | Execute a shell command in a sandboxed user workspace directory. Returns stdout, stderr, and exit code. Dangerous commands are blocked. Max timeout is 60s. |
| `shell_python` | _(null)_ |  | shell | Execute a Python script in the user workspace. Writes the code to a temporary file and runs it with python3. Returns stdout, stderr, and exit code. |
| `sql` | _(null)_ |  | database | Unified SQL tool against the user's Supabase database. Actions: query (read-only SELECT — other statements rejected), insert (one row or array; user_id auto-stamped), update (with required `match` filters), delete (with  |
| `task` | _(null)_ |  | productivity | Unified tool for the user's tasks. All operations are dispatched via the `action` field. Replaces the legacy task_* tools. Resource id is `task_id`. Actions: list (compact list, optionally scoped to a project or parent t |
| `text_analyze` | _(null)_ |  | text | Analyze text with multiple analysis types: summary (word/char/sentence/paragraph counts), keywords (top 20 by frequency), entities (emails, URLs, phones, dates), or language (word stats, unique words, avg word length). |
| `text_regex_extract` | _(null)_ |  | text | Extract matches from text using a regular expression pattern. Returns all matches with count (find_all=true) or the first match with span position (find_all=false). Supports capture group selection. |
| `toolcomp_create_component` | _(null)_ |  | internal | Create a new tool UI component record for a tool that doesn't have one yet. Provide tool_id, display_name, and inline_code at minimum. overlay_code is optional but recommended for tools with rich output. Fails safely if  |
| `toolcomp_get_code` | _(null)_ |  | internal | Retrieve the full source code for a specific tool UI component. Specify which sections to return: inline_code, overlay_code, utility_code, header_extras_code, header_subtitle_code. Defaults to inline_code and overlay_cod |
| `toolcomp_get_context` | _(null)_ |  | internal | Fetch a complete, curated context bundle for a specific tool's UI component. Returns the tool definition (parameters, output_schema), a summary of all component code sections with lengths, condensed test samples (event t |
| `toolcomp_get_incident_detail` | _(null)_ |  | internal | Get full details for a specific tool UI component incident (error report). Includes the complete error stack trace and the tool_update_snapshot — the exact data the component received when it crashed. Use to diagnose com |
| `toolcomp_get_sample_detail` | _(null)_ |  | internal | Get the complete data for a specific tool test sample. By default returns a condensed view: arguments, event timeline, output preview. Set full_events=true only when you need to inspect raw streaming chunks or a specific |
| `toolcomp_list_tools` | _(null)_ |  | internal | List and discover available tools. Supports flat paginated listing and grouped views. group_by=prefix groups tools by name prefix (e.g. web for web_search/web_read, toolcomp for all toolcomp_* tools) — best for seeing wh |
| `toolcomp_patch_code` | _(null)_ |  | internal | Apply one or more targeted string replacements to a tool UI component's code without rewriting the entire section. Each patch specifies an old_string to find and a new_string to replace it with. Patches apply in order, e |
| `toolcomp_resolve_incident` | _(null)_ |  | internal | Mark a tool UI component incident as resolved. Call this after deploying a fix so the incident no longer appears in the open incidents list. Optionally add resolution notes. |
| `toolcomp_update_code` | _(null)_ |  | internal | Write updated source code to one or more sections of a tool UI component. Always provide the COMPLETE replacement code for each section — never partial snippets. Optionally bump the patch version automatically and add no |
| `toolcomp_update_settings` | _(null)_ |  | internal | Update non-code settings on a tool UI component: display_name, results_label, allowed_imports, keep_expanded_on_stream, language, is_active, or notes. Does NOT accept code fields — use toolcomp_update_code for those. |
| `travel_create_summary` | _(null)_ |  | travel | Create a comprehensive travel summary combining location, weather, restaurants, activities, and events into a formatted text report. |
| `travel_get_activities` | _(null)_ |  | travel | Get activity recommendations based on city and weather. Returns indoor activities for rainy/snowy weather, outdoor for others (mock data for demo/testing). |
| `travel_get_events` | _(null)_ |  | travel | Get local events happening in a city, taking weather into account. Returns indoor events for rainy/snowy weather, outdoor for others (mock data for demo/testing). |
| `travel_get_location` | _(null)_ |  | travel | Get the user's current location city. Returns a randomly selected city (mock data for demo/testing). |
| `travel_get_restaurants` | _(null)_ |  | travel | Get restaurant recommendations for a specified city. Returns a list of restaurant names (mock data for demo/testing). |
| `travel_get_weather` | _(null)_ |  | travel | Get current weather conditions for a specified city. Returns condition, temperature, and unit (mock data for demo/testing). |
| `vsc_get_state` | _(null)_ |  | ide | Returns current VSCode IDE state fields for this request. Call this when you need the user's active file content, selected text, diagnostics, workspace folders, or git status. Pass the exact field names you need. Availab |
| `web` | _(null)_ |  | web | Unified web tool. Actions: search (Brave-style search; pass `queries` array), read (fetch and extract text from a single `url`; optional AI summarization), batch_read (concurrent fetch of many `urls` — ~N× faster than se |
| `widget_attach_media` | _(null)_ |  | productivity | Attach a media asset (image, video, audio) to the widget. The widget decides where to place it. |
| `widget_create_artifact` | _(null)_ |  | productivity | Create a new structured artifact owned by the widget (flashcard, note, code block, task, etc.). The widget's host decides what kinds of artifacts it accepts. |
| `widget_text_append` | _(null)_ |  | text | Append text to the end of the widget's full content (not relative to a selection). |
| `widget_text_insert_after` | _(null)_ |  | text | Insert text immediately after the widget's current selection without removing the selection. |
| `widget_text_insert_before` | _(null)_ |  | text | Insert text immediately before the widget's current selection without removing the selection. |
| `widget_text_patch` | _(null)_ |  | text | Find-and-replace a verbatim excerpt inside the widget's content. Uses fuzzy matching (exact -> whitespace-normalized -> blank-lines-stripped -> lenient) like note_patch. Returns which pass matched. |
| `widget_text_prepend` | _(null)_ |  | text | Prepend text to the start of the widget's full content (not relative to a selection). |
| `widget_text_replace` | _(null)_ |  | text | Replace the widget's currently-selected text with new text. Used when an agent rewrites, translates, or otherwise transforms a user's selection inline. |
| `widget_update_field` | _(null)_ |  | productivity | Update a single named field on the widget's underlying record. The widget decides which record this applies to (a note, a flashcard, a form field, etc.). |
| `widget_update_record` | _(null)_ |  | productivity | Patch multiple fields on the widget's underlying record in one call. |

### `matrx_local` — 63 tools

| name | tier | admin | cat | description |
|---|---|---|---|---|
| `local_applescript` | _(null)_ |  | local_os | Execute AppleScript on macOS. Controls Finder, Mail, Calendar, Safari, and any scriptable application. |
| `local_archive_create` | _(null)_ |  | local_media | Create a zip or tar archive from files and directories. |
| `local_archive_extract` | _(null)_ |  | local_media | Extract a zip, tar, or 7z archive. |
| `local_bash` | _(null)_ |  | local_execution | Run a shell command on the local system with full OS access. Tracks working directory across calls via session state. |
| `local_bash_output` | _(null)_ |  | local_execution | Read accumulated output from a background shell command started with local_bash (run_in_background=true). |
| `local_battery_status` | _(null)_ |  | local_system | Get battery level, charging status, and estimated time remaining. |
| `local_browser_click` | _(null)_ |  | local_browser | Click an element on the current browser page by CSS selector. |
| `local_browser_eval` | _(null)_ |  | local_browser | Execute JavaScript in the current browser page context. |
| `local_browser_extract` | _(null)_ |  | local_browser | Extract text, HTML, attributes, or form values from the current browser page. |
| `local_browser_navigate` | _(null)_ |  | local_browser | Navigate the local Playwright-controlled browser to a URL. |
| `local_browser_screenshot` | _(null)_ |  | local_browser | Take a screenshot of the current browser page or a specific element. |
| `local_browser_tabs` | _(null)_ |  | local_browser | Manage browser tabs: list, open new, close, or switch to a tab. |
| `local_browser_type` | _(null)_ |  | local_browser | Type text into an input element on the current browser page. |
| `local_clipboard_read` | _(null)_ |  | local_system | Read the current contents of the system clipboard. |
| `local_clipboard_write` | _(null)_ |  | local_system | Write text to the system clipboard. |
| `local_disk_usage` | _(null)_ |  | local_system | Get disk usage statistics for all mounted volumes or a specific path. |
| `local_edit_file` | _(null)_ |  | local_file_ops | Apply a precise string replacement to a file. old_string must match exactly (including whitespace) and be unique in the file. |
| `local_fetch_url` | _(null)_ |  | local_network | Fetch content from a URL using HTTP (curl-cffi). Returns status, headers, and body. |
| `local_fetch_with_browser` | _(null)_ |  | local_network | Fetch a URL using a headless browser (Playwright). Use when the page requires JavaScript rendering. |
| `local_focus_app` | _(null)_ |  | local_process | Bring an application window to the foreground. Uses AppleScript on macOS, PowerShell on Windows. |
| `local_focus_window` | _(null)_ |  | local_window | Bring a window to the foreground by app name and optional title. |
| `local_get_installed_apps` | _(null)_ |  | local_os | List installed applications on the system, optionally filtered by name. |
| `local_glob` | _(null)_ |  | local_file_ops | Find files matching a glob pattern on the local filesystem. |
| `local_grep` | _(null)_ |  | local_file_ops | Search file contents for a regex pattern on the local filesystem. |
| `local_hotkey` | _(null)_ |  | local_input | Send a keyboard shortcut (e.g. 'cmd+c', 'ctrl+shift+s', 'alt+tab'). Modifiers: cmd/command, ctrl/control, alt/option, shift. |
| `local_image_ocr` | _(null)_ |  | local_media | Extract text from an image file using OCR (Tesseract). |
| `local_image_resize` | _(null)_ |  | local_media | Resize or convert an image file. |
| `local_kill_process` | _(null)_ |  | local_process | Kill a running process by PID or name. |
| `local_launch_app` | _(null)_ |  | local_process | Launch an application on the local system by name or path. |
| `local_list_directory` | _(null)_ |  | local_file_ops | List the contents of a directory on the local filesystem. |
| `local_list_document_folders` | _(null)_ |  | local_documents | List all folders in the local document store. |
| `local_list_documents` | _(null)_ |  | local_documents | List documents in the local document store (~/.matrx/documents/). |
| `local_list_ports` | _(null)_ |  | local_process | List listening TCP/UDP ports and the processes bound to them. |
| `local_list_processes` | _(null)_ |  | local_process | List running processes with PID, name, CPU%, and memory usage. |
| `local_list_windows` | _(null)_ |  | local_window | List all visible windows with title, app name, position, and size. |
| `local_mdns_discover` | _(null)_ |  | local_network | Discover mDNS/Bonjour services on the local network (smart devices, printers, AirPlay, HomeKit, etc.). |
| `local_minimize_window` | _(null)_ |  | local_window | Minimize, maximize, or restore a window. |
| `local_mouse_click` | _(null)_ |  | local_input | Click the mouse at specific screen coordinates. |
| `local_mouse_move` | _(null)_ |  | local_input | Move the mouse cursor to specific screen coordinates. |
| `local_move_window` | _(null)_ |  | local_window | Move and/or resize a window by app name. |
| `local_network_info` | _(null)_ |  | local_network | Get local network information: IPs, interfaces, gateway, DNS, MAC addresses. |
| `local_network_scan` | _(null)_ |  | local_network | Scan the local network for active hosts using ARP. |
| `local_notify` | _(null)_ |  | local_system | Show a desktop notification on the local system. |
| `local_open_path` | _(null)_ |  | local_system | Open a file or directory in the system's default application (Finder on macOS, Explorer on Windows). |
| `local_open_url` | _(null)_ |  | local_system | Open a URL in the default web browser on the local system. |
| `local_pdf_extract` | _(null)_ |  | local_media | Extract text (and optionally images) from a PDF file. |
| `local_port_scan` | _(null)_ |  | local_network | Scan a host for open TCP ports. |
| `local_powershell` | _(null)_ |  | local_os | Execute a PowerShell script on Windows. Has access to COM, WMI, .NET APIs, and the registry. |
| `local_read_document` | _(null)_ |  | local_documents | Read the full content of a document from the local document store. |
| `local_read_file` | _(null)_ |  | local_file_ops | Read a file from the local filesystem. Returns line-numbered content. Supports offset and limit for large files. |
| `local_research` | _(null)_ |  | local_network | Deep web research: search + scrape all results + compile findings into a structured report. |
| `local_scrape` | _(null)_ |  | local_network | Scrape one or more URLs with the full scraper pipeline (JS rendering, content extraction, optional caching). |
| `local_screenshot` | _(null)_ |  | local_system | Take a screenshot of the local screen and return it as a base64-encoded image. |
| `local_search` | _(null)_ |  | local_network | Search the web using Brave Search API and return results. |
| `local_search_documents` | _(null)_ |  | local_documents | Search document content in the local store by keyword. |
| `local_system_info` | _(null)_ |  | local_system | Get detailed information about the local system: OS, CPU, RAM, disk, hostname. |
| `local_system_resources` | _(null)_ |  | local_system | Get real-time CPU, memory, disk, and network usage statistics. |
| `local_task_stop` | _(null)_ |  | local_execution | Stop a background shell task started with local_bash. |
| `local_top_processes` | _(null)_ |  | local_system | Get top N processes by CPU or memory usage. |
| `local_type_text` | _(null)_ |  | local_input | Type text using the system keyboard (simulates keystrokes). |
| `local_write_document` | _(null)_ |  | local_documents | Create or update a Markdown document in the local document store. |
| `local_write_file` | _(null)_ |  | local_file_ops | Write content to a file on the local filesystem. Creates parent directories as needed. |
| `record_gif` | _(null)_ |  | advanced | Record browser actions and export as an animated GIF. Actions: 'start_recording', 'stop_recording', 'export' (generates and either downloads or drops onto a page element), 'clear' (discard frames). Take a screenshot righ |

---

## 2. matrx-extend tool details

Each entry includes the full description + parameter summary so
the reviewer can spot redundant fields, stale text, or schema gaps.
Required params are **bold**.

### `ai`

- **tier:** read · **category:** advanced · **active:** ✅ · **version:** 7

> On-device AI (Gemini Nano + siblings). Free, offline, multimodal, no network. Actions: 'check_availability' (probe per-API readiness), 'summarize' (text→summary), 'classify' (text+categories→label), 'extract_json' (text+schema→object), 'translate' (text+target_lang), 'detect_language' (text→BCP-47), 'proofread' (text→corrections), 'describe_image' (image_url OR image_base64+mime_type → caption), 'check_prompt_injection' (text→risk assessment). Use BEFORE expensive cloud calls when on-device quality permits.

**Params:** text: `string`, **action**: `string[check_availability\|summarize\|classify\|extract_json\|translate\|detect_language\|proofread\|describe_image\|check_prompt_injection]`, prompt: `string`, schema: `?`, image_url: `string`, mime_type: `string`, categories: `array`, source_lang: `string`, target_lang: `string`, image_base64: `string`

### `browser_batch`

- **tier:** read · **category:** core · **active:** ✅ · **version:** 9

> Execute up to 20 read-tier tool calls in one round trip. Pass `calls: [{ name, arguments }]`. Returns `results: [{ name, ok, output \| error }]` in order. Action / ask-user / privileged tools are NOT permitted inside a batch — call them individually so the user can approve. Use this for predictable multi-step reads (read_page + take_screenshot + list_open_tabs) where each call is independent.

**Params:** **calls**: `array`, stop_on_error: `boolean`

### `cdp_a11y_tree`

- **tier:** privileged · 🔒 admin · **category:** debug · **active:** ✅ · **version:** 5

> Dump the accessibility tree of the active tab via Accessibility.getFullAXTree. Each node has { role, name, value, description, properties, children }. Use INSTEAD of read_active_page when you want a clean semantic view of the page — it omits decorative DOM and surfaces aria-roles, button labels, form-field associations directly. Best for vision-free reasoning.

**Params:** tab_id: `integer`, max_nodes: `integer`

### `cdp_emulate`

- **tier:** privileged · 🔒 admin · ⚡ privileged · **category:** advanced · **active:** ✅ · **version:** 8

> Override viewport / device metrics on an attached CDP tab for responsive testing. Actions: 'set' (apply `width`+`height`+optional `device_scale_factor`/`mobile`/`user_agent`), 'clear' (revert overrides). Tab must be attached via cdp_session first.

**Params:** width: `integer`, **action**: `string[set\|clear]`, height: `integer`, mobile: `boolean`, tab_id: `integer`, user_agent: `string`, device_scale_factor: `number`

### `cdp_full_page_screenshot`

- **tier:** privileged · 🔒 admin · **category:** debug · **active:** ✅ · **version:** 7

> Capture the FULL page (not just viewport) as base64. Use instead of take_screenshot for whole-article / long-form pages. Pass a `profile` to optimize for a specific vision model (same profile names as take_screenshot). The tool auto-computes capture_scale so the long edge lands at the profile's target. Returns { ok, media_type, format, image_base64, byte_length, capture_scale, profile, est_tokens }. The `media_type` field is ready to drop into an image content block — the agent server should pass it through verbatim, NOT stringify the whole object.

**Params:** format: `string[png\|jpeg\|webp]`, tab_id: `integer`, profile: `string[auto\|auto-final\|anthropic-default\|anthropic-hires\|openai-original\|openai-high\|openai-low\|gemini-screenshot\|gemini-overview\|gemini-2.5-default\|ocr-heavy\|lossless]`, quality: `integer`, full_page: `boolean`, capture_scale: `number`

### `cdp_input_click_xy`

- **tier:** privileged · 🔒 admin · **category:** debug · **active:** ✅ · **version:** 5

> Synthesize a real mouse click at viewport coordinates (x, y) via Input.dispatchMouseEvent. Bypasses event-handler shadowing, works through shadow DOM and cross-origin iframes (OOPIFs) — the most reliable click in existence. Use when click_element fails because the page intercepts synthetic clicks.

**Params:** **x**: `number`, **y**: `number`, button: `string[left\|right\|middle]`, tab_id: `integer`, click_count: `integer`

### `cdp_input_type`

- **tier:** privileged · 🔒 admin · **category:** debug · **active:** ✅ · **version:** 5

> Type literal text into whatever element currently has focus, via Input.insertText. Fires beforeinput / input / compositionend events correctly so React-controlled inputs accept it. Use after focus_element + when type_into_element fails.

**Params:** **text**: `string`, tab_id: `integer`

### `cdp_network_capture_drain`

- **tier:** privileged · 🔒 admin · ⚡ privileged · **category:** debug · **active:** ✅ · **version:** 6

> Drain captured Network events from a tab's buffer. Each entry has { request_id, url, method, status, mime_type, request_headers, response_headers, finished, failed, ts_ms }. Use cdp_network_get_body with a request_id to fetch a response body lazily.

**Params:** max: `integer`, tab_id: `integer`, url_contains: `string`

### `cdp_network_capture_start`

- **tier:** privileged · 🔒 admin · ⚡ privileged · **category:** debug · **active:** ✅ · **version:** 5

> Begin capturing every Network event on a tab (default: active). After this, navigate or interact with the page; calls accumulate in a buffer. Use cdp_network_capture_drain to read them. Use cdp_network_capture_stop when finished.

**Params:** tab_id: `integer`

### `cdp_network_capture_stop`

- **tier:** privileged · 🔒 admin · ⚡ privileged · **category:** debug · **active:** ✅ · **version:** 5

> Stop capturing Network events on a tab and clear its buffer.

**Params:** tab_id: `integer`

### `cdp_network_get_body`

- **tier:** privileged · 🔒 admin · ⚡ privileged · **category:** debug · **active:** ✅ · **version:** 7

> Fetch the response body for a captured request, by request_id (from cdp_network_capture_drain). Returns { body, base64_encoded }. Bodies are large so we don't buffer them eagerly.

**Params:** tab_id: `integer`, **request_id**: `string`

### `cdp_perf_metrics`

- **tier:** read · 🔒 admin · **category:** debug · **active:** ✅ · **version:** 5

> Read Performance.getMetrics for a tab. Returns { Documents, Frames, JSHeapUsedSize, LayoutCount, RecalcStyleCount, ScriptDuration, TaskDuration, … }. Useful when an action triggered chaos and you need to measure it.

**Params:** tab_id: `integer`

### `cdp_print_pdf`

- **tier:** privileged · 🔒 admin · **category:** debug · **active:** ✅ · **version:** 5

> Print a tab to PDF via Page.printToPDF. Returns base64 PDF data. Useful for archival, sharing, or feeding the PDF to a downstream model.

**Params:** tab_id: `integer`, landscape: `boolean`, print_background: `boolean`

### `cdp_session`

- **tier:** privileged · 🔒 admin · ⚡ privileged · **category:** advanced · **active:** ✅ · **version:** 8

> Manage Chrome DevTools Protocol attachments. Actions: 'attach' (begin debugger session on `tab_id` — required before any other cdp_* tool), 'detach' (end session), 'list' (which tabs are currently attached). Admin + `debugger` permission.

**Params:** **action**: `string[attach\|detach\|list]`, tab_id: `integer`

### `chrome_bookmarks`

- **tier:** read · **category:** advanced · **active:** ✅ · **version:** 7

> Read the user's bookmarks. Actions: 'search' (free-text against title and URL; pass `query`), 'tree' (folder tree starting at `folder_id` or root, `max_depth` deep). Each bookmark has id/title/url/parent_id/date_added.

**Params:** limit: `integer`, query: `string`, **action**: `string[search\|tree]`, folder_id: `string`, max_depth: `integer`

### `chrome_cookies`

- **tier:** privileged · 🔒 admin · ⚡ privileged · **category:** advanced · **active:** ✅ · **version:** 8

> Manage cookies for any domain. Actions: 'get' (read; pass `name` for a specific cookie or omit for all matching), 'set' (write; requires `name` + `value`; optional `domain`/`path`/`expires_in_seconds`/`same_site`/`http_only`/`secure`), 'delete' (requires `name`). Always pass `url` (or `domain` for 'get'). Admin-only.

**Params:** **url**: `string`, name: `string`, path: `string`, value: `string`, **action**: `string[get\|set\|delete]`, domain: `string`, secure: `boolean`, http_only: `boolean`, same_site: `string[strict\|lax\|no_restriction]`, expires_in_seconds: `integer`

### `chrome_history`

- **tier:** read · **category:** advanced · **active:** ✅ · **version:** 7

> Read browsing history. Actions: 'search' (free-text against title/URL; pass `query`, optional `start_time_ms`/`end_time_ms`/`limit`), 'recent' (last N `minutes`, default 60).

**Params:** limit: `integer`, query: `string`, **action**: `string[search\|recent]`, minutes: `integer`, end_time_ms: `integer`, start_time_ms: `integer`

### `chrome_recently_closed`

- **tier:** action · **category:** advanced · **active:** ✅ · **version:** 7

> Recently-closed tabs and windows. Actions: 'list' (returns sessions with id/url/title/lastModified), 'restore' (reopens; `session_id` optional — defaults to the most recently closed).

**Params:** **action**: `string[list\|restore]`, session_id: `string`

### `chrome_record_gif`

- **tier:** action · 🔒 admin · **category:** advanced · **active:** ✅ · **version:** 7

> Record browser actions and export as an animated GIF. Actions: 'start_recording', 'stop_recording', 'export' (generates and either downloads or drops onto a page element), 'clear' (discard frames). Take a screenshot right after start and right before stop to capture clean first/last frames. 'export' returns {file_id, file_url} when not dropping. Drop target accepts ref (preferred) or coordinate.

**Params:** ref: `string`, **action**: `string[start_recording\|stop_recording\|export\|clear]`, **tab_id**: `string`, options: `object`, download: `boolean`, filename: `string`, coordinate: `array`

### `chrome_record_tab_video`

- **tier:** action · 🔒 admin · **category:** advanced · **active:** ✅ · **version:** 5

> Record video of a tab via chrome.tabCapture + MediaRecorder and upload to cld_files. Args: duration_ms (default 5000, max 60000), audio (default false), tab_id? (defaults to assigned tab), filename?. Returns { ok, file_id, file_url, mime_type, duration_ms, size_bytes }. Requires `tabCapture` optional permission — when missing returns ok:false with a remediation hint pointing the user to Settings → Advanced → Tab video capture.

**Params:** audio: `boolean`, tab_id: `integer`, filename: `string`, duration_ms: `integer`

### `chrome_save_page_as_mhtml`

- **tier:** action · 🔒 admin · **category:** files · **active:** ✅ · **version:** 5

> Snapshot a tab as a self-contained MHTML archive (HTML + every resource inlined). Returns base64 MHTML data. Use for: archival, sharing a frozen page, feeding the agent a stable snapshot it can reanalyze later.

**Params:** tab_id: `integer`

### `chrome_tab_audio_inspect`

- **tier:** read · **category:** tabs · **active:** ✅ · **version:** 6

> Report which open tabs are currently making noise, were recently audible (within the last 60s), or are muted. Each entry: { id, title, url, audible, muted, active, window_id, last_audible_at }. Useful for finding 'the noisy tab' and for media-aware automation.

**Params:** _(no parameters)_

### `chrome_webmcp`

- **tier:** action · 🔒 admin · **category:** advanced · **active:** ✅ · **version:** 8

> Discover and invoke tools that pages have registered via `navigator.modelContext.registerTool` (Chrome 146+). Actions: 'check' (probe API + count tools), 'list' (enumerate page-registered tools), 'call' (invoke; pass `tool_name` and `arguments`). Admin-only experimental capability.

**Params:** **action**: `string[check\|list\|call]`, arguments: `?`, tool_name: `string`

### `clipboard`

- **tier:** action · **category:** files · **active:** ✅ · **version:** 8

> Read from or write to the system clipboard. Actions: 'read' (returns current clipboard text), 'write' (sets clipboard text — pass `text`). Useful for 'copy this for the user' and 'paste what I just copied' workflows.

**Params:** text: `string`, **action**: `string[read\|write]`

### `computer`

- **tier:** action · **category:** core · **active:** ✅ · **version:** 9

> Mouse, keyboard, and screenshot interactions. Prefer 'ref' over 'coordinate' when targeting elements; coordinates survive poorly across scrolls and layout changes. The 'screenshot' action persists the image to cloud and returns {file_id, file_url, width, height, mime_type} — use that file_id with upload_file or drop_file later. Use wait_for for synchronization, NOT a fixed sleep.

**Params:** ref: `string`, text: `string`, **action**: `string[left_click\|right_click\|double_click\|triple_click\|type\|key\|scroll\|hover\|screenshot\|left_click_drag\|scroll_to\|focus\|blur]`, repeat: `integer`, **tab_id**: `string`, modifiers: `string`, coordinate: `array`, scroll_amount: `integer`, scroll_direction: `string[up\|down\|left\|right]`, start_coordinate: `array`

### `delete_demo`

- **tier:** action · **category:** demos · **active:** ✅ · **version:** 6

> Delete a saved demo by id. Cannot be undone.

**Params:** **demo_id**: `string`

### `delete_guidance_item`

- **tier:** action · **category:** guidance · **active:** ✅ · **version:** 7

> Delete a saved guidance item by id. Cannot be undone. For demo references, this only removes the guidance index entry — the underlying demo lives in its own storage and must be deleted via `delete_demo`.

**Params:** **id**: `string`

### `describe_demo`

- **tier:** read · **category:** demos · **active:** ✅ · **version:** 7

> Return the full step list for a saved demo. Each step has { kind, url, selector_chain, element_snapshot, input_text, param_placeholder, is_sensitive }. Use before replay to verify what the demo will do.

**Params:** **demo_id**: `string`

### `desktop_run_command`

- **tier:** privileged · **category:** advanced · **active:** ✅ · **version:** 5

> Invoke a command on the matrx-local desktop bridge. Available commands depend on what matrx-local exposes (file ops, system info, window control, etc.). Returns { ok, data?, error? }. Fails fast with reason="desktop unavailable" if the bridge isn't connected — check via the desktop:availability channel before calling.

**Params:** args: `object`, **command**: `string`

### `downloads`

- **tier:** action · **category:** files · **active:** ✅ · **version:** 9

> Manage file downloads. Actions: 'list' (recent downloads with id/filename/url/state/bytes), 'cancel' (abort a pending download), 'confirm' (no-op; Chrome auto-completes downloads), 'download_url' (trigger a download from a URL). download_id required for cancel/confirm; url required for download_url.

**Params:** url: `string`, **action**: `string[list\|confirm\|cancel\|download_url]`, filename: `string`, download_id: `string`

### `drop_file`

- **tier:** action · **category:** files · **active:** ✅ · **version:** 9

> Synthesize a drag-and-drop of a single file onto a target element or coordinate. Use for drop zones that aren't backed by <input type='file'>. Provide ref OR coordinate. file_id is a MediaRef (e.g. from a prior screenshot or upload).

**Params:** ref: `string`, **tab_id**: `string`, **file_id**: `string`, filename: `string`, coordinate: `array`

### `evaluate_javascript`

- **tier:** privileged · 🔒 admin · ⚡ privileged · **category:** advanced · **active:** ✅ · **version:** 10

> Evaluate JavaScript in the page context. Returns the value of the last expression — do NOT use 'return' at top level. Admin-gated. Prefer DOM tools (read_page, find, computer, form_input) when possible — JS exec is XSS-equivalent and bypasses our safety nets.

**Params:** arg: `?`, **text**: `string`, tab_id: `string`

### `extract_microdata`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 6

> Extract every structured-data signal on the active page in one call: { snapshot, json_ld, microdata, schema_org_types, counts }. `snapshot` is the OG/Twitter/canonical/JSON-LD snapshot used by the Showcase tab. `json_ld` returns each JSON-LD block (flattens @graph; honors `ld_type` filter). `microdata` walks every [itemscope][itemtype] tree (honors `itemtype` filter). `schema_org_types` unions all detected types so you can answer 'is this a Product page?' in one read. Same code paths as the user-facing Showcase → JSON-LD / Microdata / Snapshot sub-tabs, so improvements to either surface flow both ways.

**Params:** kinds: `array`, ld_type: `string`, itemtype: `string`

### `extract_table`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 6

> Extract a table on the active page as structured JSON. Handles native <table> with thead/tbody, rowspan/colspan, multi-row headers, and ARIA role="table" / role="grid" patterns. Provide `ref` (preferred) from a prior read_page, or `selector` (any CSS), or omit both to pick the largest visible table. Returns { columns: [{ index, path: [headerLevels...] }], rows: [{ cells: [{ value, is_header, colspan?, rowspan? }] }], merged_cells, row_count, column_count }. Use this instead of cell-by-cell scraping — one call versus dozens.

**Params:** ref: `string`, max_rows: `integer`, selector: `string`, normalize: `boolean`, compute_header_paths: `boolean`

### `fetch_url_as_markdown`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 7

> Fetch an HTTP(S) URL and return its readable content as Markdown — the same defuddle + readability + turndown pipeline the Scrape tab uses against the active page, but pointed at any URL without opening a tab. Returns { title, markdown, byline, excerpt, extractor, word_count, reading_time_minutes, metadata, ld_json, http_status, final_url, content_type, truncated }. Pass `use_session: true` to attach the user's cookies (paywalled / logged-in pages). Pass `include_extras: true` to also get links / images / videos / SEO audit. Non-HTML URLs (PDFs, JSON, etc.) are rejected with a clear error — use `read_pdf` for PDFs.

**Params:** **url**: `string`, max_chars: `integer`, user_agent: `string`, use_session: `boolean`, include_extras: `boolean`, follow_redirects: `boolean`

### `find`

- **tier:** read · **category:** core · **active:** ✅ · **version:** 10

> Find elements on the active page by natural-language description ("the sign-in button", "the search input near the top", "the paragraph about pricing"). Returns matching refs you can immediately pass to interaction tools. Uses on-device AI for matching when available; falls back to text similarity. Reuses any fresh `read_page` scrape — call it once before a series of finds. By default also searches non-interactive content (headings/paragraphs) so you can locate sections by topic; set `include_content:false` to restrict to clickable elements only. Returns { matches: [{ ref, name, role, score, reason }] }.

**Params:** limit: `integer`, **query**: `string`, tab_id: `string`, max_candidates: `integer`, include_content: `boolean`

### `find_text_on_page`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 10

> Ctrl+F-style literal text search within a tab. Returns matches with surrounding context + the nearest enclosing element selector. Pass regex=true to use a regular expression. Use when read_active_page would be overkill — e.g. "where on this page does it say 'click here to download'?". For natural-language search, use find instead.

**Params:** limit: `integer`, **query**: `string`, regex: `boolean`, tab_id: `string`, context_chars: `integer`, case_sensitive: `boolean`

### `form_input`

- **tier:** action · **category:** forms · **active:** ✅ · **version:** 7

> Set the value of a form element by reference. Use string for text inputs, boolean for checkboxes/radios, value or visible label for selects. The handler dispatches on element type — you don't need to specify it.

**Params:** **ref**: `string`, **value**: `string\|number\|boolean`, **tab_id**: `string`

### `get_computed_style`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 7

> Read computed CSS for an element. Pass `properties` to limit (e.g. ["color","font-size"]) — without it returns a useful default subset (color, background, font, padding, margin, border, display, position, dimensions). Useful for debugging visual issues or matching styles.

**Params:** **selector**: `string`, properties: `array`

### `get_element_at_point`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 5

> Identify the DOM element at viewport coordinates (x, y). Returns tag, text, attrs, and a stable selector. Useful when correlating something seen in a screenshot to a clickable element.

**Params:** **x**: `number`, **y**: `number`

### `get_element_details`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 9

> Deep inspection of a single element by ref: full attribute set, bounding box, visibility, optional computed styles and innerHTML. Use when read_page's summary isn't enough — e.g. reading data-* attributes or checking if something is hidden by CSS. Avoids needing evaluate_javascript for routine introspection. innerHTML is capped at 50 KB; response includes truncated:true when exceeded.

**Params:** **ref**: `string`, tab_id: `string`, include_html: `boolean`, include_styles: `boolean`

### `get_form_fields`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 5

> Discover forms on the active tab. For each form, returns id, action, method, and a list of fields: { name, type, value, label, required, placeholder, selector }. Use this BEFORE typing to find the right selector and label so you fill the right field.

**Params:** selector: `string`

### `get_guidance_item`

- **tier:** read · **category:** guidance · **active:** ✅ · **version:** 7

> Return the full record for one guidance item by id. Notes include their text; screenshots/GIFs include their cld_files URL; demo references include the linked demo_id (use `replay_demo` to run).

**Params:** **id**: `string`

### `get_page_links`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 7

> Return anchor links from the active tab. Each entry is { href, text, title, rel, target }. Filter by href substring, link text substring, or same-origin only. Lighter than read_active_page when you only need link discovery.

**Params:** limit: `integer`, href_contains: `string`, text_contains: `string`, same_origin_only: `boolean`

### `get_page_selection`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 5

> Return the user’s currently selected text on the active tab. Empty string if nothing is selected.

**Params:** _(no parameters)_

### `get_page_text`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 10

> Extract clean readable text from the active page — strips chrome / nav / ads / scripts / hidden DOM. Lighter than read_active_page (which returns full markdown + media + structured data). Best for "read me this article" style asks. Returns { url, title, byline, text, char_count }.

**Params:** tab_id: `string`, max_chars: `integer`

### `get_request_body`

- **tier:** privileged · 🔒 admin · ⚡ privileged · **category:** debug · **active:** ✅ · **version:** 9

> Fetch the response body for a specific request seen by read_network_requests. Returns inline text. Pass request_id from a prior drain.

**Params:** tab_id: `string`, **request_id**: `string`

### `inspect_element`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 6

> Deep snapshot of a single element: tag, text, full attributes, bounding rect, key computed styles, ancestor chain (tag + class), and child counts. Useful when a click or type call is failing and you need to understand why.

**Params:** **selector**: `string`

### `list_browser_tools`

- **tier:** read · **category:** ? · **active:** ✅ · **version:** 5

> Index of every browser-tool category the extension exposes. Returns one entry per category: name, label, description, count of tools, name of the category-specific list tool. To get the full schemas for a category, call its `list_tool` (e.g. `list_page_tools`). Use this whenever the model needs more capabilities than its current toolset offers.

**Params:** _(no parameters)_

### `list_demos`

- **tier:** read · **category:** demos · **active:** ✅ · **version:** 5

> List every saved demo as { id, name, description, start_url, step_count, parameter_names, created_at, updated_at }. Use to find a demo to replay or describe.

**Params:** _(no parameters)_

### `list_guidance`

- **tier:** read · **category:** guidance · **active:** ✅ · **version:** 7

> List saved guidance items (notes, screenshots, GIFs, demo references). Pass `domain` to filter; omit to return everything. Returns lightweight summaries — call `get_guidance_item` for full details.

**Params:** domain: `string`

### `mutation_watch`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 6

> Observe an element for `duration_ms` (default 3000, max 30000) and report what changed. Set `kinds` to a subset of ['text','attributes','children','visibility'] to filter; default watches all four. Events: { ts_ms, kind, before?, after?, attribute?, added_count?, removed_count?, visible? }. Use this instead of polling read_page when waiting for async UI to settle.

**Params:** ref: `string`, kinds: `array`, selector: `string`, max_events: `integer`, duration_ms: `integer`

### `navigate`

- **tier:** action · **category:** core · **active:** ✅ · **version:** 7

> Navigate a tab to a URL, or move through history with 'back'/'forward'. Protocol defaults to https:// if omitted. After navigating, refs from prior read_page calls are invalidated — call read_page again before referencing elements.

**Params:** **url**: `string`, force: `boolean`, **tab_id**: `string`

### `query_elements`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 5

> Run document.querySelectorAll on the active tab and return up to `limit` matches as { tag, text, attrs }. `attrs` is a list of attribute names to extract. Use this to find CSS selectors that subsequent action tools can target.

**Params:** limit: `integer`, **selector**: `string`, attributes: `array`

### `read_active_page`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 5

> Read the active tab and return a structured snapshot: cleaned article (markdown + html), title, byline, full image/video/link/audio lists, JSON-LD, schema types, SEO signals (headings, meta, alt-text coverage). Pass deep=true to scroll the page top→bottom first to trigger lazy-loaded images and infinite-scroll content before reading. Use this whenever you need to understand or quote the page.

**Params:** deep: `boolean`

### `read_console_messages`

- **tier:** privileged · 🔒 admin · **category:** debug · **active:** ✅ · **version:** 10

> Read console messages from a tab. Auto-starts CDP console capture if not already running. Filter by level, text regex, or use errors_only=true. Returns { count, messages: [{ level, text, url, line, ts_ms }] }. Console capture stays on until cdp_detach or tab close.

**Params:** max: `integer`, clear: `boolean`, limit: `integer`, tab_id: `string`, pattern: `string`, auto_start: `boolean`, errors_only: `boolean`, level_filter: `array`

### `read_network_requests`

- **tier:** privileged · 🔒 admin · ⚡ privileged · **category:** debug · **active:** ✅ · **version:** 9

> Read HTTP requests (XHR, fetch, documents, etc.) from a tab. Auto-cleared on cross-domain navigation. Filter with url_pattern to keep output manageable. Response bodies are NOT included by default — use get_request_body to fetch a specific body. The buffer is per-tab and bounded; old entries fall off the back.

**Params:** clear: `boolean`, limit: `integer`, tab_id: `string`, auto_start: `boolean`, url_pattern: `string`, include_body: `boolean`

### `read_page`

- **tier:** read · **category:** core · **active:** ✅ · **version:** 10

> Return an accessibility-style summary of the active page. Each interactive element gets a reference id (`ref:N`) you can pass to click_element / type_into_element / scroll_into_view / etc. instead of a CSS selector — refs are stable across DOM mutations within the same page lifetime. Pass interactive_only=false to include headings, paragraphs, and labels too. Refs invalidate on navigation; call this again after navigating. Returns { url, title, count, elements: [{ ref, role, name, tag, text, visible, bounds? }] }.

**Params:** filter: `string[interactive\|all]`, tab_id: `string`, max_chars: `integer`, max_nodes: `integer`, include_text: `boolean`, include_bounds: `boolean`, include_hidden: `boolean`, interactive_only: `boolean`, trigger_lazy_load: `boolean`

### `read_pdf`

- **tier:** read · **category:** files · **active:** ✅ · **version:** 9

> Extract text and structure from a PDF — either one loaded in a browser tab, or one already in cld_files (pass file_id). Returns text by page with optional page range. Use file_id when you have a MediaRef in hand (e.g. from a prior download); use tab_id when the PDF is open in the browser.

**Params:** tab_id: `string`, file_id: `string`, page_end: `integer`, max_chars: `integer`, page_start: `integer`

### `record_demo`

- **tier:** action · **category:** demos · **active:** ✅ · **version:** 7

> Record a user demonstration that can later be replayed by the agent. Actions: 'start' (begin recording on a tab; clicks, typed text, submits, navigations, and scrolls are captured automatically as the user demonstrates), 'stop' (save the recording with a name + parameter declarations; sensitive fields like passwords are auto-parameterised), 'discard' (throw away the in-flight recording without saving), 'status' (read; report whether a recording is active and how many steps have been captured). Coach the user: ask them to walk through the workflow, then call stop when they say they're done. Saved demos are replayed via `replay_demo`.

**Params:** _(no parameters)_

### `remember_for_domain`

- **tier:** action · **category:** memory · **active:** ✅ · **version:** 6

> Remember something about a domain so it shows up in `domain_memo` context on every future visit. Use for site-specific lessons: "the PO submit button is the third primary", "DOB format is MM/DD/YYYY here", "this site requires SSO via Okta". Notes are free-form prose; hints are structured key/value pairs you can look up by name. Memos on a parent domain (e.g., atlassian.net) automatically apply to subdomains. Returns the updated memo so you can see what is remembered now.

**Params:** note: `string`, hints: `object`, **domain**: `string`

### `replay_demo`

- **tier:** privileged · ⚡ privileged · **category:** demos · **active:** ✅ · **version:** 7

> Replay a saved demo against a tab. Always requires confirmation — the demo can click, type, submit, and navigate. Pass `dry_run: true` to test selector resolution without taking action. Pass `params` to substitute placeholders (sensitive fields like passwords MUST be supplied this way; the agent should ask the user via `user(type='secret', ...)` first). Returns per-step results with `resolved_via` showing which selector strategy hit.

**Params:** params: `object`, tab_id: `integer`, **demo_id**: `string`, dry_run: `boolean`

### `request_user_takeover`

- **tier:** ask-user · **category:** ask · **active:** ✅ · **version:** 10

> Hand keyboard/mouse control to the user so they can perform an action the agent cannot or should not (logging in, MFA, CAPTCHA, sensitive form filling, decisions only the user can make). The user types/clicks directly into the page; when they're done they signal completion in the UI. The agent should re-read the page after takeover ends to see what changed. Distinct from `user` (Q&A) — this is full page handoff.

**Params:** **reason**: `string`, tab_id: `string`, instructions: `string`, expected_action: `string`

### `resize_window`

- **tier:** action · **category:** tabs · **active:** ✅ · **version:** 9

> Resize the browser window containing a tab. Useful for responsive testing. If tab_id is omitted, resizes the active tab's window. Note: this changes the OS window size, which in turn changes the viewport.

**Params:** **width**: `integer`, **height**: `integer`, tab_id: `integer`

### `save_guidance_note`

- **tier:** action · **category:** guidance · **active:** ✅ · **version:** 7

> Save a domain-scoped note for the user (or for yourself on the next visit). The note auto-surfaces in chat context whenever the user opens a tab on this domain. Use for site-specific lessons that don't fit in `remember_for_domain`'s structured hints — full prose explanations, workflow hints, gotchas.

**Params:** **text**: `string`, **domain**: `string`, caption: `string`, origin_url: `string`

### `scratchpad`

- **tier:** read · **category:** memory · **active:** ✅ · **version:** 1

> Session-scoped, in-process scratchpad for stashing structured notes across turns without burning context tokens. Distinct from the canonical `memory` tool which is the persistent long-term memory system. Use scratchpad for ephemeral state inside a single run; use `memory` for things the agent should remember about the user across sessions. Actions: 'set' (write a value to a key), 'get' (read by key), 'list' (all keys), 'delete' (remove a key). Values are stringified — stringify objects before passing. Caps: 8 KB per value, 100 keys per session. Cleared at session end.

**Params:** key: `string`, value: `string`, **action**: `string[set\|get\|list\|delete]`

### `screenshot_region`

- **tier:** read · **category:** page · **active:** ✅ · **version:** 6

> Capture a bounded region of the active tab's viewport. Provide `ref` (preferred) from a prior read_page, OR `selector`, OR an explicit viewport `rect: {x,y,w,h}`. The handler scrolls the target into view if needed, captures the visible viewport, then crops to the resolved rect (with optional `padding` in CSS px). Returns the same shape as take_screenshot: { media_type, format, width, height, image_base64, byte_length, source_rect }. Use this for focused vision-API calls on a specific component — 5-20× cheaper than a full-page screenshot.

**Params:** ref: `string`, rect: `object`, format: `string[png\|jpeg]`, padding: `integer`, profile: `string[auto\|auto-final\|anthropic-default\|anthropic-hires\|openai-original\|openai-high\|openai-low\|gemini-screenshot\|gemini-overview\|gemini-2.5-default\|ocr-heavy\|lossless]`, quality: `integer`, selector: `string`

### `sleep`

- **tier:** action · **category:** interact · **active:** ✅ · **version:** 6

> Pause the agent for `ms` milliseconds (50ms–5min). Use when waiting for time-based things the page does on its own — a video to play before capturing transcript, an animation to finish, a debounced search to settle, a rate-limit window to clear. The server is non-blocking during the pause; only the agent waits. Prefer `wait_for` when you have a concrete condition (selector or readyState) — `sleep` is for unconditional waits. Returns { ok, slept_ms }.

**Params:** **ms**: `integer`, reason: `string`

### `storage`

- **tier:** privileged · ⚡ privileged · **category:** advanced · **active:** ✅ · **version:** 7

> Persistent agent-namespaced storage that survives across runs. Distinct from canonical `memory` which is session-scoped (cleared on SW restart). Actions: 'get' (returns value at key), 'set' (writes any JSON-serializable value), 'list' (returns all keys). Use for user preferences, scratchpads, progress markers between conversations.

**Params:** key: `string`, value: `?`, **action**: `string[get\|set\|list]`

### `stylesheet`

- **tier:** privileged · ⚡ privileged · **category:** advanced · **active:** ✅ · **version:** 8

> Inject or remove a CSS stylesheet on the active (or specified) tab. Actions: 'inject' (apply `css`; pass `persistent: true` to survive navigations), 'remove' (drop a previously-injected `css` block — must match exactly).

**Params:** **css**: `string`, **action**: `string[inject\|remove]`, tab_id: `integer`, persistent: `boolean`

### `submit_form`

- **tier:** action · **category:** forms · **active:** ✅ · **version:** 5

> Submit a form. By default the tool clicks the form's primary submit button (so HTML5 validation + framework handlers run). Set via_button=false to fall back to HTMLFormElement.submit() — skips validation but works for form elements that lack a button.

**Params:** selector: `string`, via_button: `boolean`

### `tab_groups`

- **tier:** action · **category:** advanced · **active:** ✅ · **version:** 8

> Manage tab groups. Actions: 'list' (returns all groups across windows), 'create' (groups `tab_ids` together; optional `title`/`color`), 'add' (puts more `tab_ids` into existing `group_id`), 'remove' (ungroups `tab_ids`), 'update' (rename/recolor/collapse `group_id`).

**Params:** color: `string[grey\|blue\|red\|yellow\|green\|pink\|purple\|cyan\|orange]`, title: `string`, **action**: `string[list\|create\|add\|remove\|update]`, tab_ids: `array`, group_id: `integer`, collapsed: `boolean`

### `tabs`

- **tier:** action · **category:** tabs · **active:** ✅ · **version:** 10

> Manage browser tabs. Actions: 'list' (all tabs in current window), 'create' (opens new tab; pass url to open at a URL), 'close', 'switch' (brings tab to foreground), 'reload', 'active' (returns the currently active tab — call when you don't know your tab_id), 'info' (full info for a specific tab_id), 'pin' (toggle pin via `on`), 'mute' (toggle mute via `on`), 'duplicate', 'move' (to `index` and optionally `window_id`), 'zoom' (set `zoom_factor`, e.g. 1.5 for 150%). tab_id required for close/switch/reload/info/pin/mute/duplicate/move/zoom.

**Params:** on: `boolean`, url: `string`, index: `integer`, **action**: `string[list\|create\|close\|switch\|reload\|active\|info\|pin\|mute\|duplicate\|move\|zoom]`, tab_id: `string`, window_id: `integer`, zoom_factor: `number`

### `tasks`

- **tier:** action · **category:** plan · **active:** ✅ · **version:** 5

> Manage the agent's own tasklist for the current conversation. Actions: 'add' (one via `title` or many via `items`), 'list' (read current tasks), 'set_status' (`id` + `status`), 'update' (`id` + `title` and/or `note`; pass note=null to clear), 'remove' (`id`), 'reorder' (`ids` in desired order), 'clear_completed' (drop done + skipped), 'clear_all'. Statuses: pending, in_progress, done, blocked, skipped. The list and any user edits to it are surfaced to you in `task_list` context on every turn — set statuses as you work so the user can see live progress.

**Params:** id: `string`, ids: `array`, note: `?`, items: `array`, title: `string`, **action**: `string[add\|list\|set_status\|update\|remove\|reorder\|clear_completed\|clear_all]`, status: `string[pending\|in_progress\|done\|blocked\|skipped]`

### `update_plan`

- **tier:** ask-user · **category:** ask · **active:** ✅ · **version:** 9

> Propose a step-by-step plan and wait for the user to approve, modify, or reject it. Use this BEFORE a multi-step action sequence so you align on intent up front. Returns { approved: true, note?: string } or { approved: false, note?: string } so you can adjust.

**Params:** steps: `array`, title: `string`, domains: `array`, approach: `array`, reasoning: `string`, timeout_seconds: `integer`, estimated_minutes: `integer`

### `upload_file`

- **tier:** action · **category:** files · **active:** ✅ · **version:** 9

> Upload one or more files to a <input type='file'> element by reference. Pass file_ids — these are MediaRef IDs (e.g. from a previous /files/upload, or from computer.action=screenshot). The handler resolves each file_id to bytes and sets the input. Do NOT click file inputs — that opens a native picker the agent cannot see. For drag-and-drop targets, use drop_file instead.

**Params:** **ref**: `string`, **tab_id**: `string`, **file_ids**: `array`

### `user`

- **tier:** ask-user · **category:** core · **active:** ✅ · **version:** 7

> Pause and talk to the user. Single tool, six modes via `type`: 'confirm' (yes/no — pass question), 'choice' (single pick — pass question + options[]), 'choice_many' (multi pick — pass question + options[]), 'text' (freeform answer — pass question), 'secret' (masked input for passwords/MFA/API keys — pass question), 'notify' (display a message and optionally collect a single action — pass message; optional actions[] and level). Optional `context` shows a one-line 'why' on ask types. Optional `timeout_seconds` (1..900) auto-resolves the call with timed_out:true if the user doesn't respond. Returns the unified envelope { answer, selected, confirmed, action, freeform, cancelled, timed_out } — unused fields are null/false. For full keyboard/mouse handoff (CAPTCHA, login), use request_user_takeover. For plan approval, use update_plan.

**Params:** **type**: `string[confirm\|choice\|choice_many\|text\|secret\|notify]`, level: `string[info\|success\|warning\|error]`, actions: `array`, context: `string`, message: `string`, options: `array`, question: `string`, timeout_seconds: `integer`

### `user_todos`

- **tier:** action · **category:** plan · **active:** ✅ · **version:** 5

> Assign tasks TO THE USER for the current conversation. The user sees them in a dedicated panel and checks them off; you'll see their state in `user_todos` context on every turn. Actions: 'add' (`title` + optional `context` for why + optional `due` hint; fires a Chrome notification unless `silent:true`), 'list', 'update' (`id` + `title`/`context`/`due`; pass null to clear), 'remove' (`id`), 'mark_done' (`id`; `done:false` un-checks), 'clear_done' (purge completed). Use this to delegate work back to the user — e.g. 'forward the email I just drafted', 'pick a date for the meeting'.

**Params:** id: `string`, due: `?`, done: `boolean`, title: `string`, **action**: `string[add\|list\|update\|remove\|mark_done\|clear_done]`, silent: `boolean`, context: `?`

### `wait_for`

- **tier:** read · **category:** interact · **active:** ✅ · **version:** 9

> Poll until a condition is met or timeout. Use after navigation or actions that trigger async loads — far more reliable than fixed sleeps. Conditions: 'element' (ref or selector exists and is visible; pass scroll=true to scroll the page while polling — handles infinite scroll), 'text' (text appears anywhere on page), 'url' (tab URL matches substring or regex), 'network_idle' (no in-flight requests for ~500ms).

**Params:** scroll: `boolean`, **tab_id**: `string`, target: `string`, **condition**: `string[element\|text\|url\|network_idle]`, timeout_ms: `integer`

---

## 3. Bundles (`tl_bundle`)

Every row in `tl_bundle` + its members. Empty bundles are explicitly
flagged — they advertise themselves to the LLM but resolve to nothing.

### matrx-extend category bundles (14)

| bundle | active | members | tool names |
|---|---|---|---|
| `advanced` | ✅ | 2  | `evaluate_javascript`, `desktop_run_command` |
| `ai` | ✅ | 0 ⚠️ **EMPTY** | _(none)_ |
| `ask` | ✅ | 2  | `request_user_takeover`, `update_plan` |
| `cookies` | ✅ | 0 ⚠️ **EMPTY** | _(none)_ |
| `core` | ✅ | 3  | `browser_batch`, `read_page`, `find` |
| `debug` | ✅ | 7  | `cdp_full_page_screenshot`, `cdp_a11y_tree`, `cdp_input_click_xy`, `cdp_input_type`, `cdp_print_pdf`, `cdp_perf_metrics`, `read_console_messages` |
| `files` | ✅ | 1  | `chrome_save_page_as_mhtml` |
| `forms` | ✅ | 1  | `submit_form` |
| `history` | ✅ | 0 ⚠️ **EMPTY** | _(none)_ |
| `interact` | ✅ | 1  | `wait_for` |
| `memory` | ✅ | 0 ⚠️ **EMPTY** | _(none)_ |
| `page` | ✅ | 8  | `get_page_text`, `get_page_selection`, `read_active_page`, `query_elements`, `find_text_on_page`, `get_page_links`, `get_element_at_point`, `get_form_fields` |
| `tabs` | ✅ | 0 ⚠️ **EMPTY** | _(none)_ |
| `webmcp` | ✅ | 0 ⚠️ **EMPTY** | _(none)_ |

### MCP-server bundles (40)

These are advertised through the marketplace flow; members live elsewhere.

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
| `context7` | 0 | Live, version-specific library documentation for AI prompts. |
| `deepwiki` | 0 | Instant documentation and architecture diagrams for any GitHub repo. |
| `demos` | 5 | Demo recording and replay — record a user workflow once, replay later with parameter substitution. |
| `figma` | 0 | Pull design context, generate code from frames, access components and variables. |
| `github` | 0 | Manage repositories, pull requests, issues, and actions. |
| `google-drive` | 0 | Search, read, and manage Google Drive files, Docs, and Sheets. |
| `google-workspace` | 0 | Gmail, Calendar, Drive, Docs, Sheets, Slides, Forms, Tasks, and Contacts. |
| `guidance` | 4 | User-saved clues for the agent — domain-scoped notes, screenshots, GIFs, and demo references. |
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
| `supabase` | 0 | Manage your database, auth, storage, and edge functions. |
| `vercel` | 0 | Manage deployments, projects, domains, and view logs. |
| `webflow` | 0 | Manage CMS content, improve SEO, localize content, and publish sites. |
| `wix` | 0 | Build and manage websites through AI. |
| `zapier` | 0 | Connect to 8,000+ apps and trigger automated workflows. |
| `zoho` | 0 | CRM, Mail, Calendar, Desk, and 500+ apps. |

---

## 4. Sources-of-truth audit

Where two systems claim authority over the same fact, list the divergence.

### 4a. `CANONICAL_SURFACE` (local) ↔ `tl_def` (DB, source_app=matrx-extend)

- Local CANONICAL_SURFACE entries: **79**
- DB matrx-extend rows: **79**
- ✅ Sets match exactly. Drift-check enforces this on every release.

### 4b. `CATEGORY_BY_TOOL` (local) ↔ `tl_def.category` (DB)

| tool | local | DB |
|---|---|---|
| `ai` | ai | advanced |
| `cdp_emulate` | debug | advanced |
| `cdp_session` | debug | advanced |
| `chrome_bookmarks` | history | advanced |
| `chrome_cookies` | cookies | advanced |
| `chrome_history` | history | advanced |
| `chrome_recently_closed` | history | advanced |
| `chrome_webmcp` | webmcp | advanced |
| `list_browser_tools` | core | (null) |
| `storage` | memory | advanced |
| `tab_groups` | tabs | advanced |
| `update_plan` | plan | ask |

### 4c. Per-handler `surface_bundles` vs `CANONICAL_SURFACE` membership

Each `ToolHandler.surface_bundles` declares which bundles (assistant /
pilot / pilot+privileged) it ships with. CANONICAL_SURFACE is the set
actually emitted to the LLM. These should agree.

- Local handlers with non-empty surface_bundles: **170**
- Local handlers with empty surface_bundles: **0** ✅
- ⚠️ Handler advertises bundle but not in CANONICAL_SURFACE: `list_core_tools`, `list_page_tools`, `list_interact_tools`, `list_forms_tools`, `list_tabs_tools`, `list_history_tools`, `list_ai_tools`, `list_files_tools`, `list_memory_tools`, `list_ask_tools`, `list_plan_tools`, `list_advanced_tools`, `list_demos_tools`, `list_guidance_tools`, `list_debug_tools`, `list_cookies_tools`, `list_webmcp_tools`, `get_active_tab`, `take_screenshot`, `list_open_tabs`, `get_tab_groups`, `get_tab_info`, `search_bookmarks`, `list_bookmark_tree`, `search_history`, `list_recent_history`, `list_downloads`, `get_extension_storage`, `list_extension_storage`, `ai_check_availability`, `ai_summarize`, `ai_classify`, `ai_extract_json`, `ai_translate`, `ai_detect_language`, `ai_proofread`, `ai_describe_image`, `ai_check_prompt_injection`, `navigate_active_tab`, `click_element`, `type_into_element`, `scroll_page`, `set_clipboard`, `press_keys`, `hover_element`, `focus_element`, `blur_element`, `right_click_element`, `select_dropdown_option`, `set_checkbox`, `set_radio`, `file_upload`, `open_new_tab`, `close_tab`, `switch_to_tab`, `duplicate_tab`, `pin_tab`, `mute_tab`, `reload_tab`, `go_back`, `go_forward`, `set_tab_zoom`, `move_tab`, `create_tab_group`, `add_tabs_to_group`, `remove_tabs_from_group`, `update_tab_group`, `download_url`, `cancel_download`, `list_recently_closed`, `restore_recently_closed`, `get_cookies`, `set_cookie`, `delete_cookie`, `cdp_attach`, `cdp_detach`, `cdp_attached_tabs`, `cdp_emulate_device`, `cdp_clear_emulation`, `get_system_info`, `list_network_blocking_rules`, `webmcp_check_availability`, `webmcp_list_page_tools`, `webmcp_call_page_tool`, `execute_javascript`, `inject_stylesheet`, `remove_stylesheet`, `set_extension_storage`, `parallel_for_each_tab`, `get_clipboard`

### 4d. DB `tl_bundle` (matrx-extend) ↔ local categories

- DB matrx-extend bundles: **14**
- Local categories: **17**
- Local-only categories: `plan`, `demos`, `guidance`

### 4e. Empty `tl_bundle` rows (DB advertises but resolves to nothing)

- ⚠️ **6 matrx-extend bundles have ZERO members in `tl_bundle_member`:**

  - `ai`
  - `cookies`
  - `history`
  - `memory`
  - `tabs`
  - `webmcp`

  These rows make `load_browser_tools({category: X})` look like a
  legitimate option to the LLM but return an empty list at runtime.
  Either populate `tl_bundle_member` OR set `is_active = false` so
  the discovery handler stops advertising them.

---

## 5. Suggested review focus

- **Pick descriptions to tighten** — Section 2 has every description verbatim. Look for context bloat, stale field references, or generic text.
- **Confirm tier + admin_only** — Tier drives the approval UX; admin_only gates visibility. Eyeball any tool where the surface looks risky for the tier shown.
- **Decide bundle strategy** — Section 4d/4e show DB bundles drifting from local categories. Three options: deprecate `tl_bundle` for matrx-extend (use local categories only), populate the DB bundles to match local, or split-domain (DB bundles for MCP marketplace, local categories for browser tools).
- **Hunt missing parameters** — Section 2 shows the param summary. Look for tools where the LLM has no signal about what to pass (no required fields, generic types).
