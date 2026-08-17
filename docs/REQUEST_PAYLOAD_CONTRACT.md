# Request Payload Contract — what the extension ships to aidream on every chat

> Authoritative reference for the wire shape of every `POST /ai/agent/{id}`.
> Keep this file in lockstep with the code it documents. When you change any
> field name, add a key, or drop one, **update this doc in the same commit**.
> Renames are breaking changes — engineers template `{{page_brief.title}}`
> into prompts and the server's discovery handler reads
> `client.state["browser-dom"]` field-by-field.
>
> Last reviewed: 2026-06-10.

---

## The request body, at a glance

```jsonc
POST /ai/agent/{agent_id}
{
  "user_input":     "string — the user's message",
  "conversation_id": "string | null",
  "variables":      "Record<string, unknown> | null",

  // ~50 keys of MODEL-FACING facts about the active page.
  // Built by buildChatContext() — src/lib/chat/context/v2-bundled.ts.
  // See §2 below for the full inventory.
  "context": { ... },

  // Capability envelope — replaces the old `client_tools` field.
  // Built by buildBrowserDomState() — src/lib/chat/build-browser-dom-state.ts.
  // See §3 below.
  "client": {
    "capabilities": ["browser-dom"],
    "state": {
      "browser-dom": { ...16 orchestration keys... }
    }
  },

  // Stream + accounting
  "stream":         true,
  "store":          true,
  "source_app":     "matrx-extend",   // wire field, NOT the dropped tl_def.source_app column
  "source_feature": "chat" | "tasks" | ...,

  // Admin-only / opt-in:
  "config_overrides": { "model": "..." },       // user model picker
  // ...other adminOverrides (debug, snapshot, block_mode, memory_*, etc.)
  //    stripped on non-admin requests.
}
```

The two payloads do different jobs and are read by different code paths
server-side:

- **`context`** — big, rich, model-facing. Aidream matches keys against
  Mandates / context_slots and surfaces the rest to the model as a
  tool-callable hint. No truncation on our side — that's the server's
  job.
