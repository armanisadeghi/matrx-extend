# matrx-extend tools

> **AUTO-GENERATED — do not edit.** Produced from `tool.definition`
> rows bound to `executor_name='chrome-extension'` via `tool.binding`,
> the source of truth. Tool names, descriptions, and argument
> contracts live ONLY in the database (Rule 4,
> common-docs/systems/agents/agent-tools/STATE.md).
> Regenerate with `pnpm docs:tools` (also runs on every `release.sh`).

Generated: 2026-10-04T14:17:46.288Z
Total tools: 82

## ai

### `ai`

_read_

On-device Chrome AI (Gemini Nano): free, offline, below cloud quality — use for cheap pre-processing before cloud calls. Missing API -> ok:false (+ availability for most actions). Outputs: check_availability -> per-API readiness; summarize -> summary; classify -> label, confidence; extract_json -> data; translate -> translation; detect_language -> candidates; proofread -> corrections; describe_image -> description; check_prompt_injection -> suspicious, severity, reason, excerpts.

**Parameters:** `text` (string); `action` (string, required) = ["check_availability","summarize","classify","extract_json","translate","detect_language","proofread","describe_image","check_prompt_injection"]; `prompt` (string); `schema` (any); `image_url` (string); `mime_type` (string); `categories` (array); `source_lang` (string); `target_lang` (string); `image_base64` (string)

## capture

### `chrome_record_gif`

_action_

Record a tab's browser actions as an animated GIF. start_recording: one per tab. stop_recording -> frame_count, duration_ms. export: stops if needed, uploads -> file_id, file_url, then downloads (download=true) or drops onto ref/coordinate (one required). clear: discard frames. Screenshot right after start and right before stop for clean first/last frames.

**Parameters:** `ref` (string); `action` (string, required) = ["start_recording","stop_recording","export","clear"]; `tab_id` (string, required); `options` (object); `download` (boolean); `filename` (string); `coordinate` (array)

### `chrome_record_tab_video`

_action_

Record a tab as video (chrome.tabCapture + MediaRecorder, WebM/MP4) and upload it to cld_files under browser-agent/recordings/. Returns {ok, file_id, file_url, mime_type, duration_ms, size_bytes, audio, source}, or {ok:false, reason, remediation?}. Needs the `tabCapture` optional permission (user enables Settings → Advanced → Tab video capture).

**Parameters:** `audio` (boolean); `tab_id` (integer); `filename` (string); `duration_ms` (integer)

### `chrome_save_page_as_mhtml`

_action_

Snapshot a tab (default: the agent's tab) as a self-contained MHTML archive, every resource inlined. -> {mhtml_base64, byte_length}. For archiving or re-analysing a frozen copy of the page.

**Parameters:** `tab_id` (integer)

### `downloads`

_action_

Chrome downloads. list: 50 most recent (id, filename, url, state, bytes). cancel: abort an in-progress download; requires download_id. confirm: returns the download's current record (Chrome completes downloads itself); requires download_id. download_url: start downloading url; requires url; name conflicts are uniquified.

**Parameters:** `url` (string); `action` (string, required) = ["list","confirm","cancel","download_url"]; `filename` (string); `download_id` (string)

### `screenshot_region`

_read_

Capture part of the assigned tab's viewport; far cheaper than a full screenshot for focused vision. Target with one of ref (preferred, from read_page), selector, or rect (viewport CSS px); an off-screen ref/selector target is scrolled into view, then padded and clamped to the viewport. Returns an image ref {file_id, file_url, media_type, source_width, source_height, size_bytes} plus source_rect; inline image_base64 only if the upload failed. Failures return ok:false with a reason.

**Parameters:** `ref` (string); `rect` (object); `format` (string) = ["png","jpeg"]; `padding` (integer); `profile` (string) = ["auto","auto-final","anthropic-default","anthropic-hires","openai-original","openai-high","openai-low","gemini-screenshot","gemini-overview","gemini-2.5-default","ocr-heavy","lossless"]; `quality` (integer); `selector` (string)

## chrome

### `chrome_bookmarks`

_read_

Read the user's bookmarks. search: query matched against title and URL. tree: folder tree from folder_id or the root.

**Parameters:** `limit` (integer); `query` (string); `action` (string, required) = ["search","tree"]; `folder_id` (string); `max_depth` (integer)

### `chrome_cookies`

_privileged · admin-only_

Manage cookies for any domain. Actions: 'get' (read; pass `name` for a specific cookie or omit for all matching), 'set' (write; requires `name` + `value`; optional `domain`/`path`/`expires_in_seconds`/`same_site`/`http_only`/`secure`), 'delete' (requires `name`). Always pass `url` (or `domain` for 'get'). Admin-only.

**Parameters:** `url` (string, required); `name` (string); `path` (string); `value` (string); `action` (string, required) = ["get","set","delete"]; `domain` (string); `secure` (boolean); `http_only` (boolean); `same_site` (string) = ["strict","lax","no_restriction"]; `expires_in_seconds` (integer)

### `chrome_history`

_read_

Reads browsing history. search: query over title/URL within a time window. recent: visits in the last `minutes`, newest first.

**Parameters:** `limit` (integer); `query` (string); `action` (string, required) = ["search","recent"]; `minutes` (integer); `end_time_ms` (integer); `start_time_ms` (integer)

### `chrome_recently_closed`

_action_

Recently closed tabs and windows. list -> entries [{last_modified_ms, tab{id,url,title} | window{id,tab_count,tabs}}] (max 25); restore reopens one.

**Parameters:** `action` (string, required) = ["list","restore"]; `session_id` (string)

## core

### `chrome_batch`

_read_

Run up to 20 read-tier extension tools (read_page, take_screenshot, list_open_tabs, …) sequentially in one round trip in the user's browser. Each call's arguments are validated against that tool's own schema. Returns {count, results: [{name, ok, output | error}]} in order. Action, ask-user and privileged tools are rejected per call (error, not run): call them individually so the user can approve. Use only when the calls don't depend on each other's output.

**Parameters:** `calls` (array, required); `stop_on_error` (boolean)

### `list_chrome_categories`

_read_

Index of the Matrx Chrome extension's tool categories (tools that run in the user's own browser): name, label, description, list_tool, tool_count, tool_names. Call a category's list_tool (e.g. list_reading_tools) to load its tools; a tool is callable only after its category's list_tool has run. Use when you need a browser capability your toolset lacks.

