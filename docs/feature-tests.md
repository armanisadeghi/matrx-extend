# Feature Tests

> Single source of truth for "how do I verify that X works?"
> Every shipped feature gets a short, specific test recipe here.
>
> **Maintainers:** when you add or change a feature, append / update its
> entry in this file before committing. Keep entries SHORT — exact steps
> a human can follow without reading source code.

## How to use this doc

- **Find a tool / feature:** Cmd-F by name. Each entry has its tool name
  or feature name as the heading.
- **After a build:** if you've changed user-visible behavior, update
  the matching entry. If you added a new tool, copy the template at
  the bottom of this file and fill it in.
- **When tests don't apply (e.g. internal-only utility):** still add an
  entry with a one-liner explaining why no manual test is meaningful
  and pointing to the unit test that covers it.
- **For agent tools:** the canonical UI for manual testing is
  **Side panel → Tools tab** — search the tool name, edit JSON args,
  click Run. The Tools tab routes through the same dispatcher path
  agents use, so it's a real end-to-end test.

## Convention

Every entry follows this shape:

```
### tool_or_feature_name
- **What it does:** one sentence
- **Where to test:** Tools tab / SEO tab / chat / etc.
- **Steps:**
  1. ...
  2. ...
- **Expected:** ...
- **Edge cases worth poking:** ...
```

---

## Agent tools

### get_clipboard
- **What it does:** Reads the system clipboard. Inverse of `set_clipboard`.
- **Where to test:** Side panel → **Tools** tab → search `get_clipboard`.
- **Prereq:** Settings → **Advanced agent capabilities** → toggle on
  **Clipboard read**. Chrome will prompt; accept.
- **Steps:**
  1. On any web page, copy a snippet of text (Cmd+C / Ctrl+C).
  2. Tools tab → `get_clipboard` → click **Run** with `{}`.
- **Expected:** `{ ok: true, text: "<your copied text>", byte_length, truncated: false }`.
- **Edge cases worth poking:**
  - If it fails with "page may need focus", click on the active page
    and re-run. The handler returns a clear hint.
  - Very long clipboard contents → `truncated: true`, default cap
    100 000 chars. Override with `max_chars` arg.
  - Empty clipboard → returns empty `text: ""`.

### tab_audio_inspect
- **What it does:** Lists tabs by audio state — currently audible,
  recently audible (within 60 s), and muted.
- **Where to test:** Tools tab → `tab_audio_inspect`.
- **Steps:**
  1. Open YouTube (or any site with audio) and start a video.
  2. Right-click another tab → Mute Tab.
  3. Tools tab → `tab_audio_inspect` → **Run** with `{}`.
- **Expected:**
  - `audible_now` lists the YouTube tab.
  - `muted` lists your muted tab.
  - `total_tabs_inspected` matches your open-tab count.
- **Edge cases worth poking:**
  - Pause the video, wait 5 s, run again → YouTube tab moves from
    `audible_now` to `recently_audible`.
  - With no audio playing anywhere → all three lists empty, count
    still populated.
- **Note:** `last_audible_at` only fills in once the SW has *seen*
  that tab become audible while running. Tabs that started audible
  before SW started will show `last_audible_at: null` until they
  toggle.

### mutation_watch
- **What it does:** Observes an element for `duration_ms` (max 30 s);
  reports text / attribute / children / visibility changes.
- **Where to test:** Tools tab → `mutation_watch`.
- **Steps:**
  1. Open a page with async UI — Twitter / Reddit / a site with a
     "Show more" button.
  2. (Optional) Run `read_page` first to get a `ref:N` for the area
     you want to watch.
  3. Run `mutation_watch` with:
     `{ "selector": "main", "duration_ms": 5000, "kinds": ["children", "text"] }`.
  4. While the 5 s window runs, interact with the page so it loads
     more content / mutates.
- **Expected:** `events` array with timestamped `{kind, before, after}`
  entries; `total_events` populated; `truncated` true only if you hit
  the cap.
- **Edge cases worth poking:**
  - Visibility: `{ "selector": ".some-button", "duration_ms": 3000,
    "kinds": ["visibility"] }`, then scroll the element off-screen →
    a `{kind: "visibility", visible: false}` event.
  - Bad selector → `{ ok: false, reason: "element not found" }`.
  - Element removed mid-watch → MutationObserver continues on the
    detached node; visibility events stop firing.

