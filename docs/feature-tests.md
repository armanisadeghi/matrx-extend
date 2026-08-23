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

## Store-review guest path

### Fresh-install guest conversation organization
- **What it does:** Resolves the fingerprint guest's server-side personal
  organization before starting a persisted AI conversation.
- **Where to test:** A fresh Chrome profile with the exact Store build loaded
  and no AI Matrx sign-in.
- **Steps:**
  1. Open `https://www.aimatrx.com/matrx-extend-demo`.
  2. Open Matrx Extend → Chat.
  3. Ask `What are the three workflow stages on this page?`.
- **Expected:** `GET /auth/whoami` returns an `organization_id`; the subsequent
  agent request includes it and answers with Capture, Understand, and Use.
  There is no 422 `body.organization_id` error and no stuck pending bubble.
- **Edge cases worth poking:** If bootstrap fails or returns no organization,
  the pending run ends immediately with a visible retryable error. The client
  never guesses or hardcodes a fallback organization.

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
  Both fields are part of the unified `tool.definition` contract shared with matrx-frontend.
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

### user / ask-user card — universal "Other" escape + freeform note
- **What it does:** Every question the agent asks renders two guaranteed
  affordances in `AgentAskUserCard`: (1) a freeform **"Other"** escape on every
  non-text question (`confirm`→Yes/No/Other, `choice`/`choice_many`→extra "Other"
  radio/checkbox, `notify`→Other button), and (2) an **"Anything else? (optional)"**
  note on the final card that flows back to the model as `additional_instructions`.
  `text`/`secret` are exempt from "Other" (they're already freeform). This holds
  regardless of which ask tool produced the card — `user`, `update_plan`, and
  `request_user_takeover` all get both.
- **Where to test:** Chat — have the agent call `user`, `update_plan`, or run them
  from the Tools tab.
- **Steps:**
  1. Run `user` `{"type":"confirm","question":"Proceed?"}` → card shows Yes / No /
     Other…; clicking Other… reveals a textarea; type + send.
  2. Run `user` `{"type":"choice","question":"Pick","options":["A","B"]}` → an
     "Other" radio appears below A/B even though `allow_other` wasn't passed.
  3. Run `update_plan` `{"steps":["x","y"]}` → Approve / Reject **and** an Other
     radio; selecting Other + typing returns the typed text as `note`.
  4. On any single (or last batched) card, type into "Anything else?" then submit →
     the structured answer comes back with `additional_instructions` populated.
- **Expected:** No question is a dead end — the user can always type a custom answer
  and always attach a freeform note. `update_plan` returns
  `{approved, note, additional_instructions}`; `request_user_takeover` returns
  `{answer, cancelled, additional_instructions}`.
- **Edge cases:** `text`/`secret` show no extra "Other" (already freeform). The note
  rides only on the FINAL card of a batch, never intermediate ones. Empty note →
  `additional_instructions: null`, not `""`.

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
  (`tool.definition` via Supabase REST — the `/ai-tools/app/matrx-extend`
  aidream endpoint was retired in the 2026-05-27 refactor), not hardcoded.
  With the network available, every canonical tool shows its `tool.definition`
  description; offline (or before the fetch resolves) it shows `—`, never
  a stale string.

### Tool descriptions read live from the DB (Rule 4)
- **What it does:** No tool descriptions live in the extension's code — they
  live only in `tool.definition` and are read live via
  `src/lib/tools/descriptions.ts` (direct Supabase REST query). Consumers:
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
- **Expected:** Descriptions match `tool.definition` exactly (regenerate
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
  - Signed in (Bearer token used to call the active aidream backend's
    `/audio/transcribe` route).
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
  4. Click a thumbnail (or the open icon) to open the canonical Files viewer; click the link icon to copy that durable Files URL; click the trash icon (then Delete) to remove the index row (file in cloud storage is kept).
  5. Switch to Chat - ask the agent "take a screenshot of this page" - it lands in the same gallery on next refresh, live via the timeline event. Ask "take a full-page screenshot" and it uses `mode: 'full_page'`.
- **Expected:**
  - Each card shows: thumbnail (authenticated fresh-byte download by `file_id`, never the expired upload-time `file_url`), source label ("You" / "Agent"), relative timestamp, dimensions. Full-page captures are visibly tall.
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

### Files tab
- **What it does:** Shows recent discoverable Matrx library files and every screenshot captured by the extension, opens the canonical web viewer, inspects the file's live family inventory, and durably attaches/detaches a file to the current conversation.
- **Where to test:** Side panel - **Files** tab (stacked-files icon).
- **Steps:**
  1. Sign in and open Files. Confirm Library shows the same recent root files visible in the web Files app; Captures shows screenshots from multiple pages.
  2. Search by filename, path, page title, and page URL.
  3. Click the branch icon. Confirm the inspector renders stored-file and processing-result nodes, parent edges, derivation kinds, requested/ancestor/sibling/descendant labels, and representations/capabilities returned by `get_file_resource_family`.
  4. Open an existing conversation (or send one message), then click the paperclip. Switch to Chat and send another message about the file; the backend should resolve the durable `file -> conversation` edge. Return to Files and click the unlink icon to detach it.
  5. Click the external-link action to open `/files/f/{fileId}` in the full Files app.
- **Expected:** Context-only/shared attachment access does not make a file appear in Library; hidden `system-files/matrx-extend/` screenshots appear only in Screenshots. Attach state refreshes when the selected conversation changes, and attach requires editor authority over both the file and conversation. Family inspection never schedules processing.
- **Edge cases worth poking:** Fresh chat before its first message shows an explicit conversation-ID notice and disables attachment; malformed family schema fails loudly; a family deeper than 16 generations or broader than 5,000 rows fails instead of showing a partial graph; old expiring `file_url` values are ignored and screenshot cards still open the canonical Files viewer by `file_id`.

---

### Guidance cloud sync (TASK-004)
- **What it does:** Guidance metadata (notes / screenshots / GIFs / demo refs) now persists to the cloud (`public.wbx_guidance`), not just the artifact bytes — so guidance created on one machine shows up on another after sign-in. DB is the source of truth; `chrome.storage.local` is an offline cache. Every save/delete (UI **or** agent tool) best-effort mirrors to the cloud; sign-in hydrates cloud→local last-write-wins.
- **Where to test:** Side panel - **Guidance** tab; cross-machine (or simulate by clearing local storage).
- **Prereq:** `migrations/2026_06_10_wbx_guidance.sql` is applied to the Matrx Supabase project (`txzxabzwovsujtloxrus`) — already applied + ledger-recorded on 2026-06-10.
- **Steps:**
  1. Signed in, open Guidance and save a note for the current domain (and/or a screenshot/GIF). It appears in the list as before.
  2. Confirm cloud write: SW console logs `guidance synced to cloud id=gd_…`, or query `select id, kind, domain from wbx_guidance` in Supabase.
  3. Simulate a fresh machine: in DevTools run `chrome.storage.local.remove(['matrx.guidance.list'])` plus the `matrx.guidance.<id>` keys (or clear local storage), then reload the side panel while signed in.
  4. Open Guidance again.
- **Expected:**
  - After reload, the previously-saved guidance reappears (hydrated from the cloud). SW console logs `guidance hydrated from cloud — merged N item(s)`.
  - Deleting an item locally also removes the `wbx_guidance` row.
  - Agent-created guidance (`save_guidance_note` etc.) syncs identically — the hook is at the storage layer, so all paths are covered.
- **Edge cases worth poking:**
  - Offline / signed-out: local save still works; cloud push silently no-ops and the item stays local (best-effort, never blocks the UI).
  - Last-write-wins: edit the same item on two machines — the newer `updated_at` wins on next hydrate; local-only (not-yet-pushed) items are never deleted by a hydrate.
  - `demo_ref`: the pointer AND the recorded body both sync now — see the next entry for the cross-machine replay test.

---

### Demo body cloud sync (TASK-004 follow-up)
- **What it does:** The recorded demo itself (full step list + selector chains + parameters) syncs through `extend.wbx_demo`, not just the guidance `demo_ref` pointer. Before this, a synced ref listed on a fresh machine and then `replay_demo` failed — a saved workflow that did not exist. Same pattern as guidance: mirror-on-save, tombstone-on-delete, hydrate cloud→local last-write-wins on sign-in, plus an on-miss repair that pulls one demo when a ref is opened before the hydrate ran.
- **Where to test:** Side panel → **Guidance** tab, and the **Tools** tab (`replay_demo`). Genuinely cross-machine — this is the whole point.
- **Prereq:** `migrations/2026_08_09_wbx_demo.sql` applied to `txzxabzwovsujtloxrus` (`pnpm check:migrations` is quiet).
- **Steps:**
  1. **Machine A**, signed in: Guidance tab → Add → record a demo on any site (a few clicks + a type). Save it with a name.
  2. Confirm the cloud write — SW console logs `demo synced to cloud id=demo_… steps=N`.
  3. **Machine B**, same account, signed in: open the side panel and let it hydrate. SW console logs `demos hydrated from cloud — merged N demo(s)`.
  4. Guidance tab on machine B: the demo appears with its step count and a **Replay…** button (no "steps aren't on this machine" notice).
  5. Click **Replay… → Run replay** on the recorded site. Also run `replay_demo({demo_id})` from the Tools tab.
- **Expected:**
  - Replay actually RUNS on machine B and reports `steps_succeeded/steps_attempted` — it does not fail with "no demo with id=…".
  - `describe_demo` on machine B returns the full step list.
  - Deleting the demo on either machine tombstones the row; the other machine drops it on next hydrate.
- **Edge cases worth poking:**
  - **Signed out / offline on machine B:** the ref may be present with no body. The Guidance preview must say *"The recorded steps for this demo aren't on this machine…"* instead of offering Replay, and `replay_demo` must return `{ok:false, error:'demo_body_unavailable'}` — distinct from `{error:'demo_not_found'}` for a genuinely bogus id. Verify both codes.
  - **Ref before body:** delete only the local `matrx.demos.<id>` key (keep the guidance ref), reload, open the item → it repairs itself from the cloud (`demo body repaired from cloud id=…`).
  - **Last-write-wins:** re-record/rename the same demo id on machine A; machine B picks up the newer copy on next hydrate. A locally newer demo is never clobbered by an older cloud copy.
  - **Agent-recorded demos** (`record_demo` with no guidance ref) sync too — the hook is at the storage layer.

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
- **Realtime ownership:** Start a fresh guest conversation, send the first
  message, and confirm the panel does not render an error about adding
  `postgres_changes` callbacks after `subscribe()`. Chat and Pilot each own one
  subscriber; the chip and drawer are state-only renderers.
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

### Showcase — shell (tab strip, persistence, forceMount)
- **What it does:** Hosts the 12 extraction sub-tabs. The strip is its own
  horizontal scroller; every sub-tab stays mounted so work survives switches.
- **Where to test:** Side panel → Showcase (admin).
- **Steps:**
  1. Open Showcase. The tab strip scrolls horizontally (fade edges, no
     wrap); the rest of the panel never scrolls sideways.
  2. Click "Network", start a capture, switch to "Doctor", come back.
  3. Close the side panel entirely; reopen → Showcase.
- **Expected:** (2) capture events and recording state are still there.
  (3) the previously-active sub-tab is restored (not reset to Doctor).
- **Edge cases:** active trigger auto-scrolls into view when selected via a
  Doctor recommendation; only the VISIBLE sub-tab auto-probes on navigation.

### Showcase — Doctor tab
- **What it does:** Probes the page for every structured-data signal and
  recommends an extraction mode; recommendations are click-to-jump.
- **Steps:** Open a recipe site (e.g. an Allrecipes page). Doctor auto-probes.
  Click the "JSON-LD tab" recommendation.
- **Expected:** Showcase switches to the JSON-LD sub-tab. Re-probe works.
  On chrome:// pages a readable error shows (no spinner hang).
- **Edge cases:** giant pages (50k+ elements) still probe quickly — the
  repeating-group scan is capped at 20k elements.

### Showcase — Recipes tab (DB-backed)
- **What it does:** One-click curated extraction configs, loaded from
  public.wbx_recipe (bundled list is the offline fallback).
- **Steps:** Open news.ycombinator.com → Recipes shows "Hacker News" match →
  Run. Navigate to another site mid-result.
- **Expected:** Rows render with Save pattern; after navigation the stale
  rows CLEAR (no cross-site leakage). "Show all" lists the full catalog.

### Showcase — Prepare tab
- **What it does:** Heuristic page cleanup (banners, load-more, scroll).
- **Steps:** Run on a cookie-bannered site; then navigate to another page.
- **Expected:** Report shows counts; report clears on navigation (a page-A
  report never displays on page B).

### Showcase — Snapshot / JSON-LD / Microdata tabs
- **What it does:** One-shot metadata grab / typed JSON-LD blocks / Schema.org
  microdata items, each with type-filter chips where applicable.
- **Steps:** Wikipedia article → each tab auto-detects when visible →
  Extract → Save pattern (create new table from fields).
- **Expected:** Detection summary matches the page; rows render; saving with
  a duplicate name auto-suffixes "(2)". The created table has EVERY column
  the preview showed (union of all rows, not just row 1).

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

### Showcase — Framework tab (next_data)
- **What it does:** Dumps __NEXT_DATA__/__NUXT_DATA__/Apollo/bpr-guid/window.*
  state into a navigable tree; click a node to set the key path, Extract.
- **Steps:** Open a Next.js site (e.g. vercel.com) → tree renders → click a
  nested node → Extract from key path → Save pattern.
- **Expected:** Huge dumps render incrementally ("+N more…" expanders, 100
  children per node). Restricted pages show "Could not read framework data".
  When BOTH an apollo script tag and window.__APOLLO_STATE__ exist, both
  appear in the source picker. `window.*` assignments are accepted only when
  their value is strict JSON; JavaScript object literals are skipped rather
  than evaluated as extension code.

### Showcase — AI Extract tab
- **What it does:** Describe what you want; the extractor agent reads the
  page and returns schema-shaped rows. Convert-to-pattern generates CSS
  selectors and VERIFIES them against the live page before showing success.
- **Steps:** On a list page, describe "product name and price", add fields
  name/price, Extract. Then "Convert to reusable pattern".
- **Expected:** Streaming progress; Cancel works mid-run and clears results;
  a stalled stream errors out by ~75s (no immortal spinner). The generated
  pattern shows "verified on this page" + a live first-row preview; selector
  sets that match nothing surface an error instead of a fake success.
- **Edge cases:** empty/duplicate schema field names block Extract with an
  inline warning; agent dropdown shows "Loading agents…".

### Showcase — List Pattern tab
- **What it does:** Two-phase visual picker (click one example item → click
  fields inside) producing a reusable CSS config.
- **Steps:** On Hacker News, "Pick an example item" → click one story row →
  add suggested fields → Done → Extract → Save pattern.
- **Expected:** While picking, the sidepanel shows a Cancel button that
  works; navigating mid-pick clears the stuck state with a message; double
  clicking Pick doesn't double-inject; re-entering picking replaces any
  orphaned page overlay; chrome:// pages get a friendly "this page type
  doesn't allow picking" error.

### Showcase — Network tab
- **What it does:** Captures top-frame fetch/XHR while you interact; pick a
  response, drill into the JSON, save url_filter+key_path as a pattern.
- **Steps:** Start capture on an SPA, scroll/click so API calls fire, select
  a JSON response, click into the array node, Save pattern.
- **Expected:** Only the captured tab's requests appear (another tab's
  traffic never pollutes the list); Reload stops the recording state;
  buffer caps at 500 events with a "dropped" notice; events survive
  switching to another sub-tab and back.

### Showcase — Patterns tab (lifecycle + re-run)
- **What it does:** Lists every saved pattern for the host with health
  badges; run / rename / delete inline.
- **Steps:**
  1. Run a DOM pattern (e.g. the JSON-LD one) → rows render, badge "ok".
  2. Run a network_capture pattern → page reloads, progress notes show
     ("Reloading page…", "Listening…"), rows arrive when the API fires.
  3. Run an ai_extract pattern → agent re-extracts the current page.
  4. Rename to a name that already exists → inline collision error.
  5. Delete: first click arms (red), second click deletes; arms off in 3s.
- **Expected:** Supabase outages show an error banner with Retry — NEVER the
  "no saved patterns" empty state; a no-match network re-run shows guidance
  and does NOT mark the pattern broken.

### Showcase — Send to agent / data_patterns tool
- **What it does:** "Send to agent" on any result stages rows (≤50) into the
  chat composer; the `data_patterns` tool lets the agent list/describe/
  run/save/delete patterns and read matching recipes.
- **Steps:** Extract rows → Send to agent → composer pre-filled, Chat tab
  active. In chat, ask the agent to "list my saved patterns for this site
  and run the best one".
- **Expected:** Agent calls data_patterns(list) then (run) with live
  progress; rows return capped at 100 with true row_count; the
  saved_patterns_for_domain context key is attached when patterns exist.

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

### Cryptographic run receipts (docs/SYSTEM_STATE.md roadmap #8)
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

### Stream stall watchdog + real resume (stuck-UI fix)
- **What it does:** Detects a stalled run (no chunk/heartbeat for 75s) and
  first attempts a REAL resume via `POST /ai/conversations/{id}/resume`
  (`user_request_id` = the requestId latched from `STREAM_OPENED`) — the same
  endpoint the client-tool-suspend `STREAM_CONTINUE` path already uses
  successfully. If that succeeds, the run just continues in a fresh assistant
  bubble — no banner, no replayed tool calls, no double billing. Only if the
  resume can't be attempted (missing ids, `matrx.stream.resume.enabled` flag
  off, conversation no longer selected, or the resume call itself errors)
  does it fall back to clearing the spinner and showing the amber Retry
  banner (full-turn replay). See docs/STREAM_RESUME_PROTOCOL.md and
  src/lib/stream/resume.ts.
