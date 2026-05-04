# 2026-05-03 — Proposed Tools vs Current Extension

Compares [docs/proposed_browser_tools.json](../docs/proposed_browser_tools.json)
(15 tools) against the extension's current 106 registered handlers
(plus ~14 generated discovery tools).

The proposal is a **drastic consolidation**: it collapses many of our
specific verbs into a small number of polymorphic mega-tools (notably
`computer` and `form_input`). Several of our tools have no counterpart
because they were never intended for general agents (CDP, on-device
AI, optional-perm tools).

---

## TL;DR

- **Direct or near-direct matches**: 6 tools — pure rename / arg shape
  changes. Lowest-risk.
- **Mega-tool merges**: ~16 of our tools collapse into the proposal's 2
  mega-tools (`computer`, `form_input`). This is the biggest semantic
  change.
- **Tools we have, proposal lacks**: ~88. Most are intentionally
  excluded (admin-only CDP, on-device AI, ask-user variants, memory,
  optional-perm wrappers); a smaller set are real holes the proposal
  may want to add.
- **Tools proposal has, we lack**: 4. We need to build these.
- **Cross-cutting**: every proposal tool has an explicit `tabId`
  parameter; every extension tool implicitly uses the active tab. This
  is a contract change that touches every handler.

---

## 1. Direct or near-direct matches (low-risk renames / arg shape)

| Proposal       | Extension              | Δ                                                            |
|----------------|------------------------|--------------------------------------------------------------|
| `read_page`    | `read_page`            | Same name. Add `depth`, `filter:'interactive'\|'all'`, `ref_id`, `max_chars`, `tabId`. Today we don't have depth/filter/ref_id focus. |
| `find`         | `find`                 | Same name. Proposal adds `tabId`. Drop our optional schema-arg if any. |
| `get_page_text`| `get_page_text`        | Same name. Add `tabId`, `max_chars`. |
| `browser_batch`| `browser_batch`        | Same name. Proposal allows write-tier calls inside; ours is read-only-ish. Reconcile policy. |
| `file_upload`  | `file_upload`          | **Arg-shape mismatch.** Proposal takes `paths: string[]` (server-side file system); ours takes base64 blobs. We're a Chrome extension — we **can't read absolute local paths**. Either keep base64 in the extension's DB row or switch to "user picks via a hidden picker" flow. |
| `read_console_messages` | `read_console_messages` | Same name. Ours is **admin + `debugger` perm + CDP-attached**; proposal advertises it as a general read tool. Means we'd need a non-CDP fallback (e.g. inject a console-shim content script) or the DB tool needs to inherit CDP gating. |

---

## 2. Mega-tool merges (the biggest design decision)

### `computer` action enum collapses 8+ of our tools

| Proposal sub-action | Extension tool | Notes |
|---------------------|----------------|-------|
| `left_click`        | `click_element` | Add modifier keys. |
| `right_click`       | `right_click_element` | |
| `double_click`      | *(missing)*    | We don't have it. |
| `triple_click`      | *(missing)*    | We don't have it. Common for "select line". |
| `type`              | `type_into_element` | Proposal `type` doesn't take a target — assumes focus. Diverges from our ref-based shape. |
| `key`               | `press_keys`   | Proposal supports `repeat`. We don't. |
| `scroll`            | `scroll_page`  | Proposal: `scroll_direction` + `scroll_amount`. Ours: into-view by ref or selector. |
| `hover`             | `hover_element` | |
| `screenshot`        | `take_screenshot` | |
| `wait`              | `wait_for`     | Proposal: `wait` is a fixed duration; ours waits on conditions (`ready_state`, `selector`). **Lossy** — proposal doesn't cover condition-waits. |
| `left_click_drag`   | *(missing)*    | We can't drag today. |
| `zoom`              | partial: `set_tab_zoom` | Proposal: zoom into a region. Ours: tab-level zoom only. |
| `scroll_to`         | partial: `scroll_page` (into-view) | |

**Tools that disappear if we adopt the mega-tool**:
`click_element`, `right_click_element`, `hover_element`, `scroll_page`,
`wait_for`, `take_screenshot`, `press_keys`, `type_into_element` (8 tools).

**Concerns:**
- The model has to learn an action-discriminator pattern. Anthropic's
  reference `computer` tool uses this shape — the model is likely
  trained on it — so familiarity is probably a win.
- `wait_for(condition)` is more powerful than `wait(duration)`. Either
  add a `wait_condition` action to the enum, or keep `wait_for` as a
  separate top-level tool.

### `form_input` collapses 4 of our tools

| Proposal field shape | Extension tool |
|----------------------|----------------|
| string `value`       | `type_into_element` (for text inputs) |
| boolean `value`      | `set_checkbox`, `set_radio` |
| string `value` (option) | `select_dropdown_option` |
| (textarea)           | `type_into_element` |

**Tools that disappear**: `set_checkbox`, `set_radio`, `select_dropdown_option`,
plus `type_into_element` if we route text inputs through `form_input`
(otherwise keep `type_into_element` for typing into non-form fields like
contenteditable).

