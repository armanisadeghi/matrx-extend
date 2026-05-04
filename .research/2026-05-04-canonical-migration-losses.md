# 2026-05-04 — Canonical migration: pending-confirmation losses

Comparing extension's 106 registered tools against
[browser_tools_canonical.json](/Users/armanisadeghi/code/aidream/packages/matrx-ai/matrx_ai/tools/docs/browser_tools_canonical.json)
(26 tools).

This file lists everything that would be **dropped, renamed-with-loss, or
semantically reduced** in the migration. Per your instruction, no tools
have been removed from the extension yet. Each item below needs a
disposition decision: **KEEP extension-only**, **DROP**, or **PITCH for
canonical addition**.

The non-lossy work (pure renames, additive new tools) is being applied
in parallel and listed at the bottom.

---

## Bucket A — Tools that disappear into a canonical mega-tool (NO functional loss)

These extension tools become unreachable as standalone names, but every
capability survives inside the new mega-tool. Default: **drop the
standalone, route via the mega-tool**. Listed for transparency; no
confirmation needed unless you want to keep some as fast paths.

### Into `computer`
- `click_element` → `computer.action='left_click'`
- `right_click_element` → `computer.action='right_click'`
- `hover_element` → `computer.action='hover'`
- `press_keys` → `computer.action='key'`
- `type_into_element` → `computer.action='type'`
- `scroll_page` → `computer.action='scroll'` / `'scroll_to'`
- `take_screenshot` → `computer.action='screenshot'`

### Into `form_input`
- `set_checkbox` → `form_input(value: boolean)`
- `set_radio` → `form_input(value: boolean)`
- `select_dropdown_option` → `form_input(value: string)`
- (Text typing into form fields stays in `computer.action='type'`)

### Into `navigate`
- `navigate_active_tab` → `navigate(url)`
- `go_back` → `navigate(url:'back')`
- `go_forward` → `navigate(url:'forward')`

### Into `tabs`
- `list_open_tabs` → `tabs(action:'list')`
- `open_new_tab` → `tabs(action:'create', url?)`
- `close_tab` → `tabs(action:'close')`
- `switch_to_tab` → `tabs(action:'switch')`
- `reload_tab` → `tabs(action:'reload')`

### Into `downloads`
- `download_url` → not directly; `downloads.action='list'` exposes downloads triggered by the page. **⚠️ Possible gap**: canonical has no "agent-initiated download from a URL" — see Bucket C.
- `cancel_download` → `downloads.action='cancel'`
- `list_downloads` → `downloads.action='list'`

### Into `clipboard`
- `set_clipboard` → `clipboard(action:'write')`
- (no current `read_clipboard` — gain, not loss)

### Into `ask_user`
- `ask_user` → `ask_user(type:'text')`
- `ask_user_choice` → `ask_user(type:'choice')`
- `ask_user_secret` → `ask_user(type:'secret')` *(canonical added 'secret' per our review)*

### Into `memory`
- `set_extension_storage` → `memory(action:'set')` *(but see Bucket C — scope changes)*
- `get_extension_storage` → `memory(action:'get')`
- `list_extension_storage` → `memory(action:'list')`

### Pure rename
- `execute_javascript` → `evaluate_javascript`
- `file_upload` → `upload_file` *(but see Bucket C — schema changes from base64 to file_id)*

---

## Bucket B — Tools with NO canonical equivalent → these are real losses if dropped

Each one needs your decision: **KEEP** (extension-only, not advertised
to general agents), **DROP**, or **PITCH** (file with the canonical team
to add).

### B1 — Page reading specialists (overlap with `read_page` / `find` / `find_text_on_page` but not 1:1)