**Parameters:** _No parameters._

## credentials

### `credential_login`

_action_

Signs in to a website with the person's saved logins; you never see a credential value. Path: open the sign-in page with cloud_browser, then auto. If auto cannot read the form (spec_incomplete): discover, then one complete attempt. needs_mfa with a saved authenticator: authenticator. list is metadata only and never logs in: use it only after no_matching_login, filtered by host or query; a filter that matches nothing returns no_matching_login, so stop searching. Never pass a URL, username, password, token, seed or code. Each login ends in one verdict: authenticated, needs_mfa, captcha_or_takeover, credentials_rejected or unknown. Missing credentials and inventory-only results are unknown, never credentials_rejected. CAPTCHA and unsupported MFA need user takeover. When a result ends the requested task, your final line is literally `Verdict: <token>`; for inventory-only or missing-credential results exactly `Verdict: unknown`, never prose such as 'cannot sign in'.

**Parameters:** `host` (string); `kind` (string) = ["secret_exposed","wrong_verdict","recipe_wrong","other"]; `notes` (string); `query` (string); `steps` (array); `where` (string); `action` (string, required) = ["list","auto","discover","attempt","authenticator","report","capture","propose_recipe"]; `expect` (object); `fields` (array); `submit` (any); `verbose` (boolean); `field_map` (array); `attempt_id` (string); `session_id` (string); `description` (string); `display_name` (string); `provider_key` (string); `code_selector` (string); `failure_signals` (array); `submit_selector` (string); `success_signals` (array); `challenge_signals` (array); `credential_item_id` (string)

## crm

### `capture_prospect`

_action_

Add the company behind the assigned page (or url) to the user's AI Matrx prospect list. Captures a company, never a person; sends nothing.
preview (default; writes nothing): -> verdict (new | already a prospect | blocklisted | unusable address), the website it would file under, and any existing relationship: message count, campaigns, confirmed wins, do-not-contact. Call it first and report any existing relationship before capturing.
capture: saves it through the standard prospect import (blocklist, de-duplication, authority scoring apply).
Errors: site_choice_required (several websites: ask which, pass site_id), no_page (pass url), sign_in_required.

**Parameters:** `url` (string); `action` (string) = ["preview","capture"]; `site_id` (string)

## demos

### `delete_demo`

_action_

Delete a saved demo by id. Cannot be undone.

**Parameters:** `demo_id` (string, required)

### `describe_demo`

_read_

Return the full step list for a saved demo. Each step has { kind, url, selector_chain, element_snapshot, input_text, param_placeholder, is_sensitive }. Use before replay to verify what the demo will do.

**Parameters:** `demo_id` (string, required)

### `list_demos`

_read_

List every saved demo as { id, name, description, start_url, step_count, parameter_names, created_at, updated_at }. Use to find a demo to replay or describe.

**Parameters:** _No parameters._

### `record_demo`

_action_

Record a user demonstration for replay_demo. start {tab_id?}: capture the user's clicks, typing, submits, navigations, scrolls (default active tab); ask them to walk through the workflow and call stop when they say they're done. stop {name ≤100, description? ≤500, parameters?: [{name, description?, type?, sensitive?}]}: save; sensitive fields (passwords) become parameters automatically. discard: drop it unsaved. status: recording?, steps_captured.

**Parameters:** `name` (string); `action` (string, required) = ["start","stop","discard","status"]; `tab_id` (integer); `parameters` (array); `description` (string)

### `replay_demo`

_privileged_

Replay a saved demo in a tab: loads its start URL, then re-runs its clicks, typing, submits and navigations. Always asks the person to confirm. Returns per-step results (resolved_via = selector strategy that hit) and failed_at_index on abort.

**Parameters:** `params` (object); `tab_id` (integer); `demo_id` (string, required); `dry_run` (boolean)

## desktop

### `desktop_run_command`

_privileged_

