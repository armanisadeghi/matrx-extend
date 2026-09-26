# matrx-extend tools

> **AUTO-GENERATED — do not edit.** Produced from `tool.definition`
> rows bound to `executor_name='chrome-extension'` via `tool.binding`,
> the source of truth. Tool names, descriptions, and argument
> contracts live ONLY in the database (Rule 4,
> common-docs/systems/agents/agent-tools/STATE.md).
> Regenerate with `pnpm docs:tools` (also runs on every `release.sh`).

Generated: 2026-09-26T17:10:20.522Z
Total tools: 82

## ai

### `ai`

_read_

On-device AI (Gemini Nano + siblings). Free, offline, multimodal, no network. Actions: 'check_availability' (probe per-API readiness), 'summarize' (text→summary), 'classify' (text+categories→label), 'extract_json' (text+schema→object), 'translate' (text+target_lang), 'detect_language' (text→BCP-47), 'proofread' (text→corrections), 'describe_image' (image_url OR image_base64+mime_type → caption), 'check_prompt_injection' (text→risk assessment). Use BEFORE expensive cloud calls when on-device quality permits.

**Parameters:** `text` (string); `action` (string, required) = ["check_availability","summarize","classify","extract_json","translate","detect_language","proofread","describe_image","check_prompt_injection"]; `prompt` (string); `schema` (any); `image_url` (string); `mime_type` (string); `categories` (array); `source_lang` (string); `target_lang` (string); `image_base64` (string)

## capture

### `chrome_record_gif`

_action_

Record browser actions and export as an animated GIF. Actions: 'start_recording', 'stop_recording', 'export' (generates and either downloads or drops onto a page element), 'clear' (discard frames). Take a screenshot right after start and right before stop to capture clean first/last frames. 'export' returns {file_id, file_url} when not dropping. Drop target accepts ref (preferred) or coordinate.

**Parameters:** `ref` (string); `action` (string, required) = ["start_recording","stop_recording","export","clear"]; `tab_id` (string, required); `options` (object); `download` (boolean); `filename` (string); `coordinate` (array)

### `chrome_record_tab_video`

_action_

Record video of a tab via chrome.tabCapture + MediaRecorder and upload to cld_files. Args: duration_ms (default 5000, max 60000), audio (default false), tab_id? (defaults to assigned tab), filename?. Returns { ok, file_id, file_url, mime_type, duration_ms, size_bytes }. Requires `tabCapture` optional permission — when missing returns ok:false with a remediation hint pointing the user to Settings → Advanced → Tab video capture.

**Parameters:** `audio` (boolean); `tab_id` (integer); `filename` (string); `duration_ms` (integer)

### `chrome_save_page_as_mhtml`

_action_

Snapshot a tab as a self-contained MHTML archive (HTML + every resource inlined). Returns base64 MHTML data. Use for: archival, sharing a frozen page, feeding the agent a stable snapshot it can reanalyze later.

**Parameters:** `tab_id` (integer)

### `downloads`

_action_

Manage file downloads. Actions: 'list' (recent downloads with id/filename/url/state/bytes), 'cancel' (abort a pending download), 'confirm' (no-op; Chrome auto-completes downloads), 'download_url' (trigger a download from a URL). download_id required for cancel/confirm; url required for download_url.

**Parameters:** `url` (string); `action` (string, required) = ["list","confirm","cancel","download_url"]; `filename` (string); `download_id` (string)

### `screenshot_region`

_read_

Capture a bounded region of the active tab's viewport — 5-20× cheaper than a full screenshot for focused vision calls. Target with `ref` (preferred, from read_page), `selector`, or explicit viewport `rect:{x,y,w,h}`; off-screen targets are scrolled into view, optional `padding` in CSS px. Uploads to cloud; returns { ok, media_type, format, width, height, source_rect, image_base64, byte_length, file_id, file_url }. Render/share file_url (durable); image_base64 feeds the vision model.

**Parameters:** `ref` (string); `rect` (object); `format` (string) = ["png","jpeg"]; `padding` (integer); `profile` (string) = ["auto","auto-final","anthropic-default","anthropic-hires","openai-original","openai-high","openai-low","gemini-screenshot","gemini-overview","gemini-2.5-default","ocr-heavy","lossless"]; `quality` (integer); `selector` (string)

## chrome

### `chrome_bookmarks`

_read_

Read the user's bookmarks. Actions: 'search' (free-text against title and URL; pass `query`), 'tree' (folder tree starting at `folder_id` or root, `max_depth` deep). Each bookmark has id/title/url/parent_id/date_added.

**Parameters:** `limit` (integer); `query` (string); `action` (string, required) = ["search","tree"]; `folder_id` (string); `max_depth` (integer)

### `chrome_cookies`

_privileged · admin-only_

Manage cookies for any domain. Actions: 'get' (read; pass `name` for a specific cookie or omit for all matching), 'set' (write; requires `name` + `value`; optional `domain`/`path`/`expires_in_seconds`/`same_site`/`http_only`/`secure`), 'delete' (requires `name`). Always pass `url` (or `domain` for 'get'). Admin-only.

**Parameters:** `url` (string, required); `name` (string); `path` (string); `value` (string); `action` (string, required) = ["get","set","delete"]; `domain` (string); `secure` (boolean); `http_only` (boolean); `same_site` (string) = ["strict","lax","no_restriction"]; `expires_in_seconds` (integer)

### `chrome_history`

_read_

Read browsing history. Actions: 'search' (free-text against title/URL; pass `query`, optional `start_time_ms`/`end_time_ms`/`limit`), 'recent' (last N `minutes`, default 60).

**Parameters:** `limit` (integer); `query` (string); `action` (string, required) = ["search","recent"]; `minutes` (integer); `end_time_ms` (integer); `start_time_ms` (integer)

### `chrome_recently_closed`

_action_

Recently-closed tabs and windows. Actions: 'list' (returns sessions with id/url/title/lastModified), 'restore' (reopens; `session_id` optional — defaults to the most recently closed).

**Parameters:** `action` (string, required) = ["list","restore"]; `session_id` (string)

## core

### `chrome_batch`

_read_