- **`client.state["browser-dom"]`** — small, structured, orchestration-
  facing. The server's `browser-dom` capability + `load_browser_tools`
  discovery handler reads this to decide which tool category to
  register for the current turn (admin? guest? perms granted? desktop
  bridge? what's already loaded?).

They ride on the same request because they're produced at the same
time, but they are **never merged**. Don't move a key from one to the
other without thinking about who reads it.

---

## 1. Tab identification — single source of truth

The agent's "current tab" is captured **exactly once per send** in
`use-chat-stream.ts` via `chrome.tabs.query({active:true, currentWindow:true})`
and the resulting `chrome.tabs.Tab` is threaded into:

- `buildChatContext()` (becomes `page_brief.tab_id`, `tab_state.*`)
- `buildBrowserDomState()` (becomes `browser-dom.current_tab_id`,
  `current_window_id`, `page_title`, `tab_status`)
- `STREAM_START.assignedTabId` (the dispatcher's tab-pinning latch —
  see [src/lib/tools/dispatch.ts](../src/lib/tools/dispatch.ts)
  `recordAssignedTab`)

This is what guarantees the four tab-id fields on the wire agree with
each other and with the dispatcher's gate. **Never re-query the active
tab from inside a context builder** — accept the tab as a parameter.
A re-query inside a builder reintroduces the race we fixed: the user
switches tabs in the 50ms between two `chrome.tabs.query` calls and
the request goes up with the page_brief from one tab and the
discovery state from another.

The PilotView path overrides `assignedTabId` explicitly so it can pin
to a tab inside the active Pilot session's tab group; the Assistant
path just trusts the active tab.

Where tab id appears on the wire (every one of these references the
**same** `chrome.tabs.Tab` object):

| Wire path                                     | Source                |
|-----------------------------------------------|-----------------------|
| `context.page_brief.tab_id`                   | `tab.id`              |
| `context.page_brief.window_id`                | `tab.windowId`        |
| `context.tab_state.tab_id` / `.window_id` / `.tab_index` / `.pinned` / `.incognito` / `.status` | `tab.*` |
| `client.state["browser-dom"].current_tab_id`  | `tab.id`              |
| `client.state["browser-dom"].current_window_id` | `tab.windowId`      |
| `client.state["browser-dom"].page_title`      | `tab.title`           |
| `client.state["browser-dom"].tab_status`      | `tab.status`          |
| `STREAM_START.assignedTabId`                  | `tab.id`              |

---

## 2. The `context` body (v2-bundled — default shape)

Source: [src/lib/chat/context/v2-bundled.ts](../src/lib/chat/context/v2-bundled.ts).
The legacy v1-flat shape is admin-toggleable for A/B; v2 is the only
shape that should be used.

### Always attached

| Key            | Shape (summary)                                                                                                                                                |
|----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `user`         | `{id, name, email}` — null when unauthenticated.                                                                                                               |
| `client`       | `{surface: "chrome-extension-chat", extension_version, desktop_bridge, now, timezone, locale}`. Different from `client.*` on the request envelope — this lives in `context`. |
| `page_brief`   | The canonical snapshot. See §2.1.                                                                                                                              |
| `page_meta`    | `{canonical, robots, referrer, charset, content_type, viewport_meta, og, twitter}`.                                                                            |
| `viewport_state`| `{width, height, scroll_y, scroll_height}`.                                                                                                                   |
| `tab_state`    | `{tab_id, window_id, tab_index, pinned, incognito, status}`. Six fields.                                                                                       |
| `auth_state`   | Whenever there's a URL AND Settings → Privacy → "Share page identity" is on (default on). `{signed_in: "yes"|"likely"|"no"|"unknown", user_chip, signals: {sign_out_link, profile_chip, avatar_image, sign_in_cta, login_form_visible}}`. (Field names corrected 2026-06-10 — the doc previously said `avatar`/`password_field_present`, which never matched the code.) |

### 2.1 `page_brief` — always attached

```jsonc
{
  "url":         "...",
  "title":       "...",
  "description": "...",
  "lang":        "...",
  "kind":        "article|product|search|form|...",
  // tab_id / window_id intentionally NOT here — see tab_state.
  "ready":       "loading|complete|...",
  "snapshot": {
    "captured_at": "ISO-8601",
    "confidence":  "high|partial|low",
    "flags":       ["captcha_present", "spa_unhydrated", ...],  // see flag list below
    "ready": {                                                   // null when checkPageReady failed
      "observed_idle":      true,
      "loading_indicators": 0
    }
  },
  "structure": {  // null when confidence === 'low'
    "headings":         [...],
    "primary_action":   {...},
    "main_interactive": [...]
  },
  "content": {    // null when confidence === 'low' OR no scrape
    "excerpt":          "first 1500 chars of markdown",
    "word_count":       1234,
    "reading_time_min": 7
  },
  "more_available": {
    "main_interactive_total": 47,   // counts of what was trimmed —
    "chrome_elements":        12,   // tells the model the brief is not
    "forms":                  1,    // "everything", just the summary
    "images":                 18,
    "videos":                 3,
    "links":                  42,
    "full_content_chars":     9876,
    "structured_data":        2,
    "seo_audit":              "available"
  }
}
```

**`snapshot.flags` enumeration** (kept in sync with `BriefBlock.flags`
in [src/lib/chat/context/probe.ts](../src/lib/chat/context/probe.ts)):

- `captcha_present` — a VISIBLE recaptcha/hcaptcha/turnstile/arkose iframe
  is on-screen with non-zero size and non-hidden style. Lazy-loaded
  invisible shims do NOT trigger this (the 2026-05-18 audit found two
  false-positives where invisible recaptcha iframes existed in the DOM
  for future form submissions — fix in probe.ts requires the iframe to
  render before promoting `kind` to `captcha`).
- `bot_challenge_or_block` — title matches `"just a moment"`,
  `"checking your browser"`, `"attention required"`, `"access denied"`,
  `"forbidden"`.
- `spa_unhydrated` — visible body text < 200 chars AND scripts are
  loading. Page hasn't rendered yet.
- `login_wall` — password input present AND main-area text < 400 chars.

Any of those pushes `confidence` to `"low"` and zeros out
`structure` / `content`. Reserved-but-unused (partial-confidence) flags:
`consent_overlay`, `paywall_or_signup_wall`, `age_gate`, `not_ready`.

### Conditional keys

Surface adds these when the relevant signal is detected on the page.
No advance declaration is needed — the server's context-fetch tool
exposes them by name automatically when present.

| Key                       | Condition                                                       |
|---------------------------|-----------------------------------------------------------------|
| `selection`               | User has selected text on the page.                             |
| `page_dismissibles`       | Modals / banners / paywalls detected; carries `close_selector`. |
| `chrome_elements`         | Header/nav/footer/aside has visible interactive elements. Capped at 20 items; full count via `page_brief.more_available.chrome_elements`. Each item: `{role, name, tag, landmark}`. |
| `form_elements`           | Forms detected in the main area. Each field includes `ref` (when prewarm tagged it) so the agent can call `form_input({ref})` without `read_page`. Null `validation` sub-fields are omitted. |
| `result_list`             | Repeating-card list (≥5 similar siblings with anchors). Per-item nulls dropped; ad-network items tagged `kind: "ad"`. |
| `page_full_content`       | A scrape (manual or auto) exists for the URL.                   |
| `page_seo_audit`          | Same gate as `page_full_content`. Untrimmed — SEO consumers need the full bundle; only empty `hreflang: []` is dropped. |
| `page_links`              | Same gate. Deduped by href (image-wrap + text duplicate links collapse to one), `kind` categorization (nav/footer/social/contact/external/content), `in_main` flag, `rel` only when set. |
| `page_media`              | Scrape has any images, videos, or audio. Tracking pixels (<2500 px²), base64 placeholders, and CDN-wrapped URLs are filtered/unwrapped. Carries `images_filtered: {shown, dropped, dropped_reason}` when filtering happened. |
| `page_media_raw`          | Always paired with `page_media` when media exists. Full unfiltered list (with opaque CDN URLs). For agents doing SEO analysis, downloads, or anything needing the original URL. |
| `page_structured_data`    | Scrape has JSON-LD blocks.                                      |
| `article_summary`         | `page_brief.kind === 'article'` AND scrape.                     |
| `product_data`            | `page_brief.kind === 'product'` AND scrape.                     |
| `pull_request`            | URL matches GitHub / GitLab PR.                                 |
| `ticket`                  | URL matches GitHub Issues / Linear / Jira.                      |
| `email_inbox` / `email_thread` | Gmail / Outlook / Hey / Superhuman.                         |
| `domain_memo`             | Per-domain memo exists (via `remember_for_domain`).             |
| `guidance`                | User-saved clues for the current domain.                        |
| `prior_capture`           | URL has been captured before (Supabase row exists).             |
| `saved_patterns_for_domain` | The user has saved extraction patterns (`wbx_pattern`) for this host. Compact list (≤20): `{id, name, kind, route_pattern, last_status, last_run_count}`. The agent runs one via `data_patterns({action:'run', pattern_id})` instead of re-scraping. |

### Rules (locked in CLAUDE.md)

- **Menu cost, not payload cost.** Each key costs ~one line in the
  model's advertised-keys list. Big rich values are FREE.
- **Bundle by mental concept.** One coherent thing → one key.
- **One source of truth per fact.** No `images_count` AND `images.length`.
- **No shallow keys for empty things.** Empty arrays go inside their
  bundle; if a bundle would be empty, omit the bundle.
- **Confidence-gated content.** Low-confidence page → `structure` and
  `content` go null. Better to send less than to mislead.
- **`more_available` always counts what was trimmed** — model knows
  the brief is not everything.
- **No implementation details.** No `scrape_extractor`, no
  `raw_html_size`, no `scrape_age_ms`.
- **No images for the model.** The text-mode model can't see them.

---

## 3. The `client.state["browser-dom"]` payload (orchestration)

Source: [src/lib/chat/build-browser-dom-state.ts](../src/lib/chat/build-browser-dom-state.ts).
Sixteen keys. Small on purpose — the server's `load_browser_tools`
discovery handler reads it field-by-field to decide which tool
category to register.

```ts
interface BrowserDomState {
  // Current tab — captured once in use-chat-stream, threaded in.
  current_url:                    string | null;
  current_tab_id:                 number | null;
  current_window_id:              number | null;
  page_title:                     string | null;
  page_lang:                      string | null;   // doc.documentElement.lang via executeScript
  tab_status:                     "loading" | "complete" | null;

  // Surface + caller identity
  surface:                        "assistant" | "pilot";
  is_admin:                       boolean;
  is_guest:                       boolean;          // true ⇔ no Bearer token
  permission_mode:                "ask" | "act";    // per-agent toggle

  // Environment capabilities
  desktop_bridge:                 "native" | "http" | "none";
  onbox_ai_available:             boolean;          // Gemini Nano detected?
  optional_permissions_granted:   string[];         // chrome.permissions.getAll()
  open_tab_count:                 number | null;
  extension_version:              string;
  extension_id:                   string;

  // Discovery hint — categories already loaded earlier this convo
  loaded_categories:              string[];
}
```

### Why each field exists (read this before deleting any)

- `current_url / current_tab_id / current_window_id / page_title /
  tab_status` — the dispatcher needs these for tab routing; the
  discovery handler uses them for URL-pattern category gating (e.g.
  "user is on Gmail → preload the email category").
- `page_lang` — language gating for category selection (some tools
  emit messages in the page's language).
- `surface` — `pilot` surfaces get the privileged kit by default.
- `is_admin` — admin-only tools are filtered out for everyone else.
- `is_guest` — guest-tier model swap (premium models fall back to
  `guest_fallback_id`); usage-quota tracking.
- `permission_mode` — UI flag, also logged in receipts.
- `desktop_bridge` — when `none`, the discovery handler drops the
  desktop_run_command tool. When `native`, it stays.
- `onbox_ai_available` — drives whether the model should prefer
  `ai({action: ...})` over a cloud round-trip.
- `optional_permissions_granted` — tools that need optional perms
  (debugger, cookies, pageCapture, sessions, ...) get gated based on
  this list.
- `open_tab_count` — heuristic for offering `parallel_for_each_tab`
  workflows.
- `extension_version / extension_id` — diagnostics + per-channel
  routing (some experimental capabilities are channel-gated).
- `loaded_categories` — when cross-request tool persistence ships
  server-side, this short-circuits re-discovery. Today it's a hint
  only — discovery is cheap enough to re-run.

---

## 4. Cross-turn lifecycle

- **Tool mutations are per-request only.** Each new user message
  restarts with `[load_browser_tools]` as the only always-on tool in
  the `browser-dom` capability. The agent re-discovers what it needs
  for the current turn. Server-side persistence is on aidream's
  roadmap; no extension change is needed when it lands.
- **The extension hints `loaded_categories`** on the next request so
  the future-persistent server can skip re-registering them.
- **Tab assignment persists per-run, not per-conversation.** Each
  user message latches a fresh `assignedTabId`. Tab switches mid-run
  do NOT affect the in-flight agent.

---

## 5. Updating this doc

Trigger for an update:

- Adding / removing / renaming any key in `context` or
  `client.state["browser-dom"]`.
- Adding / removing a conditional gate (e.g. a new `pull_request`-
  style dynamic key).
- Changing the source of truth for an existing key (e.g. moving
  `page_lang` from executeScript to the probe).
- Any change in how `tab_id` flows through the request.

The relevant files to keep in lockstep:

- [src/lib/chat/context/v2-bundled.ts](../src/lib/chat/context/v2-bundled.ts) — context builder.
- [src/lib/chat/build-browser-dom-state.ts](../src/lib/chat/build-browser-dom-state.ts) — browser-dom state builder.
- [src/hooks/use-chat-stream.ts](../src/hooks/use-chat-stream.ts) — request assembly.
- [CLAUDE.md](../CLAUDE.md) — high-level summary; the inline `context shape` section there must agree with this file.

---

## Changelog

### 2026-06-10 — audit hardening (size caps, confidence gate, privacy gate)

- **Confidence gate now covers scrape-derived keys.** `page_full_content`,
  `page_seo_audit`, `article_summary`, `product_data` are omitted when
  `page_brief.snapshot.confidence === 'low'` — previously only
  `page_brief.structure/content` honored the gate, so a CAPTCHA page's body
  still shipped.
- **`page_brief` always present when a tab exists.** When the probe fails
  (chrome:// page, PDF viewer, blocked scripting) a minimal brief is emitted:
  `kind:'unknown'`, `snapshot.confidence:'low'`,
  `flags:['unreadable_or_restricted']`, null structure/content.
- **`page_brief.content` honesty:** new `excerpt_truncated: boolean` and
  `full_in: 'page_full_content'`; `word_count`/`reading_time_min` describe the
  FULL text (unchanged), the flag prevents misreading the 1500-char excerpt
  as the whole article.
- **Size caps at the extension boundary:** `page_full_content.markdown`
  capped at 120k chars, `.html` at 150k — when capped, `truncated: true` +
  `full_chars: {markdown, html}` are added. `page_media_raw` lists capped at
  100 entries each — when capped, `truncated: true` +
  `full_counts: {images, videos, audio}`.
- **Privacy gate:** `auth_state` and `email_inbox`/`email_thread` are gated
  by the Settings → Privacy → "Share page identity & email content" toggle
  (default ON). When off, the keys are absent AND the detectors don't run.
- **`form_elements.fields[].current_value` is always `null` for
  `type=password` inputs** — typed-but-unsubmitted passwords no longer leave
  the browser. The field shell (type/label/required) still appears.
- Conditional keys present in code but previously missing from this doc:
  `highlights` (user-attached highlight bundles), `current_plan`,
  `task_list`, `user_todos` (lists state, attached when non-empty). The
  `client.state["browser-dom"]` envelope also carries
  `bound_compute_target_kind` / `bound_compute_target_id` (18 keys total,
  not 16).


### 2026-05-18 — Context cleanup pass (browser-agent feedback)

A live test by our browser agent — running `ctx_batch` against Yahoo's
homepage and datadestruction.com — surfaced a lot of always-noise
content in the context and a real bug in the page-kind classifier.

**Bug fix:**

- **Captcha false-positive.** The probe was promoting `kind: "captcha"`
  any time a recaptcha/hcaptcha/turnstile/arkose iframe existed in the
  DOM, regardless of visibility. Most sites embed an invisible
  recaptcha shim for future form submissions; the model was treating
  ordinary marketing pages as bot-walled. Fixed in
  [probe.ts](../src/lib/chat/context/probe.ts) — the iframe must now
  render with non-zero size and non-hidden style before
  `captcha_present` is pushed.

**Always-useless content dropped (no shape change for consumers):**

- `page_brief.tab_id` / `page_brief.window_id` — duplicated `tab_state`.
- `page_brief.snapshot.ready` — trimmed from 6 sub-fields to just
  `{observed_idle, loading_indicators}`. The other four
  (`document`, `mutation_count`, `pending_images`, `load_event_ms`)
  are debugging detail, kept in the probe's return type for the Debug
  tab but not surfaced per-turn.
- `page_meta.og` / `page_meta.twitter` — empty `{}` objects no longer
  attached.
- `page_media` images — filtered:
  - Tracking pixels (< 2500 px²) dropped.
  - Base64 `data:image/svg+xml` and `data:image/gif` placeholders
    dropped.
  - CDN-wrapper URLs (Yahoo's `s.yimg.com/lo/mysterio/api/...`,
    NitroCDN's `cdn-*.nitrocdn.com/...`, generic `?url=` query
    wrappers) unwrapped to the inner logical URL. Full opaque URLs
    move to a new `page_media_raw` key the agent can read on demand.
  - Empty `videos: []` / `audio: []` arrays no longer included.
- `page_links` — deduped by `href` (image-wrapped + text-labeled
  duplicates collapse), `rel` only included when set, each link now
  carries `kind: "nav"|"footer"|"social"|"contact"|"external"|"content"`
  and `in_main: bool`.
- `form_elements` — `validation` sub-fields included only when set
  (no more six-null bag per field), `validation` itself omitted when
  empty. Each field now carries a `ref` (e.g. `"ref:42"`) when the
  prewarm pass has tagged a `data-matrx-ref` on the element — the
  agent can pass it straight to `form_input({ref})` without a
  separate `read_page` call.
- `result_list` — per-item null fields (`price`, `rating`,
  `image_alt`) omitted instead of being included as `null`.
  Ad-network domains (`jd8trk`, `doubleclick`, `taboola`, etc.) and
  tracking-param URLs (`gclid=`, `utm_source=ad`, `fbclid=`) get
  tagged `kind: "ad"` so the model can skip sponsored entries when
  summarizing.
- `page_seo_audit.hreflang: []` — empty array omitted. Rest of the
  SEO bundle deliberately left untrimmed; SEO audit consumers
  genuinely use every field.

**New ctx key — `chrome_elements`:**

The probe used to expose `page_brief.more_available.chrome_elements:
N` as a count tease but didn't surface the actual list. Now attached
as its own ctx key when the page has visible header/nav/footer/aside
interactive elements. Capped at 20 items; full count still in
`more_available`. Each item: `{role, name, tag, landmark}` where
`landmark` is `"header" | "nav" | "footer" | "aside" | "unknown"` —
the agent can reach sign-in / cart / nav-search icons without walking
the full read_page result.

**Sequencing change:**

`prewarmReadPageCache` now runs BEFORE the rest of the parallel
context-build tasks (probe, discover-forms, etc.). Cost is ~30-80ms
of added serial latency; benefit is that every form field now ships
with a `data-matrx-ref` tag the agent can use directly.

**`page_brief.snapshot.flags` enumeration:**

Added to `BriefBlock.flags` JSDoc in probe.ts AND mirrored in §2.1 of
this doc. Single source of truth: edit one, mirror in the other.

**Side-note follow-ups (not in this changelog entry — design needed):**

- **Refs everywhere, not just on form fields.** Browser agent flagged
  this as the most valuable potential feature. Currently
  `form_elements` is the only context key that ships refs; the
  vision is that any "interact-with-this-element" suggestion in the
  context (chrome_elements, page_brief.structure.main_interactive,
  result_list items, page_dismissibles) should carry a ref too —
  the agent can then do bulk operations (`form_input` array calls,
  `click_element` chains) without a `read_page` round trip.
  Implementation: walk those collectors after prewarm tags the DOM,
  thread refs through each. Bigger refactor — left as a follow-up.
- **Action-confirmation pass.** After a `click_element` /
  `form_input` / `navigate`, the response should include a small
  state-delta so the model doesn't have to re-screenshot to verify
  the action took effect. Cheap to compute (the action handler
  already knows what changed); high-value because it eliminates a
  full read_page round-trip after every interaction.
- **Main-content vs. chrome separation.** Today `page_full_content`
  ships the whole article. For non-article pages (dashboards, search
  results, forms), the model still sees footer links and sidebar
  cruft. Proposal: have the scrape pipeline emit a tagged
  `{main, chrome, sidebar, footer}` segmentation per page so the
  model can decide which slice it wants — instead of seeing the
  whole DOM mixed together.

### 2026-05-18 — Single source of truth for tab id; `page_lang` dedup

Triggered by a contract audit while shipping the unified `user` tool
(see [USER_TOOL_WIRE_CONTRACT.md](https://github.com/armanisadeghi/aidream/blob/main/packages/matrx-ai/matrx_ai/tools/USER_TOOL_WIRE_CONTRACT.md)
in aidream). Audit surfaced two no-brainer issues in how the request
body was assembled:

1. **Double `chrome.tabs.query({active:true})` per send.** Both
   `buildChatContext` and `buildBrowserDomState` were running their
   own active-tab queries. A user switching tabs in the ~50ms
   between the two queries would have sent `page_brief.tab_id` from
   one tab and `client.state["browser-dom"].current_tab_id` from
   another. The dispatcher's `assignedTabId` followed the second
   query, so tool execution could disagree with what the model saw
   in `page_brief`.
2. **`page_lang` was being fetched twice.** The probe inside the
   context builder already returned `document.documentElement.lang`;
   `buildBrowserDomState` was doing a separate `executeScript` round
   trip for the same value.

**Fix:**

- New `resolveActiveTab()` helper in
  [src/lib/chat/active-tab.ts](../src/lib/chat/active-tab.ts).
  Single `chrome.tabs.query` per send.
- Both chat hooks ([use-chat-stream.ts](../src/hooks/use-chat-stream.ts)
  and [use-pilot-chat-stream.ts](../src/hooks/use-pilot-chat-stream.ts))
  call `resolveActiveTab()` at the top of `send()` and thread the
  resulting `chrome.tabs.Tab` into BOTH builders + into
  `STREAM_START.assignedTabId`.
- `buildChatContext` (v1-flat AND v2-bundled) now accepts an optional
  `activeTab` input on `ContextBuildInputs` and uses it instead of
  re-querying. Fallback query stays for one-off / test callers.
- `buildBrowserDomState` now accepts optional `activeTab` AND
  `pageLang` opts. When `pageLang` is provided the executeScript
  call is skipped entirely. The chat hooks lift it from
  `context.page_brief.lang` after building the context.
- CLAUDE.md updated with a new convention bullet ("Active tab for
  request assembly: resolve ONCE per send") and a pointer to this
  doc at the top of the Server-integration section.

**Net effect on the wire:** every per-send tab id field
(`context.page_brief.tab_id`, `context.page_brief.window_id`,
`context.tab_state.tab_id`/`window_id`/`tab_index`/`pinned`/
`incognito`/`status`, `client.state["browser-dom"].current_tab_id`/
`current_window_id`/`page_title`/`tab_status`, and
`STREAM_START.assignedTabId`) now references the same
`chrome.tabs.Tab` object. Race is gone.

**Net effect on round trips per send:** -1 `chrome.tabs.query`
and -1 `executeScript`. Marginal but free.

### 2026-05-18 — Unified `user` tool (replaces `ask_user` + `notify_user`)

Consolidated `ask_user` / `ask_user_choice` / `ask_user_secret` and
`notify_user` into a single `user` tool with a `type` discriminator
(`confirm | choice | choice_many | text | secret | notify`).
Single result envelope per the contract:
`{ answer, selected, confirmed, action, freeform, cancelled, timed_out }`.
`type='notify'` fires a system notification AND renders the inline
card with optional action buttons + an always-present 'Other'
freeform escape hatch.

See [USER_TOOL_WIRE_CONTRACT.md](https://github.com/armanisadeghi/aidream/blob/main/packages/matrx-ai/matrx_ai/tools/USER_TOOL_WIRE_CONTRACT.md)
for the authoritative wire contract. The handler lives at
[src/lib/tools/handlers/user.ts](../src/lib/tools/handlers/user.ts);
the inline card at
[src/features/chat/AgentAskUserCard.tsx](../src/features/chat/AgentAskUserCard.tsx)
branches on `req.kind` and renders the matching variant.

`request_user_takeover` and `update_plan` were intentionally NOT
folded into `user` — they have distinct semantics (full page
handoff, plan approval) and remain standalone in the `ask` category.