Invoke a command on the matrx-local desktop bridge. Available commands depend on what matrx-local exposes (file ops, system info, window control, etc.). Returns { ok, data?, error? }; fails fast with reason "desktop bridge unavailable — matrx-local is not running" when the bridge isn't connected.

**Parameters:** `args` (object); `command` (string, required)

## devtools

### `cdp_a11y_tree`

_privileged_

Dump the tab's accessibility tree (CDP Accessibility.getFullAXTree) as a flat node list with role, name, value, properties, child_ids. Prefer over read_active_page for a semantic view (roles, labels, form-field associations) without decorative DOM.

**Parameters:** `tab_id` (integer); `max_nodes` (integer)

### `cdp_emulate`

_privileged · admin-only_

Override viewport/device metrics on a tab via CDP for responsive testing; attaches the debugger itself. set -> {ok}. clear: drops metrics + user-agent overrides. Needs the `debugger` optional permission; Chrome only.

**Parameters:** `width` (integer); `action` (string, required) = ["set","clear"]; `height` (integer); `mobile` (boolean); `tab_id` (integer); `user_agent` (string); `device_scale_factor` (number)

### `cdp_full_page_screenshot`

_privileged_

Capture the full scrollable page (beyond the viewport); use instead of take_screenshot for long pages. Auto-scales the long edge to the profile's vision target (profiles as take_screenshot). tab_id defaults to your tab. Returns an image_ref (file_id, durable file_url to render/share, capture_scale, est_tokens). If upload fails: inline image_base64 + media_type — pass media_type verbatim, never stringify the object.

**Parameters:** `format` (string) = ["png","jpeg","webp"]; `tab_id` (integer); `profile` (string) = ["auto","auto-final","anthropic-default","anthropic-hires","openai-original","openai-high","openai-low","gemini-screenshot","gemini-overview","gemini-2.5-default","ocr-heavy","lossless"]; `quality` (integer); `full_page` (boolean); `capture_scale` (number)

### `cdp_input_click_xy`

_privileged_

Real mouse click at viewport CSS-pixel (x, y) via CDP Input.dispatchMouseEvent; works through shadow DOM, cross-origin iframes, and pages that ignore synthetic clicks. Use when a ref click (computer left_click) has no effect. Chrome only; needs the debugger permission. Default tab: the run's tab.

**Parameters:** `x` (number, required); `y` (number, required); `button` (string) = ["left","right","middle"]; `tab_id` (integer); `click_count` (integer)

### `cdp_input_type`

_privileged_

Type literal text into the focused element via CDP Input.insertText (fires the input events React-controlled inputs need). Focus first with computer action=focus; use when computer type or form_input leaves a controlled input unchanged.

**Parameters:** `text` (string, required); `tab_id` (integer)

### `cdp_network_capture_drain`

_privileged_

Remove and return up to `max` of the oldest Network records buffered for a tab (after cdp_network_capture_start; Chrome). Each record { request_id, url, method, status, mime_type, request_headers, response_headers, finished, failed, ts_ms }. url_contains (case-insensitive) filters after removal, so drained non-matching records are lost. Bodies: cdp_network_get_body(request_id).

**Parameters:** `max` (integer); `tab_id` (integer); `url_contains` (string)

### `cdp_network_capture_start`

_privileged_

Begin capturing every Network event on a tab (default: active). After this, navigate or interact with the page; calls accumulate in a buffer. Use cdp_network_capture_drain to read them. Use cdp_network_capture_stop when finished.

**Parameters:** `tab_id` (integer)

### `cdp_network_capture_stop`

_privileged_

Stop capturing Network events on a tab and clear its buffer; undrained events are lost (cdp_network_capture_drain first).

**Parameters:** `tab_id` (integer)

### `cdp_network_get_body`

_privileged_

Response body of one request captured by cdp_network_capture_start, by request_id from cdp_network_capture_drain. -> {body, base64_encoded}.

**Parameters:** `tab_id` (integer); `request_id` (string, required)

### `cdp_perf_metrics`

_read_