- **Where to test:** chat surface (Assistant + Pilot). Hard to trigger
  naturally; force it.
- **Steps:**
  1. Send a message that keeps the agent talking for a while (or one that
     calls a tool), then kill the stream silently — e.g. in DevTools
     terminate the offscreen document, or block the network mid-stream so no
     `done` ever arrives.
  2. Wait ~75s. Watch the debug log: `stream stalled — no activity for
     75000ms` followed by either `stream resumed after stall (via /resume, no
     replay)` (success — a new assistant message appears and the run
     continues) or `stream giving up (<reason>)` (falls back to the Retry
     banner as before).
  3. To force the fallback path deliberately: `chrome.storage.local.set({
     'matrx.stream.resume.enabled': false })`, repeat step 1 — the amber
     "The response stalled (no activity for 75s)." banner appears with
     **Retry** + dismiss (✕). Click Retry → the last turn re-sends (full
     replay) and the banner clears.
- **Expected:** A normal completed run never shows the banner (watchdog
  stopped on `done`). Cancelling clears it. Switching conversations clears it.
  A successful resume never shows the banner at all. Pilot surface follows
  the same resume-then-fallback order (no banner on Pilot either way — it
  just clears the spinner on ultimate give-up, by design).
- **Edge cases:** a late chunk after stall doesn't re-arm the watchdog; a new
  send while a stall handler is mid-flight is detected (runId mismatch) and the
  stale handler no-ops; a stall on a conversation the user has since navigated
  away from declines the resume (`resumeRun` checks `selectedConversationId`)
  and falls back to give-up cleanly.

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