| Tool | What it uniquely provides | Recommendation |
|------|---------------------------|----------------|
| `get_active_tab` | Returns "what tab am I on right now" without listing all tabs. Common reflex when the agent wants its own context. | **DROP** — every tool now takes `tabId`; agent reads its tab from conversation context. |
| `get_page_selection` | Returns whatever text the user has selected on the page right now. **Useful for "explain this" / "translate this" workflows.** | **PITCH** — small addition, real workflow value. Or **KEEP** if the canonical team won't take it. |
| `read_active_page` | Full page scrape including a `deep:true` lazy-loader pass. | **DROP** — `read_page({trigger_lazy_load:true})` and `get_page_text` cover this between them. |
| `query_elements` | `document.querySelectorAll` on raw CSS, returns tag/text/attrs lists. The "I know the selector, give me the matches" tool. | **PITCH** — power users (and the test runner) lean on this; `find` (NL) and `find_text_on_page` (literal text) don't substitute when you have a CSS selector. |
| `get_page_links` | Returns just `<a>` elements with `href` + text + `rel`, with `same_origin_only` filter. | **PITCH** — common navigation-planning primitive; cheaper than `read_page`. |
| `get_computed_style` | Computed style of an element by selector. | **DROP** — `get_element_details({include_styles:true})` covers this. |
| `get_element_at_point` | "What's at viewport coordinate (x,y)?" | **DROP** — niche; agents that work in coordinates use `computer.left_click(coordinate)` directly. |
| `inspect_element` | Deep snapshot: tag, text, attrs, computed styles, ancestor chain. | **DROP** — `get_element_details` is the canonical replacement. |
| `get_form_fields` | Lists every form field on the page with label / value / required / options. | **DROP** — `read_page({filter:'interactive'})` covers it. |
| `find_text_on_page` | Already in canonical — no loss. | (No-op.) |

### B2 — Keyboard / mouse helpers without a canonical mapping

| Tool | Notes | Recommendation |
|------|-------|----------------|
| `focus_element` | Programmatic focus without click. Useful for triggering visibility/aria-expanded on tooltips. | **DROP** — `computer.left_click(ref)` covers most cases; canonical doesn't acknowledge focus as a separate primitive. Or **PITCH** as `computer.action='focus'`. |
| `blur_element` | Programmatic blur. | **DROP** — niche. |
| `submit_form` | Programmatic `<form>.submit()`. | **DROP** — `computer.key('Enter')` or click the submit button. Most workflows already do that. |

### B3 — Tab / window features without canonical mapping

| Tool | Notes | Recommendation |
|------|-------|----------------|
| `set_tab_zoom` | Per-tab zoom. | **DROP** — niche. |
| `pin_tab`, `mute_tab`, `move_tab`, `duplicate_tab` | Tab-management quality-of-life. | **DROP** all — niche; if needed, **PITCH** as `tabs.action='pin'/'mute'/'duplicate'`. |
| `get_tab_info`, `get_tab_groups`, `create_tab_group`, `add_tabs_to_group`, `remove_tabs_from_group`, `update_tab_group` | Tab-group management. Canonical decided "tab-groups are out of scope for v1". | **DROP** all per the canonical decision, OR **KEEP** extension-only for the side panel's own UI (the side panel has tab-group views). |

### B4 — Browser data (bookmarks / history / sessions)

| Tool | Notes | Recommendation |
|------|-------|----------------|
| `search_bookmarks`, `list_bookmark_tree` | Bookmark access. **Real workflow**: "find the article I bookmarked about X." | **PITCH** as a `browser_data` group. Real value for personal-assistant agents. |
| `search_history`, `list_recent_history` | History access. Same use case. | **PITCH** alongside bookmarks. |
| `list_recently_closed`, `restore_recently_closed` | "Reopen the tab I closed by mistake." | **DROP** — niche; user-initiated via Cmd-Shift-T. |

### B5 — Cookies & session manipulation

| Tool | Notes | Recommendation |
|------|-------|----------------|
| `get_cookies`, `set_cookie`, `delete_cookie` | Direct cookie manipulation. Optional permission today. **Real risk**: misused, bypasses auth. | **KEEP extension-only** for power users via the Tools tab. Don't pitch — too dangerous as a general agent capability. |

### B6 — Page archive / capture

| Tool | Notes | Recommendation |
|------|-------|----------------|
| `save_page_as_mhtml` | Saves complete page snapshot via the `pageCapture` permission. | **KEEP extension-only**. Niche but the only way to preserve a complete snapshot for audit. |

### B7 — Privileged page mutation

| Tool | Notes | Recommendation |
|------|-------|----------------|
| `inject_stylesheet`, `remove_stylesheet` | Inject CSS. Used today for picker overlays. | **KEEP extension-only** (used by our own UI, not advertised to agents). |
| `desktop_run_command` | Send a command to the desktop bridge (matrx-local). | **KEEP extension-only**. The whole desktop bridge is an extension-specific surface. |

### B8 — On-device AI (Gemini Nano via `chrome.ai`) — 9 tools

`ai_check_availability`, `ai_summarize`, `ai_classify`, `ai_extract_json`,
`ai_translate`, `ai_detect_language`, `ai_proofread`, `ai_describe_image`,
`ai_check_prompt_injection`.