Chrome Performance.getMetrics for a tab (default: the agent's tab). -> {metrics: {Documents, Frames, JSHeapUsedSize, LayoutCount, RecalcStyleCount, ScriptDuration, TaskDuration, …}}.

**Parameters:** `tab_id` (integer)

### `cdp_print_pdf`

_privileged_

Print a tab to PDF via CDP Page.printToPDF, e.g. to archive a page or pass it to another model. Returns {pdf_base64, byte_length (decoded bytes)}.

**Parameters:** `tab_id` (integer); `landscape` (boolean); `print_background` (boolean)

### `cdp_session`

_privileged · admin-only_

Manage Chrome DevTools Protocol debugger sessions. attach/detach: open/close a session on tab_id; list -> {tab_ids} attached. Other cdp_* tools attach their tab on demand, so attach is optional.

**Parameters:** `action` (string, required) = ["attach","detach","list"]; `tab_id` (integer)

### `get_request_body`

_privileged_

Response body of a request from read_network_requests, by its request_id. Chrome only; needs the debugger permission.

**Parameters:** `tab_id` (string); `request_id` (string, required)

### `read_console_messages`

_privileged_

Read console output (console.* calls, uncaught exceptions) from a tab via CDP. The first call starts capture, so only later messages are seen; capture persists until the debugger detaches (tab close, cdp_session detach, 10 min idle). Takes the oldest `limit` buffered messages, then filters; without clear:true every read returns the same oldest messages, so pass clear:true to poll for new output. Returns {ok, count, messages: [{level, text, url, line, column, ts_ms}]}. Needs the `debugger` optional permission; Chrome only.

**Parameters:** `max` (integer); `clear` (boolean); `limit` (integer); `tab_id` (string); `pattern` (string); `auto_start` (boolean); `errors_only` (boolean); `level_filter` (array)

### `read_network_requests`

_privileged_

Read completed HTTP requests (XHR, fetch, documents, …) from a tab via CDP. The first call starts capture, so only requests finishing later are seen; capture persists until the debugger detaches (tab close, cdp_session detach, 10 min idle). Each read removes the oldest `limit` records from the buffer, then applies url_pattern; non-matching removed records are lost. Returns {ok, count, records: [{request_id, url, method, status, mime_type, request_headers, response_headers, failed?, error_text?, ts_ms}]}; no bodies (get_request_body with request_id). Needs the `debugger` optional permission; Chrome only.

**Parameters:** `clear` (boolean); `limit` (integer); `tab_id` (string); `auto_start` (boolean); `url_pattern` (string); `include_body` (boolean)

## education

### `capture_study_set`

_action_

Capture the study set on the current page as an AI Matrx flashcard deck. Extracts term/definition pairs from Quizlet set data, a definition list, or a two-column table (3+ rows). preview writes nothing and returns deck_name, card_count, source and a 5-card sample — show it to the person before capture. capture creates the deck and returns set_id, deck_name, card_count, open_url. Errors: no_page, nothing_found, extraction_failed, sign_in_required, organization_required (relay its message: the person must pick an organization), import_failed.

**Parameters:** `action` (string) = ["preview","capture"]; `deck_name` (string)

## guidance

### `delete_guidance_item`

_action_

Delete a saved guidance item by id. Cannot be undone. For demo references, this only removes the guidance index entry — the underlying demo lives in its own storage and must be deleted via `delete_demo`.

**Parameters:** `id` (string, required)

### `get_guidance_item`

_read_

One guidance item by id, in full: note text; screenshot/GIF file_id + url (annotated_* when marked up); demo_ref demo_id (run with replay_demo).

**Parameters:** `id` (string, required)

### `list_guidance`

_read_

List saved guidance summaries (notes, screenshots, GIFs, demo refs); get_guidance_item returns content.

**Parameters:** `domain` (string)

### `save_guidance_note`

_action_

Save a free-form note for a domain; it is added to chat context whenever the user's page is on that domain or a subdomain. For site-specific prose (workflows, gotchas); structured hints go to remember_for_domain.

**Parameters:** `text` (string, required); `domain` (string, required); `caption` (string); `origin_url` (string)

## human

### `request_user_takeover`

_ask-user_

Pause and ask the user to do something in the page themselves that you cannot or should not (log in, MFA, CAPTCHA, sensitive form entry, a decision only they can make). Shows a takeover card; the user acts in the page, then replies. Returns {answer, cancelled, additional_instructions} or {timed_out:true}. Re-read the page afterwards. For a question with no page action, use user.

**Parameters:** `reason` (string, required); `tab_id` (string); `instructions` (string); `expected_action` (string); `timeout_seconds` (integer)

### `update_plan`

_ask-user_

Propose a step-by-step plan and wait for the person to approve, amend or reject it; call before a multi-step action sequence. Returns { approved, note? } — note carries their amendment; timeout or cancel returns approved=false.

**Parameters:** `steps` (array); `title` (string); `domains` (array); `approach` (array); `reasoning` (string); `timeout_seconds` (integer); `estimated_minutes` (integer)

### `user`

_ask-user_

Pause to ask the user, or notify them. By type:
- confirm: yes/no -> confirmed
- choice: pick one of options -> selected
- choice_many: pick zero or more of options (checklist) -> selected
- text: free-form -> answer
- secret: sensitive input, masked in UI and storage -> answer
- notify: no answer required; shows message with optional actions buttons to nudge the user to act elsewhere -> action
The UI always appends a freeform 'Other' to confirm, choice, choice_many and notify; never add your own Other / None of these option. Other text returns in freeform.
Every result may carry additional_instructions (a note the user attached; honor it) and wrote_instead=true (the user skipped the structure; their reply in freeform is the answer; re-ask only if still needed). Also cancelled, and timed_out after timeout_seconds (continue without an answer).
Batched: questions=[1-4 single-question objects], no other top-level fields; shown in sequence -> {answers[] by position, cancelled, timed_out}.
Prefer this to guessing on destructive or sensitive actions. For the user typing directly into the page, use request_user_takeover.

**Parameters:** `type` (string) = ["confirm","choice","choice_many","text","secret","notify"]; `level` (string) = ["info","success","warning","error"]; `header` (string); `actions` (array); `context` (string); `message` (string); `options` (array); `question` (string); `questions` (array); `allow_other` (boolean); `timeout_seconds` (integer)

### `user_todos`

_action_

Assign tasks to the person for this conversation (work only they can do, e.g. forward a drafted email, pick a meeting date). They check them off in a panel; their state reaches you each turn in `user_todos` context.
add: title -> todo; notifies them unless silent. list. update: id + fields to change. remove: id. mark_done: id. clear_done: deletes completed todos.

**Parameters:** `id` (string); `due` (any); `done` (boolean); `title` (string); `action` (string, required) = ["add","list","update","remove","mark_done","clear_done"]; `silent` (boolean); `context` (any)

## interaction

### `clipboard`

_action_

Read or write the system clipboard through the agent's tab. read -> {text}; write sets the clipboard to text.

**Parameters:** `text` (string); `action` (string, required) = ["read","write"]

### `computer`

_action_

Mouse, keyboard and screenshot actions in one browser tab (activated first). Prefer ref (from read_page) over coordinate: coordinates break across scrolls and layout changes. Synchronize with wait_for, not fixed sleeps.
left_click, double_click, triple_click: ref or coordinate. right_click, hover, focus, blur, scroll_to: ref.
type: text; replaces the value of ref's field, or of the focused field without ref.
key: text = space-separated keys/chords ("Enter", "Control+Shift+K", "Tab Tab Enter") to the focused element.
scroll: scroll_direction, scroll_amount (ticks of ~100px).
left_click_drag: start_coordinate -> coordinate.
screenshot: -> {file_id, file_url, width, height, mime_type}; reuse file_id with upload_file/drop_file.
repeat and modifiers are accepted but not applied.

**Parameters:** `ref` (string); `text` (string); `action` (string, required) = ["left_click","right_click","double_click","triple_click","type","key","scroll","hover","screenshot","left_click_drag","scroll_to","focus","blur"]; `repeat` (integer); `tab_id` (string, required); `modifiers` (string); `coordinate` (array); `scroll_amount` (integer); `scroll_direction` (string) = ["up","down","left","right"]; `start_coordinate` (array)

### `drop_file`

_action_

Dispatches a drag-and-drop of one file onto ref or coordinate (one required); focuses tab_id first. For drop zones not backed by <input type='file'> (else upload_file). file_id is a MediaRef id (prior upload, or computer screenshot).

**Parameters:** `ref` (string); `tab_id` (string, required); `file_id` (string, required); `filename` (string); `coordinate` (array)

### `form_input`

_action_

Set a form element's value by ref (from read_page/find); element type auto-detected. Text/textarea/contenteditable: string, replaces content. Checkbox: boolean. Select, radio: the option's value attribute, not its label (a miss returns the available options).

**Parameters:** `ref` (string, required); `value` (string|number|boolean, required); `tab_id` (string, required)

### `navigate`

_action_

Navigate tab_id to url; url 'back'/'forward' moves through history. A URL without a scheme gets https://. Navigating invalidates refs from earlier read_page calls; call read_page again before using refs.

**Parameters:** `url` (string, required); `force` (boolean); `tab_id` (string, required)

### `sleep`

_action_

Unconditional pause of ms milliseconds -> {ok, slept_ms}. For time-based page behavior: a video playing before transcript capture, an animation, a debounced search, a rate-limit window. With a concrete condition (element, text, url, network_idle) use wait_for.

**Parameters:** `ms` (integer, required); `reason` (string)

### `stylesheet`

_privileged_

Inject or remove CSS on a tab (default active). inject: lasts until navigation. remove: css must exactly match an injected block.

**Parameters:** `css` (string, required); `action` (string, required) = ["inject","remove"]; `tab_id` (integer)

### `submit_form`

_action_

Submit a form in the agent's tab: clicks its submit button so validation and handlers run; with no button or via_button=false, calls form.requestSubmit().

**Parameters:** `selector` (string); `via_button` (boolean)

### `upload_file`

_action_

Sets files on an <input type='file'> (by ref) and fires change; focuses tab_id first. file_ids are MediaRef ids (prior upload, or computer screenshot). Never click a file input: the native picker is invisible to you. Drop zones without a file input: drop_file.

**Parameters:** `ref` (string, required); `tab_id` (string, required); `file_ids` (array, required)

### `wait_for`

_read_

Poll (200 ms) until a condition holds or timeout_ms; use after navigation or actions that load async instead of fixed sleeps. Activates and focuses the tab. element: target = CSS selector or 'ref:<ref>', exists and visible (non-zero box, not hidden/transparent). text: target is a case-insensitive substring of the page's innerText. url: target is a regex (substring if it fails to compile) on the tab URL. network_idle: currently unreliable — prefer element, text or url. Returns {ok, elapsed_ms} or {ok:false, reason:'timeout'}.

**Parameters:** `scroll` (boolean); `tab_id` (string, required); `target` (string); `condition` (string, required) = ["element","text","url","network_idle"]; `timeout_ms` (integer)

## memory

### `remember_for_domain`

_action_

Save a site-specific lesson ('PO submit is the third primary button', 'DOB is MM/DD/YYYY', 'SSO via Okta'); it appears in domain_memo context on every later visit to the domain and its subdomains. Pass note and/or hints; notes accumulate (newest 50 kept), hints merge by key. Returns the updated memo.

**Parameters:** `note` (string); `hints` (object); `domain` (string, required)

## productivity

### `google_email_send`

_ask-user_

Show the user one Gmail message and let THEM send it. Pass the exact recipient, subject and body you want sent (use google_workspace prepare_email first to compose it). AI Matrx renders that message to the user, who may edit any field and must explicitly confirm before anything is sent from their Gmail account. You cannot confirm on their behalf and there is no argument that skips the review. Returns {sent:true, message_id, to, subject, edited} once the user sends, or {sent:false, declined:true} if they decline — treat a decline as a normal outcome and ask what to change.

**Parameters:** `cc` (array); `to` (string, required); `body` (string, required); `subject` (string, required)

## reading

### `data_patterns`

_action_

The user's saved data-extraction patterns (the extension's Showcase/Data tabs), run against the assigned tab. Prefer list → run over re-scraping a page the user already has a pattern for.
- list: domain → patterns with health (last_status, last_run_at, last_run_count).
- describe: pattern_id → full config and fields.
- recipes: → curated known-good configs matching the tab's URL.
- run: pattern_id → rows (capped by rows_limit), true row_count, truncated, outcome. The pattern must belong to the tab's host. DOM kinds run in-page; ai_extract re-runs the extraction agent; network_capture needs admin, Chrome debugger permission, and approval per run, then reloads the page and waits for a matching API response.
- save: name, kind, config (+ fields for manual_css) → id. Saved for the tab's path.
- delete: pattern_id.

