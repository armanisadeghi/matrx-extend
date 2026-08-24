# matrx-extend — System State (living document)

> The living record of what this extension can do today and how each capability
> shipped. Updated every time we ship or rip something out. This content moved
> here from CLAUDE.md in the 2026-08-20 charter rewrite
> (`common-docs/policies/claude-md-charter.md`); CLAUDE.md now carries rules +
> pointers only. Mission: build the harness that gets the world's top AI models
> begging their researchers to let them out of their current harness and into
> AI Matrx.

## ✅ What the system can do today

### Agent harness (the core)

- **165 registered client-side tools** (73 read · 136 read+action+ask ·
  full kit with privileged) wired end-to-end through SW dispatcher →
  permission gate → handler → result POST → timeline event. The
  canonical "advertised" surface is smaller — see `CANONICAL_SURFACE`
  in [src/lib/tools/categories.ts](../src/lib/tools/categories.ts) for
  the names the server actually shows agents (mega-tool routers like
  `computer`, `tabs`, `form_input` collapse many granular handlers).
- **Capability-based discovery (2026-05-01)** — every chat ships a single
  capability `browser-dom` whose only always-on tool is `load_chrome_tools`.
  The model calls `load_chrome_tools({category})` to pull in the matching
  category's tools mid-turn. Server-side discovery handler reads
  `client.state["browser-dom"]` (admin? perms? desktop bridge?) and routes
  via DB rows in `tool.definition` (joined with `tool.binding`
  where `executor_name='chrome-extension'`) — see
  [docs/MATRX_EXTEND_MIGRATION_GUIDE.md](../docs/MATRX_EXTEND_MIGRATION_GUIDE.md)
  for the post-redesign source-of-truth flow. The previously-emitted
  `types/server-handoff/browser-dom-capability.json` was retired in
  May 2026.
- **Category taxonomy redesign (2026-05-19)** — categories rebuilt
  around user mental model, not implementation surface. 14 categories
  replace the previous 17:
  - `core` — always-on discovery + batching utilities
  - `reading` — "what's on the page" (read_page, find, extract_*, …)
  - `interaction` — "do something on the page" (computer, navigate,
    form_input, clipboard, evaluate_javascript, …)
  - `tabs` — manage browser tabs / windows
  - `capture` — save artifacts (downloads, MHTML, screenshots, GIFs, video)
  - `chrome` — user's personal Chrome data (cookies/bookmarks/history),
    admin-restricted
  - `human` — talk to user (user, update_plan, request_user_takeover,
    user_todos; `tasks` is server-executed by aidream)
  - `memory` — agent state (`remember_for_domain`). Durable memory for a
    user / project / organization is the server-side `memory` tool; there is
    no client-side KV here (see the retirement note below).
  - `ai` — on-device Gemini Nano
  - `demos` — record + replay user workflows
  - `guidance` — user-saved hints for the agent
  - `devtools` — CDP + host diagnostics (admin)
  - `webmcp` — page-registered tools (admin)
  - `desktop` — matrx-local bridge
  The "advanced" junk drawer and the 1-tool categories (cookies, webmcp,
  ai-as-1-tool, interact-as-sleep-only) are gone. Per aidream's
  [tool_system_rules.md](../../aidream/docs/official/tool_system_rules.md)
  (there is no "TOOL_ROUTING_RULES.md" — that name is a phantom),
  categories are pure UX — they affect
  Tools-tab grouping and discovery helpers, NEVER routing. The LLM only
  sees (name, description, schema).
- **Drift script v3 (2026-05-27)** —
  [`scripts/check-tool-db-drift.ts`](../scripts/check-tool-db-drift.ts)
  was rewritten against the post-tool-refactor schema (see the master
  reference at
  [/Users/armanisadeghi/code/aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md)).
  It now checks three DB tables (live names — these moved a SECOND time
  in the 2026-06 schema split, out of `public` and into the `tool`
  schema; reach them via `toolDb()`):
  1. `tool.definition` — name + description + tier + admin_only +
     parameters + category. Was `tl_def`, then `tool_def`; `source_app`
     and `function_path` columns are gone.
  2. `tool.binding` — pure (tool_id, executor_name, is_active) M2M.
     Every advertised tool MUST have an active row for
     `executor_name='chrome-extension'` (or a `chrome-extension.*`
     sub-executor). Missing = resolver can't route. Was `tl_executor`,
     then `tool_binding`; `surface='matrx-extend.browser'` is no longer
     the ownership concept — the executor name is.
  3. `tool.surface_defaults` — every advertised tool MUST appear in
     `always_include_tools` for at least one of
     `chrome-extension/{assistant,pilot}`. Missing = discovery handler
     never shows it. Was `tl_def_surface`, then `tool_surface_defaults`.
     Exception by design: a tool needing live UI state is *armed* per
     conversation instead and must NOT be listed here.
  Wired into `release.sh` as before; new failure modes are surfaced
  inline + repeated in the end-of-release loud banner.