| Notes | Recommendation |
|-------|----------------|
| Free, on-device, multimodal. The extension's strategic differentiator. Canonical doesn't include them — Playwright surfaces have no equivalent. | **PITCH** as a separate capability group `on_device_ai`, advertised only when the client reports `onbox_ai_available: true`. **KEEP extension-only** in the meantime. |

### B9 — CDP / DevTools — 12 tools

`cdp_attach`, `cdp_detach`, `cdp_attached_tabs`, `cdp_a11y_tree`,
`cdp_full_page_screenshot`, `cdp_input_click_xy`, `cdp_input_type`,
`cdp_network_capture_start`, `cdp_network_capture_drain`,
`cdp_network_capture_stop`, `cdp_network_get_body`, `cdp_print_pdf`,
`cdp_perf_metrics`, `cdp_emulate_device`, `cdp_clear_emulation`.

| Notes | Recommendation |
|-------|----------------|
| Admin-only debugging power. Canonical's `read_console_messages` and `read_network_requests` cover the **read** side, but not the **write/emulate** side (clicking via Input domain, viewport emulation, etc.). | **KEEP extension-only**. These are admin-tier, require visible debugger banner, and have no Playwright analog (Playwright already operates at this level). |

### B10 — WebMCP — 3 tools

`webmcp_check_availability`, `webmcp_list_page_tools`, `webmcp_call_page_tool`.

| Notes | Recommendation |
|-------|----------------|
| Bleeding-edge `navigator.modelContext` API. Extension-only experiment. | **KEEP extension-only**. Not stable enough for a canonical entry. |

### B11 — Discovery system — 15 generated tools

`list_browser_tools`, `list_core_tools`, `list_page_tools`,
`list_interact_tools`, `list_forms_tools`, `list_tabs_tools`,
`list_history_tools`, `list_ai_tools`, `list_files_tools`,
`list_memory_tools`, `list_ask_tools`, `list_advanced_tools`,
`list_debug_tools`, `list_cookies_tools`, `list_webmcp_tools`.

| Notes | Recommendation |
|-------|----------------|
| Our progressive-disclosure system. Canonical replaces it with **groups in the request** (`core` / `inspection` / `files` / `interaction` / `advanced` chosen by the agent definition). | **DROP all** once we're on canonical groups — they're solving the same problem two ways. **KEEP** the master `list_browser_tools` as a debug helper if useful. |

### B12 — Misc

| Tool | Notes | Recommendation |
|------|-------|----------------|
| `notify_user` | Already in canonical. | (No-op.) |
| `update_plan` | Already in canonical — but **schema differs** from what we discussed (no create/patch/replace). Treat the current canonical as v1; pitch the action-discriminator version as v2. |
| `remember_for_domain` | Per-domain persistent notes. **Different from canonical `memory`**, which is session-scoped. | **PITCH** as `memory(action:'remember_domain')` or a separate `domain_memory` tool — real value, distinct from session memory. |
| `sleep` | Trivial fixed sleep. | **DROP** — `wait_for(condition:'network_idle')` covers most cases; canonical removed `computer.wait` deliberately. |

---

## Bucket C — Tools that change CONTRACT, not just name (real semantic loss if not handled)

These are not drops, but the schema/behavior change is non-trivial. Each
needs implementation work, not just an alias.