**Parameters:** `kind` (string) = ["manual_css","json_ld","og_meta","auto_table","next_data","ai_extract","list_pattern","microdata","network_capture"]; `name` (string); `action` (string, required) = ["list","describe","recipes","run","save","delete"]; `config` (object); `domain` (string); `fields` (array); `pattern_id` (string); `rows_limit` (integer)

### `extract_microdata`

_read_

Extract the active page's structured data in one call. Returns { ok, snapshot, json_ld, microdata, schema_org_types, counts: {json_ld, microdata}, reason? }. snapshot: title, url, canonical, lang, description, og.*, twitter.*, article.*, embedded JSON-LD, favicon. json_ld: every block, @graph flattened. microdata: top-level [itemscope][itemtype] items. schema_org_types: union of every detected type (answers 'is this a Product page?'). A failed sub-extractor returns empty and is named in reason.

**Parameters:** `kinds` (array); `ld_type` (string); `itemtype` (string)

### `extract_table`

_read_

Extract one table on the active page as structured JSON: native <table> (thead/tbody, rowspan/colspan, multi-row headers) or ARIA role=table/grid. Target: `ref` from read_page (preferred), else `selector` (CSS), else the largest visible table. Returns { ok, table_kind, columns: [{index, path: [header levels]}], rows: [{index, cells: [{value, is_header, colspan?, rowspan?}]}], merged_cells, row_count, column_count, header_row_count, truncated } or { ok: false, reason }. One call instead of cell-by-cell scraping.

