# 2026-05-03 — Agent failure-mode triage

Captured from a real Haro CPA portal trace (Gmail → portal upload task).
Items in this file are the ones we **could not** fix in-extension on
2026-05-03; either they live on the server, or they need design before
code.

Already shipped in this commit:
- Password masking in `read_page`, `get_form_fields`, `inspect_element`,
  `get_element_at_point`, `query_elements` — autofilled passwords are
  no longer echoed back to the model.
- Tool-name alias forgiveness layer
  ([src/lib/tools/aliases.ts](../src/lib/tools/aliases.ts)) — legacy
  `browser_*` DB names route to the canonical handler.
- Structured "did you mean" error when an unknown tool name is dispatched
  (replaces silent pass-through).
- `list_open_tabs` / `get_tab_info` — strip `data:` URI favicons (text-only
  agent gets no value, payload was huge for tab-heavy users).

---

## 🔴 Server-side bugs (file with the FastAPI / orchestrator team)

### S1 — Tool catalog drift between Supabase and the extension

**Evidence:** the `public.tools` table advertises this set to the agent:

| DB tool name             | Maps to (extension)        |
|--------------------------|----------------------------|
| `browser_click`          | `click_element`            |
| `browser_close`          | `close_tab`                |
| `browser_get_element`    | `query_elements` *(approx)* |
| `browser_navigate`       | `navigate_active_tab`      |
| `browser_screenshot`     | `take_screenshot`          |
| `browser_scroll`         | `scroll_page`              |
| `browser_select_option`  | `select_dropdown_option`   |
| `browser_wait_for`       | `wait_for`                 |
| `browser_type_text`      | `type_into_element`        |
| `interaction_ask`        | `ask_user`                 |
| `load_browser_tools`     | `load_browser_tools` ✅     |

Only **1 of 11** matches. The DB is from an earlier naming generation
("browser_*"); the extension uses verb-noun ("click_element"). The alias
layer keeps the agent functional today, but the DB needs reconciliation
or every new tool we add will fall through.

**Action:** run [`pnpm catalog:tools`](../package.json) and diff against
`public.tools`. Use the spec in
[.research/tool-db-comparison-task.md](./tool-db-comparison-task.md).
Decide: (a) rename DB rows to canonical names, or (b) keep aliases
permanent and document the dual surface.

### S2 — Server's tool-call dedupe is too aggressive

**Evidence (from trace):**
- `"Couldn't read active tab — Exact duplicate call to 'get_active_tab'
  with identical arguments was already made."`
- `"Failed to read page — Exact duplicate call to 'read_page' with
  identical arguments was already made."` *(after a navigation, so the
  page contents had completely changed)*

`get_active_tab` returns mutable state by definition; deduping it is
incorrect. `read_page` after navigation should not be considered a
duplicate.

**Fix options:**
1. Whitelist tools that are exempt from dedupe (`get_active_tab`,
   `read_page`, `take_screenshot`, `read_console_messages`, every
   `cdp_*`, `find_text_on_page`).
2. Include URL + tab_id in the dedupe key.
3. Dedupe only within a 2–3 second window, not the whole conversation.

### S3 — "Browser session not found" fallback is misleading

**Evidence:** when the agent called the (unknown-to-extension) tool
`browser_click({selector, session_id: "active"})`, the server replied
with `"Browser session 'active' not found or expired."` — opaque, no
hint that the tool simply isn't registered.

**Fix:** check whether this string is generated server-side. If so,
either remove the fallback (let the extension's "did you mean" surface
through) or rephrase to "tool not registered for this client".

### S4 — Non-persistent tool loading across turns

**Evidence:** the agent loaded `page` → `core` → `interact` → `tabs` →
`ask` over five separate `load_browser_tools` calls in one task. Per
[CLAUDE.md](../CLAUDE.md), tool mutations are per-request only and the
discovery loop restarts each turn.

**Action:** server team's existing roadmap. Worth restating that this
forces the model to re-discover on every user message and is partly
responsible for the flailing visible in the trace.

---

## 🟡 Extension-side improvements (tractable, deferred)

### E1 — Mark mutable read tools as "always re-runnable" in the catalog

