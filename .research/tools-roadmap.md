# Tools Roadmap — working backlog

> Companion to [proposed-tools-and-features.md](./proposed-tools-and-features.md).
> That file is the master spec (rationale + sketches). **This file is the
> tracker** — current focus, queue order, sub-tasks per item, notes that
> accumulate as we work, and a scratchpad for ideas we don't want to lose.
>
> Update rules:
> - Status moves through: `queued` → `in-progress` → `expanded` (when we
>   spend extra time on it) → `shipped`.
> - When a related idea comes up while building an item, log it as a
>   sub-task under that item OR drop it into the Scratchpad.
> - When we ship, move the entry to "Shipped" with a one-line summary +
>   pointer to its design-notes doc.

---

## 🎯 Current focus
**Powering through the queue, a few items per turn.**

Each turn:
1. Pick 2–3 items from the queue based on size + leverage.
2. Build, typecheck, wire to registry/categories/catalog.
3. Update this doc — promote to "Recently shipped" with a one-line
   summary and pointer to the source / design-notes.
4. Surface clear test instructions to the user.
5. Propose what to do next turn.

---

## 📋 Queue (next up, in order)

### 1. `accessibility_audit` — Tier 1
- **Surface:** `both` (agent tool + section in the SEO tab)
- **Sketch:** inject bundled axe-core (~120 KB), return
  `{violations: [{rule, severity, help_url, nodes: [{ref, html_excerpt}]}],
  total_nodes_audited}`. SEO tab gets an "Accessibility" subsection.
- **Sub-tasks:**
  - [ ] Vendor axe-core into the extension build (decide: run-time fetch
    vs. pin a copy to git)
  - [ ] Decide injection mode: `chrome.scripting.executeScript({world:
    'MAIN'})` so axe sees the live DOM, vs. ISOLATED-world
  - [ ] Map axe's `target` (CSS selector chain) onto our `data-matrx-ref`
    system so the agent can act on flagged nodes
  - [ ] SEO tab UI section
- **Open questions:**
  - Do we want axe's full ruleset or a pruned set (WCAG 2.1 AA only)?
  - Should the audit also persist per-domain so we can show a trend
    line in the SEO tab?
- **Related future ideas:** Lighthouse runner; image-alt auditor that
  uses `ai_describe_image` to suggest alt text for missing ones.

### 2. `watch_for_change` — Tier 1
- **Surface:** `both` (agent tools + Agenda tab "Watches" section)
- **Sketch:** persist as an `agenda_task` with `kind: 'watch'`.
  Agent tools: `watch_for_change({url, condition})`,
  `list_watches`, `cancel_watch`. Conditions: text-appears,
  text-disappears, css-selector-contains, numeric-threshold-crossed.