**Parameters:** `ref` (string); `max_rows` (integer); `selector` (string); `normalize` (boolean); `compute_header_paths` (boolean)

### `fetch_url_as_markdown`

_read_

Fetch an HTTP(S) URL and return its readable content as Markdown — the same defuddle + readability + turndown pipeline the Scrape tab uses against the active page, but pointed at any URL without opening a tab. Returns { title, markdown, byline, excerpt, extractor, word_count, reading_time_minutes, metadata, ld_json, http_status, final_url, content_type, truncated }. Pass `use_session: true` to attach the user's cookies (paywalled / logged-in pages). Pass `include_extras: true` to also get links / images / videos / SEO audit. Non-HTML URLs (PDFs, JSON, etc.) are rejected with a clear error — use `read_pdf` for PDFs.

**Parameters:** `url` (string, required); `max_chars` (integer); `user_agent` (string); `use_session` (boolean); `include_extras` (boolean); `follow_redirects` (boolean)

### `find`

_read_

Find elements on the active page by natural-language description ("the sign-in button", "the paragraph about pricing"). Returns { matches: [{ ref, name, role, score, reason }] }; pass the refs to interaction tools. Reuses a fresh read_page scrape, so call read_page once before a series of finds. Searches headings/paragraphs too; include_content:false restricts to interactive elements.

**Parameters:** `limit` (integer); `query` (string, required); `tab_id` (string); `max_candidates` (integer); `include_content` (boolean)

### `find_text_on_page`

_read_

Ctrl+F over a tab's text nodes, skipping script/style and nodes whose direct parent is display:none or visibility:hidden; a match never spans element boundaries. Returns {count, matches: [{text, context, selector, tag}]}; selector = enclosing element. Cheaper than read_active_page when you only need where a string appears; for natural-language search use find.

**Parameters:** `limit` (integer); `query` (string, required); `regex` (boolean); `tab_id` (string); `context_chars` (integer); `case_sensitive` (boolean)

### `get_computed_style`

_read_

Read computed CSS for an element. Pass `properties` to limit (e.g. ["color","font-size"]) — without it returns a useful default subset (color, background, font, padding, margin, border, display, position, dimensions). Useful for debugging visual issues or matching styles.

**Parameters:** `selector` (string, required); `properties` (array)

### `get_element_at_point`