### extract_table
- **What it does:** Returns a structured representation of any HTML
  `<table>` or ARIA `role="table"`/`role="grid"` with full
  rowspan/colspan and multi-row-header handling.
- **Where to test:** Tools tab → `extract_table`.
- **Steps:**
  1. Open a page with a real table — Wikipedia article, a financial
     report, or e.g. https://en.wikipedia.org/wiki/List_of_countries_by_GDP_(nominal).
  2. Run `extract_table` with `{}` → picks the largest visible table.
  3. Optionally run `read_page` first to get a `ref:N` for a specific
     table; pass `{ "ref": "ref:N" }`.
- **Expected:**
  - `table_kind: "table"` or `"aria-grid"`
  - `columns: [{ index, path: ["Q1", "Revenue"] }, ...]` — multi-row
    header levels collapse into the path
  - `rows: [{ index, cells: [{ value, is_header, colspan?, rowspan? }] }]`
  - `merged_cells` lists every cell with rowspan/colspan > 1
  - `truncated: true` if the body exceeded `max_rows` (default 500)
- **Edge cases worth poking:**
  - Multi-row headers (e.g. "Q1 → Revenue / Cost") collapse correctly.
  - ARIA `role="grid"` (e.g. some Google products) returns
    `table_kind: "aria-grid"`.
  - No table on page → `{ ok: false, reason: "No table found on the page" }`.

### screenshot_region
- **What it does:** Captures a bounded portion of the active viewport;
  same envelope as `take_screenshot` but cropped.
- **Where to test:** Tools tab → `screenshot_region`.
- **Steps:**
  1. Open a content-rich page.
  2. Optionally run `read_page` to get a `ref:N` for the component you
     want.
  3. Run with one of:
     - `{ "ref": "ref:42" }`
     - `{ "selector": "main h1" }`
     - `{ "rect": { "x": 100, "y": 100, "w": 400, "h": 300 } }`
  4. Inspect the returned `image_base64` (paste into a data-URL viewer
     to see the crop).
- **Expected:** `{ ok: true, media_type: "image/jpeg" | "image/png",
  width, height, source_rect, image_base64, byte_length, profile }`.
  `width` and `height` are in image-pixels (× DPR). `source_rect` is
  the CSS-pixel rect that was captured (with padding applied).
- **Edge cases worth poking:**
  - Off-viewport element → handler auto-scrolls it into view first,
    then captures.
  - `padding: 0` → tight crop with no margin.
  - Element with zero size or display:none → `{ ok: false, reason: "Element has zero size" }`.

### record_demo / replay_demo / list_demos / describe_demo / delete_demo
- **What they do:** Record a user demonstration of a workflow once,
  replay it on demand with parameter substitution.
- **Where to test:** Tools tab → run each handler in sequence (or
  through chat for the natural agent-coached flow).
- **Steps (record):**
  1. Tools tab → `record_demo` with `{ "action": "start" }`. Agent
     posts back `{ ok: true, recording_id, tab_id }`.
  2. Demonstrate a small workflow on the active tab — e.g. open
     Wikipedia, click into a search box, type a query, press Enter,
     click a result.
  3. Tools tab → `record_demo` with
     `{ "action": "stop", "name": "wiki search demo",
        "description": "Search Wikipedia for a term",
        "parameters": [{ "name": "query", "description": "search term" }] }`.
- **Steps (replay):**
  1. `list_demos` → confirm your demo appears.
  2. `describe_demo` with `{ "demo_id": "demo_..." }` → inspect the
     captured steps.
  3. `replay_demo` with
     `{ "demo_id": "demo_...", "params": { "query": "Service workers" }, "dry_run": true }`
     → resolves selectors without acting; check `step_results[*].ok`.
  4. `replay_demo` with `dry_run: false` → user must confirm
     (privileged tier); demo runs.
- **Expected:** Each replay step's `resolved_via` shows which selector
  strategy hit (`matrx-ref` / `id` / `data-testid` / `aria` / `text`
  / `css-path`).
- **Edge cases worth poking:**
  - Sensitive fields (password / autocomplete=cc-*) auto-parameterize;
    replay refuses to run unless `params` carries the placeholder.
  - Replay against a redesigned page → strategies fall through; the
    most resilient remaining one usually still works.
  - `dry_run: true` is the safe way to test a demo after a site
    has changed.