| Tool | Old → New contract | What we lose if not addressed |
|------|---------------------|-------------------------------|
| `file_upload` → `upload_file` | base64 blob → `file_ids: string[]` (cloud MediaRefs) | Today the agent passes blob bytes. Canonical assumes a `cld_files` upload happened first. **Build needed**: client `/files/upload` endpoint + handler that resolves file_id → bytes via the same pipeline. Until then, file uploads break. |
| `set_extension_storage` → `memory.set` | Persistent across sessions → session-scoped, 8 KB cap, 100 keys | Persistence is **lost**. Long-running domain memory would be wiped. Canonical's `memory` is the new scratch; for persistent per-domain notes we need `remember_for_domain` (Bucket B) or pitch persistence to canonical. |
| `download_url` (action) → `downloads.list` (read-only) | Active "trigger a download" → passive "see what was downloaded" | **Capability lost**: agent can no longer initiate a download from a URL. Workaround: navigate to the URL and let the page trigger the download, then `downloads.list`. Less reliable. **Pitch** `downloads.action='download_url'`. |
| `read_console_messages` (admin + CDP) → general read tool | Required `debugger` perm + CDP attach → freely available | Need a non-CDP fallback. Options: inject content-script that wraps `console.*` (loses early messages, can't see CSP-violating ones), or surface CDP-version with the optional permission gate inherited. |
| `read_network_requests` (admin + CDP) → general read tool | Same as above | Same shape — need `chrome.webRequest` or content-script bridge for non-admin. **Hardest gap to close.** |
| `wait_for` shape change | `(ready_state \| selector \| timeout_ms)` → `(condition: element\|text\|url\|network_idle, target, scroll, timeout_ms)` | Old `ready_state` waits go away. Plus side: gain `text`, `url`, `network_idle`, and the powerful `scroll:true` mode. **Net win, but the handler is a rewrite.** |

---

## Bucket D — `tabId` becomes required everywhere

Canonical: every tool that touches the page takes `tabId: string`.

Today: every extension tool implicitly uses the active tab (we resolve
via `chrome.tabs.query({active:true, currentWindow:true})` inside the
handler).

**Decision:** make `tabId` required in the schema (canonical), but
fall back to the active tab inside the handler when omitted (for
backward compatibility during migration). Pitch a follow-up to lock
the contract once the agent is reliably passing it.

This is a transition concern, not a loss — listed here so the team
knows every handler is touched by the migration.

---

## Bucket E — Architectural decisions buried in canonical

These were locked in by canonical's `_meta.decisions`. Reading them now
so we don't rediscover them mid-migration.

| Decision | Implication for extension |
|----------|---------------------------|
| `tabId_type: "string"` | Extension's `chrome.tabs.id` is `number`. Stringify at the dispatcher boundary; the rest of the surface uses strings. |
| `tabs_list_scope: "all tabs in current window"` | Tab-groups are out. Our planned Pilot-tab sandbox concept needs to be reframed (probably becomes "current window = sandboxed window" for Pilot mode). |
| `user_takeover: top-level tool` | Confirmed `request_user_takeover` stays a separate tool, not an `ask_user.type`. We already align. |
| `computer_zoom: removed` | Don't worry about region-zoom semantics. |
| `computer_wait: removed` | Don't add a `computer.wait` shim. `wait_for` is the only blessed wait. |
| `evaluate_javascript: admin-only default` | Today `execute_javascript` is privileged-tier. Match: admin-only, opt-in via `tool_config`. |
| `browser_batch: no templating in v1` | Don't try to add `${...}` references. Model handles step dependencies via separate calls. |
| `memory: 8 KB / 100 keys` | Enforce caps in handler. |
| `read_pdf: tabId OR file_id` | Need a PDF parser — we don't have one yet. PDFs in tabs render as native PDF viewer; the agent can't read text from that without a parser. New build. |
| `drop_file: separate tool from upload_file` | Build both. |
| `cloud_files contract` | This is the **biggest architectural commitment**. Every file-producing tool returns `{file_id, file_url, ...}`; every file-consuming tool takes `file_id`. The extension needs a `/files/upload` POST → `file_id` flow, plus a way to fetch bytes back from `cld_files` server-side when a tool runs that consumes a file_id. |

---

## What I'm applying right now (additive, no losses)

These need no confirmation — nothing is removed.

1. **Tool name aliases** for the canonical renames (extends
   [`src/lib/tools/aliases.ts`](../src/lib/tools/aliases.ts)):
   - `evaluate_javascript` → `execute_javascript`
   - `upload_file` → `file_upload` *(works for the call shape today;
     contract change in Bucket C still needs the cloud_files build)*
2. **Add `secret` mode to `ask_user`** so the canonical schema validates
   even though we still also have `ask_user_secret` standalone.
3. **`resize_window` handler** — we don't have it; trivial 5-line
   `chrome.windows.update`.

What I'm NOT touching yet (waiting on confirmation for Bucket B + C):
- The five mega-tool routers (`computer`, `form_input`, `navigate`,
  `tabs`, `downloads`, `memory`, `clipboard`, `ask_user` unified)
- Any tool removal from the registry
- The cloud_files plumbing
- The non-CDP fallbacks for `read_console_messages` / `read_network_requests`
- `read_pdf` (needs a parser)
- `drop_file` (needs cloud_files first)
- `record_gif` (substantial new build)

---

## What I need from you

For each section in **Bucket B**, mark each item:

- **K** = Keep extension-only (don't advertise to general agents; reachable via Tools tab and admin agents)
- **D** = Drop entirely
- **P** = Pitch for canonical addition (and for now, keep extension-only)

A pass through B1–B12 with K/D/P next to each row gives me the green
light to start removing handlers. Until then everything stays.

Bucket C decisions will follow naturally once the canonical client +
cloud_files plumbing is designed — flag if any of those need
to be expedited.