_read_

Identify the DOM element at viewport coordinates (x, y). Returns tag, text, attrs, and a stable selector. Useful when correlating something seen in a screenshot to a clickable element.

**Parameters:** `x` (number, required); `y` (number, required)

### `get_element_details`

_read_

Inspects one element by ref: all attributes (sensitive values masked), bounding rect, visibility (incl. CSS-hidden), first 400 chars of text. include_styles adds computed styles; include_html adds innerHTML (capped 50 KB, truncated:true). Use when read_page's summary is not enough, e.g. data-* attributes.

**Parameters:** `ref` (string, required); `tab_id` (string); `include_html` (boolean); `include_styles` (boolean)

### `get_form_fields`

_read_

List forms on the active tab: each form's id, action, method, submit_selector, and fields {name, type, value, label, required, placeholder, selector}; select fields include options; secret values masked. Scans <form> elements only. Use before typing to pick the right field.

**Parameters:** `selector` (string)

### `get_page_links`

_read_

Return anchor links from the active tab. Each entry is { href, text, title, rel, target }. Filter by href substring, link text substring, or same-origin only. Lighter than read_active_page when you only need link discovery.

**Parameters:** `limit` (integer); `href_contains` (string); `text_contains` (string); `same_origin_only` (boolean)

### `get_page_selection`

_read_

Returns the active tab's selected text as {text, selected, range_count}; text '' when nothing is selected, plus error if the page blocks scripting.

**Parameters:** _No parameters._

### `get_page_text`

_read_

Extract clean readable text from the active page — prefers <main>/<article>, drops nav / aside / header / footer / scripts / hidden DOM. Lighter than read_active_page (which returns full markdown + media + structured data). Best for "read me this article" style asks. Returns { url, title, byline, text, char_count }.

**Parameters:** `tab_id` (string); `max_chars` (integer)

### `inspect_element`

_read_

Deep snapshot of a single element: tag, text, full attributes, bounding rect, key computed styles, ancestor chain (tag + class), and child counts. Useful when a click or type call is failing and you need to understand why.

**Parameters:** `selector` (string, required)

### `list_highlights`

_read_

List highlights the user captured on web pages (text passages and elements) via the Highlight tab. Each entry includes the captured text plus a reference (CSS selector, data-matrx-ref when still valid, role/tag, and a text-quote anchor) so you can act on the exact element or passage with click/type/extract tools. scope: "page" (current URL, default), "site" (current domain), or "all".

**Parameters:** `url` (string); `limit` (integer); `scope` (string) = ["page","site","all"]

### `mutation_watch`

_read_

Watch one element for duration_ms and report what changed — use instead of polling read_page while async UI settles. Returns {ok, duration_ms, events: [{ts_ms, kind, before?, after?, attribute?, added_count?, removed_count?, visible?}], total_events, truncated}; before/after capped at 200 chars. Errors: element not found, bad selector.

**Parameters:** `ref` (string); `kinds` (array); `selector` (string); `max_events` (integer); `duration_ms` (integer)

### `query_elements`

_read_

Run document.querySelectorAll on the active tab and return up to `limit` matches as { index, tag, text, attrs, visible }. attrs holds the requested `attributes`, or all attributes when omitted; sensitive values are masked. Use this to find CSS selectors that subsequent action tools can target.

**Parameters:** `limit` (integer); `selector` (string, required); `attributes` (array)

### `read_active_page`

_read_

Read the active tab and return a structured snapshot: cleaned article (markdown + html), title, byline, full image/video/link/audio lists, JSON-LD, schema types, SEO signals (headings, meta, alt-text coverage). Pass deep=true to scroll the page top→bottom first to trigger lazy-loaded images and infinite-scroll content before reading. Use this whenever you need to understand or quote the page.

**Parameters:** `deep` (boolean)

### `read_page`

_read_

Accessibility-style snapshot of a tab. Each element gets a `ref:N` to pass as `ref` to computer (left_click, type, focus, scroll_to, …) instead of a coordinate. Refs survive DOM mutations but are renumbered by the next read_page and invalidated by navigation — re-read after either. Sensitive values are masked. Returns { url, title, count, total_candidates, elements: [{ ref, role, name, tag, text, visible, bounds?, href?, value? }] }.

**Parameters:** `filter` (string) = ["interactive","all"]; `tab_id` (string); `max_chars` (integer); `max_nodes` (integer); `include_text` (boolean); `include_bounds` (boolean); `include_hidden` (boolean); `interactive_only` (boolean); `trigger_lazy_load` (boolean)

### `read_pdf`

_read_