### Chat markdown — angle-bracket tags render as literal text
- **What it does:** In the chat/reasoning markdown renderer, only registered
  tags (`<thinking>`, `<reasoning>`, `<reflection>`) become collapsible blocks.
  Any other angle-bracket token (`<ctx>`, `<provider_specific_param>`, a
  literal `<T>`) renders as plain text instead of being swallowed into a
  collapsible "streaming…" box.
- **Where to test:** Chat tab — send a message that makes the agent emit prose
  or inline JSON containing a bare tag, e.g. ask it to describe a schema with
  `"max": <ctx>` or to mention `<provider_specific_param>`. Reasoning blocks
  also exercise this.
- **Steps:**
  1. Chat tab → send: *"Show a JSON config where max_tokens is `<ctx>` and
     mention a `<provider_specific_param>` placeholder."*
  2. Watch the assistant message (and its Reasoning panel) render.
- **Expected:** `<ctx>` and `<provider_specific_param>` appear as literal text.
  No dashed-border box, no chevron, no uppercase "streaming…" label folding the
  rest of the content into it.
- **Edge cases worth poking:**
  - `<thinking>`/`<reasoning>` still render as their custom shimmer blocks.
  - A streaming `<reasoning>` with no closer yet still shows its in-flight
    block (legit streaming case, unchanged).
  - Backtick-quoted `` `<ctx>` `` still renders as inline code.

---

### Deep capture on first submit — fires even with a background capture running
- **What it does:** The composer "Deep capture on first submit" toggle scrolls
  the page top→bottom (loading lazy content) before the first message about a
  page goes out. It used to be silently skipped when the background auto-capture
  was still running (shared in-flight flag); now a user-requested deep capture
  waits for that to clear and always runs.
- **Where to test:** Chat composer → Customize chip (Sliders icon) → "Deep
  capture on first submit" ON.
- **Steps:**
  1. Open a long, lazy-loading page (e.g. an infinite-scroll feed). Open the
     side panel and *immediately* type a message and send (within ~1s of the
     panel opening, so the background capture is still in flight).
  2. Watch the page: it should scroll to the bottom and back before the message
     sends. Debug tab → `scrape` logs show `pre-send deep capture`.
- **Expected:** The scroll happens on the first submit regardless of background
  capture timing. Subsequent submits on the same URL reuse the deep capture (no
  re-scroll). Toggle OFF → no scroll.
- **Edge cases worth poking:** Toggle off mid-session then send → no scroll.
  Navigate to a new URL → next first-submit deep-captures again.

### Default mode (ask/act) honored on WebMCP + frontend-bridge tool calls
- **What it does:** Settings → Default mode = "Act without asking" now applies
  to tool calls initiated via WebMCP and the frontend bridge (previously those
  paths read the wrong storage key and always fell back to "ask").
- **Where to test:** Settings → Default mode; then trigger a WebMCP or
  frontend-bridge tool call.
- **Steps:**
  1. Settings → set Default mode to **Act without asking**.
  2. Trigger an action-tier tool via a WebMCP page tool or the frontend bridge.
- **Expected:** The action runs without an approval card (act mode). Set back to
  "Ask before acting" → the approval card appears.
- **Edge cases worth poking:** Privileged-tier tools still confirm even in act
  mode (unchanged). First-run with no setting persisted → defaults to ask.

### Auto-scrape mode — Scroll & capture
- **What it does:** Settings → Scrape → "Auto-scrape mode" = *Scroll & capture*
  makes the background on-load capture scroll top→bottom first (loading lazy
  content) before capturing, instead of a fast visible-DOM grab. Auto-scrape
  is OFF on a fresh install and begins only after the user enables it.
- **Where to test:** Settings → Scrape section ("Auto-scrape on load" ON +
  "Auto-scrape mode" = Scroll & capture).
- **Steps:**
  1. Enable both. Load a lazy-loading page and wait ~1s after it finishes.
  2. The page briefly scrolls to load content, then restores. Open Chat and ask
     about content far down the page — it's present in context.
- **Expected:** With "Capture" mode, only above-the-fold content is captured;
  with "Scroll & capture", lazy content below the fold is included.
- **Edge cases worth poking:** Switching mode mid-session takes effect on the
  next capture (read fresh, no listener re-register). chrome:// pages skip.

### Research capture — media + structured collectors (§4)
- **What it does:** A research capture now sends, alongside the HTML + image
  dims, the JS-injected media (`<video>`/`<audio>` + YouTube/Vimeo iframes) and
  clean structured data (OpenGraph/Twitter metadata + parsed JSON-LD) the
  server's HTML scan can't compute — gathered in one injected pass.
- **Where to test:** Tasks tab → run any capture (L1/L2/L3) on a media- or
  schema-rich page (e.g. a news article or product page); DevTools Network panel.
- **Steps:**
  1. Open the DevTools Network panel for the side panel (or inspect the SW).
  2. Run a capture on a queued source that has video embeds and JSON-LD.
  3. Find the `POST …/extension-content` request and read its body.
- **Expected:** The body has `images` (as before) PLUS `media: { videos, audio }`
  and `structured: { metadata, jsonLd }` when the page has any. A page with no
  media/structured omits those keys (kept lean). The capture still succeeds and
  the source advances exactly as before (server ignores unknown keys today).
- **Edge cases worth poking:** A page with zero videos/jsonLd → `media`/
  `structured` absent, body identical to the old shape. Injection failure →
  empty data, capture still proceeds off the HTML.

### Research capture — publish / modify dates
- **What it does:** A capture now sends
  `structured.metadata.published_time` / `.modified_time`, read from the page's
  `article:published_time` / `article:modified_time` meta tags (plus the
  `itemprop=datePublished` / `og:updated_time` / `name=date` aliases). These are
  the FIRST thing the server's `_structured_dates` looks at — JSON-LD
  `datePublished`/`dateModified` is only its fallback — so an OG-only article
  used to store no date at all.
- **Where to test:** Tasks tab → run a capture on a news article; DevTools
  Network panel; then the source's content row in the research UI.
- **Steps:**
  1. Find an article page whose `<head>` has `article:published_time` and NO
     `datePublished` JSON-LD (view-source and grep to confirm).
  2. Add it to a topic and run a capture (any level) from the Tasks tab.
  3. In the Network panel read the `POST …/extension-content` body:
     `structured.metadata.published_time` must be the ISO string from the page.
  4. Check the stored content row — `published_at` matches that value.
- **Expected:** The date reaches the payload verbatim (original offset kept) and
  lands on the content row. A page with neither meta nor JSON-LD sends `null`.
- **Edge cases worth poking:** A page whose date is locale-formatted
  ("August 9, 2026") or `08/09/2026` → both fields `null`, NOT a guessed date
  (a wrong date is worse than none). A page with both OG and JSON-LD dates →
  the OG value wins. `<time datetime>` counts only when it carries
  `itemprop="datePublished"`/`"dateModified"` — a bare `<time>` in an article is
  ignored because it's usually a related-post or comment timestamp.

### Scrape — link scheme filtering (`collectLinks`)
- **What it does:** The page-link collector keeps only links an agent could
  actually navigate to — `http:`/`https:` with a real host. `javascript:`,
  `mailto:`, `tel:`, `blob:` and `data:` hrefs are dropped. (They all *parse*
  as URLs — they just have no host — so the old parse-or-throw check let every
  one of them through.) Mirrors the canonical server rule in
  `matrx_scraper/seo_audit.py`. Affects the `page_links` context key the agent
  gets every turn and `SoupResult.links` → the capture sink's `extracted_links`.
  A same-page `#fragment` anchor still survives — it resolves to a real http(s)
  target.
- **Where to test:** Side panel → **Tools** tab → run `get_page_links`, and
  side panel → **Scrape** tab → Capture.
- **Steps:**
  1. Open a page with JS-driven nav — an old-style site whose menu uses
     `<a href="javascript:void(0)">`, plus a footer `mailto:` and `tel:` link
     (Inspect the DOM to confirm the hrefs before testing).
  2. Tools tab → `get_page_links` → **Run**, with no arguments.
  3. Scrape tab → **Capture**, then read the captured `links` array.
- **Expected:** The Scrape capture's `links` contains no `javascript:`,
  `mailto:`, `tel:`, `blob:` or `data:` entry — only http(s) URLs; in-page
  anchor links appear as the page URL plus `#fragment`. Note `get_page_links`
  is a *separate* implementation (`handlers/inspect.ts`) that has always
  skipped `javascript:` and deliberately still returns `mailto:`/`tel:` so the
  agent can read contact details on request — comparing the two is the point of
  running both.
- **Edge cases worth poking:** A protocol-relative `//cdn.example.com/x` link
  → survives, resolved to the page's own scheme. A page whose images are inline
  `data:` URIs or canvas `blob:` URLs → those still appear in the capture's
  `images`/`videos` (the media collectors keep them on purpose; only the link
  collector is host-and-http-only).

---

