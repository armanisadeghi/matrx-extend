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
  width, height, source_rect, image_base64, byte_length, profile,
  file_id, file_url }`. The crop is uploaded to cloud storage (so
  `file_url` is a durable link and it appears in the Screenshots gallery);
  `image_base64` is still returned for the vision model. `width` and
  `height` are in image-pixels (× DPR). `source_rect` is the CSS-pixel
  rect that was captured (with padding applied).
- **Edge cases worth poking:**
  - Off-viewport element → handler auto-scrolls it into view first,
    then captures.
  - `padding: 0` → tight crop with no margin.
  - Element with zero size or display:none → `{ ok: false, reason: "Element has zero size" }`.

### Screenshot results render inline in the chat timeline (via durable URL)
- **What it does:** When the agent captures the screen, the image renders
  inline in the chat tool-timeline row (no click-to-expand needed), and it
  renders from the **hosted `file_url`** — so it survives a reload, not just
  the live view. EVERY screenshot path now uploads to cloud storage and
  returns `file_url`: `computer({action:"screenshot"})`, `take_screenshot`,
  `screenshot_region`, and `cdp_full_page_screenshot`. (`image_base64` is also
  returned for the vision model, but the UI renders the URL, never the base64.)
  Regression context: the 2026-05-19 namespace redesign moved the agent off
  `take_screenshot` onto `computer`, but the image renderer was still keyed on
  `take_screenshot`, so screenshots stopped showing — only a `file_id` blob.
- **Where to test:** Chat tab (ask the agent to "take a screenshot of this
  page"); also Tools tab → `computer` with `{ "action": "screenshot" }`,
  `screenshot_region`, `cdp_full_page_screenshot`.
- **Steps:**
  1. Open any page, ask the agent in Chat to take a screenshot.
  2. Watch the tool-timeline row when the call completes — image renders.
  3. Reload the side panel / reopen the conversation from history — the image
     is still there (rehydrated from the stored `file_url`).
- **Expected:** The captured image renders inline under the row from
  `file_url`, with a `W×H · size` caption. The capture also lands in the
  Screenshots tab gallery. Non-screenshot `computer` actions (click/type/
  scroll) render NO image block — just the normal header.
- **Edge cases worth poking:**
  - Region/full-page captures (`screenshot_region`, `cdp_full_page_screenshot`)
    now also appear in the Screenshots gallery.
  - If the cloud upload fails, `file_url` is null; the row shows the header but
    no image (a local-only image is intentionally NOT rendered).
  - `chrome_bookmarks` / `chrome_history` / `chrome_cookies` / `chrome_webmcp`
    rows show their custom icon+verb header (not the bare default row) — the
    renames are aliased.
  - Guard test: `pnpm vitest run tests/unit/tool-display-registry.test.ts`
    enforces 1:1 coverage (every canonical tool has a display config) and
    fails if a renamed tool's config isn't re-keyed or aliased.

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
- **MDX/Mintlify docs (regression):** docs sites that render
  paragraphs as `<span data-as="p">` (not real `<p>`) and code as
  Shiki-highlighted line spans used to (a) collapse every paragraph
  into one space-joined blob and (b) drop code blocks entirely.
  `normalizeSemanticMarkup` (in `pipeline.ts`, runs on a clone before
  extraction) renames `[data-as]` block tags to real tags and rebuilds
  each highlighted code block as a clean `<pre><code>`, **replacing the
  whole `.code-block` chrome wrapper** (copy/feedback buttons) rather
  than just the inner `<pre>` — otherwise Defuddle scores the
  button-laden wrapper as non-content and prunes the code with it.
  - **Test:** `fetch_url_as_markdown` on a Cartesia docs page, e.g.
    `https://docs.cartesia.ai/use-the-api/tts-websocket/buffering`.
  - **Expected:** paragraphs are blank-line separated (not run
    together); fenced code blocks (```` ```json ````) appear with
    their source intact. Unit coverage:
    `tests/unit/normalize-markup.test.ts`.

### record_gif
- **What it does:** Record browser actions on a tab via CDP screencast
  and export an animated GIF, optionally dropping it onto a page
  element.
- **Where to test:** Tools tab → `record_gif`.
- **Prereq:** Settings → **Advanced agent capabilities** → toggle on
  **DevTools Protocol** (the `debugger` permission).
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

### storage `delete` + request_user_takeover `timeout_seconds` (GAP 4)
- **What it does:** `storage` supports a `delete` action (remove an
  agent-namespaced KV key); `request_user_takeover` accepts an optional
  `timeout_seconds` (1–900) bounding how long the agent waits for the user.
  Both fields are part of the unified `tl_def` contract shared with matrx-frontend.
- **Where to test:** Tools tab → Run `storage` / `request_user_takeover`, or via chat.
- **Steps:**
  1. Run `storage` `{"action":"set","key":"t","value":1}` → `{ok:true}`.
  2. Run `storage` `{"action":"delete","key":"t"}` → `{ok:true,deleted:true}`.
  3. Run `storage` `{"action":"get","key":"t"}` → `{exists:false}`.
  4. Run `request_user_takeover` `{"reason":"x","timeout_seconds":5}` → the takeover
     card auto-resolves `timed_out:true` after ~5s if unanswered.
- **Expected:** delete removes only the namespaced key; `timeout_seconds` shortens
  the default 15-min wait. `pnpm catalog:tools:drift` stays green.
- **Edge cases:** `delete` without `key` → `{ok:false}`; omitting `timeout_seconds`
  keeps the 15-min default.

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
- **Edge cases:** Each tool's **description** is read LIVE from the DB
  (`GET /ai-tools/app/matrx-extend`), not hardcoded. With the network
  available, every canonical tool shows its `tl_def` description; offline (or
  before the fetch resolves) it shows `—`, never a stale string.

### Tool descriptions read live from the DB (Rule 4)
- **What it does:** No tool descriptions live in the extension's code — they
  live only in `public.tl_def` and are read live via
  `src/lib/tools/descriptions.ts` (`GET /ai-tools/app/matrx-extend`). Consumers:
  Tools-tab catalog, the permission-approval card, the client discovery tools
  (`list_<category>_tools`), WebMCP registration, and the frontend bridge.
- **Where to test:** Side panel → Tools tab; and any action-tier tool in chat
  while in "Ask" mode (to see the approval card).
- **Steps:**
  1. Tools tab: confirm each canonical tool shows a description (from the DB).
  2. In chat (Ask mode), trigger an action tool (e.g. `navigate`) → the
     approval card shows the tool name, the DB description, and the args.
  3. Code audit: `grep -rn "description:" src/lib/tools/handlers/` returns only
     non-tool keys (Zod fields, ask-user option labels) — zero `ToolHandler`
     descriptions.
- **Expected:** Descriptions match `tl_def` exactly (regenerate
  `docs/TOOLS.generated.md` with `pnpm docs:tools` to compare). `pnpm
  catalog:tools:drift` is green.
- **Edge cases:** Offline → approval card omits the description (shows name +
  args only); Tools tab shows `—`. Never a hardcoded fallback string.

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

### Side panel — Debug tab → event-type (stream) filtering
- **What it does:** The Debug tab tails every cross-context log event live.
  Stream events are now tagged with their wire event type (`phase`, `data`,
  `record_reserved`, `tool_event`, `warning`, `completion`, …) so the third
  filter row ("events") lets you toggle individual stream event types in/out
  with colored pills — instead of only toggling the whole `stream` source.
  Each matching row also shows a colored tag badge. Admin-only.
- **Where to test:** Side panel → **Debug** tab (Log subview).
- **Steps:**
  1. Send a chat message and let the stream run so events flow in.
  2. Confirm the third filter row ("events") populates with colored pills,
     one per distinct event type seen.
  3. Click a pill (e.g. `record_reserved`) to hide that type → those rows
     disappear; click again to show. Use **all** / **none** to bulk toggle.
  4. Confirm `pilot-stream` (and `audio`, `pilot`, `frontend-bridge`,
     `desktop-ws-offscreen`) rows now appear in the source filter and feed —
     previously they were silently dropped.
  5. Copy/Download the log → each tagged line includes `<event_type>`.
- **Expected:** Hidden event types are excluded from the feed; untagged
  events (auth/api/sys/etc.) are unaffected by the events row. Newly-seen
  event types appear automatically as visible pills (opt-out semantics).
- **Edge cases:** Pause freezes the feed but the pill set keeps reflecting
  the frozen list; clearing the log empties the events row until new events
  arrive.

---

### Scrape — Diagnose with AI (element picker)
- **What it does:** After a Scrape capture, lets you click an on-page
  element that's missing from (or junk in) the scrape, then copies a
  pre-formatted bundle of selector chain, byte-budgeted HTML, page
  context, and a markdown excerpt — pasteable into an LLM chat to debug
  why the scraper handled it that way.
- **Where to test:** Side panel → **Scrape** tab.
- **Steps:**
  1. Open a page; click **Capture** (or **Scroll & capture**) so a
     scrape result is showing.
  2. In the header below the title, find the **Diagnose** row.
  3. Choose **Missing** or **Unwanted** (color-coded), then click
     **Pick on page**.
  4. Hover the live page — a colored highlight follows the cursor.
     Click the target element. (Press **Esc** to cancel.)
  5. A DiagnoseCard appears in the side panel: selector chain,
     `<tag>` + text preview, sibling count if it's a repeating item.
  6. Type a one-line note describing the issue, then click
     **Copy for AI** → **For AI agent**.
- **Expected:** Clipboard contains a `wrapForAgent`-formatted bundle
  with: mode, user note, URL/title, selector chain (up to 6 levels),
  leaf HTML (≤ 3 KB), optional parent HTML, optional sibling HTML
  (when repeating siblings detected), and — for *Missing* mode — a
  markdown excerpt around the matched anchor OR an explicit "text
  does not appear in scraped markdown" note when nothing matches.
- **Edge cases worth poking:**
  - Pick a huge `<div>` (or `<body>`): leaf HTML truncates with a
    visible marker; parent/sibling sections are omitted.
  - Pick on a page with no current capture: `Diagnose` row is hidden.
    Capture first.
  - Pick the same element twice: card overwrites without prompting.
  - Repeating list page (PyPI projects): the bundle includes one
    sibling example and reports `siblingCount`.
  - **Restricted URLs** (chrome://, web store): the picker injection
    will fail silently; recovery is to navigate to a real page.

### Scrape — `protectMicroData` pre-pass (PyPI date recovery)
- **What it does:** Before Readability runs, strips Readability's
  negative-weight class tokens (`meta`, `comment`, `footer`, `byline`,
  etc.) from ancestors of `<time>`, `<data>`, `<meter>`, `<address>`,
  and appends each element's `aria-label`/`title`/`datetime` text to
  its inner content so the parent crosses Readability's "suspiciously
  short" threshold. Runs on a cloned doc only.
- **Where to test:** Side panel → **Scrape** tab.
- **Steps:**
  1. Open a PyPI projects-management page (e.g.
     <https://pypi.org/manage/projects/>) while signed in.
  2. Click **Capture**.
  3. Switch to the Article tab.
- **Expected:** Each `<time>` value (e.g. `Mar 25, 2026`) survives
  into the markdown, with the precise timestamp from `title="…"`
  appended in parentheses. Same survives on dev.to article footers,
  GitHub commit lists, and similar sites that wrap dates in
  `<time>` inside negatively-classed parents.
- **Edge cases worth poking:**
  - Long-form article (Substack, NYT): article body should be
    unchanged vs. previous behavior — pre-pass is a no-op when no
    `<time>` is inside a penalized ancestor.
  - Page with no `<time>` elements: pre-pass is a no-op (early
    exit on empty `querySelectorAll`).
  - Pages where `aria-label` is identical to inner text: no
    parenthetical is appended (we skip if equal).

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
- **What it does:** Records video (and optionally audio) of the active tab via `chrome.tabCapture` + MediaRecorder, uploads to `cld_files`, and shows the result in a recording list. Same offscreen-document pipeline as mic capture (TASK-002). Available as both a user UI (Tools tab - Recorder sub-tab) and an agent tool (`chrome_record_tab_video`), gated by the `tabCapture` optional permission.
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
  1. Tools tab - Catalog - find `chrome_record_tab_video`.
  2. Hit Run with `{ "duration_ms": 5000, "audio": false }` (optional: `"source": "tab" | "display"`, `"tab_id"`). It's a single blocking call — it returns once the recording finishes (~5s here).
  3. Approve the action prompt (Action tier in Ask mode).
  4. Result includes `{ ok: true, file_id, file_url, mime_type, duration_ms, size_bytes }`. The capture also appears in the Tools-tab Recorder list (after a hydrate / reload).
- **Expected:**
  - Recordings appear most-recent first; the list survives sidepanel reload via `chrome.storage.local`.
  - Without the `tabCapture` permission granted, both surfaces fail cleanly: the agent tool is gated by the dispatcher and returns `{ ok:false, error: "permission_not_yet_granted: this tool needs the optional Chrome permission(s) [tabCapture]..." }` (guiding the agent to ask the user to enable it via Settings → Advanced agent capabilities); UI surface shows an error banner with a "Dismiss" button.
- **Edge cases worth poking:**
  - Restricted URLs (`chrome://`, PDF viewer): `getMediaStreamId` rejects - the recorder shows the error banner.
  - Trigger Stop early - the upload still produces a valid (shorter) WebM.
  - Recordings persist a maximum of 50 entries; older ones drop off.
  - Audio toggle on - the encoded WebM contains both tracks (mime type: `video/webm;codecs=vp9,opus` or fallback).
  - The tool is gated by the `tabCapture` optional permission (not admin-only) - any user who grants the permission can use it.

### Screenshots tab (TASK-005)
- **What it does:** Per-page screenshot history. Lists every screenshot ever taken of the active page (canonical URL match), regardless of whether the agent or the user triggered it. The two buttons at the bottom — **Visible** and **Full page** — both call the same `take_screenshot` handler the agent uses (with `mode: 'visible' | 'full_page'`), so user and agent captures share one persistence path (cld_files + `wbx_screenshot` index row).
- **Where to test:** Side panel - **Screenshots** tab (camera icon).
- **Prereq:** apply `migrations/2026_05_08_wbx_screenshot.sql` against the Matrx Supabase project.
- **Steps:**
  1. Navigate to a regular web page.
  2. Open Screenshots tab - click **Visible**. The current viewport is captured and a card appears in the gallery.
  3. Click **Full page** on a page taller than one screen. The page scrolls top → bottom (visible to the user; this is expected); after ~1 sec/screen a card appears whose thumbnail is the entire page stitched.
  4. Click a thumbnail (or the open icon) to view full size in a new tab; click the link icon to copy the URL; click the trash icon (then Delete) to remove the index row (file in cloud storage is kept).
  5. Switch to Chat - ask the agent "take a screenshot of this page" - it lands in the same gallery on next refresh, live via the timeline event. Ask "take a full-page screenshot" and it uses `mode: 'full_page'`.
- **Expected:**
  - Each card shows: thumbnail (lazy-loaded from `file_url`), source label ("You" / "Agent"), relative timestamp, dimensions. Full-page captures are visibly tall.
  - Refreshes automatically when `take_screenshot` completes anywhere in the side panel.
  - Empty state on a fresh page; skeleton on first load.
  - If the cld_files upload or `wbx_screenshot` insert fails, an amber warning under the buttons reads "Captured, but failed to save to the gallery."
- **Edge cases worth poking:**
  - Restricted URLs (`chrome://`, PDF viewer): both buttons should error inline.
  - Same page hit via slightly different URL (http vs https, trailing slash, `www.`) - `normalizeUrl()` collapses them, so screenshots from any variant show on the canonical view.
  - Pages taller than 30 viewports: full-page capture stops at the cap and shows "Page exceeded the 30-screen tile cap; the bottom is cropped."
  - position:fixed / position:sticky elements (toolbars, cookie banners) repeat on every tile in full-page mode - known limitation; use `cdp_full_page_screenshot` (debugger perm) for a clean single-shot.
  - Mid-capture navigation: if the user navigates while full-page is running, captures may end up on the new page. The handler restores the original scroll position even on error.
  - Network down: handler returns inline image with `file_id: null`; no row added - the gallery still shows previously-saved entries unchanged, and the warning surfaces.

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

### Plan & tasks chip placement in the chat header
- **What it does:** When a conversation has a plan, agent tasks, or open
  user-todos, a small chip (📋 done/total, 📌 open-todos) appears in the
  chat header's right-hand control cluster — laid out in flow next to the
  Language / Permission / Copy / New-chat / History controls. Clicking it
  opens the Plan & tasks drawer.
- **Where to test:** Chat tab.
- **Steps:**
  1. Start a conversation where the agent proposes a plan or adds tasks
     (or add a task manually via the drawer).
  2. Look at the top-right of the chat header.
- **Expected:** The chip sits to the LEFT of the other header controls with
  normal spacing — it does NOT overlap or sit on top of the History icon.
  When there's no plan/tasks/todos, the chip is absent and takes no space.
- **Edge cases worth poking:**
  - Plan exists but zero tasks/todos → chip still shows (opens the drawer to
    the plan); it must not cover the History/New-chat icons.
  - Regression being guarded: the chip used to be `absolute right-2 top-1`,
    floating over the header and overlapping the History icon.

### Showcase — Tables tab (auto_table mode)
- **What it does:** Detects every `<table>` on the page (≥2 rows) and
  extracts the chosen one as JSON rows. Auto-handles multi-tier headers
  inside `<thead>` by expanding `colspan` / `rowspan` into a column-aligned
  grid and merging tier text with " - " (consecutive duplicates collapsed).
- **Where to test:** Side panel → Showcase → Tables.
- **Steps:**
  1. Open a page with a simple single-header table (e.g. any Wikipedia
     "List of …" article). Click Extract → headers are the single row;
     each `<tr>` becomes one row object. No regression vs. legacy behavior.
  2. Open a page with a two-tier header table (e.g.
     https://developers.openai.com/api/docs/pricing — top tier
     "Short context" / "Long context" each `colspan=3`, second tier
     "Model / Input / Cached input / Output" repeated). Click Extract →
     keys should be `Model`, `Short context - Input`,
     `Short context - Cached input`, `Short context - Output`,
     `Long context - Input`, etc. Every model name lands in the `Model`
     column; no `col_N` fallback keys.
  3. Detection summary on a multi-tier table reads `…r×Nc, 2-tier hdr`.
- **Expected:**
  - 7-column OpenAI pricing table extracts 6 rows, each with all 7 keys
    populated and the values aligned to the bottom-tier subcolumn.
  - Single-tier tables behave exactly as before — headers are the first
    `<thead> <tr>` (or the first `<tr>` if no `<thead>`); body is `<tbody>`
    or all `<tr>` minus the header rows.
- **Edge cases worth poking:**
  - `rowspan=2` on a corner cell (e.g. "Model" spanning both header tiers)
    → produces `Model` (not `Model - Model`); the consecutive-duplicate
    collapse handles this.
  - Table with header rows inside `<tbody>` (no `<thead>`) → set
    `header_rows: 2` in the saved-pattern config to override auto-detect.
  - Empty top-tier cell → drops out of the merge, so the bottom-tier
    name stands alone.
  - Tables where data rows have `colspan` / `rowspan` are NOT yet
    expanded — values still zip positionally. Open a follow-up if a
    real page hits this.

### parallel_for_each_tab
- **What it does:** Fan out the same prompt across N existing tabs (max 8) and collect the results. Each sub-run is its own agent conversation pinned to one tab. Admin-only.
- **Where to test:** Side panel → **Chat** tab; **Tasks** tab shows the live status panel.
- **Prereq:** Signed in as admin. Open at least 3 tabs you want to fan out across (e.g. three Wikipedia article URLs).
- **Steps:**
  1. Open 3 unrelated Wikipedia articles in separate tabs (find their tab ids via `list_open_tabs`).
  2. In Chat, send: `use parallel_for_each_tab to summarize each in 2 sentences with tab_ids=[<a>,<b>,<c>], merge_strategy="concat"`.
  3. Switch to the **Tasks** tab while it runs.
- **Expected:**
  - Tasks tab shows a "Parallel runs" card with 3 sub-runs.
  - Each sub-run progresses pending → running → completed; the card header shows "X running" / "Y done" badges live.
  - Click a sub-run row to expand and see the streamed text per tab.
  - Final tool result (back in Chat) is a concat-merged string with `## Tab <id>` headers and one summary per tab.
- **Edge cases worth poking:**
  - Pass an unknown tab id → tool returns `ok: false` with the list of unknown ids; no LLM calls made.
  - Pass `timeout_ms: 2000` against a slow tab → that sub-run shows `timeout` pill; the others still complete; final result has `status: "timeout"` for that tab.
  - Pass `merge_strategy: "json_array"` → result is an array of `{ tab_id, ok, data, error }` objects (best when the sub-prompt produces structured `data` events).
  - Pass `tab_ids` of length 9 → rejected at the Zod layer with "array must contain at most 8 elements".
  - Dismiss the "X" on a session card mid-stream → row clears from UI; sub-runs continue server-side until done.

---

### pilot_tab
- **What it does:** Side panel tab (admin-only) that runs an agent inside a
  sandboxed Chrome tab group. Action-tier tools are constrained to tabs in
  the group; the assistant Chat tab is unaffected.
- **Where to test:** Side panel → **Pilot** tab (Crosshair icon, emerald
  accent — appears next to Chat).
- **Prereq:** Signed in as admin.
- **Steps:**
  1. Click the Pilot tab. Empty state explains the surface.
  2. Click **Start Pilot** in the header. Chrome opens a new tab group
     (blue, titled "Pilot") seeded with the currently active tab. The
     header switches to **End** with the group id + tab count.
  3. Send a message like `take a screenshot of this tab`. The agent uses
     the pilot toolset (full read+action+ask kit) and the screenshot
     comes from a tab inside the group.
  4. Open another tab OUTSIDE the group (Cmd-T). Then ask the agent to
     `click_element ref:1 on tab id <outside-tab-id>`.
  5. Click **End**. Every tab in the group closes.
- **Expected:**
  - Step 2: a new tab group appears in the tab strip, painted blue with
    title "Pilot".
  - Step 3: tool calls succeed; assigned tab is the seed tab inside the group.
  - Step 4: dispatcher returns `pilot_group_violation: tab N is not part of
    the active Pilot session group (M)`. Agent sees the error and can
    recover.
  - Step 5: tabs gone, header reverts to "Start Pilot".
- **Edge cases worth poking:**
  - Manually close the last tab in the group while a session is active →
    `chrome.tabs.onRemoved` listener resets the session; the Pilot view
    flips back to the empty state without the user clicking End.
  - Right-click the group → Ungroup. `chrome.tabGroups.onRemoved` resets
    the session.
  - Run `parallel_for_each_tab` with a tab id from outside the group →
    rejected up front with `pilot_group_violation`, no LLM calls made.
  - Start a Pilot session, then close the side panel and reopen. The
    session is restored from `chrome.storage.local` (key
    `matrxPilotSession`); the group still exists in Chrome and is still
    bound to the agent.
  - Switch the permission chip to **Ask before acting** → action-tier
    tools render the inline approval card before each call (privileged
    tools always confirm).

### Cryptographic run receipts (CLAUDE.md #8)
- **What it does:** every tool call gets signed with a device-bound
  Ed25519 key, appended to a local audit log, and exposed via a
  Shield-icon "Show receipt" button on every timeline row.
- **Where to test:** Chat tab + Settings → Advanced → Audit key.
- **Prereq:** signed in as admin (Audit key card is admin-only).
- **Steps:**
  1. Run any tool from the agent (or the Tools tab "Run" button — same
     dispatcher path).
  2. Hover the resulting timeline row. The Shield button reveals next
     to the Copy button.
  3. Click Shield → modal opens showing the receipt JSON.
  4. Confirm the green "Signature valid" banner with the active
     `publicKeyId`.
  5. Click "Copy JWS" — clipboard now contains
     `<header>.<payload>.<sig>` compact JWS.
  6. Open Settings → Advanced agent capabilities → Audit key. Note the
     public-key ID and receipt count. Click "Export public key" — JWK
     copied. Click "Re-key" → confirm. Receipt count is preserved.
  7. Run another tool. Verify the new receipt's `publicKeyId` matches
     the new active key. Open an old receipt — it still shows
     "Signature valid" (verified against the retired key in history).
- **Expected:**
  - Receipt JSON contains `v` (now `2`), `publicKeyId`, `callId`,
    `toolName`, `argsHash`, `outputHash`, `ok`, `startedAt`,
    `completedAt`, `conversationId`, `runId`, `origin`, `signature`.
  - The audit log caps at 1000 entries (FIFO).
- **Origin coverage (schema v2, 2026-05-07):** the receipt now carries
  an `origin` tag identifying which dispatch path produced it. Verify
  every path lands a receipt with the right origin:
  1. **agent** — send any message in the Assistant Chat tab and run a
     tool. Settings → Audit key → "Recent receipts" should show a row
     with the blue `agent` chip.
  2. **pilot** — Pilot tab → Start Pilot session → ask the agent to
     "take a screenshot of this tab". The new row uses the violet
     `pilot` chip.
  3. **parallel** — Chat tab → ask the agent to call
     `parallel_for_each_tab` across two open tabs (admin only). Sub-run
     tool calls land with the amber `parallel` chip; the parent call
     itself stays `agent`.
  4. **webmcp** — open devtools console on a connected page (e.g.
     `aimatrx.com`) and run
     `await navigator.modelContext.callTool('matrx.get_active_tab', {})`.
     The new row uses the emerald `webmcp` chip and has
     `conversationId: null` (WebMCP calls aren't tied to a conversation).
  5. Use the chip-set filter at the top of "Recent receipts" to narrow
     the list to one origin; counts on each chip match the underlying
     log.
- **Edge cases worth poking:**
  - Run a tool that errors (e.g. invalid args) → receipt still
    appended with `ok: false` and `outputHash: '...'` (hash of null).
  - Crash a handler mid-run (kill the SW with Inspect Service Worker)
    → the partial receipt with `outputHash: 'pending'` and `ok: null`
    remains in the log.
  - Clear local data (Settings → Privacy → Clear local data) →
    verifying receipts copied externally before the wipe shows
    "public key '...' is not on file".
  - Old v1 receipts in an existing audit log: receipts that were
    signed before schema v2 lack the `origin` field. They should still
    open in the receipt modal with a green "Signature valid" banner;
    the Recent-receipts panel renders them as `agent`.

### Copy message / Copy conversation
- **What it does:** every assistant message bubble shows a hover-revealed
  copy menu; the chat header shows a "Copy conversation" button that
  exports the entire thread with per-section toggles.
- **Where to test:** Assistant Chat tab and Pilot tab — both surfaces.
- **Per-message copy steps:**
  1. Send a message that triggers at least one tool call (e.g. "what's
     on this page?" forces `read_page`). Wait for the assistant reply.
  2. Hover the assistant bubble — copy icon appears bottom-left.
  3. Click → popover with four options:
     - **Markdown** — plain final text only.
     - **With tool calls** — text plus self-closing
       `<tool name="..." status="completed|error" />` lines, no data.
     - **With everything** — admin-only chip; full args + result JSON
       inside `<tool>` blocks plus `<thinking>` for reasoning parts.
     - **For AI agent** — `wrapForAgent` preamble + fenced markdown.
  4. Paste into a text editor to verify each flavor's shape.
- **Conversation copy steps:**
  1. Have at least one user/assistant exchange.
  2. Click the clipboard-list icon in the chat header (disabled when
     `messages.length === 0`).
  3. Popover lists seven checkboxes (same for users and admins):
     `Include all user messages`, `Include all assistant messages`,
     `Include agent info`, `Include thinking`, `Include tool calls`,
     `Include full tool results` (gated by tool calls), `Include
     instructions for AI`.
  4. Flip toggles — the char-count chip in the bottom-left updates.
  5. Click **Copy** → check mark for ~900ms, popover closes, clipboard
     holds the rendered transcript.
- **Expected:**
  - Output wraps in `<conversation>...</conversation>` with each turn
    as `<message role="user|assistant">...</message>`.
  - Agent info renders as `<agent name="..." id="..." />`.
  - Tool calls render as `<tool name="..." status="..." />` (basic) or
    full `<tool>...<args>...</args><result>...</result></tool>` block.
  - Reasoning renders as `<thinking>...</thinking>` when enabled.
- **Edge cases worth poking:**
  - Toggle off "Include tool calls" — the "Include full tool results"
    row greys out (cursor:not-allowed) and uncheck-locks itself.
  - DB-hydrated history (open an old conversation) — messages lack
    `parts`, so tool-call and thinking toggles produce no extra blocks
    even when on. The `content` string still renders inside `<message>`.
  - Non-admin user — "With everything" option is hidden in the
    per-message menu; the conversation popover still shows every
    checkbox unchanged.
  - Pilot surface mirrors all behavior — same options, same output
    shape, uses `usePilotChatStore` instead of `useChatStore`.

### Incremental tool progress (long-running tools)
- **What it does:** A tool can emit live progress updates between `started`
  and `completed` instead of just spinning. Server tools emit a
  `tool_progress` tool_event sub-event; client (SW) handlers call
  `ctx.reportProgress('…')`. The chat row renders a progress log (default)
  that collapses to "N updates" on completion. Opt-in — tools that emit no
  progress are unchanged. Registry can customize via `progress` config
  (`mode: 'log' | 'latest' | 'steps'`, `visibleWhileRunning`, `showWhenComplete`).
- **Where to test:** chat surface (assistant or pilot) with a tool that emits
  progress. Quick manual smoke: in any client handler add
  `ctx.reportProgress?.('step 1')` / `('step 2')` and run it via the Tools tab
  (note: Tools-tab runner has no `reportProgress`, so use a real agent run).
- **Steps:**
  1. Trigger a tool that reports progress.
  2. While running: progress lines appear under the tool row, newest with a
     spinner; `percent` (if sent) shows a thin bar.
  3. On completion: lines collapse to a "N updates" toggle (unless
     `showWhenComplete`); click to expand.
- **Expected:** A normal tool (no progress) looks exactly as before. Progress
  never flips a completed row back to "started". Bounded to 200 entries.
- **Edge cases:** progress arriving before `tool_started` (seeds a started
  part); `steps` mode dedupes by `step` keeping latest status; pilot surface
  mirrors via `usePilotChatStore`.

### Stream stall watchdog + Retry banner (stuck-UI fix)
- **What it does:** Detects a stalled run (no chunk/heartbeat for 75s),
  clears the stuck spinner, and shows an amber Retry banner above the
  composer. Consumes the server `heartbeat` event as a liveness signal.
  Attempts resume first (no-op until backend ships — see
  docs/STREAM_RESUME_PROTOCOL.md), then falls back to Retry (replays the
  last turn).
- **Where to test:** chat surface. Hard to trigger naturally; force it.
- **Steps:**
  1. Send a message, then kill the stream silently — e.g. in DevTools
     terminate the offscreen document, or block the network mid-stream so no
     `done` ever arrives.
  2. Wait ~75s. Spinner stops; the amber "The response stalled (no activity
     for 75s)." banner appears with **Retry** + dismiss (✕).
  3. Click Retry → the last turn re-sends and the banner clears. Dismiss (✕)
     hides it without re-sending.
- **Expected:** A normal completed run never shows the banner (watchdog
  stopped on `done`). Cancelling clears it. Switching conversations clears it.
  Pilot surface clears its spinner on stall too (no banner — by design).
- **Edge cases:** a late chunk after stall doesn't re-arm the watchdog; a new
  send while a stall handler is mid-flight is detected (runId mismatch) and the
  stale handler no-ops.

---

### Turn-boundary inbox (queue a message into a running agent)
- **What it does:** While a run is streaming, lets the user keep typing and
  "send" — instead of starting a second run or cancelling, the message is
  POSTed to `/ai/conversations/{id}/inbox` and the running agent answers it on
  the same stream at its next pause. A "waiting its turn" card floats above the
  composer with a live timer; on delivery the message drops into the transcript.
- **Where to test:** Assistant Chat surface (not Pilot yet).
- **Steps:**
  1. Send a message that triggers a longish response (e.g. "analyze the current
     page" or anything with tool calls) so the stream stays open a few seconds.
  2. While it's still streaming, type a follow-up. The send button is now an
     indigo→violet gradient with a small clock badge (NOT the solid send arrow,
     NOT the Stop square — both the gradient queue button and the Stop button
     are shown). Press Enter or click it.
  3. A dreamy card appears above the input: "Queued — waiting its turn" with a
     drifting sheen, pulsing dot, and a counting timer (0s, 1s, …).
  4. When the agent reaches a turn boundary, the card flips to "Delivered to
     the agent" (green check), then fades out, and the queued text appears as a
     user bubble in the transcript just above the agent's continuing response.
- **Retract / edit:** while a card is "pending" (POST resolved), it shows a
  pencil and × at the right of the status row. × retracts (DELETE) and removes
  the card; pencil opens an inline editor (Enter saves via PATCH, Esc cancels).
  If the agent drains the item between your click and the request (409), the
  card is left to follow the normal delivered flow.
- **Expected:** No second run starts; the original stream keeps going. FIFO if
  you queue several. The agent's reply addresses the queued message.
- **Edge cases worth poking:**
  - Queue in the first ~second of a brand-new chat (before the server assigns a
    conversation id): the gradient button is disabled and Enter is a no-op
    (tooltip "Waiting for the conversation to start…"); the draft is kept.
  - Network/auth failure on the POST → card turns red "Couldn't queue" with the
    error and a dismiss ✕; no transcript bubble.
  - Retract/edit are hidden while a card is still "sending" (no injection_id
    yet) and reappear once it's "pending".
  - Stop (square) still cancels the whole run while a card is pending.

### Stop & send (interrupt the running turn and redirect)
- **What it does:** While a run is streaming, lets the user cut the current
  response and immediately send a new message. The server keeps the partial
  assistant turn (with an auto `[⚠️ Response interrupted by the user before
  completion.]` marker) and the fresh run loads that history and answers the
  redirect. Distinct from the inbox: inbox waits for the boundary on the SAME
  run; stop & send cuts now and starts a fresh run.
- **Where to test:** Assistant Chat surface (not Pilot yet).
- **Steps:**
  1. Send a message that triggers a longish response. While it streams, type a
     redirect (e.g. "actually, just summarize in one line").
  2. Click the **amber→rose** button with the small stop badge (it sits between
     the indigo queue button and the plain Stop square). Note: Enter still
     QUEUES (the safe default) — interrupt is click-only.
  3. The current response stops; after a brief pause a fresh run starts and the
     transcript shows the truncated previous answer with the interrupted marker,
     followed by the answer to your redirect.
- **Expected:** Exactly one new run starts (no double-send). The previous turn
  is preserved truncated + marked, so the model has context for the redirect.
- **Edge cases worth poking:**
  - In the first ~second of a brand-new chat (no conversation id yet): the
    amber→rose button is disabled (tooltip "Waiting for the conversation to
    start…") — interrupt needs the conversation id to load the partial as
    history.
  - Fire it back-to-back: each cut persists its own partial; the grace delay
    (350ms) keeps ordering correct so each fresh run sees the prior truncation.

---

### Highlights (Highlight tab + on-page highlighter + attach-to-chat)
- **What it does:** Lets the user mark text passages and whole elements on any
  page; captures are persisted to Supabase (`wbx_highlight`) with a re-locatable
  reference, can be attached to the chat (ride along as the `highlights` context
  key), and can be handed to the Data and Scrape tabs. The agent can read them
  via `list_highlights`.
- **Where to test:** Side panel → Highlights tab (highlighter icon, signed-in
  only); also Chat, Data, Scrape, and the Tools tab.
- **Steps:**
  1. Open a content-rich page. Side panel → **Highlights** tab → **Highlight
     this page**. A pill toolbar appears top-center on the page.
  2. **Text mode** (default): drag-select a passage. It paints yellow; a row
     appears in the Highlights list with the captured text.
  3. **Element mode**: click the toolbar's *Element* toggle, hover (blue
     outline), click an element. It paints an outline; a row appears.
  4. Reload the page, **Highlight this page** again → existing highlights
     re-paint (text via text-quote, elements via selector).
  5. Click the link icon on a row (or **Attach all to chat**), open **Chat** —
     an amber "N highlights attached" chip shows above the composer. Send a
     message; the agent receives a `highlights` context key.
  6. **Data ( N )** button → switches to Data tab with element highlights
     pre-loaded as picker fields → Save pattern works.
  7. **Scrape ( N )** button → switches to Scrape tab, shows a highlighted-
     regions banner with combined text + copy.
  8. Tools tab → run `list_highlights` with `{"scope":"page"}` → returns the
     captured highlights with their references.
- **Expected:** Captures persist across reloads and survive sign-out/in (RLS
  scoped to the user). The pill's count tracks captures; trash clears the
  page's highlights; ✕ stops the overlay.
- **Edge cases worth poking:**
  - chrome:// / Web Store pages: overlay injection fails gracefully (button
    no-ops, no crash).
  - Side panel closed while capturing: the paint stays but the row isn't saved
    (no auth context to write) — re-toggle to recapture.
  - Text spanning multiple elements: anchor still re-locates via the exact
    quote within the container.
  - Guests: the tab is hidden (signed-in only, like Notes).

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