Extract text from a PDF by file_id (cld_files id) or tab_id (open tab whose URL ends in .pdf; fetched with the user's cookies and uploaded, returning a reusable file_id). Returns file_id, text (with page markers), page_count (pages read), total_pages, page_start, page_end, truncated.

**Parameters:** `tab_id` (string); `file_id` (string); `page_end` (integer); `max_chars` (integer); `page_start` (integer)

## records

### `records`

_action_

The person's custom records: tables, fields and rows, plus forms, portals, boards, dashboards, documents and automations built on them. Send `action` and that action's arguments in `args`. Before a write or build action's FIRST use in a conversation, call {"action": "guide", "args": {"topic": "<action>"}} for every argument and a worked example (record_read and record_aggregate need no guide: their shapes are below); {"action": "guide"} alone returns the full how-to.
Actions:
- table_list: the tables and homes the person can see
- metadata_search: search tables and fields by name (structure, not rows)
- record_read: rows of a table (table_id, optional match), or one row (record_id)
- record_aggregate: count/sum/avg/min/max, grouped; every total, count, average or top N — never add up rows you read. Call it FIRST, naming the table, fields and related rows as the person did — no metadata_search, table_list, record_read or guide before it (a wrong name is refused with the real ones): {"action": "record_aggregate", "args": {"table": "Visit Log", "measure": "sum", "field_key": "Copay", "match": {"Patient.Referring physician": "Dr. Shah"}}} ("Relation.Field", or a related table's field named bare, reaches across a relation; a related row is matched by its name). Also group_by (a relation's groups carry each row's `name`), bucket (day/week/month), order "measure_desc" + limit (top N), as_of
- record_write: add or change rows, up to 200 in one call via `records`; an entry with `record_id` changes that row
- record_delete: archive a row; undo=true restores it
- record_history / record_restore_version: a row's past versions; put one back
- field_propose: add ONE field to an existing table
- table_propose: a new table WITH all its fields in one call (a choice field takes `options`, a link takes `relation_target`: the other table's id)
- import_propose: a spreadsheet, CSV or rows from the chat into a table
- did rows fail to import / is this table complete: record_read with table_id (or table); the answer's import_note says what the last import refused and why, or is absent when nothing was
- form_propose: a form anyone with the link can answer
- capture_propose: the person's own crew logging on a phone, even offline
- booking_propose: let people book a time
- checklist_propose: a process or SOP that runs when a record arrives
- pipeline_propose: a board where records move between stages
- dashboard_propose: a saved breakdown, counts or chart
- document_propose: render a record as a proposal, quote, invoice or letter
- portal_propose: clients sign in and see only their own rows
- signature_request: have somebody sign a document on a record
- subscription_propose: notify or summarize when something happens
- enrich_propose: fill fields of rows from outside sources
- entity_read / entity_write: platform records such as contacts
- guide: arguments and examples for any action
One call per intent, never one per field or row: {"action": "table_propose", "args": {"name": "Field Crews", "fields": [{"name": "region", "type": "text"}, {"name": "day rate", "type": "currency"}]}}; {"action": "record_write", "args": {"table_id": "<id>", "records": [{"region": "North", "day_rate": 1200}, {...}]}}; {"action": "record_read", "args": {"table_id": "<id>"}}.
Reads span every organization the person belongs to. Tell the person `where.say` exactly. If an answer says `awaiting_approval`, say it did NOT happen, name the approvers, and stop.

**Parameters:** `args` (object); `action` (string, required) = ["table_list","metadata_search","record_read","record_aggregate","record_write","record_delete","record_history","record_restore_version","field_propose","table_propose","form_propose","booking_propose","import_propose","dashboard_propose","pipeline_propose","document_propose","checklist_propose","capture_propose","enrich_propose","portal_propose","signature_request","subscription_propose","entity_read","entity_write","guide"]

## tabs

### `chrome_tab_audio_inspect`

_read_

Report which open tabs are currently making noise, were recently audible (within the last 60s), or are muted. Each entry: { id, title, url, audible, muted, active, window_id, last_audible_at }. Useful for finding 'the noisy tab' and for media-aware automation.

**Parameters:** _No parameters._

### `resize_window`

_action_

Resize the OS browser window containing tab_id (default the active tab's window) to width x height px, which changes the viewport; for responsive testing. Returns {window_id, width, height}.

**Parameters:** `width` (integer, required); `height` (integer, required); `tab_id` (integer)

### `tab_groups`

_action_

Manage Chrome tab groups. list: all groups across windows. create: group tab_ids. add: move tab_ids into group_id. remove: ungroup tab_ids. update: rename, recolor or collapse group_id.

**Parameters:** `color` (string) = ["grey","blue","red","yellow","green","pink","purple","cyan","orange"]; `title` (string); `action` (string, required) = ["list","create","add","remove","update"]; `tab_ids` (array); `group_id` (integer); `collapsed` (boolean)

### `tabs`

_action_

Manage browser tabs. list: tabs in all windows. create: new foreground tab (url optional). active: your assigned tab — call when you lack a tab_id. info: one tab's details. switch: bring to foreground. close, reload, duplicate. pin / mute: set via on. move: to index (window_id optional). zoom: set zoom_factor.

**Parameters:** `on` (boolean); `url` (string); `index` (integer); `action` (string, required) = ["list","create","close","switch","reload","active","info","pin","mute","duplicate","move","zoom"]; `tab_id` (string); `window_id` (integer); `zoom_factor` (number)

## webmcp

### `chrome_webmcp`

_action · admin-only_

Use tools the current page registered via navigator.modelContext.registerTool (WebMCP, Chrome 146+). check: API present + tool count. list: the page's tools. call: run tool_name with arguments.

**Parameters:** `action` (string, required) = ["check","list","call"]; `arguments` (any); `tool_name` (string)