### Research queue — domain-policy categories (§5)
- **What it does:** The scrape queue now renders the server's per-source policy
  category: `gated_login` sources appear under a **"Sign in to capture"** section
  (open → sign in → Go via the user-gated overlay), `low_value` sources under a
  **collapsed "Low-value"** section that never auto-batches, and `special`
  sources get a violet **"Worth it"** badge. The human `policy_reason` ("Login
  required …") shows on the row.
- **Where to test:** Tasks tab, with a topic whose sources include a login-walled
  site (e.g. NYT), a low-value site (e.g. Facebook), and a tuned site (e.g.
  Reddit).
- **Steps:**
  1. Open the Tasks tab. Confirm gated_login sources are under "Sign in to
     capture" with a "Login required" badge + reason, and are NOT in the
     automated batch.
  2. Confirm low_value sources are under a collapsed "Low-value" section; expand
     it to opt in. The "Run automated batch" button count excludes them.
  3. Confirm a `special` source shows the "Worth it" badge.
  4. On a gated_login row press **Trigger** → the tab opens, you sign in, press
     **Go** in the overlay → it captures as you.
- **Expected:** Categories group + label correctly; low-value never auto-runs;
  gated_login uses the sign-in-then-Go flow; the header count + empty-state
  include the policy buckets.
- **Edge cases worth poking:** A legacy server build (no policy fields) → every
  source is a plain `open` scrape task, no badges, exactly as before. Being on a
  gated_login URL surfaces the top-of-list "you're on a queued source" banner.

### Research enrich tasks (§3) — dormant until the server emits them
- **What it does:** When the server tags a queue item `task_kind:'enrich'` with a
  directive (goal: rendered_dom / authenticated / expand / comments / structured
  / …), the row shows a violet goal badge + an **Enrich** button. Pressing it
  opens/reuses the tab, runs the goal-specific capture (settle/scroll/click →
  capture html + page data), and submits with `enrich_goal`. Artifact goals
  (screenshot/download/xhr_json/transcript) show an honest "not available yet"
  error naming the missing server piece.
- **Where to test:** Not yet end-to-end — **no server emits enrich items today**
  (the generator is a filed server contract). The goal→plan mapping is covered by
  `tests/unit/research-enrich.test.ts`. To exercise the UI before the server
  lands it, hand-craft a queue item with `task_kind:'enrich'` + an `enrich`
  directive in a mocked queue response.
- **Expected:** Supported goals capture + submit (and the row goes success/thin);
  unsupported goals surface the named-gap message; a plain scrape item is
  unaffected (no badge, normal Run).
- **Edge cases worth poking:** `hints.selector` is clicked first on
  expand/comments; `details` accordions are opened; generic "load more" controls
  are capped at 8 clicks so it can't runaway-click a page.

### Scrape queue — filter / search / sort / group-by
- **What it does:** A toolbar on the Tasks tab to focus a huge multi-project
  queue: filter by **project**, free-text **search** (url/title/project/domain), a
  **Filters** popover (domain · status · policy category · capture level), **sort**
  (project / domain / recency / chars / attempts / status), and a **group-by**
  toggle (capture level ↔ project). Selections persist across reopens.
- **Where to test:** Tasks tab (needs a queue spanning several projects/domains).
- **Steps:**
  1. Pick a project in the **project dropdown** → only that project's sources show;
     the header count + "N of M shown" reflect the filter.
  2. Type part of a domain/title in **search** → list narrows live; clear with ×.
  3. Open the **Filters** popover → tick a domain / status / capture level →
     results narrow; the funnel icon shows an active-count badge.
  4. Flip **group-by** to **project** (folder icon) → sections become one per
     project, each row showing a capture-level chip; flip back to level (list icon).
  5. Change **sort** → order updates within every section.
  6. Close + reopen the side panel → your project filter + sort + group mode are
     still applied.
- **Expected:** Filters compose (AND); "Clear filters" (×) resets them; an empty
  result shows "No sources match your filters"; a legacy server build with no
  policy fields still works (everything reads as an `open` scrape task).

### Scrape queue — batch actions + new statuses (ignored / content_mismatch)
- **What it does:** Select multiple sources and act in bulk — **Capture** (auto-
  capturable) or **Resolve** with any verdict. Adds two honest verdicts: **Ignore**
  ("not interested" — not dead/gated) → status `ignored`, and **Wrong content**
  ("page isn't what it claimed — redirect/changed page, not a 404") →
  `content_mismatch`. Both terminal. See docs/RESEARCH_QUEUE_MANAGEMENT.md.
- **Where to test:** Tasks tab.
- **Steps:**
  1. Filter to a project you're done with. Click the **section checkbox** (or
     "select all filtered" in the action bar) → an action bar shows "N selected".
  2. Click **Resolve → Ignore — don't want it** → progress shows, the sources
     leave the queue, selection clears.
  3. Per-row **Resolve** dropdown now also lists "Ignore" and "Wrong content"
     alongside accept / gated / dead / retry.
  4. Select a few L1/L2 sources → **Capture** → they scrape in sequence.
- **Expected:** Bulk resolve removes terminal-verdict sources on the next refresh;
  `retry` requeues them; a few failures are logged but don't sink the batch.
  Resolved sources show the new status in the **web research UI** once aidream +
  matrx-frontend deploy (until then batch still works via a per-source fallback,
  and the web UI shows a muted badge for the new statuses).