Execute up to 20 read-tier Chrome-extension tool calls in one round trip (runs in the user's browser via the Matrx extension). Pass `calls: [{ name, arguments }]`. Returns `results: [{ name, ok, output | error }]` in order. Action / ask-user / privileged tools are NOT permitted inside a batch — call them individually so the user can approve. Use this for predictable multi-step reads (read_page + take_screenshot + list_open_tabs) where each call is independent.

**Parameters:** `calls` (array, required); `stop_on_error` (boolean)

### `list_chrome_categories`

_read_

Index of every tool category the Matrx Chrome extension exposes (client-side tools that run in the user's own browser). Returns one entry per category: name, label, description, count of tools, name of the category-specific list tool. To get the full schemas for a category, call its `list_tool` (e.g. `list_reading_tools`). Use this whenever the model needs more Chrome-extension capabilities than its current toolset offers.

**Parameters:** _No parameters._

## credentials

### `credential_login`

_action_

Sign in to websites with the person's saved logins without ever seeing a credential value. For a direct sign-in request, THE PATH is: (1) open the requested sign-in page with cloud_browser; (2) call credential_login action='auto' with that browser session; (3) use discover then one complete attempt only if auto could not read the form; (4) use authenticator for a supported saved TOTP challenge. action='list' is diagnostic metadata only after no_matching_login; it never performs a login. FILTER the list: pass host='<the site''s host>' or query='<a name>' and you get back only the saved logins you asked about. Unfiltered it returns a short summary line per saved login (id, name, hosts, whether it has an authenticator), capped, with truncated=true when there is more — pass verbose=true only when you need an item''s full record. A filter that matches nothing returns status no_matching_login with matched=false and the total number of saved logins: stop searching rather than calling list again. FILTER the list: pass host='<the site''s host>' or query='<a name>' and you get back only the saved logins you asked about. Unfiltered it returns a short summary line per saved login (id, name, hosts, whether it has an authenticator), capped, with truncated=true when there is more — pass verbose=true only when you need an item''s full record. A filter that matches nothing returns status no_matching_login with matched=false and the total number of saved logins: stop searching rather than calling list again. Never pass a URL, username, password, token, seed, or code. End with exactly one verdict: authenticated, needs_mfa, captcha_or_takeover, credentials_rejected, or unknown. Missing credentials and inventory-only results are unknown, never credentials_rejected. CAPTCHA and unsupported MFA require user takeover. When a credential_login result ends the requested task, include a literal final line in the form Verdict: <token>. For an inventory-only or missing-credential result, that line MUST be exactly Verdict: unknown; never replace unknown with prose such as cannot sign in.

**Parameters:** `host` (string); `kind` (string) = ["secret_exposed","wrong_verdict","recipe_wrong","other"]; `notes` (string); `query` (string); `steps` (array); `where` (string); `action` (string, required) = ["list","auto","discover","attempt","authenticator","report","capture","propose_recipe"]; `expect` (object); `fields` (array); `submit` (any); `verbose` (boolean); `$variants` (any); `field_map` (array); `attempt_id` (string); `session_id` (string); `description` (string); `display_name` (string); `provider_key` (string); `code_selector` (string); `failure_signals` (array); `submit_selector` (string); `success_signals` (array); `challenge_signals` (array); `credential_item_id` (string)

## crm

### `capture_prospect`

_action_

Add the website of the page you are on to the user's AI Matrx prospect list. ALWAYS call with action='preview' first: it writes nothing and tells you the verdict (new, already a prospect, blocked by the user's blocklist, or not a usable web address), which of their websites it would be filed under, and — most importantly — whether this company is ALREADY someone they know, with the number of previous messages, the campaigns they are in, how many confirmed wins they have given, and whether they are marked do-not-contact. Report that before capturing: treating a warm or forbidden contact as a cold prospect is the mistake this prevents. Then call action='capture' to save it. The capture goes through the platform's one prospect-import path, so the user's blocklist, de-duplication and authority scoring all apply exactly as they do to a prospect found by search. Defaults to the page you are assigned to; pass `url` only to capture a different address. If the user has several websites the call comes back asking which one — ask them, then pass `site_id`. This tool captures a COMPANY, never a person; it never sends anything to anyone.

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

Record a user demonstration that can later be replayed by the agent. Actions: 'start' (begin recording on a tab; clicks, typed text, submits, navigations, and scrolls are captured automatically as the user demonstrates), 'stop' (save the recording with a name + parameter declarations; sensitive fields like passwords are auto-parameterised), 'discard' (throw away the in-flight recording without saving), 'status' (read; report whether a recording is active and how many steps have been captured). Coach the user: ask them to walk through the workflow, then call stop when they say they're done. Saved demos are replayed via `replay_demo`.

**Parameters:** _No parameters._

### `replay_demo`

_privileged_

Replay a saved demo against a tab. Always requires confirmation — the demo can click, type, submit, and navigate. Pass `dry_run: true` to test selector resolution without taking action. Pass `params` to substitute placeholders (sensitive fields like passwords MUST be supplied this way; the agent should ask the user via `user(type='secret', ...)` first). Returns per-step results with `resolved_via` showing which selector strategy hit.

**Parameters:** `params` (object); `tab_id` (integer); `demo_id` (string, required); `dry_run` (boolean)

## desktop

### `desktop_run_command`

_privileged_

Invoke a command on the matrx-local desktop bridge. Available commands depend on what matrx-local exposes (file ops, system info, window control, etc.). Returns { ok, data?, error? }. Fails fast with reason="desktop unavailable" if the bridge isn't connected — check via the desktop:availability channel before calling.

**Parameters:** `args` (object); `command` (string, required)

## devtools

### `cdp_a11y_tree`

_privileged_

Dump the accessibility tree of the active tab via Accessibility.getFullAXTree. Each node has { role, name, value, description, properties, children }. Use INSTEAD of read_active_page when you want a clean semantic view of the page — it omits decorative DOM and surfaces aria-roles, button labels, form-field associations directly. Best for vision-free reasoning.

**Parameters:** `tab_id` (integer); `max_nodes` (integer)

### `cdp_emulate`

_privileged · admin-only_

Override viewport / device metrics on an attached CDP tab for responsive testing. Actions: 'set' (apply `width`+`height`+optional `device_scale_factor`/`mobile`/`user_agent`), 'clear' (revert overrides). Tab must be attached via cdp_session first.

**Parameters:** `width` (integer); `action` (string, required) = ["set","clear"]; `height` (integer); `mobile` (boolean); `tab_id` (integer); `user_agent` (string); `device_scale_factor` (number)

### `cdp_full_page_screenshot`

_privileged_

Capture the FULL scrollable page (beyond the viewport) — use instead of computer/take_screenshot for long-form pages. Auto-scales so the long edge fits the `profile`'s vision-model target (same profiles as take_screenshot). Uploads to cloud; returns { ok, media_type, format, width, height, image_base64, byte_length, capture_scale, profile, est_tokens, file_id, file_url }. Render/share file_url (durable); image_base64 feeds the vision model — pass media_type through verbatim, never stringify the object.

**Parameters:** `format` (string) = ["png","jpeg","webp"]; `tab_id` (integer); `profile` (string) = ["auto","auto-final","anthropic-default","anthropic-hires","openai-original","openai-high","openai-low","gemini-screenshot","gemini-overview","gemini-2.5-default","ocr-heavy","lossless"]; `quality` (integer); `full_page` (boolean); `capture_scale` (number)

### `cdp_input_click_xy`

_privileged_

Synthesize a real mouse click at viewport coordinates (x, y) via Input.dispatchMouseEvent. Bypasses event-handler shadowing, works through shadow DOM and cross-origin iframes (OOPIFs) — the most reliable click in existence. Use when click_element fails because the page intercepts synthetic clicks.

**Parameters:** `x` (number, required); `y` (number, required); `button` (string) = ["left","right","middle"]; `tab_id` (integer); `click_count` (integer)

### `cdp_input_type`

_privileged_

Type literal text into whatever element currently has focus, via Input.insertText. Fires beforeinput / input / compositionend events correctly so React-controlled inputs accept it. Use after focus_element + when type_into_element fails.

**Parameters:** `text` (string, required); `tab_id` (integer)

### `cdp_network_capture_drain`

_privileged_

Drain captured Network events from a tab's buffer. Each entry has { request_id, url, method, status, mime_type, request_headers, response_headers, finished, failed, ts_ms }. Use cdp_network_get_body with a request_id to fetch a response body lazily.

**Parameters:** `max` (integer); `tab_id` (integer); `url_contains` (string)

### `cdp_network_capture_start`

_privileged_

Begin capturing every Network event on a tab (default: active). After this, navigate or interact with the page; calls accumulate in a buffer. Use cdp_network_capture_drain to read them. Use cdp_network_capture_stop when finished.

**Parameters:** `tab_id` (integer)

### `cdp_network_capture_stop`

_privileged_

Stop capturing Network events on a tab and clear its buffer.

**Parameters:** `tab_id` (integer)

### `cdp_network_get_body`

_privileged_

Fetch the response body for a captured request, by request_id (from cdp_network_capture_drain). Returns { body, base64_encoded }. Bodies are large so we don't buffer them eagerly.

**Parameters:** `tab_id` (integer); `request_id` (string, required)

### `cdp_perf_metrics`

_read_

Read Performance.getMetrics for a tab. Returns { Documents, Frames, JSHeapUsedSize, LayoutCount, RecalcStyleCount, ScriptDuration, TaskDuration, … }. Useful when an action triggered chaos and you need to measure it.

**Parameters:** `tab_id` (integer)

### `cdp_print_pdf`

_privileged_

Print a tab to PDF via Page.printToPDF. Returns base64 PDF data. Useful for archival, sharing, or feeding the PDF to a downstream model.

**Parameters:** `tab_id` (integer); `landscape` (boolean); `print_background` (boolean)

### `cdp_session`

_privileged · admin-only_

Manage Chrome DevTools Protocol attachments. Actions: 'attach' (begin debugger session on `tab_id` — required before any other cdp_* tool), 'detach' (end session), 'list' (which tabs are currently attached). Admin + `debugger` permission.

**Parameters:** `action` (string, required) = ["attach","detach","list"]; `tab_id` (integer)

### `get_request_body`

_privileged_

Fetch the response body for a specific request seen by read_network_requests. Returns inline text. Pass request_id from a prior drain.

**Parameters:** `tab_id` (string); `request_id` (string, required)

### `read_console_messages`

_privileged_

Read console messages from a tab. Auto-starts CDP console capture if not already running. Filter by level, text regex, or use errors_only=true. Returns { count, messages: [{ level, text, url, line, ts_ms }] }. Console capture stays on until cdp_detach or tab close.

**Parameters:** `max` (integer); `clear` (boolean); `limit` (integer); `tab_id` (string); `pattern` (string); `auto_start` (boolean); `errors_only` (boolean); `level_filter` (array)

### `read_network_requests`

_privileged_

Read HTTP requests (XHR, fetch, documents, etc.) from a tab. Auto-cleared on cross-domain navigation. Filter with url_pattern to keep output manageable. Response bodies are NOT included by default — use get_request_body to fetch a specific body. The buffer is per-tab and bounded; old entries fall off the back.

**Parameters:** `clear` (boolean); `limit` (integer); `tab_id` (string); `auto_start` (boolean); `url_pattern` (string); `include_body` (boolean)

## education

### `capture_study_set`

_action_

Capture the study set on the current page into a native AI Matrx flashcard deck. Extracts term/definition pairs (a Quizlet set's framework data, a definition list, or a two-column table) and lands them through the platform's one import door — the same writer, dedupe and membership edges as the web app's importer. Always 'preview' first: it writes nothing and returns the deck name, card count and a 5-card sample so the user confirms what would be captured. 'capture' commits and returns the new deck's id and open link. Requires sign-in to commit.

**Parameters:** `action` (string) = ["preview","capture"]; `deck_name` (string)

## guidance

### `delete_guidance_item`

_action_

Delete a saved guidance item by id. Cannot be undone. For demo references, this only removes the guidance index entry — the underlying demo lives in its own storage and must be deleted via `delete_demo`.

**Parameters:** `id` (string, required)

### `get_guidance_item`

_read_

Return the full record for one guidance item by id. Notes include their text; screenshots/GIFs include their cld_files URL; demo references include the linked demo_id (use `replay_demo` to run).

**Parameters:** `id` (string, required)

### `list_guidance`

_read_

List saved guidance items (notes, screenshots, GIFs, demo references). Pass `domain` to filter; omit to return everything. Returns lightweight summaries — call `get_guidance_item` for full details.

**Parameters:** `domain` (string)

### `save_guidance_note`

_action_

Save a domain-scoped note for the user (or for yourself on the next visit). The note auto-surfaces in chat context whenever the user opens a tab on this domain. Use for site-specific lessons that don't fit in `remember_for_domain`'s structured hints — full prose explanations, workflow hints, gotchas.

**Parameters:** `text` (string, required); `domain` (string, required); `caption` (string); `origin_url` (string)

## human

### `request_user_takeover`

_ask-user_

Hand keyboard/mouse control to the user so they can perform an action the agent cannot or should not (logging in, MFA, CAPTCHA, sensitive form filling, decisions only the user can make). The user types/clicks directly into the page; when they're done they signal completion in the UI. The agent should re-read the page after takeover ends to see what changed. Distinct from `user` (Q&A) — this is full page handoff.

**Parameters:** `reason` (string, required); `tab_id` (string); `instructions` (string); `expected_action` (string); `timeout_seconds` (integer)

### `update_plan`

_ask-user_

Propose a step-by-step plan and wait for the user to approve, modify, or reject it. Use this BEFORE a multi-step action sequence so you align on intent up front. Returns { approved: true, note?: string } or { approved: false, note?: string } so you can adjust.

**Parameters:** `steps` (array); `title` (string); `domains` (array); `approach` (array); `reasoning` (string); `timeout_seconds` (integer); `estimated_minutes` (integer)

### `user`

_ask-user_

Pause and interact with the user. ONE tool, six types — pick the right one. ASK types (resolve with the user's answer): 'confirm' (yes/no), 'choice' (pick exactly one from `options`), 'choice_many' (pick zero-or-more from `options`, checklist UI), 'text' (free-form input), 'secret' (sensitive input — masked in UI and storage, response tagged sensitive). NOTIFY type (does not require an answer, nudges the user to take action elsewhere): 'notify' — surface `message` with optional `actions` buttons (e.g. ['Done — I clicked it']) and an always-appended 'Other' freeform fallback. All types accept an optional `timeout_seconds` — if no response arrives in time the call resolves with `{ timed_out: true }` and the agent continues. Prefer this over guessing on destructive or sensitive actions. For full control transfer (user types directly into the page), use request_user_takeover instead — different lifecycle. NEVER add your own 'Other', 'None of these', or free-text choice to `options` — the UI ALWAYS appends a freeform 'Other' escape to every choice/choice_many/confirm, so list only the substantive options. The user can also reply outside your structure: every result may carry `additional_instructions` (an optional freeform note the user attached to their answer — always read and honor it) and `wrote_instead: true` (the user declined the structured question(s) and typed a freeform reply in `freeform`; treat that as their answer and re-ask later only if you still genuinely need it).

**Parameters:** `type` (string) = ["confirm","choice","choice_many","text","secret","notify"]; `level` (string) = ["info","success","warning","error"]; `header` (string); `actions` (array); `context` (string); `message` (string); `options` (array); `question` (string); `questions` (array); `allow_other` (boolean); `timeout_seconds` (integer)

### `user_todos`

_action_

Assign tasks TO THE USER for the current conversation. The user sees them in a dedicated panel and checks them off; you'll see their state in `user_todos` context on every turn. Actions: 'add' (`title` + optional `context` for why + optional `due` hint; fires a Chrome notification unless `silent:true`), 'list', 'update' (`id` + `title`/`context`/`due`; pass null to clear), 'remove' (`id`), 'mark_done' (`id`; `done:false` un-checks), 'clear_done' (purge completed). Use this to delegate work back to the user — e.g. 'forward the email I just drafted', 'pick a date for the meeting'.

**Parameters:** `id` (string); `due` (any); `done` (boolean); `title` (string); `action` (string, required) = ["add","list","update","remove","mark_done","clear_done"]; `silent` (boolean); `context` (any)

## interaction

### `clipboard`

_action_

Read from or write to the system clipboard. Actions: 'read' (returns current clipboard text), 'write' (sets clipboard text — pass `text`). Useful for 'copy this for the user' and 'paste what I just copied' workflows.

**Parameters:** `text` (string); `action` (string, required) = ["read","write"]

### `computer`

_action_

Mouse, keyboard, and screenshot interactions. Prefer 'ref' over 'coordinate' when targeting elements; coordinates survive poorly across scrolls and layout changes. The 'screenshot' action persists the image to cloud and returns {file_id, file_url, width, height, mime_type} — use that file_id with upload_file or drop_file later. Use wait_for for synchronization, NOT a fixed sleep.

**Parameters:** `ref` (string); `text` (string); `action` (string, required) = ["left_click","right_click","double_click","triple_click","type","key","scroll","hover","screenshot","left_click_drag","scroll_to","focus","blur"]; `repeat` (integer); `tab_id` (string, required); `modifiers` (string); `coordinate` (array); `scroll_amount` (integer); `scroll_direction` (string) = ["up","down","left","right"]; `start_coordinate` (array)

### `drop_file`

_action_

Synthesize a drag-and-drop of a single file onto a target element or coordinate. Use for drop zones that aren't backed by <input type='file'>. Provide ref OR coordinate. file_id is a MediaRef (e.g. from a prior screenshot or upload).

**Parameters:** `ref` (string); `tab_id` (string, required); `file_id` (string, required); `filename` (string); `coordinate` (array)

### `form_input`

_action_

Set the value of a form element by reference. Use string for text inputs, boolean for checkboxes/radios, value or visible label for selects. The handler dispatches on element type — you don't need to specify it.

**Parameters:** `ref` (string, required); `value` (string|number|boolean, required); `tab_id` (string, required)

### `navigate`

_action_

Navigate a tab to a URL, or move through history with 'back'/'forward'. Protocol defaults to https:// if omitted. After navigating, refs from prior read_page calls are invalidated — call read_page again before referencing elements.

**Parameters:** `url` (string, required); `force` (boolean); `tab_id` (string, required)

### `sleep`

_action_

Pause the agent for `ms` milliseconds (50ms–5min). Use when waiting for time-based things the page does on its own — a video to play before capturing transcript, an animation to finish, a debounced search to settle, a rate-limit window to clear. The server is non-blocking during the pause; only the agent waits. Prefer `wait_for` when you have a concrete condition (selector or readyState) — `sleep` is for unconditional waits. Returns { ok, slept_ms }.

**Parameters:** `ms` (integer, required); `reason` (string)

### `stylesheet`

_privileged_

Inject or remove a CSS stylesheet on the active (or specified) tab. Actions: 'inject' (apply `css`; pass `persistent: true` to survive navigations), 'remove' (drop a previously-injected `css` block — must match exactly).

**Parameters:** `css` (string, required); `action` (string, required) = ["inject","remove"]; `tab_id` (integer); `persistent` (boolean)

### `submit_form`

_action_

Submit a form. By default the tool clicks the form's primary submit button (so HTML5 validation + framework handlers run). Set via_button=false to fall back to HTMLFormElement.submit() — skips validation but works for form elements that lack a button.

**Parameters:** `selector` (string); `via_button` (boolean)

### `upload_file`

_action_

Upload one or more files to a <input type='file'> element by reference. Pass file_ids — these are MediaRef IDs (e.g. from a previous /files/upload, or from computer.action=screenshot). The handler resolves each file_id to bytes and sets the input. Do NOT click file inputs — that opens a native picker the agent cannot see. For drag-and-drop targets, use drop_file instead.

**Parameters:** `ref` (string, required); `tab_id` (string, required); `file_ids` (array, required)

### `wait_for`

_read_

Poll until a condition is met or timeout. Use after navigation or actions that trigger async loads — far more reliable than fixed sleeps. Conditions: 'element' (ref or selector exists and is visible; pass scroll=true to scroll the page while polling — handles infinite scroll), 'text' (text appears anywhere on page), 'url' (tab URL matches substring or regex), 'network_idle' (no in-flight requests for ~500ms).

**Parameters:** `scroll` (boolean); `tab_id` (string, required); `target` (string); `condition` (string, required) = ["element","text","url","network_idle"]; `timeout_ms` (integer)

## memory

### `remember_for_domain`

_action_

Remember something about a domain so it shows up in `domain_memo` context on every future visit. Use for site-specific lessons: "the PO submit button is the third primary", "DOB format is MM/DD/YYYY here", "this site requires SSO via Okta". Notes are free-form prose; hints are structured key/value pairs you can look up by name. Memos on a parent domain (e.g., atlassian.net) automatically apply to subdomains. Returns the updated memo so you can see what is remembered now.

**Parameters:** `note` (string); `hints` (object); `domain` (string, required)

## productivity

### `google_email_send`

_ask-user_

Show the user one Gmail message and let THEM send it. Pass the exact recipient, subject and body you want sent (use google_workspace prepare_email first to compose it). AI Matrx renders that message to the user, who may edit any field and must explicitly confirm before anything is sent from their Gmail account. You cannot confirm on their behalf and there is no argument that skips the review. Returns {sent:true, message_id, to, subject, edited} once the user sends, or {sent:false, declined:true} if they decline — treat a decline as a normal outcome and ask what to change.

**Parameters:** `cc` (array); `to` (string, required); `body` (string, required); `subject` (string, required)

## reading

### `data_patterns`

_action_

Manage and run the user's saved data-extraction patterns (the same system behind the extension's Showcase and Data tabs). Actions: 'list' — saved patterns for a domain (defaults to the current tab's host) with health badges; 'describe' — one pattern's full config and fields; 'recipes' — curated extraction recipes matching the current page (known-good configs for popular sites); 'run' — execute a saved pattern on the current tab and get rows back (DOM kinds run instantly; ai_extract re-runs the extraction agent against the page; network_capture reloads the tab and listens ~20s for the matching API request — tell the user before running it since the page will reload); 'save' — persist a new pattern (requires name + kind, mode-specific config, and fields for manual_css); 'delete' — remove a pattern. Run results are capped at rows_limit (default 100) with the true row_count reported. Prefer 'list' then 'run' over re-scraping a page the user has already built a pattern for.

**Parameters:** `kind` (string) = ["manual_css","json_ld","og_meta","auto_table","next_data","ai_extract","list_pattern","microdata","network_capture"]; `name` (string); `action` (string, required) = ["list","describe","recipes","run","save","delete"]; `config` (object); `domain` (string); `fields` (array); `pattern_id` (string); `rows_limit` (integer)

### `extract_microdata`

_read_

Extract every structured-data signal on the active page in one call: { snapshot, json_ld, microdata, schema_org_types, counts }. `snapshot` is the OG/Twitter/canonical/JSON-LD snapshot used by the Showcase tab. `json_ld` returns each JSON-LD block (flattens @graph; honors `ld_type` filter). `microdata` walks every [itemscope][itemtype] tree (honors `itemtype` filter). `schema_org_types` unions all detected types so you can answer 'is this a Product page?' in one read. Same code paths as the user-facing Showcase → JSON-LD / Microdata / Snapshot sub-tabs, so improvements to either surface flow both ways.

**Parameters:** `kinds` (array); `ld_type` (string); `itemtype` (string)

### `extract_table`

_read_

Extract a table on the active page as structured JSON. Handles native <table> with thead/tbody, rowspan/colspan, multi-row headers, and ARIA role="table" / role="grid" patterns. Provide `ref` (preferred) from a prior read_page, or `selector` (any CSS), or omit both to pick the largest visible table. Returns { columns: [{ index, path: [headerLevels...] }], rows: [{ cells: [{ value, is_header, colspan?, rowspan? }] }], merged_cells, row_count, column_count }. Use this instead of cell-by-cell scraping — one call versus dozens.

**Parameters:** `ref` (string); `max_rows` (integer); `selector` (string); `normalize` (boolean); `compute_header_paths` (boolean)

### `fetch_url_as_markdown`

_read_

Fetch an HTTP(S) URL and return its readable content as Markdown — the same defuddle + readability + turndown pipeline the Scrape tab uses against the active page, but pointed at any URL without opening a tab. Returns { title, markdown, byline, excerpt, extractor, word_count, reading_time_minutes, metadata, ld_json, http_status, final_url, content_type, truncated }. Pass `use_session: true` to attach the user's cookies (paywalled / logged-in pages). Pass `include_extras: true` to also get links / images / videos / SEO audit. Non-HTML URLs (PDFs, JSON, etc.) are rejected with a clear error — use `read_pdf` for PDFs.

**Parameters:** `url` (string, required); `max_chars` (integer); `user_agent` (string); `use_session` (boolean); `include_extras` (boolean); `follow_redirects` (boolean)

### `find`

_read_

Find elements on the active page by natural-language description ("the sign-in button", "the search input near the top", "the paragraph about pricing"). Returns matching refs you can immediately pass to interaction tools. Uses on-device AI for matching when available; falls back to text similarity. Reuses any fresh `read_page` scrape — call it once before a series of finds. By default also searches non-interactive content (headings/paragraphs) so you can locate sections by topic; set `include_content:false` to restrict to clickable elements only. Returns { matches: [{ ref, name, role, score, reason }] }.

**Parameters:** `limit` (integer); `query` (string, required); `tab_id` (string); `max_candidates` (integer); `include_content` (boolean)

### `find_text_on_page`

_read_

Ctrl+F-style literal text search within a tab. Returns matches with surrounding context + the nearest enclosing element selector. Pass regex=true to use a regular expression. Use when read_active_page would be overkill — e.g. "where on this page does it say 'click here to download'?". For natural-language search, use find instead.

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

Deep inspection of a single element by ref: full attribute set, bounding box, visibility, optional computed styles and innerHTML. Use when read_page's summary isn't enough — e.g. reading data-* attributes or checking if something is hidden by CSS. Avoids needing evaluate_javascript for routine introspection. innerHTML is capped at 50 KB; response includes truncated:true when exceeded.

**Parameters:** `ref` (string, required); `tab_id` (string); `include_html` (boolean); `include_styles` (boolean)

### `get_form_fields`

_read_

Discover forms on the active tab. For each form, returns id, action, method, and a list of fields: { name, type, value, label, required, placeholder, selector }. Use this BEFORE typing to find the right selector and label so you fill the right field.

**Parameters:** `selector` (string)

### `get_page_links`

_read_

Return anchor links from the active tab. Each entry is { href, text, title, rel, target }. Filter by href substring, link text substring, or same-origin only. Lighter than read_active_page when you only need link discovery.

**Parameters:** `limit` (integer); `href_contains` (string); `text_contains` (string); `same_origin_only` (boolean)

### `get_page_selection`

_read_

Return the user’s currently selected text on the active tab. Empty string if nothing is selected.

**Parameters:** _No parameters._

### `get_page_text`

_read_

Extract clean readable text from the active page — strips chrome / nav / ads / scripts / hidden DOM. Lighter than read_active_page (which returns full markdown + media + structured data). Best for "read me this article" style asks. Returns { url, title, byline, text, char_count }.

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

Observe an element for `duration_ms` (default 3000, max 30000) and report what changed. Set `kinds` to a subset of ['text','attributes','children','visibility'] to filter; default watches all four. Events: { ts_ms, kind, before?, after?, attribute?, added_count?, removed_count?, visible? }. Use this instead of polling read_page when waiting for async UI to settle.

**Parameters:** `ref` (string); `kinds` (array); `selector` (string); `max_events` (integer); `duration_ms` (integer)

### `query_elements`

_read_

Run document.querySelectorAll on the active tab and return up to `limit` matches as { tag, text, attrs }. `attrs` is a list of attribute names to extract. Use this to find CSS selectors that subsequent action tools can target.

**Parameters:** `limit` (integer); `selector` (string, required); `attributes` (array)

### `read_active_page`

_read_

Read the active tab and return a structured snapshot: cleaned article (markdown + html), title, byline, full image/video/link/audio lists, JSON-LD, schema types, SEO signals (headings, meta, alt-text coverage). Pass deep=true to scroll the page top→bottom first to trigger lazy-loaded images and infinite-scroll content before reading. Use this whenever you need to understand or quote the page.

**Parameters:** `deep` (boolean)

### `read_page`

_read_

Return an accessibility-style summary of the active page. Each interactive element gets a reference id (`ref:N`) you can pass to click_element / type_into_element / scroll_into_view / etc. instead of a CSS selector — refs are stable across DOM mutations within the same page lifetime. Pass interactive_only=false to include headings, paragraphs, and labels too. Refs invalidate on navigation; call this again after navigating. Returns { url, title, count, elements: [{ ref, role, name, tag, text, visible, bounds? }] }.

**Parameters:** `filter` (string) = ["interactive","all"]; `tab_id` (string); `max_chars` (integer); `max_nodes` (integer); `include_text` (boolean); `include_bounds` (boolean); `include_hidden` (boolean); `interactive_only` (boolean); `trigger_lazy_load` (boolean)

### `read_pdf`

_read_

Extract text and structure from a PDF — either one loaded in a browser tab, or one already in cld_files (pass file_id). Returns text by page with optional page range. Use file_id when you have a MediaRef in hand (e.g. from a prior download); use tab_id when the PDF is open in the browser.

**Parameters:** `tab_id` (string); `file_id` (string); `page_end` (integer); `max_chars` (integer); `page_start` (integer)

## records

### `records`

_action_

Read and write this organization's custom records — tables, their fields and their rows — publish a form that people with no account can answer, and open a portal where each client signs in and sees only their own rows, and write the wording of a proposal, a quote or a letter once and render it for any record. One tool, 24 actions.

DO A WHOLE INTENT IN ONE CALL. Each action takes everything it needs at once; calling one per field or one per row is the single thing that makes this tool slow, and it is never necessary.

A table and all its fields — ONE call: {"action": "table_propose", "name": "Field Crews", "fields": [{"name": "crew name", "type": "text"}, {"name": "region", "type": "text"}, {"name": "day rate", "type": "currency", "unit": "USD"}]}. It answers with table_id and every field's key and field_id. Never follow it with field_propose for a field you already named here.

Every row — ONE call: {"action": "record_write", "table_id": "<id>", "records": [{"crew_name": "North Crew", "region": "North", "day_rate": 1200}, {...}, {...}]} — up to 200 rows in one call, in one transaction. Each entry IS the field map; do not wrap it in `values` and do not call record_write in a loop.

Read them all back — ONE call: {"action": "record_read", "table_id": "<id>"} returns every record of that table. `record_id` instead of `table_id` reads exactly one, with its field versions.

A PROCESS, whole, in ONE call. When somebody describes how a job is done — "every new hire gets these twelve steps", an onboarding, an SOP, a closing checklist, a what-happens-when — that is checklist_propose. Write down what they SAID, in their order and their words; do not ask them to number it. Each step carries who does it, how many days it has, what it waits for and what it needs before it counts as done:
{"action": "checklist_propose", "name": "New hire onboarding", "table": "Hires", "roles": [{"role": "hr", "user_id": "<id>"}, {"role": "it", "user_id": "<id>"}], "trigger": "record_created", "steps": [{"title": "Send the contract", "role": "hr", "due_days": 0, "requires": {"kind": "note"}}, {"title": "Order the laptop", "role": "it", "due_days": 2, "after": ["Send the contract"], "requires": {"kind": "answer", "key": "serial_number"}}]}.
Every step becomes a real piece of work in somebody's inbox with a real date the moment a record arrives in that table — nobody has to remember to start it. A second sentence like "actually the laptop should be due on day five" is the same call again with checklist_id and the whole list of steps. Pass start_for with a record id to run it once now, so the person sees a real checklist rather than a promise of one.

A PUBLIC FORM, whole, in ONE call. When somebody asks for a form, an intake, a sign-up sheet, an application or a way for people to send something in, that is form_propose — never a table plus a plan to build a form later. It makes the table, the typed fields, the rule that says what counts as a complete answer, the rule that says who to tell, and the published link, and it answers with that link:
{"action": "form_propose", "title": "New patient intake", "table": "New Patients", "fields": [{"name": "full name", "type": "text", "required": true}, {"name": "date of birth", "type": "date", "required": true}, {"name": "mobile", "type": "phone", "required": true}, {"name": "reason for visit", "type": "text", "help": "In your own words"}], "notify": true}.
Anyone with the link can answer it and nobody can guess it; the answers arrive as ordinary records in that table, stamped with the form they came through. Pass table_id instead of table to put a form on a table that already exists.

A CREW OUT IN THE FIELD, IN ONE CALL. When somebody says their people are ON SITE — photographing something, weighing it, reading a meter, inspecting a property, counting stock in a warehouse — and want it logged where they stand, that is capture_propose, never form_propose. A form is answered by a stranger with a link; a capture sheet is answered by THEIR OWN crew on a phone, often with no signal, and it keeps working: each capture waits on the phone and lands when the bars come back, once, however many times it retries. Give a photograph or a voice note the type attachment — that is what opens the camera and the microphone instead of a text box — and give the agent the columns it can work out for itself:
{"action": "capture_propose", "title": "Bin round", "table": "Bins", "fields": [{"name": "bin id", "type": "text", "required": true, "ask": "Which bin is this?"}, {"name": "weight", "type": "number", "unit": "kg", "required": true, "ask": "What does it weigh?"}, {"name": "photo", "type": "attachment", "required": true, "ask": "Photograph the bin"}, {"name": "voice note", "type": "attachment", "ask": "Anything worth saying?"}, {"name": "contents", "fill": "classify what is in the bin from the photograph"}]}.
It answers with the link the crew opens on their phones. A field carrying `fill` is never asked of the person holding the phone — the agent fills it from what they captured, and that cell says on its face that a model wrote it.

A FILE SOMEBODY SENT YOU, IN ONE CALL. When somebody attaches a spreadsheet or a CSV and asks you to pull it in, load it, import it or "put this in a table", that is import_propose. Send the rows EXACTLY as the file spells them — do not convert anything, do not guess a type, do not strip a dollar sign or reformat a date. The store works every column out from the values AND from what this organization already has: money keeps its currency, dates become dates, a few repeating words become a dropdown, an address that belongs to somebody here becomes a person, and names that are all records of another table become a pointer at it. Anything it cannot place goes to the approvals inbox as a new column — never dropped:
{"action": "import_propose", "table": "Deals", "source_name": "deals.csv", "dedupe_key": "deal", "rows": [{"Deal": "Roof job", "Amount": "$1,250.00", "Closes": "11/30/2026", "Stage": "Open", "Account": "Northwind Trading"}]}.
ASK FOR TWO THINGS FIRST when the file plainly has them and you cannot tell: which column makes a row the SAME row (dedupe_key — it is what stops a corrected re-import doubling everything), and, for slashed dates, whether the day or the month comes first. Pass table_id instead of table to add to a table that already exists. The answer says how many landed, how many were already there and how many were refused WITH the reason and the row — say those numbers; never report a count you were not given.

BEING TOLD WHEN SOMETHING HAPPENS, all of it, in ONE call. When somebody asks to be told, texted, emailed or notified about something — "text me on a new lead; email me a Monday summary" — that is subscription_propose, never two subscriptions assembled by hand over two different filters that then quietly stop agreeing. It writes WHAT COUNTS down once as a saved view the person can edit later in plain English, and one subscription per thing they asked to be told, all over that one view:
{"action": "subscription_propose", "table_id": "<the leads table>", "watch": {"stage": "new"}, "view_name": "New leads", "tell": [{"cadence": "instant", "channel": "sms"}, {"cadence": "weekly", "channel": "email", "schedule": "monday 08:00"}]}.
instant means the moment a record ENTERS that view — a field edit on one already in it sends nothing. A summary names what entered, what left and what changed since the last one, and an empty summary is not sent at all. Quiet hours ({"start": "22:00", "end": "07:00", "tz": "America/Chicago"}) MOVE a message to the moment they end; they never drop it.

A WAY FOR PEOPLE TO BOOK TIME, whole, in ONE call. When somebody asks to let clients book, schedule, make an appointment, reserve a slot or pick a time, that is booking_propose — never a form with a date field, which would take two answers for one eleven o'clock. It makes the table, the questions, the hours, the slots table whose unique index refuses a double-booking, and the published link:
{"action": "booking_propose", "title": "Book a 30-minute consult", "table": "Consults", "fields": [{"name": "full name", "type": "text", "required": true}, {"name": "email", "type": "email", "required": true}], "availability": {"timezone": "America/Chicago", "slot_minutes": 30}, "notify": true}.
Do NOT add a field for the time — the page holds the slot and stamps it on the booking itself. Every part of `availability` has a default, so send only what the person actually said. Each booking is an ordinary record in that table, so you can read, move and cancel it with the other verbs afterwards.

A QUESTION ABOUT THE WHOLE TABLE, answered as a SCREEN and with the numbers, in ONE call. When somebody asks to see how things stand — a breakdown, a dashboard, what is stuck, how many by stage, a chart of the month — that is dashboard_propose: each part of the sentence becomes a block, it saves them together as a canvas they can open again, and it answers with the rows so you can say the numbers in this same turn. "Show me jobs by stage this month and what's stuck" is:
{"action": "dashboard_propose", "name": "Jobs this month", "table_id": "<id>", "blocks": [{"title": "Jobs by stage", "kind": "column", "group_by": ["stage"], "measures": [{"op": "count"}], "filter": {"created_at": {"from": "2026-09-01", "to": "2026-10-01"}}}, {"title": "Stuck jobs", "kind": "stuck", "state_key": "stage", "days": 14}]}.
`kind` is number, bar, column, line, donut, table or stuck; a filter value that is a plain value is an equality and {"from": …, "to": …} is a moment window (from included, to excluded); created_at and updated_at are always filterable and bucketable, and every other key must be a real field of that table. Pass `table` and `fields` instead of table_id to make the table with the dashboard, and `dashboard_id` to re-state one you already made — a follow-up like "break it down by owner" sends the whole block list again.

A BOARD OF THINGS BY STAGE, WITH THE RULES THAT JUDGE EVERY MOVE, in ONE call. When somebody asks for a pipeline, a board, a kanban, deals by stage, a hiring funnel, tickets by status — anything where things MOVE between named columns — that is pipeline_propose. It makes the Choice column, marks it as the table's stage column, writes each policy as a Rule the store enforces on every write, saves the board and answers with its address AND its live counts:
{"action": "pipeline_propose", "table_id": "<id>", "stage_field": {"key": "stage", "label": "Stage", "options": ["Lead", "Qualified", "Proposal", "Won", "Lost"]}, "transitions": [{"from": "Lead", "to": "Qualified"}, {"from": "Qualified", "to": "Proposal"}, {"from": "Proposal", "to": "Won"}], "requires": {"Won": ["signed_proposal"]}, "who": {"Won": "admin"}, "limits": {"Proposal": 3}, "measure": "amount"}.
THE OPTIONS ARE THE COLUMNS, IN THE ORDER YOU WRITE THEM. A SECOND SENTENCE ADDS A RULE RATHER THAN REBUILDING THE BOARD: "and nothing moves to Won without a signed proposal" is the same verb again with table_id, the same stage_field.key, and nothing but `requires` — what you do not mention is left exactly as it was. The answer carries every rule WITH the sentence it says when it refuses, so warn somebody before they try instead of after. Pass `table` and `fields` instead of table_id to make the table with the board.

A DOCUMENT FROM A RECORD, whole, in ONE call. When somebody asks to turn a row into a proposal, a quote, an invoice, a contract, a letter or a report — "turn this job into a proposal with our letterhead" — that is document_propose. You write the wording and name the columns in the same words a person uses; it resolves them to the Table's real Fields, puts the organization's own letterhead at the top, saves the wording and renders the record, and answers with a link that opens the document with print and save-as-PDF on it:
{"action": "document_propose", "title": "Job proposal", "table_id": "<id>", "record_id": "<the job's id>", "body": "Dear {{field:client_name}},\n\nFor the work at {{field:site_address}} we propose {{field:quoted_total}}, starting {{field:start_date}}."}.
NEVER WRITE THE LETTERHEAD YOURSELF — not the company name, not the logo, not the address. It is put at the top from this organization's own settings, and the answer says in `letterhead.source` where it came from; inventing one would put a company's name on a document it never agreed to. Never invent a column either: a token naming no column is REFUSED and nothing is written, the answer lists every column this table really has in `fields`, and `fix` says exactly what to send — so fix the one token and call again. `template_id` re-writes wording you already saved (send the whole body; every save is a new version), and leaving out `record_id` saves the wording without making a document yet.

A PORTAL FOR CLIENTS, whole, in ONE call. When somebody asks to let their clients, customers, tenants or students sign in and see only their own rows — their jobs, their invoices, their case — that is portal_propose, never a table plus a plan to build sharing later. It makes the list of clients, the link from every exposed table back to that list, the portal and its address, and it invites the people you name:
{"action": "portal_propose", "title": "Client portal", "client_table": "Clients", "tables": [{"table": "Jobs", "names_via": "client", "visible_fields": ["title", "stage", "scheduled_for"], "comments": true}, {"table": "Invoices", "names_via": "client"}], "invite": [{"client_record_id": "<id>", "email": "ann@acme.com"}]}.
`names_via` is the whole of it: the field on THAT table that names the client a row belongs to, which is the only reason one person sees eleven rows and not two hundred. A field of that name that does not exist yet is created as a relation to the client list, and rows that name nobody are seen by nobody until they do. `visible_fields` left out shows every field; `editable_fields` left out means they can change nothing; `comments` lets them write on a row. Pass client_table_id instead of client_table when the list of clients already exists. An invitation confers nothing on its own — a person sees their rows only after following their own sign-in link.

HAVE THE CLIENT SIGN IT. "Have them sign this before we start" is signature_request, never an attachment and never another vendor: a signature here is a Value ON the record, carrying who signed, when, from what address and browser, and the hash of the exact document version they saw. One call:
{"action": "signature_request", "record_id": "<the job>", "template_id": "<the proposal template>", "field": "client_signature", "signer_email": "dana@acme.com", "signer_name": "Dana Okonkwo"}.
`field` is a signature column on that record’s table — a text column whose format is `signature`; the store names the ones that exist if you get it wrong. It answers with a link, ONCE, because only a fingerprint of it is stored: hand that link to the person, because nothing here emails it for you and saying otherwise would be a lie. The link stops working when it expires, when they sign or decline, or the moment the record changes — nobody signs a document the record no longer supports.

The other four: table_list (what tables and homes exist), metadata_search (search structure, not rows), record_aggregate (count/sum/avg/min/max, grouped, computed inside the query), record_delete (soft delete; undo=true restores), field_propose (add ONE field to a table that already exists).

Field names: you may write a field by its key or by its display label, in any casing — both are resolved, and a name that is no field at all is refused with the real ones listed rather than written into nowhere.

WHERE THE WORK WENT — read it, never guess it. Every answer that puts something somewhere carries `where`, with the organization's name, the home's name and a ready-made sentence in `where.say`. Tell the person that sentence, with those exact names. Never say the work went to a default workspace, a sandbox, a fallback, or anywhere you were not told: you are always working inside one organization, and if a name could not be read the answer says so in the same place.

WHEN A CHANGE WAITS FOR A PERSON. An organization can ask a person before an agent changes a table that already existed — a new column, new rows, a record CHANGED, a record DELETED or put back, and on the strictest setting a whole new table. The answer then says `awaiting_approval` with `approval_id`, `approvers` and `not_done`. Say plainly that it did NOT happen, name the people who can approve it, and stop: do not retry it, do not work around it, do not call it queued unless the answer gave you an `approval_id`, and do not claim it is done. A table you made yourself in this conversation never waits. Deleting is not an exception to this — it is the change people most want to be asked about.

Every call runs under your own authority: it reads and changes exactly what you could, values you are not cleared to see come back masked and named rather than dropped, and anything that could not be done is said in the answer.

**Parameters:** `run` (boolean); `who` (object); `body` (string); `flow` (string); `home` (string); `name` (string); `rows` (array); `spec` (object); `tell` (array); `undo` (boolean); `unit` (string); `field` (string); `intro` (string); `label` (string); `limit` (integer); `match` (object); `query` (string); `roles` (array); `steps` (array); `table` (string); `title` (string); `watch` (object); `action` (string, required) = ["table_list","metadata_search","record_read","record_aggregate","record_write","record_delete","record_history","record_restore_version","field_propose","table_propose","form_propose","booking_propose","import_propose","dashboard_propose","pipeline_propose","document_propose","checklist_propose","capture_propose","enrich_propose","portal_propose","signature_request","subscription_propose","entity_read","entity_write"]; `blocks` (array); `config` (object); `enable` (boolean); `entity` (string); `fields` (array); `invite` (array); `limits` (object); `notify` (object); `tables` (array); `values` (object); `columns` (array); `mapping` (object); `measure` (string); `publish` (boolean); `records` (array); `trigger` (string); `version` (integer); `view_id` (string); `csv_text` (string); `group_by` (string); `id_keyed` (boolean); `on_entry` (object); `requires` (object); `table_id` (string); `unmapped` (string); `$variants` (any); `field_key` (string); `file_hash` (string); `questions` (array); `record_id` (string); `render_id` (string); `start_for` (string); `thank_you` (object); `view_name` (string); `date_order` (string); `dedupe_key` (string); `field_type` (string); `letterhead` (boolean); `description` (string); `sensitivity` (string); `signer_name` (string); `source_name` (string); `stage_field` (object); `template_id` (string); `transitions` (array); `availability` (object); `checklist_id` (string); `client_table` (string); `dashboard_id` (string); `expires_days` (integer); `on_duplicate` (string); `open_to_crew` (boolean); `presentation` (object); `preview_only` (boolean); `signer_email` (string); `submit_label` (string); `client_fields` (array); `context_policy` (string); `submission_cap` (integer); `client_table_id` (string); `relation_target` (string); `expected_version` (integer); `options_table_id` (string)

## tabs

### `chrome_tab_audio_inspect`

_read_

Report which open tabs are currently making noise, were recently audible (within the last 60s), or are muted. Each entry: { id, title, url, audible, muted, active, window_id, last_audible_at }. Useful for finding 'the noisy tab' and for media-aware automation.

**Parameters:** _No parameters._

### `resize_window`

_action_

Resize the browser window containing a tab. Useful for responsive testing. If tab_id is omitted, resizes the active tab's window. Note: this changes the OS window size, which in turn changes the viewport.

**Parameters:** `width` (integer, required); `height` (integer, required); `tab_id` (integer)

### `tab_groups`

_action_

Manage tab groups. Actions: 'list' (returns all groups across windows), 'create' (groups `tab_ids` together; optional `title`/`color`), 'add' (puts more `tab_ids` into existing `group_id`), 'remove' (ungroups `tab_ids`), 'update' (rename/recolor/collapse `group_id`).

**Parameters:** `color` (string) = ["grey","blue","red","yellow","green","pink","purple","cyan","orange"]; `title` (string); `action` (string, required) = ["list","create","add","remove","update"]; `tab_ids` (array); `group_id` (integer); `collapsed` (boolean)

### `tabs`

_action_

Manage browser tabs. Actions: 'list' (all tabs in current window), 'create' (opens new tab; pass url to open at a URL), 'close', 'switch' (brings tab to foreground), 'reload', 'active' (returns the currently active tab — call when you don't know your tab_id), 'info' (full info for a specific tab_id), 'pin' (toggle pin via `on`), 'mute' (toggle mute via `on`), 'duplicate', 'move' (to `index` and optionally `window_id`), 'zoom' (set `zoom_factor`, e.g. 1.5 for 150%). tab_id required for close/switch/reload/info/pin/mute/duplicate/move/zoom.

**Parameters:** `on` (boolean); `url` (string); `index` (integer); `action` (string, required) = ["list","create","close","switch","reload","active","info","pin","mute","duplicate","move","zoom"]; `tab_id` (string); `window_id` (integer); `zoom_factor` (number)

## webmcp

### `chrome_webmcp`

_action · admin-only_

Discover and invoke tools that pages have registered via `navigator.modelContext.registerTool` (Chrome 146+). Actions: 'check' (probe API + count tools), 'list' (enumerate page-registered tools), 'call' (invoke; pass `tool_name` and `arguments`). Admin-only experimental capability.

**Parameters:** `action` (string, required) = ["check","list","call"]; `arguments` (any); `tool_name` (string)

