# Proposed Tools & Features

> Curated 2026-05-05. The 15 ideas below came out of a brainstorm on what
> the harness is missing. **All 15 are committed to ship**, but not all of
> them are agent tools — some are user-facing UI features, some are pure
> agent capabilities, and several are both. This doc is the source of
> truth for which is which and what each will look like.

## How to read this doc

Each entry has:
- **Surface** — `agent-tool`, `ui-feature`, or `both`
- **Why it's not just one or the other** — the line is blurry; we're
  explicit so we don't accidentally double-build or under-build
- **Sketch** — the smallest viable form
- **Dependencies / status** — links to existing surfaces it should
  integrate with

The order is roughly priority. Tier 1 is "must ship next." Tier 2 fills
real gaps. Tier 3 is high-leverage but more niche.

---

## Tier 1 — would change what tasks the harness can do

### 1. `record_demo` + `replay_demo` ✅ SHIPPED 2026-05-05
- **Surface:** `both` (heavy agent tool, light UI for save/manage flow)
- **Why both:** the recording itself is captured automatically by content
  scripts during a user demonstration — no UI dance needed. But saving,
  naming, parameterizing, listing, and deleting demos benefits from a
  small UI. The agent calls `record_demo({action:"start"})` to kick off,
  then `record_demo({action:"stop"})` once the user's done. The agent can
  also coach the user through a recording without any extra UI: chat *is*
  the UI for the simple path.
- **Sketch:**
  - Recorder = content script registered on `<all_urls>` at runtime,
    listens to click / input / change / submit / keydown(Enter) / popstate
    / scroll(debounced); posts each event to SW with tab_id + stable
    selector strategies.
  - Selector chain (best→worst): `data-matrx-ref` (recording-only) →
    `#id` (heuristic on stable IDs) → `[data-testid]` →
    ARIA role + accessible-name → tag + visible text → ancestral CSS path
    (capped at 4 levels).
  - Storage = `chrome.storage.local` under `matrx.demos.list` (summaries)
    and `matrx.demos.{id}` (full step list). Supabase persistence is a
    later upgrade.
  - Replay = opens `start_url`, then per step: switch tab, resolve
    selector via best-available strategy, dispatch the action, wait for
    nav-if-needed. Self-healing falls back through the selector chain.
    LLM-fallback is an explicit next iteration.
  - Parameters = at save time the agent (or UI) marks specific typed
    values as `{{name}}` placeholders; replay substitutes from `params`.
  - Agent tools: `record_demo({action})`, `list_demos`, `describe_demo`,
    `replay_demo({demo_id, params, tab_id?})`, `delete_demo`.
- **Dependencies:** existing `data-matrx-ref` system from `read_page`,
  the dispatcher's tool-event hook (we already use that for record_gif).
- **Status:** in progress (see roadmap section 5 — this is the canonical
  implementation of "self-healing selectors + deterministic replay").

### 2. `extract_table` ✅ SHIPPED 2026-05-05
- **Surface:** `agent-tool` (with optional Data-tab integration later)
- **Why agent-only:** the user already has the Data tab for picking and
  applying patterns interactively. The agent needs a one-shot, structured
  call that handles `<table>`, multi-row headers, rowspans, colspans, and
  div-based grids. The Data tab can later add a "extract this table"
  button that wraps the same handler.
- **Sketch:** `extract_table({ref OR selector, normalize_headers?, max_rows?})`
  → `{columns: [{path: ["Q1", "Revenue"]}], rows: [{cells: [...]}], merged_cells: [...]}`.
  Handles ARIA `role="grid"` cells too.

### 3. `watch_for_change`
- **Surface:** `both`
- **Why both:** scheduling and orchestration already live in the Agenda
  tab — that's the natural home for "active watches." Agent tools create,
  list, and cancel watches; the Agenda tab visualizes them.
- **Sketch:**
  - Agent tools: `watch_for_change({url, condition})` →
    `{watch_id, next_check_at}`. Conditions: text appears/disappears, CSS
    selector text matches predicate, numeric value crosses threshold.
  - Backend: persist as an `agenda_task` with kind `watch`. Agenda alarm
    re-opens the URL (or fetches via `fetch_url_as_markdown`), evaluates
    the predicate, fires a chat message + Chrome notification on hit.
  - UI: existing Agenda tab gets a "Watches" subsection (filters tasks
    by kind).