- **Sub-tasks:**
  - [ ] Extend `agenda_task` schema with a `condition_json` column
  - [ ] Predicate evaluator (text/regex/numeric) lives in
    `src/lib/agenda/conditions.ts`
  - [ ] Decide: re-open the URL in a tab vs. server-side fetch vs.
    `fetch_url_as_markdown` (depends on item #11 below)
  - [ ] Agenda tab UI: filter chip for `kind=watch`; per-watch detail
    page showing eval history
  - [ ] Notification: chat message + Chrome notification on hit
- **Open questions:**
  - Cookie/auth scoping for "logged-in price" watches
  - Rate-limit: how aggressively can we re-check without burning
    bandwidth or tripping rate limits?

### 3. `smart_form_fill` — Tier 2
- **Surface:** `agent-tool` only
- **Sketch:** `smart_form_fill({form_ref OR selector, payload, mode:
  "label-similarity" | "strict"})` → `{filled, skipped,
  required_unmapped}`. Calls per-field handlers internally.
- **Sub-tasks:**
  - [ ] Label-similarity matcher: normalize label text, do
    Levenshtein + token-overlap, threshold-based pick
  - [ ] Dependent-dropdown handling: re-read form between
    fields when an earlier select fires a network call
  - [ ] Sensitive-field detection: refuse plaintext password mapping
    unless caller passes `accept_sensitive: true` and the value comes
    from `ask_user_secret`
- **Open questions:**
  - Should this pair with the demo system? "Fill the form like demo X
    did, but with this payload."

### 4. `compare_screenshots` — Tier 2
- **Surface:** `both`
- **Sketch:** `compare_screenshots({file_id_a, file_id_b, threshold?})`
  → `{pixels_changed, regions_changed: [{x,y,w,h,severity}],
  heatmap_file_id}`.
- **Sub-tasks:**
  - [ ] Decode both via `createImageBitmap`, draw to OffscreenCanvas,
    pixel-diff with tolerance
  - [ ] Cluster changed pixels into bounding boxes (connected-components)
  - [ ] Emit a heatmap PNG, upload to cld_files, return file_id
  - [ ] Optional UI: side-by-side diff viewer in a new "QA" tab or as
    part of the Tools tab
- **Open questions:**
  - Anti-aliased text always shows up as noise — do we want
    SSIM-style tolerance or just a percentage threshold?

### 5. `record_video` — Tier 2
- **Surface:** `both`
- **Sketch:** swap GIF encoder for `MediaRecorder` over
  `chrome.tabCapture` (or `getDisplayMedia`); same `start/stop/export`
  surface as `record_gif`. WebM by default, optional MP4 via remux.
- **Sub-tasks:**
  - [ ] Permission audit: `tabCapture` permission required
  - [ ] Audio support: opt-in flag (mic + system audio)
  - [ ] Reuse the recording state holder pattern from `record_gif`
  - [ ] Optionally share the click/drag/label overlay system
- **Open questions:**
  - Can we share the overlay compositor by rendering overlays into a
    canvas that's mixed into the MediaRecorder stream?

### 6. `shadow_dom_resolve` — Tier 3
- **Surface:** `agent-tool` only (internal mechanism)
- **Sketch:** `shadow_dom_resolve({selector_or_text})` → `{ref, path:
  [host_selector, ":host /shadow/", inner_selector]}`. Walks every
  shadow root and returns a path the action handlers can replay.
- **Sub-tasks:**
  - [ ] Decide whether to make this a standalone tool or fold the
    capability into `read_page` / `find` so it's implicit
  - [ ] Handle nested shadow roots (e.g. component-in-component)
- **Notes:** also fixes a gap in the demo system (its capture
  function only sees light-DOM ancestors).

### 7. ~~`fetch_url_as_markdown`~~ ✅ SHIPPED 2026-05-05
Moved to "Recently shipped" below.

### 7. `request_user_paste_image` — Tier 3
- **Surface:** mostly `ui-feature` with thin agent-side trigger
- **Sketch:** agent calls
  `request_user_paste_image({prompt})`. Side panel renders a
  paste-target widget in the conversation. User pastes/drops an image;
  upload to cld_files; post a tool-result with `{file_id, file_url}`.
- **Sub-tasks:**
  - [ ] Side-panel widget component (drop zone + paste handler)
  - [ ] Tool-result wiring follows the `ask_user_secret` precedent
- **Open questions:**
  - Allow video / PDF too, or images only?

---

## ✅ Recently shipped

### `extract_microdata` — 2026-05-05
Single agent tool returning every structured-data signal on the active
page in one call: snapshot (title / OG / Twitter / canonical), every
JSON-LD block (with `@graph` flattening), every Schema.org microdata
item, and a sorted union of all detected `@type` / `itemtype` names.

**Cross-working achieved:** the tool is a thin wrapper over the same
`src/lib/data-pattern/modes/{json_ld,microdata,og_meta}` extractors that
the user-facing Showcase tab's JsonLdTab / MicrodataTab / SnapshotTab
already use. One code path → improvements to either side flow both ways.

Files: [src/lib/tools/handlers/microdata.ts](../src/lib/tools/handlers/microdata.ts).

### `get_clipboard` + `tab_audio_inspect` + `mutation_watch` — 2026-05-05
Three small high-leverage utilities bundled in
[src/lib/tools/handlers/extras.ts](../src/lib/tools/handlers/extras.ts).

- **`get_clipboard`** — read the system clipboard (inverse of
  `set_clipboard`). Tier `action`, requires the new `clipboardRead`
  optional permission. Auto-trim + `max_chars` cap. Uses
  `executeScript({world: 'MAIN'})` against the active tab; returns a
  clear "page may need focus" hint if the browser denies the read.
- **`tab_audio_inspect`** — diagnostic listing of audible / muted /
  recently-audible tabs. Pure SW; backed by a tiny event log in
  [src/lib/audio/audible-log.ts](../src/lib/audio/audible-log.ts) that
  hooks `chrome.tabs.onUpdated` for the `audible` field.
- **`mutation_watch`** — observe an element for `duration_ms` (cap
  30 s), report changes by kind (`text`, `attributes`, `children`,
  `visibility`). Uses `MutationObserver` + `IntersectionObserver`
  inside the page; replaces brittle `wait_for + read_page` polling.

Wiring touches: registry (new `extras_handlers` block), categories
(get_clipboard → `files`, tab_audio_inspect → `tabs`, mutation_watch
→ `page`), catalog permissions, [wxt.config.ts](../wxt.config.ts)
optional_permissions (added `clipboardRead`),
[src/lib/permissions/optional.ts](../src/lib/permissions/optional.ts)
union + labels (Settings UI auto-enumerates so the toggle appears
without further wiring), bootstrap (started `audible-log` so timestamps
accumulate from SW startup).

### `extract_table` — 2026-05-05
- 2D virtual-grid resolver with rowspan/colspan; native `<table>` and
  ARIA `role="table"` / `role="grid"`; multi-row header path
  computation.
- Files: [src/lib/tools/handlers/extract.ts](../src/lib/tools/handlers/extract.ts)
- **Active follow-on work:** see "Current focus" above. Notes will
  collect here as we expand on it.

### `screenshot_region` — 2026-05-05
- Ref / selector / rect → cropped viewport capture; auto-scrolls
  off-viewport elements into view; DPR-aware crop; same envelope as
  `take_screenshot`.
- Files: [src/lib/tools/handlers/extract.ts](../src/lib/tools/handlers/extract.ts)

### Demo system — `record_demo` + `replay_demo` + `list_demos` + `describe_demo` + `delete_demo` — 2026-05-05
- 5 agent tools, full record/replay engine, self-healing 7-tier
  selector chain, sensitive-field auto-parameterization,
  privileged replay tier with `dry_run` mode.
- Files: [src/lib/demos/](../src/lib/demos/) + [src/lib/tools/handlers/demos.ts](../src/lib/tools/handlers/demos.ts)
- Design notes: [demo-system-design-notes.md](./demo-system-design-notes.md)

### `record_gif` — 2026-05-05
- CDP screencast recording → self-contained GIF89a encoder
  (NeuQuant + LZW) → cld_files upload → drop-on-element OR
  download. Click / drag / label / progress / watermark overlays.
- Files: [src/lib/recording/](../src/lib/recording/) + [src/lib/tools/handlers/record.ts](../src/lib/tools/handlers/record.ts)
- Design notes: [record-gif-design-notes.md](./record-gif-design-notes.md)

---

## 🧪 Scratchpad — ideas not yet committed

Capture half-formed ideas here so they don't get lost. When one
crystallizes, promote it into the Queue with a sketch + sub-tasks.

- **`replay_demo` LLM-fallback recovery:** when all selector strategies
  miss, hand the `element_snapshot` + a fresh page snapshot to Gemini
  Nano with "find the element that looks like THIS." (Originally listed
  as future work in demo-system-design-notes; promoting if it gets
  prioritized.)
- **Visual UI for demos:** side-panel tab listing saved demos with
  inline replay/edit/delete + a record button in the chat header.
  Right now the only UI is the agent's conversational coaching.
- **`extract_table` → CSV / Markdown export helper:** the JSON shape
  is great for agents but humans often want CSV. Could be a sibling
  tool `table_to_csv({table_json})` or a flag on `extract_table`.
- **`extract_table` → pagination follower:** detect "next page" links
  on a list page and aggregate tables across pages into one result.
  Pairs with item #10 (`fetch_url_as_markdown`) for fetching subsequent
  pages without leaving the current tab.
- **`smart_paginate`** (related to above): generic auto-follow N pages
  of any list page, aggregating items. Originally in the brainstorm
  but didn't make the top 15 — keep in scratchpad.
- **Cross-extension demo sharing:** export a saved demo as a portable
  JSON bundle that another matrx user can import. Useful for "here's
  how to do this workflow" templates.
- **Demo LLM-recorded narration:** while the user demonstrates, the
  agent can ask Gemini Nano to caption each step. Saved as part of the
  demo description.
- **`extract_table` semantic validation:** when a column header is
  e.g. "Price", run cell values through a number/currency validator
  and flag rows where parsing fails — useful for QA and data import.