- **Edge cases worth poking:** "Capture" is disabled when no selected source is
  auto-capturable (paste-only / sign-in). Selecting across projects then resolving
  applies to all of them (server resolves each source's topic + checks access).

### Agenda — Cron trigger
- **What it does:** Creating an agenda task with a Cron trigger now actually
  fires. A 5-field cron expression (min hour dom month dow, evaluated in your
  local timezone) computes `next_due_at`; the SW scanner picks it up and
  advances to the next occurrence after each fire.
- **Where to test:** Side panel → Agenda → new task → Trigger = Cron.
- **Steps:**
  1. New task, set Trigger = **Cron**. Enter an expression (default `0 9 * * *`).
     The helper text shows the parsed "Next:" time; an invalid expression shows
     red + disables Create.
  2. Set the expression to fire in the next minute or two (e.g. current
     minute+1, current hour) and create it.
  3. Wait for the scanner (runs every minute) → the task fires (notification or
     auto-run per Auth mode) and its "next" advances.
- **Expected:** Valid cron computes a real next-fire; invalid blocks creation.
  Recurring cron re-arms after firing.
- **Edge cases worth poking:** `0 9 * * 1-5` (weekdays only) skips weekends;
  `*/15 * * * *` every 15 min; impossible dates never fire (no crash). The
  optional `tz` is not yet honored — evaluation is local time.

### Agenda — On-match (context-match) trigger
- **What it does:** A context-match task fires when your active tab matches a
  hostname substring and/or a URL regex (not on a clock). Rate-limited to once
  per 10 min per task while the match holds.
- **Where to test:** Side panel → Agenda → new task → Trigger = On-match.
- **Steps:**
  1. New task, Trigger = **On-match**. Set "Hostname contains" (e.g.
     `github.com`) and/or "URL matches (regex)" (e.g. `/pull/\\d+`). At least one
     is required or Create is disabled.
  2. Create it, then switch your active tab to a matching page.
  3. Within ~1 min the scanner fires the task (notification or auto-run).
- **Expected:** Fires on a matching active tab; does not re-fire within 10 min;
  no condition set → cannot create.
- **Edge cases worth poking:** Invalid regex never matches (no crash). Non-
  matching tab → no fire. Multiple conditions AND together.

### Voice language drives transcription (STT), not just speech (TTS)
- **What it does:** The chat-header language picker now also passes its language
  to speech-to-text, so dictating in a non-English language transcribes in that
  language instead of defaulting to English.
- **Where to test:** Chat composer mic button + the language picker in the chat
  header.
- **Steps:**
  1. Set the language picker to a non-English language (e.g. Español / فارسی).
  2. Click the mic and dictate a sentence in that language.
- **Expected:** The transcript comes back in the selected language. Switch back
  to English → English transcription.
- **Edge cases worth poking:** Default language is `en`. The pre-TTS on-device
  translation step (TASK-002d) is still pending — this entry covers STT only.

### Client-tool suspend/resume — exactly one resume, context survives
- **What it does:** When the agent calls a browser tool, the server hard-
  suspends; the extension POSTs the result and opens exactly ONE `/resume`
  stream (server enforces an atomic run claim; duplicates get a benign 409).
  The resume re-sends a fresh context bundle so `page_brief` / `ctx_get` keep
  working mid-conversation.
- **Where to test:** Chat tab, on any normal page (e.g. a docs site).
- **Steps:**
  1. Ask the agent something that forces browser tools, e.g. "List my open
     tabs, then read this page and summarize it" (Act mode for zero prompts).
  2. Watch the timeline: each tool call completes once; the agent continues
     after each result without re-calling the same tool with identical args.
  3. Mid-conversation, ask "what page am I on?" — the agent should answer from
     context (page_brief), not via web search, and `ctx_get` must not report
     "No context objects are available".
- **Expected:** No repeated identical tool calls, no "Triplicate call" errors,
  one assistant bubble per continuation, tool rows in the DB carry real
  `duration_ms`.
- **Edge cases worth poking:**
  - Multiple parallel tool calls in one turn (e.g. "screenshot AND list tabs")
    → still exactly one resume; the SW log shows
    "continuation_needed duplicate suppressed" for the extras.
  - Very fast tools (tabs list) → if the resume races the suspend, the log
    shows "409 resume_conflict — retrying" and recovers within ~1-3s.

### Cold-resume — answer a paused conversation after closing the panel
- **What it does:** When the user closes the side panel while the agent is waiting
  on a client-delegated tool, the conversation is left paused on the server. On
  reopen, the extension fetches the outstanding delegated calls
  (`GET /ai/conversations/{id}/pending_calls`) and re-drives each one through the
  same dispatch path as a live `tool_delegated` event — the approval card
  re-appears, the tool runs, and the agent resumes. See docs/COLD_RESUME.md.
- **Where to test:** Chat tab, on any normal page.
- **Steps:**
  1. In **Ask** mode, send a message that forces an action tool, e.g. "click the
     first link on this page".
  2. When the approval card appears, **close the side panel** without answering.
  3. Reopen the side panel and re-select the same conversation.
  4. The approval card should re-appear. Click **Allow**.
- **Expected:** The tool runs once, the result posts, and the agent resumes and
  finishes its turn (one continuation, no duplicate run).
- **Edge cases worth poking:**
  - A **read-tier** delegated call (rare) runs immediately on reopen with no card.
  - Reopen the conversation twice quickly → the SW log shows
    "cold-resume duplicate suppressed"; the handler runs only once.
  - If the user is signed out / the conversation has no pending calls, reopen is a
    silent no-op (no spurious cards).

### read_active_page on a normal page
- **What it does:** Full readable capture of the assigned tab via the content
  script pipeline (now statically imported in the SW — no more chunk-loading
  "document is not defined" failures).
- **Where to test:** Tools tab → `read_active_page` → Run (or via chat).
- **Steps:**
  1. Open a regular article page, run `read_active_page` with `{}`.
  2. Run again with `{"deep": true}` on a lazy-loading page.
- **Expected:** Structured soup result (title, content). On a chrome:// page a
  structured "Chrome blocks extensions…" reason — never a raw JS error.
- **Edge cases worth poking:** A tab opened before the extension installed
  (auto-inject + retry), an SPA mid-hydration.

### Execution-time admin_only gate (dispatcher + WebMCP)
- **What it does:** Admin-only tools are now refused at EXECUTION time for
  non-admins, on both the streaming dispatcher and every external path
  (WebMCP page bridge, frontend RPC, desktop reverse-invoke) — previously
  only advertisement was filtered.
- **Where to test:** Tools tab as a NON-admin account (or sign out → guest).
- **Steps:**
  1. As a non-admin, force-run an admin tool (e.g. `chrome_cookies` with
     `{"action":"get"}`, or a `cdp_*` tool) via the Tools tab Run button
     or by having a test page post a `__matrx_webmcp_call` for it.
  2. As an admin, run the same tool.
- **Expected:** Non-admin gets a structured `admin_only:` /
  `webmcp: ... admin-only` error, never an execution. Admin path unchanged.
- **Edge cases worth poking:**
  - Fresh install before any sign-in (no cached flag) → treated as non-admin.
  - The four mega-routers (`chrome_cookies`, `chrome_webmcp`, `cdp_session`,
    `cdp_emulate`) now carry admin_only and disappear from non-admin surfaces.

### External-caller confirmation (page / frontend / desktop)
- **What it does:** Action-tier tool calls that originate OUTSIDE the agent
  (WebMCP page bridge, aimatrx.com RPC, matrx-local) now ALWAYS show the
  approval card — even in "Act without asking" mode — with a red banner
  naming the initiator.
- **Where to test:** A WebMCP-enabled allow-listed page + the chat sidepanel.
- **Steps:**
  1. Set permission mode to "Act without asking".
  2. From the allow-listed page, invoke an action tool (e.g. `navigate`)
     through `navigator.modelContext` / the bridge.
  3. Observe the sidepanel.
- **Expected:** An approval card appears with the rose "Requested by the web
  page you have open — NOT by your agent" banner; the remember-for-this-chat
  checkbox is absent (domain trust never applies to external callers). Deny
  returns a structured error to the page.
- **Edge cases worth poking:**
  - Privileged tool from the page → refused outright (no card).
  - Duplicate `tool_delegated` replays of the same call_id → second is
    suppressed (SW log: "duplicate tool_delegated suppressed").
  - A privileged call whose args carry a URL the user trust-remembered
    earlier in the chat → still shows the card (trust shortcut no longer
    applies to privileged).

### Stream survives sidepanel tab switches; leaving a conversation cancels its run
- **What it does:** Chat/Pilot views stay mounted across sidepanel tab
  switches (no more dropped chunks / phantom stall banners), and switching
  conversation or clicking New Chat mid-stream cancels the live run instead
  of leaking its state into the destination.
- **Where to test:** Chat tab.
- **Steps:**
  1. Start a long agent run, switch to the Tools tab for ~10s, switch back.
  2. Start another run, then pick a different conversation from history.
  3. Start another run, then click New Chat.
- **Expected:** (1) The transcript contains the text streamed while you were
  away; no "stalled" banner appears afterwards. (2)+(3) The spinner stops,
  the composer is in normal send mode (not the indigo queue mode), and the
  old run's tool cards/results do NOT appear in the new conversation.
- **Edge cases worth poking:**
  - Queue a turn-boundary message, then switch conversations — the queued
    card should not deliver into the wrong transcript.
  - Multiple ask-cards open while a continuation fires — exactly ONE resume
    (no duplicate ghost bubbles; SW log shows others "another hook instance
    owns the resume").

### Privacy toggle — page identity & email context
- **What it does:** Settings → Privacy → "Share page identity & email
  content" (default ON) gates the `auth_state` and Gmail
  `email_inbox`/`email_thread` context keys.
- **Where to test:** Settings tab + Debug tab (context inspector) or server
  request logs.
- **Steps:**
  1. On GitHub while signed in, send a chat message — context includes
     `auth_state` with your visible username.
  2. Turn the toggle OFF, send again.
- **Expected:** `auth_state`/email keys absent from the request; the
  detectors don't run (no executeScript for them). Password inputs NEVER
  appear in `form_elements.current_value` regardless of the toggle.

### Mic auto-stop when the panel closes
- **What it does:** the offscreen recorder stops ~5s after the last
  recording surface disappears; pause now disables the audio track.
- **Where to test:** Chat composer mic button.
- **Steps:**
  1. Start recording, then close the side panel entirely.
  2. Watch the OS/browser mic indicator.
- **Expected:** indicator goes off within ~5 seconds. Reopening within the
  grace window (quick toggle) keeps the recording alive. While PAUSED, no
  audio is captured. Guests see "Sign in to use voice input" instead of a
  recording that fails at transcription.

### Bug-hunt 2026-06-10 — quick regression passes
- **Guidance Add button:** Guidance tab → Add → the Note/Screenshot/GIF/Demo
  bar must open (it was completely dead). Edit a note → Save → the preview
  shows the NEW text immediately. Delete a demo row → `list_demos` (Tools
  tab) no longer lists it. Delete on machine A → machine B drops it after
  its next sign-in hydrate.
- **Lists repaint:** TaskPanel (chat header chip) → add a task → it appears
  INSTANTLY. Check a todo, delete a task, "Clear done" — all repaint live.
  Then have the running agent add/update a task through the `tasks` tool:
  the same row must repaint in TaskPanel and the Lists tab via
  `chat.agent_task` Realtime. Tool routing diagnostics must show executor
  `aidream`, no `chrome-extension` binding, and zero findings.
- **Tasks overlay:** trigger an L3 capture, switch sidepanel tabs, click the
  in-page Capture button — it still works (TasksView stays mounted). With
  the panel fully closed, the overlay unlocks with a "side panel is closed"
  notice instead of freezing on "Capturing…".
- **Parallel runs:** text renders once (was doubled).
- **Scrape:** Save while signed out shows a red failure line (was silent
  fake-success); a failed "Scroll & capture" retries WITH scrolling;
  fetch_url_as_markdown returns the FETCHED page's metadata/links.
- **SEO:** audit a link-heavy page — internal/external link counts are real
  numbers (they were hardcoded 0); chrome:// pages explain themselves.
- **Chat:** answer an agent questionnaire → Stop now stops that run; ask
  cards with a countdown disappear at 0; streamed code blocks no longer
  flash between plain and highlighted.

### SEO audit — parity with the server auditor (2026-08-09)
- **What it does:** the SEO tab audits the LIVE DOM in-browser (the server's
  `POST /seo/public/page-audit` re-fetches the URL, so it can't see an SPA, a
  signed-in page, or `localhost`). Its counting rules are a deliberate mirror of
  `matrx_scraper/seo_audit.py` and had drifted.
- **Where to test:** SEO tab, plus Tools tab → `fetch_url_as_markdown`.
- **Steps:**
  1. SEO tab on any article page → Audit. Note **Words** and the heading count.
  2. Compare against the same URL run through the server's page-audit.
  3. Open a page whose nav uses `javascript:void(0)` or `mailto:` links, or one
     with blank `<h2>` wrappers in a card grid (most marketing sites). Audit.
  4. Tools tab → `fetch_url_as_markdown` with `include_extras: true` on any
     article URL. Inspect the `seo` block in the result.
- **Expected:**
  - Heading list contains no blank entries, and the count matches the server's.
  - `javascript:`/`mailto:`/`tel:`/`#frag` links are counted in NEITHER
    internal nor external (they used to inflate external).
  - `flesch_reading_ease` matches the server's score for the same text, and a
    genuine score of `0` is reported as `0` (it used to become `null`).
  - In the `fetch_url_as_markdown` result: `seo.url` is the FETCHED page's URL
    (was `""`), `seo.word_count` is non-zero (was always 0), and
    `seo.links.internal` is non-zero on a page with same-host links (every link
    used to count as external because the parsed Document has no location).
- **Edge cases:** a subdomain link (`blog.example.com` from `example.com`) counts
  as **external** — that matches the Python and is intentional. `chrome://`
  pages still refuse with the restricted-URL message.
- **Automated:** `tests/unit/seo-audit-parity.test.ts` pins every rule above.

### SEO audit — diff vs last saved + history (2026-08-09)
- **What it does:** the SEO tab used to render one thing from the previous saved
  audit — its timestamp. It now states the VERDICT ("3 fewer images missing alt
  text"), lists only what changed, and lets you open every saved audit for the URL.
- **Where to test:** SEO tab. Requires sign-in (rows are RLS-scoped by `created_by`).
- **Steps:**
  1. Open any page you can edit (a local dev page is easiest) → SEO tab → **Save**.
  2. Change something measurable on the page: edit the `<title>`, add an `alt=""`
     to an image that lacked one, add a paragraph, add an `<h2>`.
  3. Reload the page, then **Re-audit** in the SEO tab.
  4. Read the "Since your last saved audit" card at the top of the results.
  5. Click the **history chip** (clock icon + count) next to the "SEO audit" title.
  6. Click a saved row → the body switches to that snapshot; click **Live** to return.
- **Expected:**
  - The card names each change as a sentence with both numbers, e.g.
    "3 fewer images missing alt text (5 → 2)", "412 more words (1,200 → 1,612)",
    "Headings: 1 added, 0 removed (7 → 8)", "Title rewritten (42 → 51 chars)".
  - Fixing all alt text reads "Every image now has alt text (was 5 missing)" and
    is green (▲); a regression is amber (▼); ambiguous changes are grey.
  - Fields that did NOT change never get their own row — they collapse into the
    single "Unchanged: Title · Canonical · …" line at the bottom.
  - Re-audit with NO page change → "Nothing changed — this page is identical to
    the saved audit."
  - Each history row shows its own verdict count ("3 changes" / "First saved
    audit"); opening one shows its diff against the audit saved before it.
  - Saving again immediately makes the new row the baseline (the diff resets to
    "Nothing changed").
- **Edge cases worth poking:**
  - Narrow the side panel to ~360px: long titles/canonicals wrap, nothing scrolls
    horizontally.
  - A saved row written by an older build that lacks `links`/`schema_types`: those
    fields are silently skipped — they appear neither as a change nor as
    "Unchanged" (we never claim a field is unchanged when one side never had it).
  - A URL with no saved audits: no history chip, no diff card, unchanged behavior.
- **Automated:** `tests/unit/seo-diff.test.ts` pins every verdict string, the
  unchanged-collapse rule, the multiset heading comparison, and defensive parsing
  of a stored `signals` blob.

### SEO audit — verdicts + one-click fixes (2026-08-09)
- **What it does:** the SEO tab used to render raw facts only ("Title: 78 chars")
  and never said whether any of it was GOOD or BAD. A verdict block now sits
  ABOVE the raw sections: four deterministic evaluators (indexing, social share
  card, page structure, URL) grade the page, rank every problem error-first, and
  ship each one with its fix. The evaluators are a byte-parity mirror of the
  canonical Python (`matrx_scraper/audit_metrics.py`) and of matrx-frontend's
  copy, so the extension, the web app, and the crawler give the same page the
  same verdict and the same wording.
- **Where to test:** SEO tab, on a live audit (not a saved snapshot).
- **Steps:**
  1. Open a page with no Open Graph tags (most docs/blog pages) → SEO tab → wait
     for the audit to auto-run.
  2. Read the pill at the top of the verdict block, then the grouped findings.
  3. Hover a finding → click the small robot icon.
  4. Go back to the SEO tab and click **Fix all** in the verdict header.
  5. Hover the **Social share card** heading → click the copy icon.
  6. Open a page with `<meta name="robots" content="noindex">` (any staging site,
     or a local page you can edit).
  7. Open a page whose `<link rel="canonical">` points at a DIFFERENT URL → click
     **Open** on that finding.
  8. Save the audit, then open it from the history chip.
- **Expected:**
  - The pill reads **Blocked from Google** / **N problems to fix** / **N things to
    improve** / **Looks good**, colored red / red / amber / emerald.
  - Findings are grouped under Indexing → Social share card → Page structure →
    URL, errors (octagon icon, red) before warnings (triangle, amber). A clean
    section shows a green line instead ("Google can index this page.").
  - The robot icon stages a message in the chat composer naming that one problem
    plus the page title and URL, and switches to the Chat tab. Existing draft text
    is preserved, not overwritten.
  - **Fix all** does the same with every finding listed, severity-tagged.
  - The copy icon copies the exact `<meta>` lines the page is missing, pre-filled
    from the page's own title / description / canonical — paste-ready for `<head>`.
  - Step 6: the pill says **Blocked from Google** and the finding reads "Meta
    robots contains noindex — Google is told not to index this page".
  - Step 7: **Open** opens the canonical URL in a NEW tab (middle-click and
    right-click → "Open in new tab" also work — it is a real anchor). The side
    panel never navigates away.
  - Step 8: a saved snapshot shows every raw section (including social preview and
    performance — a saved row has always persisted the whole audit) but NO verdict
    block. That is deliberate: `evaluateSeoAudit` takes a full `SeoAudit`, and a
    stored row parses to the narrower `StoredAuditSignals`, so it would be judging
    partial inputs.
- **Edge cases worth poking:**
  - A page with zero problems: the block collapses to one green "No problems
    found" line and the **Fix all** button is absent.
  - A page reached via a redirect: expect "URL redirects through N hop(s)".
    Cross-origin redirects without `Timing-Allow-Origin` report 0 hops — the
    browser hides the count, so this under-reports rather than inventing one.
  - `file://` or a page where Chrome hides the response status: expect the warning
    "HTTP status was not captured" rather than a fabricated 200.
  - A page with a blank `<h2>`: the "empty heading(s)" warning will NOT fire here.
    The collector drops empty headings before the evaluator sees them (mirroring
    the Python collector); the server-side crawl audit does report them.
  - Narrow the side panel to ~360px — messages wrap, the action icons stay
    reachable, nothing scrolls horizontally.
- **Automated:** `tests/unit/seo-evaluator-parity.test.ts` asserts all four
  evaluators produce output identical to the Python-generated fixture
  (`tests/unit/__fixtures__/audit-parity.json`, copied verbatim from
  matrx-frontend — never regenerate it here).

### SEO audit — AI recommendations (2026-08-09)
- **What it does:** the "AI recommendations" section used to render the developer
  TODO "Wire this up to /ai/agent/execute with an SEO prompt." It now sends the
  WHOLE audit object to an agent as one `page_seo_audit` context key and streams
  real, paste-ready recommendations into the panel. The run is ephemeral
  (`store: false`) — it never appears in your chat history.
- **Where to test:** SEO tab, on a live audit (not a saved snapshot).
- **Prereq:** signed in, with a default agent set (Settings → Default agent; a
  fresh install already points at the Matrx Browser Agent).
- **Steps:**
  1. Open any content page → SEO tab → wait for the audit to auto-run.
  2. Scroll to **AI recommendations** → click **Get recommendations**.
  3. Watch the section while it runs.
  4. When it finishes, click **Regenerate**, then the copy icon in the section header.
  5. Click the **by \<agent name\>** line in the footer.
  6. Navigate the tab to a different page and return to the SEO tab.
- **Expected:**
  - On click: a spinner with "Reading your audit…", then "Writing…" once the first
    text lands; markdown renders incrementally as it streams, and a **Stop** button
    sits beside the spinner.
  - The advice cites the real audit numbers (title length, missing-alt count,
    heading structure, word count) and gives replacement text you can paste.
  - On completion: the spinner is replaced by a footer naming the agent, plus
    **Regenerate**. The header copy button copies the markdown.
  - Clicking the agent name opens `aimatrx.com/agents/<id>` in a NEW tab — the
    audit and its recommendations are still there when you come back.
  - After navigating, the section is back to its idle "Get recommendations" state.
    Recommendations for the previous page are never shown next to a new audit.
  - Viewing a **saved snapshot** from history hides the section entirely — the
    agent is only ever asked about the live page.
- **Failure behavior (check this — it is the point of the feature):**
  - Kill your network, then click **Get recommendations**: within ~75s the section
    shows a red "The agent stopped responding. Try again." and a **Try again**
    button. It never spins forever and never silently shows an empty panel.
  - A server-side error renders the server's message in red with **Try again**.
  - A run that completes with no output reports "The agent returned nothing. Try
    again." rather than an empty section.
  - Click **Stop** mid-stream: the spinner clears and whatever streamed so far
    stays on screen with **Regenerate** available.
- **Edge cases worth poking:**
  - Narrow the side panel to ~360px — markdown wraps, code/tables scroll inside
    their own container, nothing scrolls the page horizontally.
  - Re-audit the same URL: the section resets to idle (the audit's `fetched_at`
    keys the component).
- **Automated:** `tests/unit/seo-recommendations-request.test.ts` pins the three
  fields aidream requires on a start request (`conversation_id` / `is_new` /
  `store: false`) and that the audit ships whole and untrimmed.

### SEO audit — every collected field is visible (2026-08-09)
- **What it does:** `runAudit` collects hreflang, `<html lang>`, og + twitter tags,
  schema.org types, internal/external link counts, sentence count, Flesch reading
  ease, and navigation timing. All of it was persisted to `extend.wbx_seo_audit`
  and shipped into agent context, and NONE of it was on screen — the link counts
  were computed and then thrown away at the render layer. The SEO tab now renders
  every field, grouped by question rather than by struct, and Copy carries them
  too. The Scrape tab's SEO panel renders through the same component.
- **Where to test:** SEO tab (and Scrape tab → **SEO** sub-tab, which must look
  identical).
- **Steps — use these specific pages, each one exercises a different group:**
  1. **Hreflang + lang** → `https://www.airbnb.com/` (ships ~60 `hreflang`
     alternates) or `https://www.wikipedia.org/`. Look for **International**.
  2. **Structured data** → `https://www.allrecipes.com/` (any recipe page — JSON-LD
     `Recipe`, `BreadcrumbList`, `NewsArticle`). Look for **Structured data**.
  3. **Social preview** → `https://github.com/` or any BBC/Guardian article
     (`og:title`, `og:image`, `twitter:card`). Look for **Social preview**.
  4. **Links + readability** → any long article, e.g. `https://en.wikipedia.org/wiki/SEO`.
  5. **No social tags** → `https://example.com/` (bare page, no og/twitter/schema).
  6. Click **Copy audit → Summary (text)** on page 1 and on page 5.
  7. Narrow the side panel to ~360px on page 1.
- **Expected:**
  - **International**: the `<html lang>` value, then one row per alternate —
    `fr`, `x-default`, … — each href a real link that opens in a NEW tab.
  - **Structured data**: one chip per type. Clicking `Recipe` opens
    `https://schema.org/Recipe`. A microdata `itemtype` (already a full URL) shows
    the short name but links to the full value.
  - **Social preview**: an actual share card — image, site name, title,
    description, and the `og:url` as a link — followed by the raw tag list, where
    every URL-valued tag (`og:image`, `og:url`) is clickable.
  - **Links**: **Internal** and **External** counts. This is the one that was
    computed and never shown at all.
  - **Readability**: the Flesch number AND its plain-English band, e.g.
    `64.2` + "Plain English — 8th–9th grade" (standard Flesch bands), plus word
    and sentence counts.
  - **Performance**: HTTP status, navigation type, redirect hops, load duration,
    transfer size — whichever the browser exposed.
  - Page 5: the International / Social preview / Structured data sections are
    **absent entirely** — not present-and-empty, not rows of `—` or `0`.
  - Step 6: the copied text contains `Page language:`, each `fr: https://…`,
    `og:title:`, `Structured data (N):`, `Internal links:`, `Sentences:`, and
    `Flesch reading ease: 64.2 (Plain English — 8th–9th grade)`. On page 5 those
    headings are absent rather than empty.
  - Step 7: nothing scrolls horizontally. Long URLs wrap mid-string, the share
    card image scales to the panel, chips wrap to new rows.
- **Edge cases worth poking:**
  - A page whose `og:image` is hotlink-blocked or 404s (common on staging): the
    card shows a labelled "Preview image failed to load" placeholder, never a
    broken-image glyph — and it still tells you the tag EXISTS.
  - A page with `javascript:void(0)` or a relative path in a meta tag: it renders
    as plain text, NOT as a link that goes nowhere.
  - Open a **saved snapshot** from the history chip: it shows the same groups. Rows
    saved before a field existed simply omit that group.
  - Scrape tab → SEO sub-tab on the same page: byte-for-byte the same sections.
    They are one component; if they differ, the duplicate has been reintroduced.
- **Automated:** `tests/unit/seo-display-fields.test.ts` pins the standard Flesch
  bands (including the inclusive-low boundaries and the out-of-0-100 tails), the
  openable-URL / schema.org door rules, and that `seoAuditToText` emits every field
  and omits empty groups.

### Stream — provider retry (no false "connection lost")
- **What it does:** when the upstream LLM provider rate-limits or 5xx's, the server
  backs off and retries. The stream goes silent for the backoff. The extension must
  keep the spinner up, hold the 75s stall watchdog, and tell the user what's
  happening — instead of declaring the run dead.
- **Where to test:** Chat tab.
- **Prereq:** hard to force naturally. Easiest repro is Debug tab → watch the stream
  log for a `provider_retry` event during a busy period; or ask the backend team to
  point an agent at a provider/model that is currently rate-limited.
- **Steps:**
  1. Send a message on an agent whose provider is rate-limiting.
  2. Watch for an amber banner above the composer.
- **Expected:** amber banner with the server's own message (e.g. "Anthropic is
  rate-limiting…"), the provider name, "attempt N of M", and a live "retrying in Xs"
  countdown. The spinner keeps spinning. When the retry lands, the banner disappears
  and the answer streams in normally.
- **Edge cases worth poking:**
  - A backoff LONGER than 75 seconds. This is the whole point: the old build showed
    a false "connection lost / Retry" banner here. It must NOT.
  - Retry that never lands → after the retry deadline plus 75s the normal stall
    banner SHOULD appear. The hold must not make the run un-killable.
  - Cancel the run mid-retry → banner clears with the run, does not linger.

### Stream — reasoning block boundaries
- **What it does:** the server now marks where a thinking block starts and stops, so
  two separate thinking blocks in one turn render as two blocks rather than merging.
- **Where to test:** Chat tab, with a reasoning-capable model.
- **Steps:**
  1. Ask something that makes the model think, call a tool, then think again.
  2. Expand the reasoning parts in the assistant bubble.
- **Expected:** two distinct reasoning parts, in stream order, not one merged block.

### Token broker — demo surface
- **What it does:** mints scoped short-lived credentials from aidream's token broker
  (`POST /broker/tokens`), shows the SW-owned credential cache, and runs a proxied
  Anthropic round-trip through the gateway (executed in the SW; the token never
  reaches the sidepanel).
- **Where to test:** admin sidepanel → Broker tab (KeyRound icon, cyan). Admin + signed in.
- **Prereq:** the target server must have `BROKER_TOKEN_SIGNING_KEY` + `public_url`
  configured (otherwise every mint shows the loud 503 card — which is itself a test).
- **Steps:**
  1. Pick audience `anthropic`, tier policy `none` (note: Mint is disabled until a
     tier is explicitly chosen — no default, by contract).
  2. Click **Mint (cached)** → green card: `proxied` / `anthropic_messages`, gateway
     endpoint URL, masked token tail, live expiry countdown. Cache list shows one row.
  3. Click **Mint (cached)** again → no new row / same token tail (cache hit).
     **Force fresh** → token tail changes.
  4. Mint audience `openai_realtime` with model `gpt-realtime` → `native_ephemeral`
     row with an OpenAI endpoint.
  5. In "Proxied test", send the default prompt → JSON result with the model's reply
     ("broker gateway OK").
  6. Trash-icon a cache row → it disappears; next mint re-mints.
- **Expected:** all of the above; tokens never appear anywhere in full (UI, logs,
  Debug tab), only 6-char tails.
- **Edge cases worth poking:**
  - Tier `guest` on the proxied test with a premium model → server rewrites the
    model (visible on Anthropic's response `model` field) — tier enforcement.
  - Signed out / guest → mint fails 401 (guests cannot mint in v1).
  - Backend env pointed at a host without the broker configured → 503 card with
    the "deploy problem — do not retry" copy, no silent fallback.

### Vault — side-panel password manager
- **What it does:** lists your saved logins (Mine + Shared with me) masked, surfaces
  the logins the SERVER approves for the current tab with a one-click **Use here**,
  reveals/copies a field on explicit request (auto-hides after 30s), toggles browser
  fill, adds the current page as a login URL, and creates a login from the page.
  Everyday management is here too: **Edit details** (name, login URLs, match rule,
  notes), **change** / **add** / **remove** a field value, and **Delete** the login.
  Sharing / transfer / ownership / attachments deliberately live on the web (`/vault`).
- **Where to test:** sidepanel → Vault tab (vault icon, between Screenshots and Tools).
  Signed in — the tab is hidden for guests and the panel refuses guest identity.
- **Prereq:** at least one `website_login` item in the Vault with `browser_fill_enabled`
  and a `login_urls` entry for the site you test on.
- **Steps:**
  1. Sign out (or use a guest profile) and open the Vault tab → sign-in prompt only;
     no list, and no request to `/api/vault/*` in the Debug tab.
  2. Sign in. Navigate to a saved site's https login page, open the Vault tab.
     The top strip shows the host and your matching login(s).
  3. Click **Use here** → the page fills and submits; the strip reports one of the
     fixed statuses (Signed in / verification step / challenge / rejected / …).
  4. Expand any item → fields show mask hints only. Click the eye → the value appears;
     wait 30s → it hides itself. Click copy → the value lands on the clipboard.
  5. Toggle **Browser fill** off → the item leaves the top strip. Toggle back on →
     it returns.
  6. On a page the item does not cover, expand it → **Use this login on &lt;host&gt;**;
     click it → the page is added and the item now appears in the top strip.
  7. On a login page with nothing saved → **Save this site** → fill name / username /
     password → **Save to Vault** → the new item appears in Mine and in the top strip.
  8. **Shared** tab → items others granted you; a shared item you cannot edit shows
     its fill switch disabled and no Edit / pencil / trash controls.
  9. Expand an item you own → pencil beside a field → type a new value → ✓ (or Enter)
     → the mask hint updates; reveal shows the NEW value; the old one is gone.
     Esc / ✕ discards the draft.
  10. **Add a field** → name `security_answer`, a value → **Add field** → a new masked
      row appears; a duplicate name is refused before any request.
  11. Trash beside a field → "Remove “…”? Yes, remove" → the row disappears.
  12. **Edit details** → change the name, add a second URL line, pick *Exact URL only*,
      write a note → **Save** → the row re-renders with the new name/URLs/note and the
      top strip re-resolves for the current page. An `http://` line is refused inline.
      Clearing every URL turns browser fill off.
  13. **Delete** → "Delete this login? Yes, delete" → the item leaves Mine and the
      top strip; reload confirms it is gone server-side.
- **Expected:** every value is masked until an explicit reveal; nothing you reveal
  survives a tab switch (leaving the Vault tab unmounts it); the Debug tab shows
  `→ POST vault/items/{item}/reveal` and `← vault reveal ok` but never a value; a
  changed/added value shows only `→ PUT vault/items/{item}/fields/{field}/value` /
  `→ POST vault/items/{item}/fields` with no body.
- **Edge cases worth poking:**
  - An http (non-loopback) page → "Browser login only runs on https pages", no matches
    fetched, and creating from that page attaches no site.
  - A sealed field → no eye/copy buttons and a "can never be shown" note.
  - Two matching logins on one page → both listed, each with its own **Use here**
    (the agent path returns `selection_required` in the same situation).
  - A login form with `method="get"`, or no method at all →
    `unsafe_destination / unsafe_get_form` before any Vault materialization or fill.
  - Sign out with the panel open → the next action reports
    "Sign in to Matrx to use the Vault".

### Agent-directed saved login (`credential_login`)
- **Where to test:** sidepanel → Tools → search `credential_login`, with an https login
  page assigned to the conversation and a matching Vault item. Signed in only.
- **Steps:**
  1. Run `discover` → exactly one candidate returns its safe field inventory (names,
     labels, fillability, and non-secret preset values), never any secret value.
  2. Run one `attempt` containing the complete field map, selectors, explicit submit
     action, and optional non-secret expectations. Use `field_key` for every Vault value.
  3. Confirm the result has a fixed status, verdict, bounded confidence, named boolean
     signals, sanitized before/after origin+path metadata, elapsed time, and
     `feedback.how_to_report`; it must contain no page text or field value.
  4. Run `report` with `kind: wrong_verdict`, a precise `where`, and the attempt id when
     present → `report_received` without any credential data in the request/result.
- **Expected:** malformed or partial attempts return `spec_incomplete` before filling;
  GET forms and unsafe destinations are refused; later-step fields may be filled after
  navigation, but all requested Vault fields are materialized atomically once.
- **Current boundary:** a local-Chrome TOTP/MFA step returns `needs_mfa` for human
  takeover. Delegated TOTP must wait for the server-to-local command channel so neither
  seed nor generated code is ever returned to the extension. Evidence is sanitized
  metadata only until local browser runs have a canonical artifact store.

### On-the-fly credential capture (`capture_credential` — D-11)
- **What it does:** the agent hits a login it has NO saved credential for and, instead
  of asking you to log in where it would see the password, asks the tool to CAPTURE one.
  A username/password box appears in chat; you type; the value is written to your Vault
  with the agent's metadata (site name, description, url, field map). **The agent never
  sees the value.** Known site → the agent gets the saved recipe; unknown site → the
  agent is asked to document a proposed recipe (a human activates it later).
- **Where to test:** chat (ask the agent to sign in to a site you have NO Vault item for)
  on the live Chrome-extension surface. Signed in only.
- **Steps:**
  1. On an https login page with nothing saved, have the agent call `capture_credential`.
  2. A "Save a login for &lt;host&gt;" card appears with the fields the agent named.
  3. Type the username + password → **Save & continue**.
  4. The agent receives `{status:'captured', credential_item_id, proceed:true}` and signs in.
  5. Open the Vault tab → the new item is in Mine with browser fill on and the login URL set.
- **Expected:** the value is masked in the box, never appears in the chat transcript, the
  tool result, or the Debug log (only `→ POST vault/browser-login/capture` with no value
  echoed); the receipt the agent shows carries the item id + field KEYS only. An unknown
  site's receipt asks the agent to propose a recipe.
- **Edge cases worth poking:** http (non-loopback) page → `unsafe_destination`, no card
  shown; Cancel on the card → the agent gets `cancelled`, nothing written; the agent
  cannot supply a value (the schema has no value field).

### Save this login? — page-driven Vault capture (no agent)
- **What it does:** when you sign in to a site yourself (submit a form with a password,
  press Enter in a password box, or click its Sign-in button), the extension offers to
  save that login to your Vault — like a password manager. A small card appears on the
  page (top-right) AND at the top of the Vault tab: **Save** (new login), **Update
  &lt;name&gt;** (a saved login already covers this site), **Not now**, **Never for this
  site**. Nothing is saved without a click. Signed in only; the prompt is on by default
  and can be turned off in Settings → Privacy → "Offer to save logins to the Vault".
- **Where to test:** any https login page (a test account on a site you own, or a
  synthetic credential) with the extension signed in.
- **Steps:**
  1. Go to an https login page with NO saved login for that site. Sign in normally.
  2. After the page settles, the on-page card says "Save this login to your Matrx
     Vault?" with the host and the username you typed. Click **Save** → "Saved to your
     Vault." → open the Vault tab → the item is in Mine, fill on, login URL set.
  3. Sign out of the site and sign in again with a DIFFERENT password → the card now
     offers **Update &lt;item name&gt;** and **Save as new**. Click Update → reveal the
     password field in the Vault tab → it is the new value.
  4. Dismiss the on-page card (**Not now**) → nothing saved; the Vault-tab card is
     gone too. Sign in again, this time open the side panel first → the same offer sits
     at the top of the Vault tab; Save from there works identically.
  5. **Never for this site** → no more prompts on that origin; Settings → Privacy lists
     it under "Never ask on these sites" with **Ask again**.
  6. Turn the Privacy toggle off → sign in anywhere → no card anywhere.
  7. Sign out of Matrx → sign in to a site → no card (the Vault rejects guests).
- **Expected:** the Debug tab shows `← receive credential-capture:decision` /
  `credential-capture:status` / `↗ broadcast credential-capture:changed` with host /
  username / item names only, and `→ POST vault/items` / `→ PUT vault/items/{item}/
  fields/{field}/value` with no body — the password NEVER appears in the Debug log, a
  broadcast, chrome.storage, or the side panel. Do nothing for 3 minutes → the offer
  expires ("no longer available to save").
- **Edge cases worth poking:** an `http://` login (non-loopback) → no card ever; a
  form that submits with GET → no card; a change-password form (two different password
  values) → no card; a sign-up form (password + matching confirm) → card; a one-time
  code box → no card; a two-step login (username on the previous screen) → card with
  host only (or the hidden identifier if the site keeps one). The on-page card hides
  itself after ~25s but the Vault-tab offer stays until the 3-minute expiry.

### Capture study set (`capture_study_set` — education, IC-11)
- **What it does:** one-click import of the study set on the current page (a Quizlet set, a
  definition list, or a two-column table) into a native AI Matrx flashcard deck through the
  platform's one import door (`edu_import_deck` RPC).
- **Where to test:** chat (ask the agent), or right-click on a quizlet.com page →
  "Save this study set to Matrx".
- **Prereq:** signed in to commit (preview works signed out... it extracts locally).
- **Steps:**
  1. Open any public Quizlet set. Right-click → **Save this study set to Matrx** — the side
     panel opens with a drafted preview-first instruction.
  2. Send it. The agent runs `preview`: expect deck name, card count, and a 5-card sample —
     nothing written yet.
  3. Confirm. The agent runs `capture`: expect the new deck's name + open link
     (`aimatrx.com/education/flashcards/<id>`), and the deck appears in the web app with the
     cards in order.
  4. On a page with a plain `<dl>` or 2-column table (e.g. a glossary), ask "save this page
     as a study set" in chat — same flow via the DOM fallback.
- **Expected:** preview writes nothing (tier `read`); capture asks for approval (tier
  `action`); the chat row names the deck; the deck lands with membership edges intact (cards
  render in the web app immediately).
- **Edge cases worth poking:**
  - Signed out + capture → "Sign in to AI Matrx to save this study set", nothing written.
  - A page with no term data → `nothing_found` with an honest reason.
  - A Quizlet page whose hydration shape changed → DOM fallback may still find pairs; if
    not, the error names both strategies.

### Reviewed Gmail send (`google_email_send` — productivity)
- **What it does:** the agent composes ONE email and stops. A review card shows the sender
  account, To, Cc, Subject and Message — all editable — and the message is sent only when the
  user presses Send, with the fields as they stand at that moment. The tool has no server
  executor anywhere in the platform: this card is the only way a message can leave the mailbox.
- **Where to test:** chat. Ask "email jane@example.com asking to reschedule Thursday".
- **Prereq:** signed in, with a Google account connected that has `gmail.send`
  (aimatrx.com → Settings → Integrations → Google Workspace).
- **Steps:**
  1. Ask the agent to email someone. Expect a **Review before sending** card with the subject
     as its title and "From <your account>" beneath it. Nothing has been sent.
  2. Edit the body (and/or To / Cc / Subject). Press **Send**. Expect the card to disappear and
     the chat row to read "Email to <recipient>" — and the message to be in Gmail's Sent
     folder with YOUR edits, not the agent's original wording.
  3. Ask again, then press **Don't send**. Expect the agent to be told you declined and to
     carry on normally — this is not an error.
- **Expected:** no send without a click; no "always send" / "remember this" affordance
  anywhere on the card; the tool result reports `edited: true` when you changed anything.
- **Edge cases worth poking:**
  - Signed out → "Sign in to AI Matrx to send from your connected Google account", no card.
  - Signed in with no Google account connected (or one without `gmail.send`) → a refusal
    naming Settings → Integrations → Google Workspace, no card.
  - **Make the send fail** (disconnect the account in another tab, then press Send) → the card
    STAYS OPEN, shows the error plus "Nothing was sent", and the agent is not told it sent.
  - Dismiss the card → the agent sees `cancelled`, not a decline and not a send.
  - Leave the card for 15 minutes → it disappears and the run reports `cancelled`.

### Google Workspace (`google_workspace` — server-executed)
- **What it does:** Docs/Sheets work on files the user picked or AI Matrx created. It runs on
  aidream, not in the extension — only its chat row is defined here.
- **Where to test:** chat. "Make me a Google Doc called Notes with today's summary."
- **Expected:** the row reads "Google Workspace — Create Document" (the ACTION, not a generic
  label) and the result renders as fields, not raw JSON. Nothing in the extension executes it.

### Structured content rendering (Content IR kinds)
- **What it does:** renders server-built `render_block` envelopes through the shared
  Content IR components instead of discarding them. Registered kinds draw as real
  components; everything else lands on the generic structured floor.
- **Where to test:** Side panel → Chat tab.
- **Prereq:** signed in (the registries read `content_ir` with the user's session).
- **Steps:**
  1. Pick an agent that produces structured output and ask for something that
     yields a registered kind — e.g. "make me 5 flashcards about photosynthesis"
     (`flashcard_set`) or "search the web for X" (`web_search_results`).
  2. Watch the reply as it streams.
- **Expected:** the deck renders as a list of cards you can click to reveal the
  answer (not a JSON fence, not raw text); a search renders as a compact list of
  titled links with domains. A quiz renders as answerable choices with the correct
  answer hidden until you pick.
- **Edge cases worth poking:**
  - Ask for a kind with NO extension component (e.g. a research report). It must
    render as a readable document with a muted "no custom view yet" footer and a
    collapsed "Raw data" escape hatch — never an error, never a blank block.
  - Nothing should render twice: if the answer appears both as a component AND as
    a raw JSON fence, block-mode chunk suppression has regressed
    (`appendAssistantText` in `src/state/chat.ts`).
  - Open the Debug tab and filter source `ui`: a malformed envelope must appear as
    a `[content-ir]` scream, never silence.
  - Copy the reply ("With everything"): a structured block copies as
    `<kind name="…">` with its zero-loss JSON, `__kind` included.

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
