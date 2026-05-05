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