**Concern**: our `select_dropdown_option` accepts `value | label | index`
(three ways to specify the option). The proposal's `value` is one
polymorphic field. Confirm this is intentional and that "label-based"
selection is an acceptable loss.

### `navigate` collapses 3 of our tools

| Proposal `url` value | Extension tool        |
|----------------------|-----------------------|
| URL string           | `navigate_active_tab` |
| `'back'`             | `go_back`             |
| `'forward'`          | `go_forward`          |

**Tools that disappear**: `go_back`, `go_forward`, `navigate_active_tab`.

**Concern**: `force: true` for "Leave site?" dialog handling — we
don't have this and it's worth building. Stale-form-data abandonment
is a real failure mode.

### `tabs_context` and `tabs_create` map to our tabs handlers

| Proposal      | Extension       | Δ |
|---------------|-----------------|---|
| `tabs_context`| `list_open_tabs` | Proposal returns **only the current tab group**. Ours returns all tabs. Different semantics — proposal assumes the agent is sandboxed to a tab group (matches our planned **Pilot tab + tab-group sandbox** roadmap item #9). |
| `tabs_create` | `open_new_tab`  | Proposal creates an **empty** tab in the current group; ours can navigate to a URL on creation. |

---

## 3. Proposal has, we don't (must build)

| Proposal              | Notes |
|-----------------------|-------|
| `read_network_requests` | We only have `cdp_network_capture_*` (admin + `debugger` perm). The proposal advertises this as a general read tool. **Hardest gap to close** — without `chrome.debugger`, we'd need `chrome.webRequest` with `<all_urls>` host perm (already in optional perms) and a content-script shim for response bodies. Significant work. |
| `resize_window`         | Easy: `chrome.windows.update({ windowId, width, height })`. Two-line handler. |
| `upload_image`          | New concept: take a `screenshot`'s output (or a user-uploaded image) and feed it back into a file input or drop zone via `imageId`. Requires an "image store" keyed by `imageId`. **Worth building** — closes the screenshot → upload loop. |
| `computer.double_click`, `computer.triple_click`, `computer.left_click_drag`, `computer.zoom`(region) | New `computer` sub-actions. Build along with the merge. |

---

## 4. Tools we have, proposal doesn't (decisions needed)

Bucketed by likely fate. Each entry: **keep & pitch for the DB**,
**keep extension-only**, or **drop**.

### 4a. Almost certainly add to the proposal — they fix real holes the trace exposed

| Tool | Why |
|------|-----|
| `ask_user`, `ask_user_choice`, `ask_user_secret`, `request_user_takeover` | The trace literally used `request_user_takeover` for password entry. Without these, the agent has no clean way to hand the keyboard to the user. The proposal's lack of an ask-user tool is a serious omission. **Pitch hard.** |
| `update_plan` | Lets the agent show its plan and get approval before acting. Cheap, high-leverage, fits the proposal's "give power without confusing the model" philosophy. |
| `find_text_on_page` | Distinct from `find` (NL element search) — this finds **text in any node**, returns selectors + context. Useful when the agent knows the literal string. |
| `get_page_links` | Specialized: returns just `<a>` elements with hrefs. The model uses this to plan navigation without scraping the whole page. |
| `notify_user` | Toast notifications — only way to signal completion when the side panel is closed. |
| `set_clipboard`            | Common workflow primitive (copy result for the user). |

### 4b. Keep extension-side as admin / power-user surface, NOT in the agent's DB tool set

These should remain registered in the extension and reachable via the
**Tools tab** (manual run by the user) and possibly via privileged-tier
agents, but **not** advertised to general agents.

| Tool | Why kept |
|------|----------|
| All `cdp_*` (12 tools) | Admin-only debugging power. Heavy, requires `debugger` perm + visible banner. |
| All `ai_*` (9 tools) | On-device Gemini Nano — these are an extension-specific differentiator we've explicitly invested in. Pitch them for the DB later as a separate capability ("on-device AI"). |
| `webmcp_*` (3 tools) | Bleeding-edge `navigator.modelContext` API; not stable enough for a general DB tool. |
| `execute_javascript`, `inject_stylesheet`, `remove_stylesheet`, `desktop_run_command` | Privileged-tier; trusted agents only. The proposal's `javascript_tool` covers JS exec but not stylesheet injection. |
| `save_page_as_mhtml`, `get_cookies`, `set_cookie`, `delete_cookie`, `list_recently_closed`, `restore_recently_closed` | Optional-perm-gated. Niche. |

### 4c. Keep, but probably collapse into something else

| Tool | Likely fate |
|------|-------------|
| `get_active_tab` | Probably redundant once every tool takes `tabId`. Replace with `tabs_context` semantics or expose as part of `read_page`'s response. |
| `get_page_selection`, `read_active_page` | Possibly subsumed by `read_page` + `get_page_text`. Audit before dropping — `read_active_page` has a `deep:true` lazy-loader pass that's not in the proposal. |
| `query_elements`, `inspect_element`, `get_element_at_point`, `get_computed_style` | Specialized DOM-debugging reads. Probably collapse into one `inspect_element({ ref OR selector OR coordinate, include })` — and pitch that as an addition. |
| `get_form_fields` | Subsumed by `read_page({ filter: 'interactive' })` + `form_input`. |
| `submit_form` | Most forms submit via Enter or a submit-button click; `computer.key('Enter')` covers it. Probably drop. |
| `focus_element`, `blur_element` | Niche. Drop unless a real workflow needs them. |
| `download_url`, `cancel_download`, `list_downloads` | Worth pitching as a `downloads` tool family for the proposal. |
| `search_bookmarks`, `list_bookmark_tree`, `search_history`, `list_recent_history` | "Personal data" tools. Pitch as optional capability — agents working on a user's behalf often want this. |
| `get_extension_storage`, `set_extension_storage`, `list_extension_storage`, `remember_for_domain` | Agent-memory primitives. Should live somewhere in the unified API but the design needs work — maybe a separate `memory_*` family. |
| All tab-management (`close_tab`, `switch_to_tab`, `duplicate_tab`, `pin_tab`, `mute_tab`, `reload_tab`, `set_tab_zoom`, `move_tab`, `create_tab_group`, `add_tabs_to_group`, `remove_tabs_from_group`, `update_tab_group`, `get_tab_groups`, `get_tab_info`) | Pitch as a `tabs_*` family. Critical for multi-tab orchestration which the proposal doesn't really cover beyond `tabs_create`. |
| `set_tab_zoom`, `mute_tab`, `pin_tab` | Likely drop — niche. |

### 4d. Discovery system — incompatible with the proposal's design

| Tool | Why |
|------|-----|
| `list_browser_tools`, `list_<category>_tools` (×14) | Our entire discovery system. The proposal advertises 15 tools always-on, no progressive disclosure. **Architectural choice**: keep our discovery for our own surface, pitch a smaller "always-on 15" set for the unified DB. The two can coexist if the extension exposes both surfaces (DB tools for cloud agents, full set for our own Pilot/Assistant). |
| `sleep` | Trivial wait. Probably keep — `computer.wait(duration)` covers it but `sleep` is more discoverable. |

---

## 5. Architectural decisions to make BEFORE writing any DB rows

The proposal locks in several design choices that ripple through every
handler. Settle these first or risk reworking everything twice.

1. **`tabId` everywhere?** Every proposal tool takes `tabId`. Our handlers
   default to active tab. Adopting the proposal means **adding `tabId`
   to ~50 handlers** and changing the chat surface to track which tab
   is "in scope" for the agent. Big refactor.
2. **Tab-group sandboxing?** `tabs_context` returns "the current group";
   `tabs_create` creates "in the current group". This implies the agent
   is bound to a tab group. Matches our Pilot-tab roadmap (#9) but means
   we need to wire the group-id through every tool. Decide: per-conversation
   group, or only Pilot uses groups?
3. **Mega-tools or specific verbs?** The proposal's `computer` and `form_input`
   trade tool count for action-enum complexity. Anthropic's `computer-use`
   models are trained on `computer`, so familiarity is real. Worth
   adopting; but keep `wait_for` separate (condition vs duration).
4. **Discovery system or always-on 15?** The proposal advertises all 15
   on every turn. Our system advertises ~24. Both are small. Pick one and
   ship it; don't run both for the same agent.
5. **Single source of truth: DB or extension?** User said *"we can't have
   our own local definitions."* Concretely:
   - Tool **names + JSON schemas** live in `public.tools`.
   - The extension imports/generates from the DB row at build time
     (codegen) so they can never drift again.
   - **Action items**: define a `pnpm sync:tools-from-db` script and a CI
     check that fails if the catalog has drifted. The existing
     `pnpm catalog:tools` would feed *into* the DB, not be the DB.
6. **What about admin-only / privileged tools?** They need a place
   somewhere — either a separate "admin capability" the DB knows about,
   or the extension keeps them in a parallel "extension-only" surface.
   Recommend: extension-only for now; pitch as a separate capability
   later.

---

## 6. Concrete next-step recommendation

Three phases, each independently shippable:

**Phase A — Adopt the 6 direct matches.** Add `tabId` arg, mirror the
proposal's schema for `read_page`, `find`, `get_page_text`,
`browser_batch`, `file_upload`, `read_console_messages`. Write the DB
rows. Smoke-test end-to-end via a real agent.

**Phase B — Build the 4 missing tools.** `read_network_requests`
(non-CDP fallback path), `resize_window`, `upload_image`, plus the new
`computer` sub-actions (`double_click`, `triple_click`, `left_click_drag`,
region `zoom`).

**Phase C — Mega-tool migration.** Implement `computer` and `form_input`
as new handlers that internally route to the existing specific
handlers. Once stable, deprecate the specific tool DB rows. Keep the
specific handlers in the extension for the Tools-tab (manual test) UI.

In parallel, file the architectural decisions (#1–#6 above) for the
team to ratify before any DB rows are written.