### 4. `screenshot_region` ✅ SHIPPED 2026-05-05
- **Surface:** `agent-tool`
- **Why agent-only:** purely a token-efficient cropping primitive for
  vision-API consumption. No UI value — Tools tab can already exercise
  any handler manually.
- **Sketch:** `screenshot_region({ref OR rect: {x,y,w,h}, profile?})` →
  same `{file_id, file_url, ...}` envelope as `take_screenshot`. Uses
  `chrome.tabs.captureVisibleTab` + canvas crop; admin path can use CDP
  `Page.captureScreenshot({clip})` for off-viewport regions.

### 5. `accessibility_audit`
- **Surface:** `both`
- **Why both:** the SEO tab already runs an audit and surfaces AI
  recommendations — accessibility is a natural sibling section there.
  The agent should also be able to call this directly to e.g. file
  bug tickets from a chat.
- **Sketch:**
  - Inject a bundled axe-core (~120 KB) via content script; run it;
    return `{violations: [{rule, severity, help_url, nodes:
    [{ref, html_excerpt}]}], total_nodes_audited}`.
  - SEO tab gets an "Accessibility" tab/section that renders the same
    structure with click-through to ref-targeted screenshots.

---

## Tier 2 — fills real gaps in the current kit

### 6. `get_clipboard`
- **Surface:** `agent-tool`
- **Why agent-only:** users already have OS-level paste. The agent
  needs the inverse of `set_clipboard` for "use whatever the user
  copied" workflows.
- **Sketch:** `get_clipboard()` → `{text}` (or `{mime_type, base64}` for
  images). Requires `clipboardRead` permission. Action tier (one-time
  consent per conversation, then auto-allowed).

### 7. `smart_form_fill`
- **Surface:** `agent-tool`
- **Why agent-only:** the user already has a form filler in the OS
  (autofill); this is for agents to fill forms from a JSON payload.
- **Sketch:** `smart_form_fill({form_ref OR selector, payload, mode:
  "label-similarity"|"strict"})` → `{filled: [...], skipped: [...],
  required_unmapped: [...]}`. Calls the existing per-field handlers
  internally so a 12-field form turns into 1 agent call instead of 12.
  Handles dependent dropdowns by re-reading the form between fields.

### 8. `mutation_watch`
- **Surface:** `agent-tool`
- **Why agent-only:** no user value — it's an internal helper for the
  agent to wait on async UI without specifying a brittle `wait_for`
  predicate.
- **Sketch:** `mutation_watch({ref, duration_ms, kinds?: ["text",
  "attributes", "children", "visibility"]})` → `{events: [{ts_ms,
  kind, before, after}]}`. Implemented via `MutationObserver` injected
  into the page.

### 9. `compare_screenshots`
- **Surface:** `both`
- **Why both:** the Scrape tab (or a future QA tab) can render a
  side-by-side diff. The agent uses the same primitive for "did the
  layout change after my action?" and visual-regression tasks.
- **Sketch:** `compare_screenshots({file_id_a, file_id_b,
  threshold?})` → `{pixels_changed, regions_changed: [{x,y,w,h,
  severity}], heatmap_file_id}`. Implementation: decode both to RGBA,
  diff per-pixel with a tolerance, cluster changed pixels into
  bounding boxes, emit a heatmap PNG.

### 10. `record_video`
- **Surface:** `both`
- **Why both:** parallels `record_gif` exactly. UI value is real for
  bug reports + demos (downloadable video). Agent value is the same
  shape as `record_gif` but with audio + better quality.
- **Sketch:** swap GIF encoder for `MediaRecorder` over
  `chrome.tabCapture` (or `getDisplayMedia`); same `start/stop/export`
  surface. Output WebM by default, optional MP4 via remux.

---

## Tier 3 — high-leverage but more niche

### 11. `shadow_dom_resolve`
- **Surface:** `agent-tool`
- **Why agent-only:** purely an internal mechanism that fixes a class
  of "click did nothing" failures on web-component pages.