### extract_microdata
- **What it does:** Returns every structured-data signal on the active
  page in one call: page snapshot (title/OG/Twitter/canonical), every
  JSON-LD block, every Schema.org microdata item, and a union list of
  all detected schema types. Same code paths as the Showcase →
  JSON-LD / Microdata / Snapshot sub-tabs (the user-facing UI), so
  fixes flow both ways.
- **Where to test:** Tools tab → `extract_microdata`. Cross-check
  with **Showcase** tab → JSON-LD / Microdata / Snapshot sub-tabs on
  the same page.
- **Steps:**
  1. Open a content-rich page with structured data — a recipe site
     (https://www.allrecipes.com/recipe/...), a product page (Amazon /
     a Shopify storefront), an event listing, or any news article.
  2. Tools tab → `extract_microdata` → **Run** with `{}`.
- **Expected:**
  - `snapshot` — populated with title, url, canonical, og.*, twitter.*,
    embedded json_ld, favicon, etc.
  - `json_ld` — array of every JSON-LD block on the page (with
    `@graph` flattened).
  - `microdata` — array of top-level Schema.org items walked from
    `[itemscope][itemtype]` nodes.
  - `schema_org_types` — sorted union of every detected `@type` and
    `itemtype` short name. Quick answer to "is this a Product page?".
  - `counts` — `{ json_ld, microdata }`.
- **Edge cases worth poking:**
  - Filter JSON-LD by type:
    `{ "ld_type": "Recipe" }` returns only recipe blocks.
  - Filter microdata by itemtype:
    `{ "itemtype": "Product" }` returns ALL items of that type
    (including nested ones, e.g. Products inside an ItemList wrapper).
  - Restrict the response shape:
    `{ "kinds": ["json_ld"] }` skips the snapshot + microdata work.
  - Page with zero structured data → `snapshot` still populated
    (it always exists), `json_ld` and `microdata` are empty arrays,
    `schema_org_types: []`.
- **Cross-check parity:** open the Showcase tab on the same page —
  the JSON-LD sub-tab should report the same blocks the agent tool
  returned, and the Microdata sub-tab should match the items array.
  If they diverge, a bug landed in only one path; the test recipe is
  to fix the shared mode in `src/lib/data-pattern/modes/`.

### fetch_url_as_markdown
- **What it does:** Fetch any HTTP(S) URL and return its readable
  content as Markdown — same defuddle + readability + turndown
  pipeline the Scrape tab uses against the active page, but pointed
  at any URL without opening a tab. Runs in the offscreen document
  (SW lacks DOMParser).
- **Where to test:** Tools tab → `fetch_url_as_markdown`. Cross-check
  with the **Scrape** tab on the same URL.