Add a new flag on `ToolHandler`, e.g. `cacheable: false`, on:
`get_active_tab`, `read_page`, `take_screenshot`, `read_console_messages`,
`find`, `find_text_on_page`, every `cdp_*` read. Surface this in
[`types/tool-catalog.json`](../types/tool-catalog.json) so the server can
honor it in S2's dedupe logic. Cheap and self-contained.

### E2 — `find_text_on_page` returns 0 matches → UI labels it "Search failed"

The handler returns `{ count: 0, matches: [] }`; the chat timeline
renders that as a red "Search failed" badge. 0 matches isn't a failure.

**Fix:** in the tool-display registry for `find_text_on_page`, treat
`count: 0` as a successful "no matches" state with a neutral label,
not an error.

### E3 — `find_text_on_page` doesn't find text in virtualized lists

Gmail's mail list keeps row text inside virtualized scroll containers
and shadow-rooted message components; our DOM TreeWalker misses them.

**Fix options:**
1. Optionally pierce open shadow roots (read-only scan; opt-in via arg).
2. Use the Gmail-specific `read_page` accessibility tree which already
   handles richer selectors.
3. Document the limitation; recommend `read_page` for SPA inboxes.

### E4 — `wait_for` with `ready_state` waited 8.3s then returned

In the trace, `wait_for(ready_state, timeout_ms)` took `8308ms` after
the portal login submitted. If that's a successful wait, the timeline
should label it "ready"; if it timed out, the result needs to say so
explicitly. Investigate the actual return value and align the UI.

### E5 — Agent loaded tool categories one at a time

The model called `load_browser_tools` five times for five categories.
Even with server-side persistence (S4), the per-call dispatcher should
support `categories: string[]` so the agent can preload in one round
trip.

**Server contract change needed**, but extension can ship the schema
first since `load_browser_tools` lives server-side per CLAUDE.md.

### E6 — Mask additional sensitive input types?

Currently we mask only `<input type="password">`. Consider adding
`type="email"` *if* there's a `data-sensitive` attribute, plus any
field whose autocomplete is `cc-number`, `cc-csc`, `current-password`,
or `new-password`. Out of scope for the immediate fix.

### E7 — Audit the CDP `cdp_a11y_tree` for password leakage

The accessibility tree dump may include input values too. Did not
audit during the password-leak fix; admin-only, but worth confirming.

### E8 — Track alias-hit telemetry

`src/lib/tools/aliases.ts` only logs to the extension log. Pipe the
aliased name + canonical name to the same telemetry channel that
records tool calls so we can build a "model name confusion frequency"
report and trim the alias map once the DB is reconciled.

---

## 🧠 Cross-cutting: pattern-catching agent mistakes

The user's framing — "be more forgiving, like a flexible search system" —
implies a longer-term direction worth committing to:

1. **Name forgiveness** (shipped): alias map + "did you mean" suggestions.
2. **Argument forgiveness** (not yet): the `browser_click` call passed
   `{selector, session_id}`. Our `click_element` doesn't take
   `session_id`. We currently fail Zod validation. Could strip unknown
   keys with a warning instead of failing — but only for read tools, to
   keep action tools strict.
3. **Selector forgiveness** (partially shipped via the ref system):
   when a CSS selector misses, the failure message should suggest
   "try `find('description')` or `read_page` to get refs."
4. **Capability forgiveness**: when a tool requires an optional perm,
   today we error. Could auto-prompt the user once instead of
   bouncing the agent.

Each of these deserves its own design pass; capture as separate tickets.


# =========== PYTHON TEAM ============

> Added 2026-05-03 (server side, post-trace investigation). Read the
> Server-side bugs section above (S1–S4) first — this section is what we
> found *in code* once we confirmed those symptoms.

## P0 — The two-vocabulary problem (root cause of the trace flailing)

**There are two completely separate sets of "browser" tools active at the
same time on the same agent.** The model has no way to know which is
which, picks the wrong one when its first attempt is rejected, and we
spend 4–6 wasted iterations getting back to working tools.

### Set A — Server-side Playwright tools (DB-registered, real)

Defined in [packages/matrx-ai/matrx_ai/tools/implementations/browser.py](../../aidream/packages/matrx-ai/matrx_ai/tools/implementations/browser.py).
Rows in `public.tools` (these are the IDs Arman shared):