- **Sketch:** `shadow_dom_resolve({selector_or_text})` → `{ref, path:
  [host_selector, ":host /shadow/", inner_selector]}`. Walks every
  shadow root and returns a path the action handlers can replay.
  Optionally enhance the existing `read_page` ref system to know about
  shadow boundaries so this becomes implicit.

### 12. `extract_microdata`
- **Surface:** `agent-tool`
- **Why agent-only:** the Scrape tab is where a human captures and
  inspects structured data interactively. The agent needs a one-call
  primitive that bundles JSON-LD + Microdata + RDFa + OpenGraph. The
  v2 context bundle (`page_structured_data`) covers this when the URL
  is the active tab; the tool form lets the agent fetch this for any
  URL without navigating.
- **Sketch:** `extract_microdata({url?})` (defaults to active tab) →
  `{json_ld: [...], microdata: [...], rdfa: [...], open_graph: {...},
  schema_org_types: ["Product", "BreadcrumbList"]}`.

### 13. `fetch_url_as_markdown`
- **Surface:** `both`
- **Why both:** the Scrape tab already captures the active page to
  Markdown. The agent needs the same pipeline against arbitrary URLs
  without opening a tab — for RSS feeds, sitemaps, JSON endpoints, and
  paywalled-but-logged-in content. Could also be a UI utility ("save
  this URL as Markdown").
- **Sketch:** `fetch_url_as_markdown({url, follow_redirects?,
  use_session?})` → `{title, markdown, metadata, http_status,
  word_count}`. Reuses `defuddle` + `@mozilla/readability` + `turndown`
  (already deps).

### 14. `request_user_paste_image`
- **Surface:** `ui-feature` (with a thin agent-side trigger)
- **Why mostly UI:** the value is the chat-side drop/paste affordance.
  The agent tool just opens that affordance; the action happens in the
  side panel.
- **Sketch:** agent calls `request_user_paste_image({prompt})`. Side
  panel renders a paste-target widget in the conversation. User
  pastes/drops an image; we upload to `cld_files` and post a
  tool-result with `{file_id, file_url}` for the agent to consume.

### 15. `tab_audio_inspect`
- **Surface:** `agent-tool`
- **Why agent-only:** purely diagnostic. "Find the noisy tab" is
  doable from the Tabs tab visually; agents need a structured query.
- **Sketch:** `tab_audio_inspect()` → `{audible_tabs: [{id, title, url,
  audible, muted, last_audible_at}], muted_tabs: [...]}`. Mostly a
  wrapper around `chrome.tabs.query({audible: true})` plus history
  from a small SW-side audio-event log.

---

## Build order

Hard committed:
1. ✅ **Demo system (item 1)** — shipped. 5 agent tools, full
   record/replay engine, self-healing selector chain, sensitive-field
   auto-parameterization. See [demo-system-design-notes.md](./demo-system-design-notes.md).
2. ✅ `extract_table` — shipped. Native `<table>` + ARIA `role=table` /
   `role=grid`, full rowspan/colspan/multi-row-header support via 2D
   virtual-grid resolution.
3. ✅ `screenshot_region` — shipped. Ref / selector / rect → cropped
   screenshot in same envelope as `take_screenshot`. Auto-scrolls
   off-viewport elements into view, DPR-aware crop.
4. **Up next: `accessibility_audit`** — pair with the SEO tab work.
5. `watch_for_change` — pair with the Agenda tab.

Then the rest of Tier 2 + Tier 3, in roughly the order above.

## File-organization conventions

- New agent-tool handlers → `src/lib/tools/handlers/<name>.ts`
- Tool-shared infrastructure → `src/lib/<domain>/` (e.g.
  `src/lib/demos/`, `src/lib/recording/`)
- New UI surfaces → `src/features/<domain>/` and a tab entry in the
  side panel layout
- Each tool needs: registry entry, category mapping, catalog permissions
  row, optional content-script entrypoint if it observes the page
- Always update `.research/<feature>-design-notes.md` for non-obvious
  decisions; reference it from each main file's header
