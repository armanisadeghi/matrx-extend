# matrx-extend tools

> **AUTO-GENERATED — do not edit.** Produced from `tool.definition`
> rows bound to `executor_name='chrome-extension'` via `tool.binding`,
> the source of truth. Tool names, descriptions, and argument
> contracts live ONLY in the database (Rule 4,
> [docs/TOOL_SOURCE_OF_TRUTH.md](./TOOL_SOURCE_OF_TRUTH.md)).
> Regenerate with `pnpm docs:tools` (also runs on every `release.sh`).

Generated: 2026-08-13T02:08:56.096Z
Total tools: 80

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

**Parameters:** `ref` (string); `rect` (object, required); `format` (string) = ["png","jpeg"]; `padding` (integer); `profile` (string) = ["auto","auto-final","anthropic-default","anthropic-hires","openai-original","openai-high","openai-low","gemini-screenshot","gemini-overview","gemini-2.5-default","ocr-heavy","lossless"]; `quality` (integer); `selector` (string)

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

### `browser_batch`

_read_

Execute up to 20 read-tier tool calls in one round trip. Pass `calls: [{ name, arguments }]`. Returns `results: [{ name, ok, output | error }]` in order. Action / ask-user / privileged tools are NOT permitted inside a batch — call them individually so the user can approve. Use this for predictable multi-step reads (read_page + take_screenshot + list_open_tabs) where each call is independent.

**Parameters:** `calls` (array, required); `stop_on_error` (boolean)

### `list_browser_tools`

_read_

Index of every browser-tool category the extension exposes. Returns one entry per category: name, label, description, count of tools, name of the category-specific list tool. To get the full schemas for a category, call its `list_tool` (e.g. `list_page_tools`). Use this whenever the model needs more capabilities than its current toolset offers.

**Parameters:** _No parameters._

## credentials

### `credential_login`

_action_

Sign in to the website in the current browser tab using a saved Matrx login. You never see or handle the username or password: the extension asks the server for them, fills the form, submits it, and reports only the outcome. Pass credential_item_id only when a previous call returned selection_required; otherwise omit it and the correct login is matched from the tab's own address. You cannot supply a URL, username, password, or selector. Returns one of: authenticated, needs_mfa, captcha_or_takeover, credentials_rejected, selection_required, no_matching_login, unsafe_destination, unknown. If MFA or a CAPTCHA appears, stop and hand control to the user — never try to work around it.

**Parameters:** `credential_item_id` (string)

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

### `scratchpad`

_read_

Session-scoped, in-process scratchpad for stashing structured notes across turns without burning context tokens. Distinct from the canonical `memory` tool which is the persistent long-term memory system. Use scratchpad for ephemeral state inside a single run; use `memory` for things the agent should remember about the user across sessions. Actions: 'set' (write a value to a key), 'get' (read by key), 'list' (all keys), 'delete' (remove a key). Values are stringified — stringify objects before passing. Caps: 8 KB per value, 100 keys per session. Cleared at session end.

**Parameters:** `key` (string); `value` (string); `action` (string, required) = ["set","get","list","delete"]

### `storage`

_privileged_

Persistent agent-namespaced storage that survives across runs. Distinct from canonical `memory` which is session-scoped (cleared on SW restart). Actions: 'get' (returns value at key), 'set' (writes any JSON-serializable value), 'list' (returns all keys). Use for user preferences, scratchpads, progress markers between conversations.

**Parameters:** `key` (string); `value` (any); `action` (string, required) = ["get","set","list","delete"]

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