| Tool name              | What it does                                         |
|------------------------|------------------------------------------------------|
| `browser_navigate`     | `await session.page.goto(url)` — Playwright on server |
| `browser_click`        | `await session.page.click(selector)`                  |
| `browser_type_text`    | `await session.page.type(selector, text)`             |
| `browser_screenshot`   | `await session.page.screenshot(...)`                  |
| `browser_wait_for`     | `await session.page.wait_for_selector(...)`           |
| `browser_select_option`| `await session.page.select_option(...)`               |
| `browser_scroll`       | `await session.page.evaluate("window.scrollBy...")`   |
| `browser_get_element`  | `await session.page.query_selector(...)`              |
| `browser_close`        | `await manager.close(session_id)`                     |

These run a **headless Chromium on the server** via the
`get_browser_session_manager()` in `matrx_ai/tools/browser_sessions.py`.
They require a `session_id` returned by `browser_navigate`. Useful in
the sandbox / matrx-local context where there is no user browser.

**They have nothing to do with the user's actual Chrome.**

### Set B — Extension client-delegated tools (in-memory registered)

Defined in
[packages/matrx-ai/matrx_ai/capabilities/browser_dom_catalog.json](../../aidream/packages/matrx-ai/matrx_ai/capabilities/browser_dom_catalog.json)
— 118 tools. Registered into `ToolRegistryV2` at startup by
[`register_browser_dom_tools_in_registry()`](../../aidream/packages/matrx-ai/matrx_ai/capabilities/browser_dom.py#L252-L297)
as `tool_type=EXTERNAL_HANDLER, source_app="matrx-extend"`. They are
**not** in the `public.tools` table — the catalog JSON is the single
source of truth and registration happens in code at boot.

When a tool from this set is dispatched, the executor's `client_tools`
short-circuit fires and the call gets delegated to the extension over
SSE. The extension runs it against the active Chrome tab and POSTs the
result to `/ai/conversations/{id}/tool_results`.

### Q (Arman): "Are any of the tools we're getting from the extension registered?"

**Yes — all 118 of them.** They live in `ToolRegistryV2` as first-class
tool definitions, identical in shape to DB-loaded tools (same
`ToolDefinition` model, same executor path), just with
`source_app="matrx-extend"` and routed via client delegation instead of
local callable.

The catalog is generated by `pnpm catalog:tools` in matrx-extend and
committed to matrx-ai. So the registry IS the source of truth at
runtime; the DB just doesn't know about them.

### Why both sets ended up active on the same agent

In the trace, `allowed_tools` for the request contained:

- The 9 Playwright `browser_*` tools (came from agent's `tool_config.tools` — DB references)
- 10 extension `page` category tools (came from `browser-dom` capability's prior `load_browser_tools(page)` call)
- `interaction_ask`, `load_browser_tools` (browser-dom's `enabled_tools`)
- `ctx_*`, `seo_*`, `usertable_*` (other registered tools the agent has)

So the agent was *configured* with the Playwright tools (probably back
when sandbox automation was the use case) **and** the matrx-extend
extension is the active client. The model sees:

- `browser_click`, `browser_navigate`, … — names match its training prior for "click in a browser"
- `click_element`, `find`, `read_page`, … — same job, different vocabulary

When `find` (extension, not yet loaded) is rejected, the model falls
back to `browser_click` (Playwright, registered, accepted by the
executor) — which then fails with **"Browser session 'active' not
found"** because Playwright tools need a real `session_id`, not the
literal string `"active"`. The agent had no way to know the right tool
even existed without re-running `load_browser_tools(core)`.

### Recommended fix (lowest risk, highest impact)

**When `browser-dom` capability is active, exclude the Playwright
`browser_*` tools from the request's tool set.** They are duplicate
functionality with a worse UX for a real-browser context.

Concrete options, in order of preference:

1. **Capability-driven exclusion list.** Add an `excludes_tools` field to
   `Capability` (in `matrx_ai/capabilities/models.py`). When a capability
   resolves into a request, its `excludes_tools` is merged into the
   `excluded` arg passed to `merge_request_tools`. `BROWSER_DOM` would
   set `excludes_tools=("browser_navigate", "browser_click", …)`.
   Generic, reusable for future conflicts.
2. **Per-agent tool_config.** Mark the Playwright tools as
   `excluded_tools` on every agent that's intended to run via the
   extension. Doesn't fix it for new agents.
3. **Move Playwright tools to a `sandbox-browser` capability.** Then
   they're only available when matrx-local declares that capability,
   never to the extension. Cleanest long-term, biggest refactor.

We recommend **option 1** for a same-week fix, **option 3** as the
follow-up.

---

## P0 — `load_browser_tools` removes itself

[browser_dom.py](../../aidream/packages/matrx-ai/matrx_ai/capabilities/browser_dom.py)
plus the discovery handler logic queue `remove=["load_browser_tools"]`
on the first call, so after the agent loads `core` it can never
re-discover other categories without the user starting a fresh
conversation. In the trace this combined with the dual-vocabulary
problem to trap the agent: by iteration 7 it was calling `read_page`
(unloaded), getting rejected, and had no way to load the `core` tools
that contain it.

**Fix:** keep `load_browser_tools` always-on for the lifetime of the
conversation. Removing it once was a nice-to-have ("the model only
needs to discover once") but it's strictly harmful when discovery is
non-persistent across turns and re-injection is the only recovery
path.

---

## P1 — Duplicate-call detector has no exemptions

Located in
[matrx_ai/tools/guardrails.py:79-96](../../aidream/packages/matrx-ai/matrx_ai/tools/guardrails.py#L79-L96).
Checks the last 5 calls; rejects identical `(tool_name, args_hash)`
regardless of:

- Time elapsed between calls
- Whether the page navigated between calls (URL changed)
- Whether the tool reads inherently mutable state

Trace evidence: `read_page` after a navigation, `get_active_tab` after
switching tabs — both rejected as "exact duplicates."

**Fix (smallest change):** add a `dedupe_exempt: bool = False` field on
`ToolDefinition` (in `matrx_ai/tools/models.py:499`) and have
`_check_duplicate` skip exempt tools. Mark these tools as exempt at
registration time:

| Tool                  | Why                                              |
|-----------------------|--------------------------------------------------|
| `read_page`           | Output depends on current DOM, changes constantly|
| `get_active_tab`      | Returns mutable state by definition              |
| `take_screenshot`     | Returns mutable state                            |
| `get_page_text`       | DOM changes                                      |
| `read_active_page`    | DOM changes                                      |
| `find` / `find_text_on_page` | Search results depend on current DOM      |
| `read_console_messages` | New messages arrive constantly                 |
| Every `cdp_*` read    | Inspect live state                               |
| `list_open_tabs`      | Tabs come and go                                 |
| `get_tab_info`        | Tab state changes                                |

For `register_browser_dom_tools_in_registry`, the catalog JSON could
carry a `dedupe_exempt` flag per tool that the registration function
forwards into the synthesized `ToolDefinition`. matrx-extend would
populate it via `pnpm catalog:tools`. Coordinated change but small.

**Alternative (looser, no schema change):** dedupe only within a
configurable window (default 2 seconds). After 2s, the same call is
allowed again. Catches accidental tight loops without blocking
legitimate re-reads after navigation.

---

## P1 — "Browser session not found" leaks Playwright internals

Same root cause as P0 above, but worth calling out separately: the
error message
`"Browser session 'active' not found or expired."` comes from
[browser.py:43-45](../../aidream/packages/matrx-ai/matrx_ai/tools/implementations/browser.py#L43-L45)
in the Playwright `browser_navigate` handler. Once the dual-vocabulary
fix lands, the model should never reach this code path on an
extension-backed request. Until then, the message is misleading
because the agent reads "Browser session" and assumes its current
Chrome tab has expired, not that it called the wrong tool.

**Fix:** if/when this code is still reachable post-cleanup, prefix the
error with `"[server-side Playwright]"` so the agent at least knows it
hit a different subsystem.

---

## P2 — Cross-request tool persistence not yet shipped

Per [matrx-ai/CLAUDE.md](../../aidream/packages/matrx-ai/CLAUDE.md)
("Tool injection refactor — current state"), `cx_conversation.dynamic_tool_state`
persistence is the only matrx-ai-side feature still missing. Until
then, every user message restarts tool discovery from the always-on
`load_browser_tools`, and the agent has to re-walk the discovery flow.
This is part of why the trace shows five separate `load_browser_tools`
calls in one task.

We can ship E5 (extension-side `categories: string[]` arg) once the
server contract is updated.

---

## P2 — Tool-name reconciliation between DB rows and extension catalog

S1 above. We're shipping the alias layer in this commit so the
extension is forgiving regardless, but the underlying issue is that
nothing today checks whether the names in `public.tools` match a
canonical name advertised by *any* surface. Once the dual-vocabulary
P0 lands, this becomes much smaller — most of the bad rows in
`public.tools` (`browser_click` etc.) shouldn't be visible to extension
users anyway.

---

## What we'd suggest the python team do first

1. **Add `excludes_tools` to `Capability`** and set it on `BROWSER_DOM`.
   One-line behavior change, high-impact, fully reversible.
2. **Stop self-removing `load_browser_tools`.** One-line behavior change.
3. ~~**Add `dedupe_exempt: bool` to `ToolDefinition`**~~ **DONE this commit
   (server side)** — see "Shipped now" below. Extension still needs to
   set the flag in the catalog JSON for the read tools listed above.

After (1) + (2) the trace's failure mode is structurally extinct.
After (3) is fully wired (extension catalog updated) the trace's
secondary issue (rejected re-reads after navigation) also goes away.
The rest is cleanup.

---

## 2026-05-04 update — canonical spec locked

The unified browser tool set is now finalized at:
[`packages/matrx-ai/matrx_ai/tools/docs/browser_tools_canonical.json`](../../aidream/packages/matrx-ai/matrx_ai/tools/docs/browser_tools_canonical.json).
27 tools across 5 groups (`core` always-on of 12; `inspection`,
`files`, `interaction`, `advanced` on-demand). Design rationale +
migration path:
[`browser_tools_final.md`](../../aidream/packages/matrx-ai/matrx_ai/tools/docs/browser_tools_final.md).
Per-surface gap analysis:
[`browser_tools_unification.md`](../../aidream/packages/matrx-ai/matrx_ai/tools/docs/browser_tools_unification.md).

**For matrx-extend specifically:** the next `pnpm catalog:tools` run
should regenerate `browser_dom_catalog.json` with the canonical names
(`click_element`→`computer.action=left_click`, `read_page` stays,
etc.) — full mapping in the unification doc. **Don't merge a catalog
that diverges from the canonical JSON** — the DB seed is going to
treat the JSON as authoritative shortly.

The `dedupe_exempt: true` flag should land on every read tool in the
catalog (`read_page`, `find`, `get_page_text`, `find_text_on_page`,
`get_element_details`, `read_console_messages`,
`read_network_requests`, `read_pdf`). The matrx-ai side already reads
this flag at registration — once the catalog ships with it, the
"duplicate read after navigation" failure mode goes extinct.

---

## Shipped now (server side, this commit)

- `ToolDefinition.dedupe_exempt: bool = False` field added in
  [matrx_ai/tools/models.py](../../aidream/packages/matrx-ai/matrx_ai/tools/models.py).
- `GuardrailEngine._check_duplicate` now skips the check when
  `tool_def.dedupe_exempt` is True
  ([matrx_ai/tools/guardrails.py](../../aidream/packages/matrx-ai/matrx_ai/tools/guardrails.py)).
  Default False — behavior unchanged for all existing tools.
- `register_browser_dom_tools_in_registry` reads `dedupe_exempt` from
  either `TOOL_METADATA[name]` (slim file) or the per-tool entry in the
  catalog
  ([matrx_ai/capabilities/browser_dom.py](../../aidream/packages/matrx-ai/matrx_ai/capabilities/browser_dom.py))
  and forwards it to the synthesized `ToolDefinition`. Coordinated
  change required: matrx-extend needs to add `dedupe_exempt: true` to
  the relevant tools when regenerating
  `browser_dom_data.json` / `browser_dom_catalog.json` via
  `pnpm catalog:tools`. Recommended set: `read_page`, `get_active_tab`,
  `take_screenshot`, `get_page_text`, `read_active_page`, `find`,
  `find_text_on_page`, `read_console_messages`, `list_open_tabs`,
  `get_tab_info`, every `cdp_*` read.
- DB-loaded tools (everything in `public.tools`) keep the default of
  False until someone marks them — the column doesn't exist yet, but
  the registration code is forward-compatible: when a `dedupe_exempt`
  bool column is added to the `tools` table, `_row_to_definition` will
  pass it through automatically (Pydantic field).