- **Global tool namespace (2026-05-19, complete; verified after the 2026-05-27 refactor)** — the
  `matrx-extend:` colon-prefix is GONE from every row in `tool.definition`.
  Three tiers replace it:
  1. **Bare global names** (~58 tools) — UI-first + everything
     Playwright can also do. Examples: `update_plan`, `user_todos`,
     `user`, `request_user_takeover`,
     `read_page`, `find`, `computer`, `tabs`, `navigate`,
     `form_input`, `evaluate_javascript`, `clipboard`, `ai`,
     `record_demo`, `replay_demo`, `desktop_run_command`, ...
     A Next.js surface that registers a handler for the same name
     shares the same `tool.definition` row — one tool, multiple impls (each
     surface's claim is its own row in `tool.binding`).
  2. **`chrome_*` bare prefix** (9 tools) — genuinely
     Chrome-extension-exclusive. Examples: `chrome_cookies`,
     `chrome_bookmarks`, `chrome_history`, `chrome_recently_closed`,
     `chrome_save_page_as_mhtml`, `chrome_tab_audio_inspect`,
     `chrome_record_gif`, `chrome_record_tab_video`, `chrome_webmcp`.
     Matches matrx_local's `local_*` convention.
  3. **`cdp_*` bare prefix** (12 tools) — Chrome DevTools
     Protocol-backed. Self-prefixed already; just dropped the colon
     namespace.
  Rule: **if Playwright can do it, we don't own the name.** The
  `tools_name_key` UNIQUE constraint is on `name` alone — that's
  load-bearing for "same name = same tool" cross-surface.
  Retired: `matrx-extend:memory` (mega-tool). Use the matrx_ai
  canonical `memory` for persistent memory.

  **Also retired — `scratchpad` and `storage` (2026-08-12, Arman's ruling).**
  Neither filled a gap and both are now deactivated in `tool.definition` with
  their bindings dropped, here and on every other client. `storage` was a
  per-user persistent KV — that is the canonical `memory` tool, rebuilt worse.
  `scratchpad` was an agent-writable in-service-worker `Map` that squatted on
  the name of `user_scratchpad`, the USER's own per-conversation document that
  the agent may read and must never write; an agent holding both was told two
  contradictory things about what a scratchpad is. An in-memory store is also
  the wrong shape on its own terms: it evaporates on a service-worker restart,
  so the agent "remembers" right up until the moment remembering would matter.
  The four `*_extension_storage` handlers died with the merged tool (nothing
  else used them). **Do not reintroduce either, and do not reuse the name
  "scratchpad" for agent state.** Per-conversation agent memory that survives a
  context reset is a real, still-unfilled gap and gets its own tool.
- **Tool registry refactor (2026-05-27, server-side)** — aidream rolled
  out a clean break of the registry schema. **NOTE: a SECOND rename
  followed in 2026-06** (the schema split moved these out of `public`
  into the `tool` schema and dropped the prefix), so the "new" names in
  this historical paragraph are themselves retired — see the vocabulary
  block further down for the live names. Old → 2026-05-27 renames:
  `tl_def` → `tool_def` (dropped `source_app`, `function_path`,
  `privileged`, `deactivated_at`; added `source_kind`,
  `managed_by_server_id`); `tl_executor_kind` → `tool_executor` (added
  `parent_executor_name` for inheritance, `mcp_server_id`);
  `tl_executor` (M2M) → `tool_binding` (pure join; `tool_id`,
  `executor_name`, `is_active`; dropped `delegated`, `priority`,
  `auto_load`, `function_path`, `source_app`); `tl_def_surface` →
  DROPPED (replaced by `tool.surface_defaults.always_include_tools` and
  `.never_include_tools` arrays per surface); `tl_gate` → DROPPED
  (gates live in matrx_ai code, referenced by name in
  `tool_def.gating` jsonb); `tl_bundle{,_member}` →
  `tool_bundle{,_member}` (schema unchanged); `cx_tl_call` →
  `cx_tool_call` (columns unchanged); `tl_mcp_*` → `tool_mcp_*`. The
  policy: **no legacy support, no shim** — old table names hit HTTP 404
  the instant the migration applied. **For the extension this is mostly
  invisible**: the capability envelope, the chat stream, and the tool
  dispatch flow are all unchanged. What did change in this repo:
  (1) [src/lib/supabase/queries.ts](../src/lib/supabase/queries.ts)
  reads `cx_tool_call` instead of `cx_tl_call` when hydrating
  conversation history with tool results;
  (2) [src/lib/tools/descriptions.ts](../src/lib/tools/descriptions.ts)
  queries `tool.definition` via Supabase REST instead of the retired
  `GET /ai-tools/app/matrx-extend` aidream endpoint;
  (3) the drift + dump scripts under `scripts/` were rewritten against
  the new tables. The 48 active `tool.binding` rows for
  `executor_name='chrome-extension'` are this extension's claim on
  tools — that's the single ownership fact. Master reference:
  [/Users/armanisadeghi/code/aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md).
- **Plan / Tasks / User-Todos (2026-07-24)** — three linked surfaces
  that pair with the existing `update_plan` flow.
  - **Plan** — what the user approved; persisted per-conversation,
    auto-populated into the tasklist on approval.
  - **Tasks** — agent's own live work items, per-conversation, with
    statuses (`pending|in_progress|done|blocked|skipped`). The canonical
    `tasks` mega-tool executes in aidream and writes `chat.agent_task`;
    the extension has no tasks handler or `chrome-extension` binding.
    Its panel reads and edits that shared table directly. Before any extension
    insert, `storage.ts` loads the named `chat.conversation`, requires its
    `organization_id`, and copies that exact value into every `agent_task` row;
    a missing/malformed parent organization refuses before insert.
  - **User todos** — work the agent assigns BACK to the user.
    `user_todos` actions: `add` (fires Chrome notification unless
    `silent:true`), `list`, `update`, `remove`, `mark_done`,
    `clear_done`. Per-conversation.
  All three slices are injected into context as `current_plan`,
  `task_list`, `user_todos` keys when non-empty — user edits flow back
  to the model on the next turn. Per-chat surface lives in the
  TaskPanel drawer (chip in chat header opens it); cross-conversation
  triage lives in the new `lists` sidepanel tab. Access at
  [src/lib/lists/storage.ts](../src/lib/lists/storage.ts); every
  local mutation broadcasts `LISTS_CHANGED`, while Supabase Realtime
  delivers aidream task writes to both task views.
- **Prospect capture — `capture_prospect` (2026-08-16, IC-10)** — the agent (or
  the user, via the "Save this site as a prospect" page context-menu item) adds
  the current page's WEBSITE to their AI Matrx prospect list.
  - 🚨 **It is not a second way to create a prospect and must never become one.**
    The handler ([src/lib/tools/handlers/prospects.ts](../src/lib/tools/handlers/prospects.ts))
    posts to aidream's `POST /api/seo/prospect-capture[/preview]`
    ([routes/prospects.ts](../src/lib/api/routes/prospects.ts)), which is the
    platform's ONE prospect-import path with a single entry — so the user's
    blocklist (enforced at ingestion), the party resolver's domain
    normalization, and de-duplication against their triage list all apply
    unchanged. This module reaches no database and carries no domain normalizer;
    both are grep-guarded in `tests/unit/prospect-capture.test.ts`.
  - **`action: 'preview'` is the default and is READ-tier** (writes nothing);
    `'capture'` is action-tier via `tierFor`. Preview reports the verdict, which
    of the user's websites it would land in, and whether the company is ALREADY
    a relationship (previous messages, campaigns, confirmed wins, do-not-contact).
  - **Never guesses the site.** With several websites the server answers 409 and
    the tool asks the user; `site_id` comes back on the next call.
  - **Captures a COMPANY, never a person.** Contact capture is a separate,
    unbuilt tool owned by the enrichment work package.
  - Cross-repo contract: `/Users/armanisadeghi/code/common-docs/projects/outreach-system/INTEGRATION_MAP.md` (IC-10) · server contract: `/Users/armanisadeghi/code/aidream/aidream/services/seo/FEATURE.md` § Browser prospect capture.
- **Reviewed Gmail send — `google_email_send` (2026-08-18)** — the agent composes ONE
  email and stops; the user sends it.
  - 🚨 **The card IS the authorization.** This tool has **no server executor anywhere in
    the platform** — its only `tool.binding` rows are CLIENT runtimes (`matrx-user` for the
    web app, `chrome-extension` for this one). That absence is the Gmail boundary, not an
    oversight: there is no server path an agent could take to send mail, and no argument it
    can set that stands in for consent. **Never add a server binding, and never add a
    `user_confirmed`-style argument** — the agent must have no vocabulary for consent.
  - [GmailReviewCard.tsx](../src/features/chat/GmailReviewCard.tsx) shows the sender account,
    To, Cc, Subject and Message with **every field editable**, and its Send button posts
    exactly what is on screen at that moment — never the agent's arguments once the user has
    edited them. There is deliberately **no "always send", no remembered domain, and no path
    that sends without a click** (note the contrast with action-tier tools, where "allow +
    remember for this conversation" is offered — that must never exist for sending mail).
    Approval covers ONE message. A failed send leaves the card OPEN saying nothing was sent.
  - [handlers/google-email-send.ts](../src/lib/tools/handlers/google-email-send.ts) is
    `ask-user` tier: it resolves the mailbox, raises an `email_review` pending ask on the
    normal `TOOL_ASK_USER_REQUEST` channel, and reports the outcome. **It sends nothing** —
    grep-guarded. Declining is a normal outcome (`{sent:false, declined:true}`), dismissal
    and expiry are `cancelled`, and a `confirmed` with no send receipt is reported as a
    FAILURE — a send we cannot evidence is never reported as success.
  - The ONE door is `POST /api/google-workspace/gmail/send-reviewed`
    ([routes/google-workspace.ts](../src/lib/api/routes/google-workspace.ts)), real user JWT
    only. `user_confirmed: true` is a literal at that single call site, reached only from
    the Send button (test: exactly one occurrence, never in the handler or the card).
  - **No new OAuth client and no new token store.** The mailbox comes from
    [lib/google/connection.ts](../src/lib/google/connection.ts), which reads SAFE metadata
    from `users.integration_connections` (status + credential reference + `gmail.send`
    scope) — the refresh token stays in aidream's vault. RLS on that table excludes
    anonymous JWTs, so a guest is told to sign in rather than to connect an account they
    could not see.
  - **Scope boundary (approved, do not exceed):** `drive.file` (only files the user picks or
    that AI Matrx creates), `gmail.send` (one reviewed message), `webmasters.readonly`,
    identity. Never Drive browsing, never Gmail reading, never a new scope.
  - **How it reaches the agent** — and this is worth knowing before you edit any surface
    row: the extension's always-on set is **every tool with an active `chrome-extension`
    binding**. `_build_auto_load_specs` in aidream's `matrx_ai/capabilities/browser_dom.py`
    says so explicitly ("No surface-defaults lookup is needed") and never reads
    `tool.surface_defaults`. So the `tool.binding` row IS the advertisement here — it takes
    effect on the next `POST /admin/tool-routing/cache-bust` (or server restart), because
    that spec list is process-cached.
  - Its sibling **`google_workspace`** (Docs/Sheets + `prepare_email`) is **server-executed**
    (executor `aidream`) — the extension has no handler for it, only a chat row config.
    **Corrected 2026-08-24:** it IS reachable from extension conversations on an
    **attached-file turn** — when the user attaches a registered Doc/Sheet, the server's
    `__google_files` handling injects `google_workspace` for that turn regardless of this
    surface's manifest (see the Google file attach entry below). What remains true, and is
    still open, is the **general** case: on a turn with no attached file, the tool is not
    advertised here. The `google` bundle was added
    to `chrome-extension/{assistant,pilot}`'s `always_include_bundles`, but that array is only
    read by `resolve_surface_manifest`, which runs only when a request declares
    `client.surface` — and this extension declares `capabilities: ['browser-dom']` with the
    surface nested in `client.state['browser-dom'].surface` instead. **Open work:** have the
    extension declare `client.surface: 'chrome-extension/{assistant,pilot}'` (both
    `ui.ui_surface` rows exist and point at the `chrome-extension` executor) so bundles and
    surface defaults apply here the way they do on `matrx-user/chat`. Until then, adding a
    tool to a bundle does nothing for this client — add the binding.
  - Cross-repo contract:
    `/Users/armanisadeghi/code/common-docs/projects/google-oauth-verification/PRODUCTION-ROLLOUT.md`
    · web-app twin: matrx-frontend `features/google-workspace/`. Tests:
    `tests/unit/google-email-send.test.ts`.
- **Google file attach — `__google_files` (2026-08-24)** — the user attaches a Google Doc
  or Sheet to a chat turn from the composer, and the agent can read and edit that one file.
  - **Files chip** in the composer toolbar, beside the settings chip and **always present** —
    a user with nothing connected still finds the affordance, and the popover explains the
    feature and links to `https://aimatrx.com/user-settings/integrations/google-workspace`.
    [src/features/chat/GoogleFileAttachmentChip.tsx](../src/features/chat/GoogleFileAttachmentChip.tsx).
  - **The list is registered resources only** — `users.integration_connection_resources` rows
    for the user's healthy `drive.file` connections, read direct from Supabase under RLS
    ([src/lib/google/files.ts](../src/lib/google/files.ts)). **Not a Drive browse**, and there
    is no Drive browse anywhere in the platform: a row exists only because the user picked
    that file with the Google Picker on the web app (or AI Matrx created it). The connection
    health rule is the single one in
    [src/lib/google/connection.ts](../src/lib/google/connection.ts) —
    `listHealthyGoogleConnections(scope)`, which `resolveGmailSendConnection()` now also uses.
  - **The tray is sticky per session** ([src/state/google-files.ts](../src/state/google-files.ts)),
    same semantics as the highlight tray, and resolved once per send in `use-chat-stream`.
  - **On the wire:** the reserved context key `__google_files`, a **plain array of Drive file
    id strings** — never an object wrapper, never content blocks. The server resolves the ids
    against the user's registered resources, names the files for the agent, **and injects the
    `google_workspace` tool for that turn**, which is why this works with no server change and
    no surface-declaration change. Server side: aidream
    `services/google_workspace/attachments.py`. Contract:
    [docs/REQUEST_PAYLOAD_CONTRACT.md §2.2](./REQUEST_PAYLOAD_CONTRACT.md).
- **Agent-safe browser login — `credential_login` (2026-07-26)** — the agent
  asks for a login and never learns the credential. One action-tier handler
  ([src/lib/tools/handlers/credential-login.ts](../src/lib/tools/handlers/credential-login.ts))
  does resolve → materialize → fill → submit → verify inside a single `run()`;
  the plaintext lives in one `const` in that scope and nowhere else.
  - **The current contract is `auto | discover | attempt | report`.** `auto`
    runs the safe one-click recipe used by the Vault panel. `discover`
    returns field names and non-secret preset values only. `attempt` accepts a
    complete field map (Vault `field_key` or an explicitly non-secret literal),
    selectors, an explicit submit method, and optional non-secret expectations
    (including a post-submit success URL prefix).
    `report` records a leak or wrong-verdict report. There is no agent-supplied
    destination URL, username, password, TOTP seed/code, or arbitrary script
    argument. Every call names its action; there is no hidden legacy arm. The
    extension derives the real tab origin itself
    (`getAssignedTab`), and injection is `frameIds: [0]` — top frame only.
  - **Refusals happen before any decrypt:** non-https (except loopback), not
    the top frame, a live page origin that disagrees with the tab, or a
    materialize response authorized for a different origin.
  - **Server contract** lives in
    [src/lib/api/routes/vault.ts](../src/lib/api/routes/vault.ts) —
    `/api/vault/browser-login/{matches, {id}/materialize, {id}/result, report}`, all
    through the one `apiPost` client and all gated on a REAL user JWT. The
    guest-fingerprint identity the rest of the extension treats as
    first-class is rejected server-side for this flow, so it is
    short-circuited here rather than failing opaquely.
  - **Returns a fixed status plus safe evidence, never page or credential
    content.** Attempt results include `verdict`, bounded `confidence`, named
    boolean `signals`, sanitized before/after origin+path metadata, elapsed
    time, and a machine-readable `feedback.how_to_report` contract. Statuses
    also include `discovery_ready`, `report_received`, and `spec_incomplete`;
    `unknown` is NOT success. MFA and CAPTCHA are never bypassed — they stop for
    user takeover. If submission never proceeds, filled fields are cleared.
  - **Redaction is no longer password-centric.** Every page-reading tool used
    to key on the live `type === 'password'`, so a filled USERNAME was echoed
    verbatim and a "show password" toggle un-redacted the password itself.
    Redaction is now the OR of **the marker attribute
    (`data-matrx-sensitive`) OR the extension's own filled-field memory OR the
    legacy password check** — contract + consumer list in
    [src/lib/credentials/sensitive-fields.ts](../src/lib/credentials/sensitive-fields.ts),
    applied in `read_page`, `get_form_fields`, `query_elements`, and the
    inspect family. Page-controlled DOM state is never the only defence, so a
    page that strips the attribute or rewrites the input type changes nothing.
  - **Advertised on the live Chrome-extension binding.** The
    `tool.definition` + `tool.binding` rows are the runtime source of truth
    (`admin_only=false`, `tier=action`, `category=credentials`). Keep the DB
    input schema synchronized with this handler via the strict catalog drift
    check whenever the union changes.
  - Plan: `/Users/armanisadeghi/code/common-docs/projects/credential-sharing-browser-login/PLAN.md`.
    **Picking this up cold?** Read
    `/Users/armanisadeghi/code/common-docs/projects/credential-sharing-browser-login/HANDOFF.md`
    first — vision, gap analysis, cross-repo architecture, next steps, landmines.
    Tests: `tests/unit/credential-login-leak.test.ts` (plaintext egress across
    every channel + wrong-origin/unsafe-destination refusal + two-step flow +
    clear-on-stall) and `tests/unit/credential-redaction.test.ts` (each
    redaction signal defends alone, plus a grep guard over the four sites).
  - **GET forms are refused before decrypt/fill.** The probe reads the owning
    form's normalized method (`get` is also the browser default when omitted),
    and the submit primitive independently refuses GET again. Credentials never
    enter a URL, history entry, Referer header, or page-inspection result.
  - **Two intentionally open boundaries:** local-Chrome delegated TOTP cannot
    be completed until aidream has a server-to-local command channel that can
    type the code without returning it over HTTP; the seed and generated code
    must remain inside aidream. Full screenshot/HTML artifact custody also
    waits for a canonical local-browser run/artifact store. The current result
    therefore carries sanitized metadata only; do not add a code-return API or
    ad-hoc artifact store to work around either boundary.
- **Reference-ID system** — `read_page` tags every interactive element with
  `data-matrx-ref="N"` and returns refs (`ref:N`) the agent passes to
  interaction tools instead of brittle CSS selectors. Refs survive DOM
  mutations within the same page lifetime; invalidate on navigation.
  `click_element`, `type_into_element`, `scroll_page` (into-view),
  `hover_element`, `focus_element`, `blur_element`, `right_click_element`,
  `press_keys`, `select_dropdown_option`, `set_checkbox`, `set_radio`,
  `submit_form`, `file_upload` all accept either `ref` or `selector`.
- **`find` (NL element search)** — natural-language description in,
  matching refs out. Uses on-device Gemini Nano with a JSON-Schema
  constraint when available; falls back to text similarity.
- **`chrome_batch`** — execute up to 20 read-tier tool calls in one round
  trip. Action / privileged tools require their normal individual approval.
- **`update_plan`** — agent proposes a step-by-step plan; user approves /
  rejects with optional note before execution begins.
- **4-tier permission model:** `read` (auto) · `action` (Ask/Act) · `ask-user`
  (renders question card) · `privileged` (always confirms, even in Act mode).
- **4 tool bundles:** core (always-on, 28 entries — agent's default surface) ·
  assistant (73 read-tier tools) · pilot (136: read+action+ask) ·
  pilot+privileged (165, trusted agents only).
- **Per-conversation tab assignment (2026-05-06)** — when the user
  sends a message, the active tab at that moment is latched as the
  agent's `assignedTabId` for that turn. All client-side tool handlers
  (`read_page`, `click_element`, `take_screenshot`, etc.) operate on
  the assigned tab, NOT on whatever tab Chrome considers active. The
  user can switch tabs mid-execution without disrupting the agent.
  Re-assignment happens on the next user message — switch tabs, send
  again, agent shifts focus. See `getAssignedTab` in
  [src/lib/tools/handlers/_active-tab.ts](../src/lib/tools/handlers/_active-tab.ts).
- **Two surfaces:** Assistant Chat tab · Pilot tab (admin-only, drives a
  sandboxed Chrome tab group with the full read+action+ask agent toolkit —
  see Roadmap item #9).
- **Per-agent permission mode** — "Ask before acting" / "Act without asking",
  user-toggleable in chat header chip, persisted per agent.
- **Domain trust** — "Allow + remember for this conversation" auto-allows
  subsequent action calls on the same host inside the same chat.
- **Inline approval cards** — `AgentApprovalCard` for confirms,
  `AgentAskUserCard` for ask-user (radio for choices, masked input for secrets,
  textarea otherwise), `ToolTimelineRow` for completed/failed calls.
- **Full type safety** — every tool has a Zod schema, dispatcher validates args
  before run, schema failures surface as structured errors.
- **Structured content renders through the SHARED Content IR components
  (2026-08-23)** — inbound `render_block` events used to be logged and thrown
  away, so a flashcard deck, a quiz or a search result set arrived as raw text
  or not at all. The extension now consumes `@ai-matrx/content-ir` (the kernel)
  and `@ai-matrx/content-ir-react` (the render layer) and routes every server
  envelope through the SAME `applyIrKindRoute` matrx-frontend uses.
  - **Detection stays server-side.** This client never parses a raw chunk — the
    server detects, validates against the registered schema, and sends the
    envelope on `metadata.__ir`. That is the designed division of labour for a
    thin client; a client-side parser is the banned "bespoke stream renderer".
  - **Registration is explicit, in the DB.** `content_ir.kind_component` rows
    with `platform='chrome-extension'` name a component key; the dispatch table
    in [src/components/kinds/dispatch.tsx](../src/components/kinds/dispatch.tsx)
    maps it. Registered today: `markdown` · `web_search_results` /
    `google_search_results` / `news_search_results` · `flashcard_set` ·
    `quiz_set`. Everything else lands on the generic structured floor, which
    says so in a muted footer — never a silent lookalike.
  - **Panel-sized components, same kinds.** `kind_component.platform` exists so
    a 400px side panel draws a kind differently from a 1200px page; cards flip,
    quizzes are answerable, results are a compact link list.
  - **Block mode wins.** A message that receives any render block stops
    accepting chunk text (aidream replaces chunks with blocks; the workflow
    channel marks the duplicate `block_shadowed`), so nothing renders twice.

### Tool categories (the discovery system)

> **2026-06-10 audit correction:** the table that used to live here listed
> the RETIRED 16-category taxonomy (`page`, `interact`, `forms`, `history`,
> `files`, `ask`, `advanced`, `debug`, `cookies`, …) and tool counts that no
> longer matched code — it predated the 2026-05-19 redesign described at the
> top of this file. The authoritative taxonomy is the **14 categories** in
> [src/lib/tools/categories.ts](../src/lib/tools/categories.ts) (`core`,
> `reading`, `interaction`, `tabs`, `capture`, `chrome`, `human`, `memory`,
> `ai`, `demos`, `guidance`, `devtools`, `webmcp`, `desktop`); the live tool
> roster is `pnpm catalog:tools:md` →
> [types/tool-catalog.md](../types/tool-catalog.md). The registry currently
> holds ~169 handlers; the advertised surface is `CANONICAL_SURFACE`
> (~95 names). Don't re-add a hand-maintained table here — it drifts.

The agent only sees the always-on discovery surface upfront; everything
else loads on demand via `load_chrome_tools({category})` (server-side
discovery handler).

### Tool list

> **For the authoritative live list, regenerate with `pnpm catalog:tools:md`
> and read [types/tool-catalog.md](../types/tool-catalog.md). Counts and
> rosters drift between releases — the highlights below are the things
> worth knowing about; don't treat them as exhaustive.**

#### Core (always advertised; 13 tools + 15 discovery tools = 28-entry surface)
- `list_chrome_categories` — discovery root (returns category index)
- `list_core_tools` — what's in core itself
- `chrome_batch` — N read-tier calls in one round trip
- `get_active_tab`, `take_screenshot`
- `read_page` — accessibility tree + ref system
- `find` — natural-language element search returning refs
- `navigate_active_tab`, `navigate` (canonical mega-tool)
- `click_element`, `type_into_element` (accept ref OR selector)
- `computer` (canonical mega-tool: click / type / key / scroll / screenshot
  under one schema)
- `ask_user`

#### Read tier (73 tools total across categories)
- **Page reading:** `get_active_tab`, `get_page_selection`, `read_active_page`
  (full scrape with `deep:true` for lazy loaders), `take_screenshot`,
  `query_elements`, `read_page` (ref system), `find` (NL search),
  `get_page_text` (Readability-style extraction)
- **Surgical inspection:** `find_text_on_page`, `get_page_links`,
  `get_computed_style`, `get_element_at_point`, `inspect_element`
- **Browser context:** `list_open_tabs`, `get_tab_groups`, `get_tab_info`
- **Personal data:** `search_bookmarks`, `list_bookmark_tree`, `search_history`,
  `list_recent_history`, `list_downloads`
- **Forms:** `get_form_fields`
- **On-device AI** (free, on-device, no network — Gemini Nano + siblings):
  `ai_check_availability`, `ai_summarize`, `ai_classify`, `ai_extract_json`,
  `ai_translate`, `ai_detect_language`, `ai_proofread`, `ai_describe_image`
  (multimodal), `ai_check_prompt_injection`
- **Sessions** (optional perm): `list_recently_closed`
- **CDP read** (admin + optional `debugger` perm): `cdp_attached_tabs`,
  `cdp_a11y_tree`, `cdp_perf_metrics`
- **Cookies read** (admin + optional `cookies` perm): `get_cookies`
- **WebMCP** (admin): `webmcp_check_availability`, `webmcp_list_page_tools`

#### Action tier (~62 handlers, including canonical mega-tools)
- **Page interaction (now ref-aware):** `navigate_active_tab`, `click_element`,
  `type_into_element`, `scroll_page`, `wait_for`, `set_clipboard`
- **Keyboard / mouse:** `press_keys`, `hover_element`, `focus_element`,
  `blur_element`, `right_click_element`
- **Form actions (ref-aware):** `select_dropdown_option`, `set_checkbox`,
  `set_radio`, `submit_form`, `file_upload` (NEW — base64 file blobs into
  `<input type="file">` via DataTransfer; bypasses the native dialog the
  agent can't see)
- **Tab control:** `open_new_tab`, `close_tab`, `switch_to_tab`,
  `duplicate_tab`, `pin_tab`, `mute_tab`, `reload_tab`, `go_back`,
  `go_forward`, `set_tab_zoom`, `move_tab`
- **Tab groups:** `create_tab_group`, `add_tabs_to_group`,
  `remove_tabs_from_group`, `update_tab_group`
- **Files / notify:** `download_url`, `cancel_download`, `notify_user`
- **Sessions** (optional perm): `restore_recently_closed`
- **Page archive** (admin + optional `pageCapture` perm): `save_page_as_mhtml`
- **WebMCP** (admin): `webmcp_call_page_tool`

#### Ask-user tier (4 tools)
- `ask_user`, `ask_user_choice`, `ask_user_secret`, `request_user_takeover`,
  `update_plan` — propose a step-by-step plan; user approves before
  execution.

#### Privileged tier (~30 tools, action variants of admin/CDP categories)
- **Page-level (general):** `execute_javascript`, `inject_stylesheet`,
  `remove_stylesheet`, `desktop_run_command`
- **Cookies write** (admin + `cookies` optional perm): `set_cookie`,
  `delete_cookie`
- **Demos:** `replay_demo` (action; can click / type / submit so always
  asks for confirm) — see Demos category for record/list/describe/delete.
- **CDP** (admin + `debugger` optional perm): `cdp_attach`, `cdp_detach`,
  `cdp_full_page_screenshot`, `cdp_input_click_xy`, `cdp_input_type`,
  `cdp_network_capture_start`, `cdp_network_capture_drain`,
  `cdp_network_capture_stop`, `cdp_network_get_body`, `cdp_print_pdf`,
  `cdp_emulate_device`, `cdp_clear_emulation`, `read_console_messages`,
  `read_network_requests`, `get_request_body` (CDP captures
  `Runtime.consoleAPICalled` + `exceptionThrown`, filterable by level
  and regex)

#### Demos & Guidance — user-saved clues for the agent
- **`demos` (5 tools):** `record_demo`, `list_demos`, `describe_demo`,
  `replay_demo` (privileged), `delete_demo`. Self-healing selector
  chain (matrx-ref → id → testid → ARIA → text → CSS path) survives
  DOM churn between recording and replay.
- **`guidance` (4 tools):** `save_guidance_note`, `list_guidance`,
  `get_guidance_item`, `delete_guidance_item`. Domain-scoped notes,
  screenshots, GIFs, and demo references; auto-attached to the agent's
  context whenever the user opens a tab on the matching domain.
  Captured artifacts are created via the Guidance side-panel tab.

### Side-panel tabs

- **Chat** — current Assistant surface, ships read-only tools to agents
- **Tasks** — research scrape queue, agent-driven mode
- **Agenda** — multi-surface scheduled agent runs. Tasks stored in
  Supabase (`agenda_task` + `agenda_run`). SW alarm scans every minute.
  Triggers: one-shot, interval, cron, context-match, heartbeat.
  - **Ask mode**: SW fires Chrome notification → click opens sidepanel
    + focuses task → user clicks Run-now.
  - **Auto mode**: SW first attempts a sidepanel broadcast
    (`AGENDA_RUN_NOW`). If sidepanel is open, runs immediately, no
    click. If closed, falls back to notification.
  - **Run-now button** (sidepanel) calls `runTask()` which switches the
    sidepanel to chat, primes selectedAgentId + selectedConversationId,
    then sends the task's prompt through the normal chat-stream
    pipeline. Stream events are filtered by runId so a parallel manual
    chat doesn't accidentally finish an agenda run row.
  - **Default agent**: `443dd7ff-e7cc-47b8-907a-0a14834caa48`. Override
    per task via `agent_id`.
  - **Heartbeats**: persistent_conversation_id captured from the first
    run's STREAM_OPENED, then reused on every subsequent run so the
    agent keeps memory across pulses.
  See [src/lib/agenda/](../src/lib/agenda/) and the schema in
  [migrations/2026_05_10_sch_v0.sql](../migrations/2026_05_10_sch_v0.sql).
  Storage layer (2026-05-10): the `agenda_task` / `agenda_run` tables
  were replaced by the kind-agnostic `sch_*` scheduling spine —
  `sch_task` ⋈ `sch_agent_task` (1:1) ⋈ `sch_trigger` (many) ⋈
  `sch_run`. The TypeScript `AgendaTask` / `AgendaRun` types are now
  façade shapes built from those joins; future scheduling kinds
  (workflows, scrapes, webhooks, user-actions) will land as sibling
  `sch_<kind>_task` tables without touching the agenda façade.
- **Scrape** — manual page capture pipeline
- **Data** — pattern picker + apply
- **Guidance** — user-saved clues for the agent: domain-scoped notes,
  screenshot grabs, GIF recordings, demo references. Whatever's saved
  for the current page's domain is auto-attached to every chat sent
  from that domain. Backs the `guidance` tool category.
  **Cloud-synced (2026-06-10, TASK-004):** guidance *metadata* persists to
  `public.wbx_guidance` (not just the artifact bytes in `cld_files`), so it
  follows the user across machines. DB is the source of truth;
  `chrome.storage.local` is an offline cache. Every `saveGuidanceItem` /
  `deleteGuidanceItem` best-effort mirrors to the cloud
  ([src/lib/guidance/cloud-sync.ts](../src/lib/guidance/cloud-sync.ts)); a
  sign-in hydration ([src/hooks/use-guidance-sync.ts](../src/hooks/use-guidance-sync.ts))
  merges cloud→local last-write-wins. **Demo bodies sync too (2026-08-09):** a
  `demo_ref` is only a pointer, so the recorded demo itself travels through
  `extend.wbx_demo` ([src/lib/demos/cloud-sync.ts](../src/lib/demos/cloud-sync.ts))
  and hydrates in the same sign-in pass — plus an on-miss repair so a ref opened
  before the hydrate pulls its own body. When a body genuinely isn't reachable
  (signed out), the Guidance preview says so and `replay_demo` returns
  `error: 'demo_body_unavailable'` (distinct from `demo_not_found`), never a
  silent failure.
- **SEO** — audit + AI recommendations
- **Notes** — list / search / folder picker / editor for user-authored
  notes (separate from guidance — notes are general personal text;
  guidance is agent-facing clues). Creates require the organization already
  carried by the authenticated request and include it explicitly; a missing
  request organization fails before Supabase.
- **Files** — recent discoverable library files plus cross-page extension
  captures. Opens canonical `/files/f/{id}` viewers, inspects the live
  `get_file_resource_family` inventory, and attaches/detaches a canonical
  `file → conversation` edge for the current chat. The existing Screenshots
  tab remains the current-page capture surface. The icon rail scrolls
  horizontally at narrow side-panel widths so the expanded tab set stays
  reachable instead of shrinking or clipping.
- **Vault** — the password-manager surface over the unified credential
  Vault (`{BACKEND}/api/vault/*`). Signed-in only: the extension's guest
  fingerprint identity is rejected for credentials **by design**, so
  [src/lib/api/routes/vault.ts](../src/lib/api/routes/vault.ts) short-circuits
  every call on `hasRealUserToken()` before a request goes out. Top strip =
  the everyday path: the logins the SERVER approves for the CURRENT tab
  (`POST /browser-login/matches`) with **Use here**, which runs the SAME
  `credential_login` handler the agent runs — one code path, so the human
  button can never fill where the agent could not. Below it: search,
  **Mine / Shared with me**, per-item browser-fill toggle, "add this page as
  a login URL", and create-from-this-page (`definition_key: website_login`).
  **Rules:** masked by default (`value_hint` is a server mask, never a
  value); a revealed value comes only from `POST /items/{id}/reveal` and
  lives ONLY in [transient-secret.ts](../src/lib/credentials/transient-secret.ts)
  (auto-clears ~30s, dropped on unmount, never storage / a store / a log /
  model context); both plaintext routes pass `silent: true` so a malformed
  2xx body can't be quoted into the debug log; destination rules
  (https-or-loopback, match modes) live once in
  [login-urls.ts](../src/lib/credentials/login-urls.ts) and are imported by
  both the panel and the tool. **Management (2026-08-22):** rename / login
  URLs / match rule / notes (`PATCH /items/{id}`), change a field value
  (`PUT /items/{id}/fields/{fid}/value`), add / remove a field, delete the
  item — every typed value is plaintext OUT once from component-local state
  over a `silent:true` call, dropped on resolve, then the item is refetched
  so the list only ever holds the server mask. Controls are gated on the
  server's `capabilities.can_edit` / `can_manage`. Sharing / transfer /
  ownership / attachments are deliberately NOT rebuilt here — they link out
  to `/vault` on the web. Guarded by `tests/unit/vault-panel.test.ts`.
- **Save this login? — page-driven Vault capture (2026-08-22)** — the
  password-manager save prompt, no agent involved. Content bridge
  ([src/lib/content/bridge.ts](../src/lib/content/bridge.ts)) lazily mounts
  [capture-detector.ts](../src/lib/credentials/capture-detector.ts) once a
  password box exists; on submit / Enter / submit-click it snapshots
  `{loginUrl, username, password}` (refusing GET forms, change-password
  forms, OTP boxes) and posts ONE raw envelope
  (`CREDENTIAL_CAPTURE_CANDIDATE`) to the SW host
  [capture-candidates.ts](../src/lib/credentials/capture-candidates.ts) — raw
  because `on()`/`send()` log payloads. The host gates (Settings flag
  `captureLoginsEnabled`, real JWT, per-origin "never" list in
  [capture-settings.ts](../src/lib/credentials/capture-settings.ts), the
  SAME https rule as the fill tool), holds the value in SW memory only (3-min
  TTL, dropped on decision / tab close), resolves existing logins via
  `/browser-login/matches`, and prompts the tab after its load completes
  (1.5 s fallback for SPA logins) with METADATA only: the on-page closed
  Shadow-DOM toast ([capture-prompt.ts](../src/lib/credentials/capture-prompt.ts))
  and the Vault-tab twin
  ([PendingCaptureCard.tsx](../src/features/vault/PendingCaptureCard.tsx)).
  Decisions: save → `createVaultItem` (website_login, fill on); update → PUT
  the matched item's password field (or add one); never → origin list;
  dismiss. Settings → Privacy toggle + "Never ask on these sites". No new
  manifest permission; CWS risk gate stays green. Guarded by
  `tests/unit/credential-capture-prompt.test.ts` (detector cases, host
  lifecycle, plaintext-egress greps).
- **Tools** — full visible catalog of every tool, search + filter, JSON
  argument editor, **Run** button per tool that flows through the same
  dispatcher path the agent uses. Use this to test capabilities directly.
- **Settings** — user prefs (no operational controls)
- **Profile** — user account + voice/language preferences (TASK-002).
- **Showcase** (admin today; user-facing once stable) — the driver surface
  for the data-extraction system: 12 sub-tabs (Doctor, Recipes, Prepare,
  Snapshot, JSON-LD, Microdata, Tables, Framework, AI Extract, List
  Pattern, Network, Patterns) over the shared `src/lib/data-pattern/`
  primitives. **2026-06-10 overhaul** (full audit + 11 remediation
  batches; plan at `~/.claude/plans/we-are-having-some-vast-starfish.md`):
  - Shell: horizontal-scroll tab strip (fade edges); ALL sub-tabs
    forceMounted with visibility-gated probes; active sub-tab persisted
    (`useShowcaseTabStore` → chrome.storage).
  - Correctness: rows/detection/source reset on navigation with
    out-of-order guards (`useExtraction`); patterns save under the page
    rows were EXTRACTED on (ExtractionSource threading); append schema
    inferred from the union of all rows with ONE shared key mapper
    (`buildFieldNameMap`) so create/append collision suffixes match.
  - Lifecycle: UNIQUE(user_id,domain,name) on wbx_pattern (migration
    2026_06_10, auto-suffix on conflict), delete/rename inline in
    PatternsTab, recipes live in `public.wbx_recipe` (bundled list =
    seed + offline fallback via `loadRecipes()`).
  - Real re-run for interactive kinds (`runSavedPattern` in
    [src/lib/data-pattern/run-interactive.ts](../src/lib/data-pattern/run-interactive.ts)):
    ai_extract re-runs the agent against the current page; network_capture
    does guided auto re-capture (inject-on-reload taps, 20s window,
    key-path rows). NetworkNoMatchError = guidance, not 'broken'.
  - Agent integration: `data_patterns` mega-tool
    (list/describe/recipes/run/save/delete — registered in tool_def +
    tool_binding + surface defaults, 81 advertised tools), dynamic
    `saved_patterns_for_domain` context key, and "Send to agent" staging
    on every ResultPreview.
  - Hardening: stream watchdog on AI extraction, picker cancel/nav-watch/
    fresh-mount, network capture tab-scoped + 500-event cap, framework
    dump extracted to a tested module (`framework-dump.ts`).
  Verify paths: docs/feature-tests.md → "Showcase — *" entries.
- **Debug** (admin) — verbose logging, telemetry, optional perms toggles

### Catalog generators

- `pnpm catalog:tools` — writes `types/tool-catalog.json` (code-sourced:
  structural contract only)
- `pnpm catalog:tools:md` — adds `types/tool-catalog.md`
- `pnpm docs:tools` — writes `docs/TOOLS.generated.md` **from the DB**
  (`tool.definition` joined with `tool.binding` where `executor_name='chrome-extension'`).
  This is the ONLY repo copy of tool descriptions (Rule 4,
  [docs/TOOL_SOURCE_OF_TRUTH.md](../docs/TOOL_SOURCE_OF_TRUTH.md)).

Code-sourced entry: `{ name, tier, input_schema (JSON Schema 7),
required_permissions, surface_bundles }`. Diffable against the DB.
**Descriptions are NOT in code** — they live only in `tool.definition` and are read
live for UI via [src/lib/tools/descriptions.ts](../src/lib/tools/descriptions.ts)
(approval card, Tools tab) and the client discovery / WebMCP / frontend-bridge
tools. Never reintroduce a hardcoded `description` on a `ToolHandler`.

### Reference docs

- [`.research/2026-04-30-browser-agent-frontier.md`](../.research/2026-04-30-browser-agent-frontier.md) —
  competitive intelligence, frontier capabilities, 7,102-word research.
- [`.research/tool-db-comparison-task.md`](../.research/tool-db-comparison-task.md) —
  spec for the agent that will diff our catalog against `tool.definition` in
  Supabase. Hand to a DB-connected agent; result → `tool-db-comparison-result.md`.

---

## 🚧 Roadmap — frontier capabilities

> Ordered by leverage / risk. ✅ shipped · 🔨 in progress · 📋 planned.

### 1. ✅ Foundation — full tool harness
Done: 96 tools, dispatcher, approval UI, Tools tab, catalog, research,
admin-only filtering, optional-permission gating.

### 2. ✅ On-device AI (`chrome.ai` / Gemini Nano Prompt API)
**Why:** free, offline, multimodal, JSON-Schema response constraints. Speed
doesn't matter when it's free and runs in the background.

Tools shipped:
- [x] `ai_check_availability` — probe per-API availability
- [x] `ai_summarize` — Summarizer API w/ languageModel fallback
- [x] `ai_classify` — JSON-Schema-constrained classifier
- [x] `ai_extract_json` — schema-constrained structured extraction
- [x] `ai_translate` — Translator API w/ auto-detect
- [x] `ai_detect_language` — LanguageDetector API
- [x] `ai_proofread` — Proofreader API w/ languageModel fallback
- [x] `ai_describe_image` — multimodal (text + image) prompt
- [x] `ai_check_prompt_injection` — guardrail for untrusted page content

Implementation: `src/lib/onbox-ai/client.ts` — feature-detects across
multiple known API shapes (`globalThis.LanguageModel`, `window.ai`,
`chrome.aiOriginTrial`); each tool returns
`{ ok: false, availability: 'unavailable' }` when the API is missing so the
agent can fall back to cloud.

### 3. ✅ `chrome.debugger` + CDP (the master key) — admin-only
**Why:** single permission collapses 5+ capability gaps competitors avoid.
The "is being debugged" banner is the friction; we make it graceful.

Tools shipped (all admin-only + require `debugger` optional permission):
- [x] `cdp_attach`, `cdp_detach`, `cdp_attached_tabs`
- [x] `cdp_full_page_screenshot` — `Page.captureScreenshot` w/ `captureBeyondViewport`
- [x] `cdp_a11y_tree` — `Accessibility.getFullAXTree`
- [x] `cdp_network_capture_start` / `_drain` / `_stop` — buffered Network
      events with lazy body fetch via `cdp_network_get_body`
- [x] `cdp_input_click_xy` — `Input.dispatchMouseEvent` (bypasses shadow DOM,
      OOPIFs)
- [x] `cdp_input_type` — `Input.insertText`
- [x] `cdp_print_pdf` — `Page.printToPDF`
- [x] `cdp_perf_metrics` — `Performance.getMetrics`
- [x] `cdp_emulate_device` / `cdp_clear_emulation` — viewport + UA override

UX shipped:
- [x] `debugger` in `optional_permissions`; runtime-grant from Settings →
      Advanced agent capabilities
- [x] Dispatcher gate — tools that need `debugger` return a structured
      "permission not granted" error if the toggle is off
- [x] Admin-only filtering — non-admin users never see CDP tools advertised

UX still planned:
- [ ] Visible "Debugging tab N — stop" badge in side panel when attached
- [ ] Auto-detach after stream ends
- [ ] `cdp_dom_snapshot` (`DOMSnapshot.captureSnapshot`)
- [ ] `cdp_emulate_geolocation`

### 4. 🔨 WebMCP — `navigator.modelContext.registerTool`
**Why:** Chrome 146 (Feb 2026); first-mover window still open.

Shipped:
- [x] `webmcp_check_availability` — read · feature-detect API + count page tools
- [x] `webmcp_list_page_tools` — read · enumerate page-registered tools
- [x] `webmcp_call_page_tool` — action · invoke a page-registered tool
- [x] `src/lib/webmcp/register.ts` — `registerToolsOnActiveTab()` ready to
      register every pilot-bundle tool via `navigator.modelContext.registerTool`
      (built; not yet auto-invoked)

Still planned:
- [ ] Auto-register on tab activation (postMessage bridge: page → SW)
- [ ] postMessage listener on the page side that forwards `__matrx_webmcp_call`
      messages into the SW dispatcher and replies with results

### 5. ✅ Self-healing selectors + deterministic replay
Shipped via the Demos category (`record_demo`, `list_demos`,
`describe_demo`, `replay_demo`, `delete_demo`): record a workflow once,
replay with parameter substitution. Self-healing chain
(matrx-ref → id → testid → ARIA → text → CSS path) survives DOM churn
between recording and replay. `replay_demo` is privileged.

Future extensions:
- [ ] Skill-level abstraction: `replay_skill(skill_id, args)` that
      composes multiple demos into one named workflow
- [ ] On replay miss: broadcast a "selector broken" event so the agent
      can re-derive without aborting

### 6. ✅ Cross-tab parallel orchestration
**Why:** "compare these 5 tabs" — fan out, materialize in side panel.
Already have `list_open_tabs` + per-tab actions; needs an orchestrator.

Shipped:
- [x] `parallel_for_each_tab(tab_ids, sub_prompt, ...)` — admin-only,
      action-tier tool ([src/lib/tools/handlers/parallel.ts](../src/lib/tools/handlers/parallel.ts))
      that fans out N child agent streams (max 8), one per tab, each pinned
      via `recordAssignedTab` BEFORE the SSE opens. `Promise.allSettled`
      so one tab failing doesn't kill the rest. Per-sub-run wall-clock
      timeout aborts via STREAM_KILL. Three merge strategies: `per_tab`
      (default), `concat`, `json_array`.
- [x] UI for showing parallel runs side-by-side: small status panel
      ([src/features/tasks/ParallelRunsPanel.tsx](../src/features/tasks/ParallelRunsPanel.tsx))
      mounted at the top of the Tasks tab. Live X-of-N progress, expandable
      per-sub-run row showing status pill + accumulated text + error.
      Bridge listens for `PARALLEL_RUN_EVENT` broadcasts so the SW-side
      handler stays sidepanel-agnostic. Full N-column live timeline grid
      remains a follow-up; this smaller panel covers the core "is it
      working?" need.

### 7. ✅ Privileged additions — cookies, pageCapture, sessions
Shipped:
- [x] `get_cookies` (read, admin) · `set_cookie` / `delete_cookie` (privileged,
      admin) — `cookies` optional permission
- [x] `save_page_as_mhtml` (action, admin) — `pageCapture` optional permission
- [x] `list_recently_closed` (read) · `restore_recently_closed` (action) —
      `sessions` optional permission

### 8. ✅ Cryptographic run receipts
**Why:** killer feature for compliance / regulated verticals. Auditor needs
chain-of-custody.

Shipped:
- [x] Sign every tool call (callId + args hash + output hash + timestamp +
      runId + conversationId) with a device-bound WebCrypto Ed25519
      keypair persisted in `chrome.storage.local` (key
      `matrx.audit.deviceKey`). Both partial (start) and full (completion)
      receipts are emitted so even crashed calls leave a trail. See
      [src/lib/audit/](../src/lib/audit/).
- [x] Append to local audit log (`matrx.audit.log`) — FIFO ring capped at
      1000 entries. `appendReceipt` is fire-and-forget and best-effort;
      signing failures never block tool execution. Backend push is
      future work — receipts can already be exported individually.
- [x] Export receipt as JWS compact-serialization (RFC 7515, `alg=EdDSA`,
      `kid=publicKeyId`) via `exportReceiptJws`. The receipt body also
      carries an in-line ed25519 signature over its canonical-JSON form
      so an exported JSON row stays verifiable against the public-key
      history without any external library.
- [x] "Show receipt" Shield-icon button on every `ToolTimelineRow`
      (hover-reveal, same pattern as `CopyToolButton`). Opens a modal
      showing the JSON, signature-verification status, and Copy-JSON /
      Copy-JWS buttons. Settings → Advanced agent capabilities → Audit
      key card lets the user view the active public-key ID, re-key
      (confirmation-gated, retains the previous key in
      `matrx.audit.publicKeyHistory` so prior receipts still verify),
      and export the active public key JWK to the clipboard.
- [x] **Schema v2 + full path coverage (2026-05-07).** Receipt schema
      bumped to `v: 2` with an optional `origin` tag (`agent`, `pilot`,
      `parallel`, `webmcp`). The verifier accepts BOTH v1 and v2 — old
      receipts in existing audit logs continue to verify; their absent
      `origin` is preserved during canonical-JSON re-serialization so
      the original signature still matches. The WebMCP path
      (`handleWebmcpCall`) now emits its own partial + completed
      receipts (origin='webmcp') — that path bypasses the streaming
      dispatcher's chunk listener so it previously had no audit
      coverage. The streaming dispatcher classifies origin per call:
      runId starts with `parrun-` → 'parallel'; conversation matches an
      active Pilot session → 'pilot'; otherwise 'agent'. The Audit-key
      card in Settings now shows the last 20 receipts with a chip-set
      origin filter so admins can confirm coverage across every tool
      execution path. Unit tests in `tests/unit/receipt.test.ts` cover
      every origin tag plus a v1-shape backward-compat case.

### 9. ✅ Pilot tab + tab-group sandbox
**Why:** the user wanted two surfaces — Assistant (Chat) and Pilot
(drives the browser in its own tab group). Pilot is admin-only initially
per the experimental → admin first → GA convention.

Shipped:
- [x] New `<PilotView>` ([src/features/chat/PilotView.tsx](../src/features/chat/PilotView.tsx))
      cloning the ChatView render tree (intentional — the two surfaces will
      diverge as Pilot grows plan-mode / receipts / sub-task spawning).
      Uses `surface: 'pilot'` in the browser-dom state so the server-side
      discovery handler can route the full read+action+ask kit. Defaults
      to 'act' permission mode — Pilot is meant to be more autonomous.
- [x] Pilot session state ([src/state/pilot.ts](../src/state/pilot.ts)) —
      zustand + chrome.storage.local. `startSession({agentId})` creates
      a fresh tab group seeded with the active tab, paints it blue +
      titles it "Pilot", latches `{groupId, windowId, agentId, startedAt}`.
      `endSession()` queries every tab in the group and removes them
      (Chrome auto-deletes the empty group).
- [x] Dispatcher group scoping ([src/lib/tools/dispatch.ts](../src/lib/tools/dispatch.ts)
      `enforcePilotGroupScope`). When a session is active, action / privileged
      tools whose `assignedTabId` lives outside the group return a
      structured `pilot_group_violation` error. Read-tier tools are unrestricted
      (introspection across the user's other tabs is still useful).
- [x] `parallel_for_each_tab` group enforcement
      ([src/lib/tools/handlers/parallel.ts](../src/lib/tools/handlers/parallel.ts)) —
      every tab id in the args must belong to the active session's group.
      Up-front rejection avoids spawning N child agents only to fail mid-flight.
- [x] Lifecycle listeners
      ([src/lib/background/bootstrap.ts](../src/lib/background/bootstrap.ts)
      `registerPilotLifecycleListeners`). `chrome.tabGroups.onRemoved`
      and `chrome.tabs.onRemoved` watch for external dissolution
      (last tab closed manually, group ungrouped via right-click) and
      reset the persisted session record so the Pilot view doesn't
      stay stuck.
- [x] Sidepanel tab registration
      ([src/entrypoints/sidepanel/App.tsx](../src/entrypoints/sidepanel/App.tsx)) —
      Crosshair icon (emerald accent) next to Chat. Admin-gated.
- [x] Parallel pilot chat store + stream hook
      ([src/state/pilot-chat.ts](../src/state/pilot-chat.ts),
      [src/hooks/use-pilot-chat-stream.ts](../src/hooks/use-pilot-chat-stream.ts))
      so the Pilot conversation thread is independent of the Assistant's
      messages — switching tabs in the side panel doesn't blur the two
      conversations.

### 10. ✅ Manifest hygiene
Shipped:
- [x] `optional_permissions`: `debugger`, `cookies`, `pageCapture`,
      `userScripts`, `proxy`, `webRequest`, `desktopCapture`, `topSites`,
      `management`
- [x] Added to base: `sessions`
- [x] Add to base: `system.cpu`, `system.memory`, `system.display`,
      `declarativeNetRequestWithHostAccess` (2026-05-07; initially
      preemptive). **2026-05-08: wired to real consumers** so the CWS
      reviewer's "declared but unused" rule isn't tripped — the same
      rule that flagged `contextMenus` on the v0.1.4 published build.
      `chrome.system.cpu/memory/display` were exercised by the
      admin-only `get_system_info` diagnostic tool; the DNR permission
      was exercised by `list_network_blocking_rules`. **Both tools (and
      `src/lib/tools/handlers/system-info.ts`) were removed 2026-07-11
      for the Chrome Web Store submission** — being admin-only, they
      made these four permissions reviewer-unreachable ("declared but
      unused"). See [docs/REMOVED_FOR_CWS_SUBMISSION.md §2](../docs/REMOVED_FOR_CWS_SUBMISSION.md) for what
      was removed and how to bring it back.

Reverted (UX regression):
- [ ] Move `<all_urls>` to `optional_host_permissions` — REVERTED
      2026-05-08. Real applications don't ask users to go into
      chrome://extensions to grant permissions; `<all_urls>` is back
      in base `host_permissions`. The runtime gate
      (`requires_broad_host_access` flag, `_host-access.ts` helper, the
      `startContentScriptRegistrar` runtime CS bootstrap, and the
      Settings → Advanced "All sites access" toggle) was removed.
      Tools that previously refused with "Open Settings → Advanced
      agent capabilities → 'All sites access'" now run unconditionally
      because the broad host grant is unconditional from install.

### 11. 🔨 Voice loop (TASK-002)
**Why:** parity with the Next.js app's voice features and hands-free
agent operation.

Engineering complete; perceptual QA outstanding.

- [x] **TASK-002a** — Cartesia TTS token wired through
      `https://aimatrx.com/api/cartesia`; STT calls aidream's catalog-routed
      `/audio/transcribe` directly with Supabase Bearer auth. The retired
      matrx-frontend `/api/audio/transcribe[-url]` proxies must not be used.
- [x] **TASK-002b** — Translation via on-device Gemini Nano
      (`ai_translate`) with server-side fallback if Nano unavailable;
      mic button in `ChatView` Composer wired to `useRecordAndTranscribe`
      with live-streaming transcript into the textarea and red-pulse +
      audio-level glow while recording.
- [x] **TASK-002b-fix** — Offscreen-document refactor (MV3 sidepanel
      can't reliably `getUserMedia`; capture moved to offscreen w/
      reason `USER_MEDIA`); new `MIC_REQUEST → MIC_RUN → MIC_EVENT`
      channel flow; `useVoicePrefsStore` (zustand → chrome.storage) for
      voice / language / speed.
- [x] **TASK-002c** — Speaker button on agent message bubbles +
      language picker in chat header / settings (shipped in 7950b12).
- [ ] **TASK-002d** — **PENDING (human-only perceptual QA across en/es/fr/fa/zh/ru)**

### 12. 📋 Vision-first navigation, timeline scrubbing
Moonshots from the research. Defer until 1–11 ship.

### 13. ✅ Incremental tool progress (2026-05-20)
**Why:** long-running tools (research, multi-page scrapes) showed only a
spinner. Now they can stream live status.

- Opt-in + additive: a tool that emits no progress renders exactly as before.
- Wire: server tools emit a `tool_progress` tool_event sub-event
  (`{event:'tool_progress', call_id, tool_name, data:{label?, step?, status?,
  percent?}}`); client (SW) handlers call `ctx.reportProgress('…')` (optional
  field on `ToolContext`, broadcast as a `TOOL_TIMELINE_EVENT` with a
  `progress` field). Both paths funnel into `appendToolProgress` on the chat
  store (FIFO-capped at 200; `ToolPartCall.progress[]`).
- Display: [`ToolProgressView`](../src/features/chat/tool-display/ToolProgressView.tsx)
  renders ONLY when entries exist. Generic default = a running log that
  collapses to "N updates" on completion (used by the default rows too, so an
  unregistered tool still gets it). Registry `progress` config customizes:
  `mode: 'log' | 'latest' | 'steps'`, `visibleWhileRunning`, `showWhenComplete`.
- Normalizer: [`progressFromWire`](../src/lib/chat/tool-progress.ts).

### 14. 🔨 Stream resilience — stall watchdog + resume (2026-05-20)
**Why:** if the offscreen doc died / network hung / server went silent with no
terminal `done`, `isStreaming` stayed true and the spinner spun forever.

Shipped (client):
- [`createStreamWatchdog`](../src/lib/stream/watchdog.ts) — dead-man's switch.
  Any chunk (incl. the server `heartbeat` event, now consumed as liveness)
  resets it; 75s of total silence fires `onStall`. Wired into both
  `use-chat-stream` and `use-pilot-chat-stream` (`start` on send, `touch` per
  chunk + on `STREAM_OPENED`, `stop` on done/cancel).
- **`hold(untilEpochMs)` — silence is NOT always death (2026-07-11).** The server
  emits **`provider_retry`** when an upstream LLM provider fails (rate limit, 5xx)
  and a retry is scheduled. It then goes **deliberately silent** for the backoff —
  no chunks, no heartbeat — and `retry_delay` routinely exceeds the 75s threshold.
  A plain dead-man's switch cannot tell that apart from a hang, so it used to KILL
  a healthy run mid-backoff and show a false "connection lost". `hold()` pushes the
  deadline to the server's own `retry_at` plus the normal grace, so a real stall is
  still caught if the retry never lands. Logic + normalizer in
  [src/lib/stream/provider-retry.ts](../src/lib/stream/provider-retry.ts) (pure,
  18 unit tests). **If you add any event that implies expected silence, it must
  `hold()` the watchdog or it will read as a stall.**
  - Only `scheduled` / `suspended` hold — `retrying_now` means the request is
    already in flight, so normal stall rules resume.
  - `retry_at` is disambiguated seconds-vs-ms **by magnitude**: a seconds value read
    as ms lands in 1970 and would silently produce no hold at all.
  - `ProviderRetryBanner` (ChatView) shows the server's own `user_message` + a live
    countdown. Never invent copy for a provider error — the server ships it.
- **`reasoning` (`{state: 'started' | 'stopped'}`)** delimits thinking blocks; the
  tokens still arrive as `reasoning_chunk`. Reasoning `MessagePart`s carry a
  `closed` flag so a SECOND thinking block in one turn renders separately instead
  of silently merging into the first.
- Assistant surface: on stall, clears the spinner + shows a Retry banner
  (`StreamInterruptionBanner` in ChatView, gated on
  `useChatStore.streamInterruption`). Retry replays the last turn. Pilot clears
  the spinner (no banner yet).

Pending — but the backend half is DONE; this is now CLIENT work
(contract in [docs/STREAM_RESUME_PROTOCOL.md](../docs/STREAM_RESUME_PROTOCOL.md)):
- [ ] **Cursor-replay resume.** `attemptResume`
  ([src/lib/stream/resume.ts](../src/lib/stream/resume.ts)) is still a flag-gated
  no-op, and it targets `GET /ai/agent/runs/{request_id}/resume?cursor=N` — an
  endpoint that does NOT exist. What the live server actually ships (verified
  2026-07-11 against its OpenAPI) is **`POST /ai/conversations/{id}/resume`**, a
  different shape: durable continuation, not cursor replay. So the scaffold cannot
  simply be flipped on — it needs rewriting against the endpoint that exists.
  Until then, a stall still replays the whole turn.
- [ ] Reliable `heartbeat` cadence (≤~20s) DURING long tool execution. (Note the
  `provider_retry` hold above now covers the *backoff* case specifically, which was
  the most common source of false stalls.)

### 15. ✅ Turn-boundary inbox — queue/steer a running agent (2026-05-20)
**Why:** stop forcing "wait for the agent to finish before I can type" and
"cancel the whole run just to add a note." Server contract (aidream repo):
[../aidream/docs/cx_chat/TURN_BOUNDARY_INBOX.md](../../aidream/docs/cx_chat/TURN_BOUNDARY_INBOX.md).

Shipped (client, Assistant Chat only):
- [x] While streaming, the composer's send button becomes a distinct
      indigo→violet gradient + clock-badge button (the Stop square stays
      alongside). Enter/click POSTs to `/ai/conversations/{id}/inbox`
      (`enqueueInboxMessage` in [routes/ai.ts](../src/lib/api/routes/ai.ts))
      instead of starting a second run. `submitMessage` branches on
      `isStreaming`; guarded until a conversation id is adopted.
- [x] A "waiting its turn" card floats above the input — drifting gradient
      (`animate-dreamy-drift`), pulsing dot, live timer. State in
      [src/state/turn-inbox.ts](../src/state/turn-inbox.ts) (ephemeral); UI in
      [src/features/chat/QueuedMessageCard.tsx](../src/features/chat/QueuedMessageCard.tsx).
- [x] Retract (×) and edit (pencil) on a pending card — `cancelInboxMessage` /
      `editInboxMessage` (DELETE / PATCH), 409-on-drained handled gracefully.
- [x] On the stream's `injection_consumed` (now typed —
      `InjectionConsumedEvent`), the message drops into the transcript as a
      user bubble inserted just ABOVE the still-streaming assistant message
      (`insertMessageBefore` on the chat store) and the card flips to
      "Delivered" then fades. Reads server-echoed `text` + honors
      `is_visible_to_user` (defensive — deployed schema lags the contract).
      `info code=inbox_continue` is logged.

Shipped (2026-05-22):
- [x] **Interrupt / "stop & send"** — the server delivered this NOT as
      abort-mid-syscall (correctly rejected as fragile) but as a clean cut that
      keeps the partial: aborting the stream makes the server persist the
      partial assistant turn + an auto `[⚠️ Response interrupted…]` marker, and
      the fresh run loads that history and answers the redirect. Client wiring:
      `interruptAndSend()` in [use-chat-stream.ts](../src/hooks/use-chat-stream.ts)
      (abort → 350ms grace so the partial flushes → normal send) behind a third
      composer affordance — the amber→rose stop-badge button, distinct from the
      indigo (waiting) queue send and the plain Stop. No special endpoint; no
      client-supplied partial. Also dropped the #2 defensive casts in
      `handleInjectionConsumed` now that the deployed `ConsumedInjection` schema
      carries `text` + `is_visible_to_user`. See
      [docs/SERVER_NEEDS_turn_boundary_inbox.md](../docs/SERVER_NEEDS_turn_boundary_inbox.md).

Deferred / not wired:
- [ ] `listPendingInboxMessages` (GET) exists but isn't auto-called — reopening
      the side panel starts a fresh chat here, so there's no live run to
      rebuild cards for. Kept for future surfaces.
- [ ] Wire Pilot surface (own composer + `use-pilot-chat-stream`).

---

## 📐 Architecture cheat sheet

```
sidepanel (React) ──STREAM_START──▶ SW ──STREAM_RUN──▶ offscreen
                                     │                    │
                                     │                    └─ holds long SSE
                                     │                       (SW dies > 30s)
                                     │
                              startToolDispatcher
                              subscribes STREAM_OPENED + STREAM_CHUNK
                              on tool_started:
                                - validate args (Zod)
                                - permission gate (tier × mode)
                                - run handler
                                - POST /conversations/{id}/tool_results
                                - broadcast TOOL_TIMELINE_EVENT
                              ◀──STREAM_CHUNK── all surfaces
```

- **`src/lib/tools/types.ts`** — `ToolHandler<T,R>`, tiers, `ToolContext`
  (includes `assignedTabId` so handlers stick to the agent's tab).
- **`src/lib/tools/registry.ts`** — `lookup`, `assistantToolNames`,
  `pilotToolNames`, `pilotToolNamesWithPrivileged`.
- **`src/lib/tools/dispatch.ts`** — SW dispatcher.
- **`src/lib/tools/handlers/*.ts`** — one file per domain (read, action,
  user, tabs, forms, keyboard, inspect, browser-data, downloads, privileged).
- **`src/lib/tools/handlers/_active-tab.ts`** — shared
  `getAssignedTab(ctx)` / `getAssignedTabId(ctx)` helpers that prefer
  `ctx.assignedTabId` and fall back to `chrome.tabs.query({active:true})`.
  All handlers use this — never re-introduce a local active-tab query.
- **`src/lib/tools/catalog.ts`** — JSON Schema generation.
- **`src/state/tool-inbox.ts`** — sidepanel-side pending confirms / asks /
  timeline.
- **`src/features/chat/Agent*Card.tsx`** — inline approval / ask-user UI.
- **`src/features/tools/ToolsView.tsx`** — visible catalog + manual test runner.

---

## 🔌 Server integration — capability-based agent API (2026-05-01)

We migrated to the new capability-based shape. The extension is the first
client built directly against it; no legacy compatibility.

**Authoritative wire contract:** [docs/REQUEST_PAYLOAD_CONTRACT.md](../docs/REQUEST_PAYLOAD_CONTRACT.md)
documents every field in `context` and `client.state["browser-dom"]`,
how tab id flows through both payloads, and what's conditional vs.
always-attached. **Update that doc in the same commit any time you add,
rename, or drop a key — engineers template `{{page_brief.title}}` into
prompts and the discovery handler reads `client.state["browser-dom"]`
field-by-field.**

**Request shape** (every chat send):

```ts
POST /ai/agent/{agent_id}
{
  user_input,
  conversation_id,
  context,                   // big rich page facts (~50 keys)
  variables,
  client: {
    capabilities: ["browser-dom"],
    state: {
      "browser-dom": {        // small orchestration metadata (~12 keys)
        current_url, current_tab_id, current_window_id, page_title, page_lang,
        tab_status, surface, is_admin, permission_mode, desktop_bridge,
        onbox_ai_available, optional_permissions_granted, open_tab_count,
        extension_version, extension_id, loaded_categories,
      },
    },
  },
}
```

**Discovery loop:**

1. Server registers `browser-dom` capability with one always-on tool:
   `load_chrome_tools`.
2. Model calls `load_chrome_tools({ category: "page" | "interact" | … })`.
3. Server-side handler reads `state["browser-dom"]` (admin? perms granted?
   desktop bridge?), looks up `category_routing[category]` from the handoff
   manifest, filters, and calls `ctx.queue_tool_changes(add=[...], remove=["load_chrome_tools"])`.
4. Orchestrator drains the mutation; next iteration the model has the new
   tools loaded.
5. Server emits `RESOURCE_CHANGED kind=active_tools`; extension listens and
   updates the Tools-tab badge + records the loaded category in
   `useActiveToolsStore` so the next request can hint `loaded_categories`.

**Cross-turn limitation (current):** tool mutations are per-request only.
Each new user message restarts with `[load_chrome_tools]`. Discovery is
cheap (server-side lookup, no LLM round-trip), so re-running per turn is
acceptable. Cross-request persistence is on the server-team's roadmap; no
extension changes needed when it lands.

**Where tool definitions live:**

> 🚨 **CANONICAL VOCABULARY — memorize before touching tools anywhere.**
> Normative source:
> [aidream/docs/official/tool_system_rules.md](../../aidream/docs/official/tool_system_rules.md)
> Part 2. Copy it verbatim; do not paraphrase.
>
> **Tool** (a contract) · **Registered tool** (has a `tool.definition` row) ·
> **Inline tool** (declared on the request, no DB row) · **Executor** (a runtime
> that dispatches — `tool.executor`) · **Binding** (this executor CAN run this
> tool — `tool.binding`; the word is reserved and means nothing else) ·
> **Client** (the app hosting surfaces) · **Surface** (a page/panel —
> `ui.ui_surface`) · **Surface defaults** (`tool.surface_defaults`) ·
> **Arming** (turning a tool on for ONE conversation at runtime, from the
> component holding the state it needs — wire field `client_tools`) ·
> **Bundle** · **Gate**.
>
> **Two paths to existence, both permanent.** Registered (durable) and inline
> (authored at runtime — this is how agents and users create tools on the fly,
> and it is never going away). **The database is NOT the only source of truth
> for tools** — that claim is false and caused durable tools to be built inline
> to dodge a registry that felt mandatory. The rule is durability: *did this
> tool exist before the request arrived?* No → inline. Yes → register it.
>
> **Three questions about reach, never conflated.** *Where can the code run?* →
> Executor. *Where is it offered by default?* → Surface. *Is it live for this
> conversation right now?* → Arming. A page needing different tools is Surface
> defaults or Arming — **never** a sub-executor.

- **Canonical source of truth for registered tools:** `tool.definition` rows in
  the aidream DB, with ownership on `tool.binding`
  (`executor_name='chrome-extension'`) — not on a column. Note these tables
  moved TWICE: `tl_def` → `tool_def` → **`tool.definition`**; `tl_executor` →
  `tool_binding` → **`tool.binding`**. Only the last name in each chain exists.
  Client access goes through `toolDb()` in
  [src/lib/supabase/schemas.ts](../src/lib/supabase/schemas.ts). Ongoing changes
  go through admin API or SQL seed PRs against aidream.
- **Local handlers:** `src/lib/tools/handlers/*.ts` (unchanged).
- **Wire-format aliasing:** `src/lib/tools/aliases.ts` stripped the
  `matrx-extend__` prefix and legacy `browser_*` names; retired along with
  the `matrx-extend:` colon namespace itself in the 2026-05-19 global
  tool namespace redesign (see below) — bare/`chrome_*`/`cdp_*` names no
  longer need aliasing.
- **Migration guide:** [docs/MATRX_EXTEND_MIGRATION_GUIDE.md](../docs/MATRX_EXTEND_MIGRATION_GUIDE.md)
  has the full PR-by-PR playbook.
- **Retired:** `types/server-handoff/browser-dom-capability.json` and
  `buildServerCapabilityHandoff()` — aidream no longer reads them.
- **Still emitted (dev/debug only):** `pnpm catalog:tools` writes
  `types/tool-catalog.json` (structural contract — no descriptions) for the
  matrx-extend-tool-display skill. The in-extension Tools tab reads tool
  descriptions LIVE from the DB (`src/lib/tools/descriptions.ts`). Not
  authoritative for aidream.
- **Tool descriptions (Rule 4):** live ONLY in `tool.definition`. The repo's single
  copy is the auto-generated `docs/TOOLS.generated.md` (`pnpm docs:tools`). No
  hardcoded descriptions in handlers; UI/discovery read them live.

## 👤 Guest mode (2026-05-16)

The extension lets unauthenticated users open the side panel and chat
immediately — no sign-in required. The intent is keeping-honest-people-honest:
clearing chrome.storage is a free reset, but the install-bound signature
is stable enough to enforce reasonable rolling limits while the user is
inside our funnel.

**Surface:**
- [`AuthGate`](../src/components/AuthGate.tsx) is now a pass-through
  wrapper (legacy name kept for compatibility). It no longer blocks.
- [`GuestBanner`](../src/components/GuestBanner.tsx) renders at the top
  of [`ChatView`](../src/features/chat/ChatView.tsx) when no user is
  signed in. Two CTAs: in-place Sign in (OAuth) + Sign up free (opens
  aimatrx.com via `chrome.tabs.create`).
- [`App.tsx`](../src/entrypoints/sidepanel/App.tsx) hides every tab
  except `chat` + `settings` for guests via the `showFullTabs` gate.
  Bounces the active selection back to `chat` if the user lands on a
  hidden tab. Admin tabs (Pilot / Showcase / Debug) keep their existing
  `isAdmin` gate — guests are not admins.

**Identification:**
- [`src/lib/auth/guest-signature.ts`](../src/lib/auth/guest-signature.ts)
  produces a stable 64-char hex signature:
  `sha256(chrome.runtime.id | nonce | createdAt)`. The nonce is a
  32-byte random minted once on first read and persisted in
  `chrome.storage.local`. Cached in-memory and via storage so the SW,
  sidepanel, and offscreen all see the same value. Concurrent callers
  share an in-flight promise so we never mint two nonces in a race.
- Outbound paths inject `X-Fingerprint-ID: <signature>` whenever the
  caller has no Bearer token:
  - [`src/lib/api/client.ts`](../src/lib/api/client.ts) `buildHeaders()` —
    REST.
  - [`src/lib/stream/offscreen-proxy.ts`](../src/lib/stream/offscreen-proxy.ts) —
    SSE streams.
  - `parallel_for_each_tab` is admin-only so admins are always signed
    in; that path keeps its strict token requirement.
- The request body's `client.state["browser-dom"].is_guest` mirrors the
  header by reading the same `getAccessToken()` result — they cannot
  drift.

**Server identification & gating:**
- aidream's `matrx_connect` AuthMiddleware (already in place) reads
  `X-Fingerprint-ID`, calls `resolve_guest_uuid()` which finds or mints
  an anonymous `auth.users` row, and sets `ctx.auth_type='fingerprint'`.
  No backend change required to make this path work.
- Model tier swap: migration `0045_guest_mode_and_model_tiers.sql` adds
  `ai_model.mid_fallback_id` + `ai_model.guest_fallback_id`. When a
  guest hits an agent whose model has a `guest_fallback_id`, the helper
  `aidream/api/utils/model_tier_swap.py` swaps `config.model` in place
  and records the original on `ctx.metadata['original_model']`. Wired
  into `agent_run.py` between `agx.load_for_execution` and the
  conversation resolution.
- Usage tracking: the same migration creates `cx_user_usage_summary`
  plus an `AFTER INSERT/UPDATE` trigger on `cx_user_request.completed_at`.
  The trigger maintains 6-hour and 24-hour rolling windows of (requests,
  tokens, cost in millicents) per user plus a frozen `auth_type` (probed
  against `guest_executions`). Request-time enforcement reads via
  `fn_get_user_usage_snapshot(user_id)` — O(1).
- Sign-up conversion: when a guest signs in, `link_guest_to_user()` in
  the existing `guest_registry` stamps `converted_to_user_id`. The
  user_id stays stable so usage history and conversations carry over.

**Operator notes:**
- After applying migration 0045, run `python db/generate.py` to
  regenerate the ORM. `swap_model_for_auth_tier` uses defensive
  `getattr(..., None)` so it no-ops cleanly during the gap.
- The migration's tail UPDATEs use `provider ILIKE / name ILIKE` to
  populate fallbacks for Opus / Sonnet / GPT-5+ / Gemini Pro. Tighten
  the WHERE clauses or replace with literal IDs as the model registry
  grows. The fallback target IDs are hardcoded (Sonnet 4.6 / Haiku 4.5
  / GPT-5 mini / gpt-4.1-mini / Gemini 3 Flash Preview).
- Enforcement is intentionally NOT yet wired — the trigger populates
  the summary, the swap downgrades premium models, but no 429 is
  returned today regardless of cost. Add a `Depends(enforce_usage_quota)`
  on `/ai/agent/{id}` once the summary has produced enough real data to
  pick limit values.

---

## ⚠️ Web Store identity gotcha (v0.1.4 incident)

**The Chrome Web Store replaces the manifest's `key` field on upload with
its own keypair.** Our local dev build uses the `key` in `wxt.config.ts`
to produce ID `cihdmkcdjjckfhjpgoedmgfpoljebaml`; the published v0.1.4
runs under the Store-assigned `hnfolienncfklkgmdjjmhhegglimlamg`. They
are independent and will never converge.

**Auth implication:** every `chrome.identity.getRedirectURL()` call
returns `https://<install-id>.chromiumapp.org/`. Supabase rejects the
authorize call when that URI isn't on its allowlist, with the
near-instant error "Authorization page could not be loaded".

**Required posture:**
- `EXPECTED_EXTENSION_IDS` in [`src/config/identity.ts`](../src/config/identity.ts)
  lists every install ID we expect to see (dev + Web Store + any future
  beta channels).
- The same list of `https://<id>.chromiumapp.org/` URIs must be registered
  in **Supabase → Authentication → URL Configuration → Redirect URLs**.
  These two lists are the same set; if they drift, sign-in dies.
- `logExtensionIdentityOnce()` runs on every SW + sidepanel boot. Drift
  surfaces as a `warn`-level `auth` log and as the red Debug-tab
  identity card.
- Adding a new build channel = ONE PR (add ID to the list) + ONE
  Supabase config change (add the URI). Both must land before the new
  channel ships to users.

Full incident write-up: [`.research/v0.1.4-auth-incident.md`](../.research/v0.1.4-auth-incident.md).