- **Steps:**
  1. Tools tab → `fetch_url_as_markdown` → Run with
     `{ "url": "https://en.wikipedia.org/wiki/Service_worker" }`.
  2. Inspect `markdown` (the article body), `title`, `metadata`,
     `extractor` (defuddle / readability / fallback), `word_count`,
     `http_status: 200`, `final_url`.
  3. Cross-check: open that URL in a tab, switch to **Scrape** tab,
     capture — the markdown should match (within whitespace
     differences from defuddle's confidence threshold).
- **Expected:**
  - `ok: true`, `markdown` populated, `metadata.og` and
    `metadata.twitter` filled when the page declares them.
  - `truncated: false` for typical articles; `truncated: true`
    only when content exceeds `max_chars` (default 200_000).
- **Edge cases worth poking:**
  - Non-HTML URL (PDF, JSON):
    `{ "url": "https://example.com/file.pdf" }` →
    `{ ok: false, reason: "Non-HTML content-type: ..." }`. Use
    `read_pdf` for PDFs.
  - Cookies-aware fetch: `{ "url": "...", "use_session": true }`
    will send the user's cookies. Required for paywalled /
    logged-in pages.
  - Redirect chain: `final_url` shows where the fetch ended up.
  - 404 / 5xx: `ok: false, http_status: 404, reason: "HTTP 404 ..."`.
  - Big article: `{ "url": "...", "max_chars": 5000 }` →
    `truncated: true`.
  - Extras: `{ "url": "...", "include_extras": true }` populates
    `links`, `images`, `videos`, `seo` (otherwise omitted to keep
    payloads small).
- **Cross-check parity:** if the agent tool's `markdown` diverges
  from the Scrape tab's output for the same URL, the bug is in the
  shared `src/lib/scrape/pipeline.ts` — fix once, both surfaces
  recover.

### record_gif
- **What it does:** Record browser actions on a tab via CDP screencast
  and export an animated GIF, optionally dropping it onto a page
  element.
- **Where to test:** Tools tab → `record_gif`.
- **Prereq:** Settings → **Advanced agent capabilities** → toggle on
  **DevTools Protocol** (the `debugger` permission). Admin-only.
- **Steps:**
  1. Open a page; run `record_gif` with `{ "action": "start_recording", "tabId": "<active tab id>" }`.
     Chrome shows the "is being debugged" banner.
  2. Demonstrate something (click around, scroll, type).
  3. `{ "action": "stop_recording", "tabId": "<id>" }` →
     `{ ok: true, frame_count, duration_ms }`.
  4. `{ "action": "export", "tabId": "<id>", "download": true,
        "filename": "demo.gif" }` → GIF appears in your Downloads
     folder.
- **Expected:** A playable animated GIF with the watermark + progress
  bar overlays.
- **Edge cases worth poking:**
  - Use `{ "action": "clear", "tabId": "<id>" }` to discard buffered
    frames without exporting.
  - Drop instead of download:
    `{ "action": "export", "tabId": "<id>", "ref": "ref:N" }` →
    synthesizes a drag-drop of the GIF onto the target element.
  - Click overlays only render when the recorded `click_element` /
    `computer.left_click` calls carried explicit `coordinate` args.
    Ref-only clicks render as labels, not pulses.

---

## UI surfaces

### Side panel — Tools tab
- **What it does:** Visible catalog of every registered tool with
  search/filter, JSON argument editor, per-tool **Run** button.
  Routes through the same dispatcher path agents use → it's the
  canonical end-to-end manual test rig.
- **Where to test:** Side panel → **Tools** tab.
- **Steps:**
  1. Search for a tool by name.
  2. Edit JSON args in the editor.
  3. Click **Run**.
  4. Inspect the returned envelope inline.
- **Expected:** Same result the agent would receive when calling the
  tool through chat.

### Side panel — Settings → Advanced agent capabilities
- **What it does:** Toggle runtime grants for optional Chrome
  permissions (`debugger`, `cookies`, `pageCapture`, `clipboardRead`).
  Each toggle calls `chrome.permissions.request` on flip-on and
  `chrome.permissions.remove` on flip-off.
- **Where to test:** Side panel → Settings → Advanced agent
  capabilities.
- **Steps:**
  1. Flip on a toggle. Chrome prompts to grant.
  2. Verify by running a tool that needs the permission (e.g.
     `get_clipboard` for `clipboardRead`).
  3. Flip off → tool returns
     `{ ok: false, reason: "required optional permission(s) not granted: ..." }`.
- **Expected:** Toggle state matches what `chrome.permissions.contains`
  reports.

### Side panel — Settings → Advanced → "All sites access" (roadmap #10)
- **What it does:** Grants / revokes broad host access (`<all_urls>`) at
  runtime. Without this, tools that operate on arbitrary websites
  (`read_active_page`, `read_page`, `find`, `click_element`,
  `type_into_element`, etc.) refuse with a structured
  `host_access_required` error pointing back to Settings. Tools that
  only operate on baseline-allowed hosts (the matrx server, aimatrx.com,
  the matrx-local engine) keep working without it.
- **Where to test:** Side panel → Settings → Advanced agent
  capabilities → **Host access** group.
- **Steps:**
  1. With the toggle OFF, navigate to any third-party site (e.g.
     `https://example.com`).
  2. Tools tab → `read_active_page` → Run with `{}`.
- **Expected (toggle off):** Result includes
  `Host access not granted for https://example.com/.` and a
  remediation message pointing at Settings → Advanced.
- **Steps (continued):**
  3. Flip the toggle ON. Chrome prompts; accept.
  4. Re-run `read_active_page`.
- **Expected (toggle on):** Tool returns the page snapshot as usual.
- **Edge cases worth poking:**
  - With toggle OFF, run `read_active_page` while on
    `https://aimatrx.com` — should succeed (baseline host).
  - Flip toggle OFF after granting → content script stops auto-injecting
    on new tabs; on-demand `executeScript` calls fail per-URL until
    re-granted.
  - Grant once, then close + reopen the side panel → toggle reflects
    the granted state on reload (state comes from
    `chrome.permissions.contains`, not local storage).
  - In `chrome://extensions/?id=<ext id>` → Details → Site access, you
    should see "On all sites" appear / disappear in lock-step with the
    toggle.

---

### Voice input — Mic button in chat composer (TASK-002a/b)
- **What it does:** Click the mic icon in the chat composer to dictate; Groq Whisper transcribes in ~2s chunks and the running transcript is written into the textarea live. Click again to stop.
- **Where to test:** Side panel → Chat tab → composer (bottom).
- **Prereq:**
  - Signed in (Bearer token used to call `https://aimatrx.com/api/audio/transcribe`).
  - Chrome microphone permission granted to the side panel origin (you'll be prompted on first click).
- **Steps:**
  1. Open Chat, click the mic icon next to the send button.
  2. Approve the microphone permission prompt if it appears.
  3. Speak for 5–10 seconds. Watch the textarea — text should start appearing within ~3 seconds and continue updating.
  4. Click the mic again. The icon switches to a spinner briefly while the final chunk transcribes, then back to the mic.
  5. The transcript is in the input, ready to send.
- **Expected:**
  - Recording state: button is red-tinted with a soft pulsing glow proportional to mic volume; icon is `MicOff`.
  - Transcribing state (after stop): button shows a spinning loader.
  - Idle state: button shows the mic icon.
  - Live transcript replaces only what was previously transcribed; if you typed text into the box first then clicked mic, your typed text stays at the front.
- **Edge cases worth poking:**
  - Sign out, then click mic → alert "Voice input — Not signed in. Please sign in to use voice input."
  - Click mic, deny mic permission → alert with permission-denied message.
  - Pause for several seconds mid-recording → transcript shouldn't include "Thank you for watching" or other Whisper silence hallucinations (handled server-side).
  - Click mic, click mic immediately (no audio) → no error; final transcript is empty.

---

### Tab assignment (TASK-009)
- **What it does:** Pins every tool call to the tab the agent was started against, regardless of where the user moves focus afterwards.
- **Where to test:** Chat tab (any conversation that triggers a client-side tool — `read_page`, `take_screenshot`, `click_element`, `computer({action:'screenshot'})` are good).
- **Prereq:** at least two tabs open, one of them clearly distinguishable from the other (e.g. `wikipedia.org` vs `news.ycombinator.com`).
- **Steps:**
  1. Make tab A active, open the side panel, and ask the agent something like "summarize this page" or "click the first link". Watch the streamed work begin.
  2. Switch to tab B BEFORE the agent finishes (do it during a tool call, ideally between two tool calls).
  3. Watch what the agent does next.
- **Expected:**
  - The agent keeps reading / clicking / screenshotting tab A. Tool results returned to chat reference tab A's URL and title.
  - Switching tab does NOT redirect the agent's gaze.
  - The next message you send while tab B is active reassigns the agent — its next turn operates on tab B (this is correct: re-assignment happens on user-message-send).
- **Edge cases worth poking:**
  - Close tab A while the agent is still working. The next tool call should fall back gracefully to the focused tab and report an honest "tab closed" / wrong-page result rather than crashing.
  - Tools tab "Run" button: still operates on whatever tab is focused (no run is in flight, so no assignment exists).
  - Agenda runs: same behaviour — the assigned tab is whichever one was active when the run kicked off.

---

### record_tab_video / Tools - Recorder pane (TASK-003)
- **What it does:** Records video (and optionally audio) of the active tab via `chrome.tabCapture` + MediaRecorder, uploads to `cld_files`, and shows the result in a recording list. Same offscreen-document pipeline as mic capture (TASK-002). Available as both a user UI (Tools tab - Recorder sub-tab) and an admin-only agent tool (`record_tab_video`).
- **Where to test:** Side panel - **Tools** tab - **Recorder** sub-tab. Also Tools - Catalog - search `record_tab_video` for the agent path.
- **Prereq:** Settings - **Advanced agent capabilities** - toggle on **Tab video capture**. Chrome will prompt; accept. (The Recorder pane will request it for you on first use; toggling in Settings ahead of time avoids the prompt.)
- **Steps (UI surface):**
  1. Open any regular web page in the active tab.
  2. Side panel - Tools - Recorder.
  3. Adjust **Duration (sec)** (1-60) and toggle **Capture audio** as desired.
  4. Click **Record**. The status badge flips to Recording, the red dot pulses, and the elapsed timer ticks.
  5. Either let the duration timer auto-stop, or click **Stop** to cut it short.
  6. Status flips to Uploading - then a row appears in the Recordings list with: tab title, capture timestamp, duration, size, mime type.
  7. Click **Open** on the row to view the video in a new tab via the cld_files URL. Click **file_id** to copy the canonical id for use in agent prompts.
- **Steps (agent surface):**
  1. Tools tab - Catalog - filter to admin / advanced - find `record_tab_video`.
  2. Hit Run with `{ "durationMs": 5000, "audio": false }`.
  3. Approve the action prompt (Action tier in Ask mode).
  4. Result includes `{ ok: true, file_id, file_url, mime_type, duration_ms, size_bytes }`.
- **Expected:**
  - Recordings appear most-recent first; the list survives sidepanel reload via `chrome.storage.local`.
  - Without the `tabCapture` permission granted, both surfaces fail cleanly: agent tool returns `{ ok:false, reason: "required optional permission(s) not granted: tabCapture..." }`; UI surface shows an error banner with a "Dismiss" button.
- **Edge cases worth poking:**
  - Restricted URLs (`chrome://`, PDF viewer): `getMediaStreamId` rejects - the recorder shows the error banner.
  - Trigger Stop early - the upload still produces a valid (shorter) WebM.
  - Recordings persist a maximum of 50 entries; older ones drop off.
  - Audio toggle on - the encoded WebM contains both tracks (mime type: `video/webm;codecs=vp9,opus` or fallback).
  - The tool is `admin_only` - non-admin users don't see it advertised in chat (still visible in Tools tab when admin).

### Screenshots tab (TASK-005)
- **What it does:** Per-page screenshot history. Lists every screenshot ever taken of the active page (canonical URL match), regardless of whether the agent or the user triggered it. The "Take screenshot" button at the bottom calls the same `take_screenshot` handler the agent uses, so user and agent captures share one persistence path (cld_files + `wbx_screenshot` index row).
- **Where to test:** Side panel - **Screenshots** tab (camera icon).
- **Prereq:** apply `migrations/2026_05_08_wbx_screenshot.sql` against the Matrx Supabase project.
- **Steps:**
  1. Navigate to a regular web page.
  2. Open Screenshots tab - click **Take screenshot**.
  3. After it completes, the gallery refreshes with a new card. Click the thumbnail or the open icon to view full size in a new tab; click the link icon to copy the URL; click the trash icon (then Delete) to remove the index row (file in cloud storage is kept).
  4. Take another screenshot - most-recent first ordering.
  5. Switch to Chat - ask the agent "take a screenshot of this page" - it lands in the same gallery on next refresh, live via the timeline event.
- **Expected:**
  - Each card shows: thumbnail (lazy-loaded from `file_url`), source label ("You" / "Agent"), relative timestamp, dimensions.
  - Refreshes automatically when `take_screenshot` completes anywhere in the side panel.
  - Empty state on a fresh page; skeleton on first load.
- **Edge cases worth poking:**
  - Restricted URLs (`chrome://`, PDF viewer): button should error inline.
  - Same page hit via slightly different URL (http vs https, trailing slash, `www.`) - `normalizeUrl()` collapses them, so screenshots from any variant show on the canonical view.
  - Network down: handler returns inline image with `file_id: null`; no row added - the gallery still shows previously-saved entries unchanged.

---

### Sidepanel default-to-new-chat (TASK-010)
- **What it does:** Opening the side panel always starts on a fresh chat, even if a previous conversation was active when it was last closed.
- **Where to test:** Chat tab.
- **Steps:**
  1. Open the side panel, send a message in any agent. Wait for the assistant to reply.
  2. Close the side panel (or close+reopen the browser).
  3. Open the side panel again.
- **Expected:**
  - Chat is empty. Agent picker still shows whatever you last picked. Draft is preserved (intentional — half-typed text shouldn't vanish).
  - Past conversation still exists — open the chat-header history picker and you can re-select it explicitly.
- **Edge cases worth poking:**
  - Switch to another tab in the side panel (Tools, Settings, etc.) and back to Chat → the in-memory chat session for THIS open session persists. Only a fresh sidepanel open resets it.
  - Send-and-close mid-stream → on next open, the in-flight reply doesn't reappear; you get an empty chat.

---

## Template (copy when adding a new entry)

```markdown
### NAME
- **What it does:** one sentence.
- **Where to test:** Tools tab / SEO tab / etc.
- **Prereq:** any toggles or setup. Omit if none.
- **Steps:**
  1. ...
  2. ...
- **Expected:** ...
- **Edge cases worth poking:**
  - ...
```
