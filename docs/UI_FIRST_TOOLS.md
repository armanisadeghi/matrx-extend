# UI-First Tools — porting guide for the Next.js frontend

> **Schema rename note — the names moved TWICE.** Wherever this doc says
> `tl_def`, read **`tool.definition`** (it was `tool_def` only between the
> 2026-05-27 refactor and the 2026-06 schema split; `public.tool_def` is as dead
> as `tl_def` today). Likewise `tl_executor` → **`tool.binding`** and
> `tl_def_surface` → **`tool.surface_defaults`**.
>
> Wherever this doc implies ownership via `source_app`: that column does not
> exist. Ownership is a row in **`tool.binding`** — `executor_name='matrx-user'`
> for the Next.js frontend, `executor_name='chrome-extension'` for this
> extension. Same tools, one shared `tool.definition` row, multiple
> `tool.binding` rows — that is how cross-surface sharing works.
>
> Canonical vocabulary:
> `common-docs/systems/agents/agent-tools/DECISIONS.md`.
> Refactor write-up:
> [CROSS_TEAM_TOOL_REFACTOR.md](../../aidream/docs/cx_chat/CROSS_TEAM_TOOL_REFACTOR.md).

> **Who this is for:** React/Next.js developers building the aimatrx.com
> chat surface (and any future Matrx Surface — SMS, mobile, sandbox).
> Many of the tools below have **zero browser dependency** — they are
> pure UI + state patterns. Copy the schema, copy the state shape,
> swap the storage transport, and you have the same capability in
> Next.js.
>
> Sibling docs:
>   - [/Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md](/Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md) — wire
>     shape the LLM sees (identical across all surfaces).
>   - [/Users/armanisadeghi/code/common-docs/systems/clients/extension/CHANNELS.md](/Users/armanisadeghi/code/common-docs/systems/clients/extension/CHANNELS.md) — how
>     matrx-extend, aidream, and matrx-frontend talk to each other.

---

## Namespace model (2026-05-19)

`tool.definition.name` is a GLOBAL unique identifier (the `tools_name_key` constraint
is on `name` alone — same name = same tool, no matter which surface runs it).
The `matrx-extend:` colon-prefix is gone. Three tiers replace it:

- **Bare global names** — UI-first + everything Playwright can also do.
  These are the SAME `tool.definition` row across surfaces. A Next.js frontend
  that registers a handler for `read_page` shares the row the Chrome
  extension already populates. Examples: `update_plan`, `tasks`,
  `user_todos`, `user`, `request_user_takeover`, `scratchpad`, `read_page`,
  `find`, `computer`, `tabs`, `navigate`, `form_input`, `evaluate_javascript`,
  `clipboard`, `ai`, `record_demo`, `replay_demo`, `desktop_run_command`.
- **`chrome_*` prefix** — genuinely Chrome-extension-exclusive: user's
  personal cookies/bookmarks/history (Playwright runs a fresh browser
  context, can't see the user's real data), `chrome.pageCapture`,
  `chrome.tabCapture`, `navigator.modelContext`. Examples: `chrome_cookies`,
  `chrome_bookmarks`, `chrome_history`, `chrome_recently_closed`,
  `chrome_save_page_as_mhtml`, `chrome_tab_audio_inspect`,
  `chrome_record_gif`, `chrome_record_tab_video`, `chrome_webmcp`.
- **`cdp_*` prefix** — Chrome DevTools Protocol-backed. Examples:
  `cdp_session`, `cdp_emulate`, `cdp_full_page_screenshot`, `cdp_a11y_tree`,
  `cdp_input_*`, `cdp_perf_metrics`, `cdp_print_pdf`, `cdp_network_*`.

The rule that drove the split: **if Playwright can do it, we don't own
the name.** Other executors follow the same shape — `matrx-local` uses
`local_*` for its desktop-engine tools, `matrx-ai-core` uses category-style
bare prefixes (`rag_*`, `fs_*`, `widget_*`). All three patterns coexist
in `tool.definition` without colons.

`scratchpad` replaces what was previously `matrx-extend:memory`. The
canonical `memory` tool is owned by matrx_ai (persistent, multi-scope
agent memory). Our session-scoped in-process kv is now `scratchpad` —
distinct concept, distinct name, no collision.

## Portability ladder

| Tool | Dependency on browser APIs | Portable to Next.js? | Notes |
|---|---|---|---|
| `user` (ask-user mega-tool) | None | ✅ 100% | Pure inline-card UI + zustand store |
| `update_plan` | None | ✅ 100% | Same as ask-user; the card is a `choice` variant |
| `tasks` (agent's tasklist) | None | ✅ 100% | Storage swap only |
| `user_todos` (assigned to user) | Chrome notification, optional | ✅ 95% | Swap Chrome notif → Web Push or toast |
| `request_user_takeover` | None | ✅ 100% | "Takeover" semantics need a frontend-specific meaning (e.g. "pause the chat input"), but the lifecycle is identical |
| `scratchpad` (session, in-process kv) | None | ✅ 100% | Map to React state / sessionStorage. The persistent `memory` tool is matrx_ai's. |
| `storage` (persistent kv) | `chrome.storage.local` | ✅ 90% | Swap to Supabase row or localStorage |
| `update_plan` notifications | None | ✅ 100% | Approval card lives inline in chat |
| `guidance` (notes, screenshots, GIFs) | Some — captures require a tab | ⚠️ Partial | Notes are 100% portable; screenshot/GIF capture stays browser-only |
| `record_demo` / `replay_demo` | DOM events, tab control | ❌ | Browser-only by nature |
| `read_page`, `find`, `computer`, `tabs`, `navigate`, `form_input`, `wait_for`, `clipboard`, `cdp_*`, `ai` (Chrome AI), `cookies`, `webmcp`, `downloads` | Heavy browser APIs | ❌ | These are why matrx-extend exists |

The first eight rows in green are the focus of this doc.

---

## Architecture primer — what makes these portable

Every UI-first tool follows the **same five-piece pattern**. Steal the
shape; swap the transport.

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ Tool schema (Zod)   │───▶│ Handler (dispatcher)│───▶│ Storage (writes)    │
│  what the LLM sees  │    │  validates + acts   │    │  per-conversation   │
└─────────────────────┘    └──────────┬──────────┘    └──────────┬──────────┘
                                      │                          │
                                      ▼                          ▼
                           ┌─────────────────────┐    ┌─────────────────────┐
                           │ Pending request UI  │    │ Live store + sub    │
                           │  inline card / modal│    │  zustand mirror     │
                           └─────────────────────┘    └─────────────────────┘
```

1. **Schema** — Zod object that the catalog/discovery layer advertises to
   the model. Identical across Surfaces.
2. **Handler** — server-side or client-side function that runs on tool-call
   delegation. The same handler runs in both surfaces; only the side
   effects (storage write, UI broadcast) differ.
3. **Storage** — per-conversation maps. In matrx-extend = `chrome.storage.local`.
   In Next.js = Supabase tables or localStorage (depending on scope).
4. **Pending request UI** — inline card rendered in the chat stream when
   the agent is awaiting a user action. Two flavors: **confirm**
   (approve/deny) and **ask** (question + answer types).
5. **Live store + subscriber** — zustand mirror of storage. When anything
   changes, broadcast → mirror refreshes → UI re-renders → next agent
   turn includes the change in context.

The wire contract (request/response) is the **same on every Surface**.
The only thing that changes between matrx-extend and Next.js is steps
3 and the broadcast mechanism in 5.

---

## Dispatching tool calls — the wire-level loop

> **The aidream server doesn't care which Surface is running the tool.**
> It sends the same SSE stream to matrx-extend, the Next.js frontend, or
> a hypothetical SMS bot. Your job as a client is: declare what you can
> do, watch for delegations in the stream, run the handler, POST the
> result back. Five HTTP-shaped steps, the same on every Surface.

The authoritative wire contract is [/Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md](/Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md).
The walkthrough below is the bite-sized version for someone who's never
dispatched a tool before.

### Step 1 — Build the request

Every chat turn POSTs `/ai/agent/{agent_id}` with this shape (matches
[`src/lib/api/routes/ai.ts`](../src/lib/api/routes/ai.ts) `AgentStartRequest`):

```ts
{
  user_input: "what the human typed",
  conversation_id: string | null,        // null on the first turn
  variables: { ... } | null,             // agent-specific template vars

  // The Big Three:
  context: { ... },                      // (a) what the model READS
  client: {
    capabilities: ['nextjs-surface'],    // (b) what the model can ASK YOU FOR
    state: {
      'nextjs-surface': { ... },         // (c) orchestration hints for capability handlers
    },
  },
}
```

**(a) `context` — what the model reads.** Big rich object full of "menu"
keys the model can template into prompts (`{{user.name}}`,
`{{current_page.title}}`, etc.). Pre-loaded once per turn. No
deferred-load cost — see /Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md §2 for the convention.
In a Next.js surface this is your chance to ship the things only your
app knows: current route, signed-in user, theme, active workspace,
recent actions, whatever powers the chat.

**(b) `client.capabilities` — what the model can ASK you for.** A list of
capability names you support. Each capability brings a single always-on
discovery tool online (e.g. `load_chrome_tools` for browser-dom). The
model calls the discovery tool, the server-side capability handler
reads `state[<capability>]` to decide which sub-tools to inject, and
those tools become available mid-turn.

For UI-first tools (`tasks`, `user_todos`, `user`, `update_plan`,
`request_user_takeover`, `memory`, `storage`), you can either:

- **Declare a capability** like `'nextjs-surface'` whose discovery handler
  registers `tasks`, `user_todos`, etc. Cleanest — the model only loads
  them when relevant.
- **Or use `custom_tools`** to ship the same tool definitions inline per
  request. Simpler if you don't need lazy discovery.

**(c) `client.state[<capability>]` — orchestration hints.** Small dict
the capability handler reads to filter which tools to expose. Example:
matrx-extend ships `is_admin`, `permission_mode`, `desktop_bridge`,
`optional_permissions_granted`. Your Next.js surface might ship
`route`, `feature_flags`, `is_premium`.

### Step 2 — Open the SSE stream

The server streams Server-Sent Events. Each chunk is JSON. The shapes
you need to handle (see [`src/lib/stream/`](../src/lib/stream/) for the
matrx-extend implementation):

| Event | What you do |
|---|---|
| `stream_opened` (carries `conversation_id`) | Latch the conversation_id from the server's response — needed for the POST-back. |
| `text_delta` | Append to the streaming assistant message. |
| `reasoning_delta` | Append to the reasoning panel (optional). |
| `tool_started` | Render a "running…" indicator. |
| `tool_delegated` | **This is the one that matters for client tools.** Run the handler. |
| `tool_completed` (server-side tools only) | Render the result inline. |
| `done` | Close the stream. |

A delegated tool call payload looks like:

```ts
{
  type: 'tool_event',
  data: {
    event: 'tool_delegated',
    call_id: 'ab14d6906',
    tool_name: 'tasks',
    arguments: { action: 'add', items: [...] },
  },
}
```

### Step 3 — Validate args + run the handler

The pattern is identical to ours in [`src/lib/tools/dispatch.ts:354`](../src/lib/tools/dispatch.ts#L354):

```ts
async function handleDelegatedCall(callId, toolName, rawArgs, conversationId) {
  const handler = TOOL_REGISTRY.get(toolName);
  if (!handler) {
    return postToolResults(conversationId, [{
      call_id: callId, tool_name: toolName,
      output: null, is_error: true,
      error_message: `Unknown tool: ${toolName}`,
    }]);
  }

  // Zod safeParse — same Zod schemas you copied from matrx-extend
  const parsed = handler.argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return postToolResults(conversationId, [{
      call_id: callId, tool_name: toolName,
      output: null, is_error: true,
      error_message: `args failed schema: ${JSON.stringify(parsed.error.format())}`,
    }]);
  }

  // For ask-user tier: render a card and await user response (see Step 4).
  // For action tier (tasks / user_todos / etc.): just run it.
  try {
    const result = await handler.run(parsed.data, { conversationId, callId });
    await postToolResults(conversationId, [{
      call_id: callId, tool_name: toolName,
      output: result, is_error: false,
    }]);
  } catch (err) {
    await postToolResults(conversationId, [{
      call_id: callId, tool_name: toolName,
      output: null, is_error: true,
      error_message: (err as Error).message,
    }]);
  }
}
```

**Three things matter here:**

1. **Always reply.** Whether success, schema-fail, handler-throw, or
   user-cancel — the server expects ONE tool_result per delegated call.
   Skip it and the run hangs. Our dispatcher's `finishWithError` path is
   what guarantees this; replicate the discipline.
2. **Validate first.** If you copied the matrx-extend Zod schemas, the
   validation gates are already correct. Don't relax them — the model
   will eventually try every edge case.
3. **Pass `conversationId` and `callId` through.** The ask-user tools
   need both: `callId` ties the request-response back to this specific
   call, and `conversationId` scopes the inbox card so a parallel chat
   doesn't see it. (We learned this the hard way — see the
   [pilot conversation-id bug commit](../src/hooks/use-tool-inbox.ts#L53).)

### Step 4 — POST the result

```
POST /ai/conversations/{conversation_id}/tool_results
Content-Type: application/json

{
  "results": [
    {
      "call_id": "ab14d6906",
      "tool_name": "tasks",
      "output": { "ok": true, "created": [{ "id": "t_abc", "title": "..." }] },
      "is_error": false,
      "error_message": null
    }
  ]
}
```

See [`src/lib/api/routes/tool-results.ts`](../src/lib/api/routes/tool-results.ts)
for the wrapper we use. The server resumes the model with this output
as the tool's response — the next chunk on the SSE stream will reflect
what the model decided to do with the result.

### Step 5 — Special case: ask-user-tier tools

For `user`, `update_plan`, and `request_user_takeover`, the handler
**runs UI logic, not data logic**:

```
delegated → handler builds a PendingAskRequest →
broadcast → inbox store gets the card →
React renders the card inline in chat →
user clicks → response comes back →
handler resumes → POST tool_result with the user's answer
```

This is why we built the pending-request inbox pattern
([`src/state/tool-inbox.ts`](../src/state/tool-inbox.ts) +
[`src/hooks/use-tool-inbox.ts`](../src/hooks/use-tool-inbox.ts) +
[`src/features/chat/AgentAskUserCard.tsx`](../src/features/chat/AgentAskUserCard.tsx)).
The handler awaits a promise that resolves when the user clicks; the
broadcast bus is just the thing that wakes it up. In matrx-extend the
bus is `chrome.runtime.sendMessage`; in Next.js it can be:

- React state + a `useEffect` that resolves the pending promise on user click (simplest, single-tab)
- A custom hook on top of `EventTarget` (in-process pub/sub)
- Supabase Realtime if you need cross-tab synchronization

The promise-await-broadcast pattern itself is unchanged.

### Step 6 — Cancellation, timeouts, idempotency

Three failure modes the handler needs to handle:

- **User cancels** (closes modal / hits Esc) — POST `{is_error: false, output: {cancelled: true}}`. The tools all already model this in their result envelopes.
- **Timeout** (`timeout_seconds` from the tool args) — POST `{is_error: false, output: {timed_out: true}}`. Don't error; the model designed for this case.
- **Duplicate delegation** (rare, server retries) — keep an in-flight set of `callId`s. If you see the same call_id twice, ack the second one with the same result.

---

## Minimum viable client — checklist

If a Next.js dev wants to bring up the eight UI-first tools end-to-end,
they need:

- [ ] **Capability or custom_tools** declared in every `AgentStartRequest`
- [ ] **Context builder** that returns whatever your app surface knows
- [ ] **Tool registry** mapping name → Zod schema + handler
- [ ] **SSE stream handler** that routes `tool_delegated` to a dispatcher
- [ ] **Dispatcher** that validates with Zod, runs handler, POSTs result (one path, no exceptions)
- [ ] **Pending-request inbox** zustand store + the two card components for ask-user-tier
- [ ] **Per-conversation storage** for `tasks`, `user_todos`, `plan` — Supabase row or localStorage
- [ ] **Live store + subscriber** that re-reads when data changes (server-side change = Realtime; same-tab = setState)
- [ ] **Result POST helper** ([`tool-results.ts`](../src/lib/api/routes/tool-results.ts) is the reference)
- [ ] **Drift check** equivalent — keep your client tool registry in lockstep with `tool.definition` (steal [`scripts/check-tool-db-drift.ts`](../scripts/check-tool-db-drift.ts))

Once these are wired, every tool in the green section of the
portability ladder above ships in one PR — they all ride the same five
pieces.

---

## Tool-by-tool

### `user` — the ask-user mega-tool

**One tool, six modes** plus **batched questions**. The LLM picks the
mode via the `type` field; for asking multiple questions in one call
(1–4), pass `{questions: [SingleQuestion, …]}` instead of the top-level
fields. The card UI renders the matching variant.

**Schema:** [`src/lib/tools/handlers/user.ts`](../src/lib/tools/handlers/user.ts)
— flat top-level object with all fields optional + a `superRefine`
that enforces either single-question OR batched form (not both).

```ts
// Single-question form
const SingleQuestion = z.object({
  type: z.enum(['confirm','choice','choice_many','text','secret','notify']),
  question: z.string().optional(),
  header: z.string().max(12).optional(),         // chip label
  options: z.array(z.union([                      // bare strings OR rich objects
    z.string(),
    z.object({
      label: z.string(),
      description: z.string().optional(),
      preview: z.string().optional(),             // code/markdown rendered side-by-side
    }),
  ])).optional(),
  context: z.string().optional(),                 // one-line "why"
  message: z.string().optional(),                 // notify body
  actions: z.array(z.string()).optional(),        // notify action buttons
  level: z.enum(['info','success','warning','error']).optional(),
  allow_other: z.boolean().optional(),            // choice/choice_many: append "Other" freeform
  timeout_seconds: z.number().int().min(1).max(900).optional(),
});

// Top-level: either single OR batched
const UserArgs = z.object({
  ...SingleQuestion.shape,                        // single-question fields
  questions: z.array(SingleQuestion).min(1).max(4).optional(),  // batched form
});
// superRefine: when `questions` is set, every other field must be undefined.
```

**Handler:** same file — branches on `isBatched(args)`. Batched form
fires sequential cards (one card at a time); cancel/timeout
short-circuits the rest, remaining slots returned as empty envelopes
with `cancelled`/`timed_out` set so the model sees which question
ended the batch.

**Single-question return** — `AskUserResponse` envelope:
```ts
{ answer, selected, confirmed, action, freeform, cancelled, timed_out }
```
Unused fields are null/false.

**Batched return** — array of envelopes indexed by question position:
```ts
{ answers: Envelope[], cancelled: boolean, timed_out: boolean }
```

**Inbox store:** [`src/state/tool-inbox.ts`](../src/state/tool-inbox.ts) — pendingAsks[] + addAsk() / resolveAsk(). Filtered by `conversationId`.

**Subscriber that ties handler → store:** [`src/hooks/use-tool-inbox.ts`](../src/hooks/use-tool-inbox.ts).

**Card components:**
  - Generic ask card with rich options + side-by-side preview + header chip + "Other" freeform: [`src/features/chat/AgentAskUserCard.tsx`](../src/features/chat/AgentAskUserCard.tsx)
  - Confirm-only card: [`src/features/chat/AgentApprovalCard.tsx`](../src/features/chat/AgentApprovalCard.tsx)

**Response wire shape:** [`src/lib/tools/types.ts`](../src/lib/tools/types.ts) — `AskUserResponse` envelope.

**Next.js port:** straight copy. Substitute the cross-component message
bus (currently `chrome.runtime.onMessage` via [`src/lib/messaging/native.ts`](../src/lib/messaging/native.ts)) with React state or an in-process pub/sub. Everything else — Zod schema, store, card, lifecycle — is framework-agnostic. The card component is ~350 LOC of pure React + shadcn primitives.

**Card layout rules to replicate:**
- `header` (if present) renders as a small uppercase chip above the question.
- `context` renders as a one-line muted line above the question.
- `batch_index` / `batch_total` (set by the handler for batched questions) render as "N of M" badge.
- `choice` with ANY option having a `preview` → side-by-side grid: vertical option list on the left, monospace preview block on the right (renders the `preview` of the focused/hovered option).
- `choice` or `choice_many` with `allow_other: true` → append a dashed-border "Other" option whose `description` says "Type a different answer"; when selected/checked, expand to a `Textarea` underneath; the response's `freeform` field carries the typed text.
- `notify` always appends an `"Other"` button next to the action buttons; clicking opens a freeform textarea.

**LLM example calls:**

```jsonc
// 1. Bare strings (legacy, still works)
{ "type": "choice", "question": "Pick one", "options": ["A", "B"] }

// 2. Rich options with preview
{
  "type": "choice",
  "header": "Palette",
  "question": "Pick a color palette",
  "options": [
    {
      "label": "Slate + emerald (Recommended)",
      "description": "Cool neutrals with a green accent.",
      "preview": "--bg: #0f172a;\n--accent: #10b981;"
    },
    { "label": "Warm beige + amber", "description": "Softer." }
  ]
}

// 3. Multi-select with allow_other
{
  "type": "choice_many",
  "question": "Which integrations?",
  "options": ["Slack", "GitHub", "Linear"],
  "allow_other": true
}

// 4. Batched (1–4 questions in one call)
{
  "questions": [
    { "type": "choice", "header": "Palette", "question": "...", "options": [...] },
    { "type": "confirm", "header": "Deploy",  "question": "Deploy now?" }
  ]
}
```

---

### `update_plan` — propose-and-approve

A specialization of `user(type='choice')` that also persists the plan
itself so the panel can render it during AND after approval.

**Schema:** [`src/lib/tools/handlers/user.ts:195`](../src/lib/tools/handlers/user.ts#L195) — `title`, `steps[]`, `domains?[]`, `reasoning?`, `estimated_minutes?`.

**Handler:** same file, line 217. Persists to storage immediately (status='proposed'), then awaits approval, then flips status to `approved` / `rejected`. **On approval, auto-populates the tasklist** with one task per step.

**Storage:** [`src/lib/lists/storage.ts`](../src/lib/lists/storage.ts) — `savePlan` / `setPlanStatus` / `getPlan` / `clearPlan`.

**UI section:** Plan section inside [`src/features/lists/TaskPanel.tsx`](../src/features/lists/TaskPanel.tsx) (drawer) and [`src/features/lists/ListsHubView.tsx`](../src/features/lists/ListsHubView.tsx) (aggregate tab).

**Next.js port:** the approval card itself rides the same `user(type='choice')` path. The plan persistence + auto-populate hook just need a server-side store (Supabase `cx_plan` table is the natural shape — one row per conversation). Same handler signature.

---

### `tasks` — agent's live tasklist

Eight actions, one aidream-native mega-tool, per-conversation. The server is
the only executor; matrx-extend deliberately has no `tasks` tool handler or
`chrome-extension` binding.

**Schema + handler:** [`aidream/aidream/tools/agent_tasks_tool.py`](../../aidream/aidream/tools/agent_tasks_tool.py)

```ts
action: 'add' | 'list' | 'set_status' | 'update' | 'remove' |
        'reorder' | 'clear_completed' | 'clear_all'
status: 'pending' | 'in_progress' | 'done' | 'blocked' | 'skipped'
```

**Storage:** `chat.agent_task` in the shared Supabase database. The extension
accessors in [`src/lib/lists/storage.ts`](../src/lib/lists/storage.ts) read and
edit that table directly for the UI; server tool calls write it through the
Matrx ORM. Extension-originated writes broadcast `LISTS_CHANGED`.

**Types:** [`src/lib/lists/types.ts`](../src/lib/lists/types.ts) — `Task` + `TaskStatus`.

**Live store mirror:** [`src/state/lists.ts`](../src/state/lists.ts) —
`useListsStore` + `useListsSubscriber(conversationId)`. Local broadcasts and
Supabase Realtime both refresh the task slice, so aidream writes repaint while
the run is in progress.

**Per-chat UI:** [`src/features/lists/TaskPanel.tsx`](../src/features/lists/TaskPanel.tsx) — drawer with inline-edit titles, status cycling (click icon to advance), keyboard-friendly add row.

**Header chip:** `TaskPanelChip` exported from the same file — small `📋 done/total` badge that toggles the drawer.

**Aggregate view:** [`src/features/lists/ListsHubView.tsx`](../src/features/lists/ListsHubView.tsx) — cross-conversation triage; expand a conversation to see + edit its lists without leaving the hub.

**Context injection:** [`src/lib/chat/context/v2-bundled.ts`](../src/lib/chat/context/v2-bundled.ts) — adds `task_list` key when non-empty. Slim shape: `[{id, title, status, note}]`. The user's edits since last turn ride this key automatically.

**Other clients:** consume the same `chat.agent_task` table directly and use
Realtime to repaint. Do not add another tool executor merely to display or edit
task rows.

---

### `user_todos` — agent assigns work BACK to the user

Symmetric to `tasks`. Items the agent creates; the user checks off in
the UI; the agent sees the change in context on the next turn.

**Schema:** [`src/lib/tools/handlers/lists.ts:140`](../src/lib/tools/handlers/lists.ts#L140)

```ts
action: 'add' | 'list' | 'update' | 'remove' | 'mark_done' | 'clear_done'
fields: title, context?, due?, id?, silent?, done?
```

**Handler:** same file, line 191. `add` fires a Chrome notification by
default; pass `silent:true` to suppress.

**Storage + types + live store:** same files as `tasks` — they share the
infrastructure.

**Per-chat UI:** "Your todos" section in [`src/features/lists/TaskPanel.tsx`](../src/features/lists/TaskPanel.tsx). Checkbox to mark done, inline-add row, collapse-to-show-done.

**Aggregate view:** in [`ListsHubView.tsx`](../src/features/lists/ListsHubView.tsx).

**Context injection:** `user_todos` key in [`v2-bundled.ts`](../src/lib/chat/context/v2-bundled.ts) — `{open: [...], recent_done: [up to 5]}` so the agent literally sees what the user closed since last turn.

**Next.js port:** copy. Replace `chrome.notifications.create` with whatever your notification system is (Web Push, in-page toast, server-side email). Per the existing pattern, fire-and-forget so the tool never blocks on a notification failure.

---

### `request_user_takeover` — full handoff

The agent stops; the user does something the agent can't. In matrx-extend
this means "type into the page directly"; in Next.js it might mean
"pause the chat input and let the user act in the main UI". The
**lifecycle** is identical regardless of what "takeover" means in the
host application.

**Schema:** [`src/lib/tools/handlers/user.ts:165`](../src/lib/tools/handlers/user.ts#L165) — `reason`, `expected_action?`, `instructions?`.

**Handler:** same file. Renders a `text`-kind ask card with the reason
as the question; resolves with whatever the user types (which can be a
"done" acknowledgment or actual structured output).

**Card:** reuses the existing `AgentAskUserCard.text` variant. No bespoke
component.

**Next.js port:** drop the takeover Zod schema in unchanged. Define
your own "what does takeover do in this app" — e.g. greying out the
chat input, opening a side modal, navigating somewhere. The schema +
inbox + response wiring are identical.

---

### `scratchpad` — session-scoped, in-process kv

`get` / `set` / `list` / `delete` against a session-scoped map. Use
this for ephemeral state inside a single run. For things the agent
should remember about the user across sessions, use the canonical
`memory` tool (owned by matrx_ai) instead.

**Schema + handler:** [`src/lib/tools/handlers/canonical.ts`](../src/lib/tools/handlers/canonical.ts) — search for `ScratchpadArgs`.

**Storage:** an in-process `Map` in the service worker. Cleared on SW
restart (session boundary).

**Next.js port:** map to `sessionStorage` for a per-tab scope, or a
React context for a per-page scope. Same API surface — bare name
`scratchpad` means the same `tool.definition` row is shared with the extension.

---

### `storage` — persistent KV

Same actions as `memory` but persistent across sessions. Distinct from
`memory` precisely so the model knows what survives.

**Schema + handler:** [`src/lib/tools/handlers/canonical-mergers.ts`](../src/lib/tools/handlers/canonical-mergers.ts) (search for `StorageArgs`).

**Storage:** `chrome.storage.local`. One namespace per user (implicit
because chrome.storage is per-extension-install).

**Next.js port:** a Supabase row keyed `(user_id, key)` is the obvious
fit. Or `localStorage` if you want pure client-side, accepting the
single-browser limitation.

---

## Common adaptations (Chrome → Next.js)

| Chrome extension primitive | Next.js equivalent |
|---|---|
| `chrome.storage.local.set/get` (per-conversation map) | Supabase row per conversation, or localStorage |
| `chrome.runtime.sendMessage` + `onMessage` (SW ↔ sidepanel) | React state + zustand setter (same process); Supabase Realtime if cross-tab |
| `chrome.notifications.create` | Web Push, in-page toast (shadcn `sonner`), or system notification |
| `chrome.tabs.query` + tab assignment | Doesn't exist; substitute "current URL" / "current page" concept |
| `ToolContext.conversationId` | The same — server passes it in the tool-call delegation envelope |
| Sidepanel-only zustand mirror | Same zustand, mounted at the chat-route level |
| `LISTS_CHANGED` broadcast | React state setter + (optionally) Supabase Realtime channel for cross-tab sync |

---

## What's NOT portable (and why)

- **`read_page`, `find`, `find_text_on_page`, `query_elements`, `inspect_element`, `get_element_details`, etc.** — Read the live DOM with reference IDs. No analogue in a Next.js app talking to the LLM; the page being chatted about is itself the Next.js app.
- **`computer`, `tabs`, `navigate`, `form_input`, `submit_form`, `wait_for`, `clipboard`** — Cross-page automation. Browser-only by definition.
- **`ai` mega-tool** — uses Chrome's built-in Gemini Nano. Next.js would route to a server-side LLM call instead (so the *capability* exists, but as a different shape — likely a server tool, not a client tool).
- **`cookies`, `cdp_session`, `cdp_emulate`, `webmcp`, `record_demo` / `replay_demo`, `downloads`, `screenshot_region`, `cdp_full_page_screenshot`, `evaluate_javascript`** — All require deep Chrome APIs.
- **`record_tab_video`, `record_gif`** — Tab capture + MediaRecorder. Browser-only.

For these, the matrx-extend Chrome extension stays the surface of
choice. The Next.js app delegates "use the user's browser to do X" to
matrx-extend via the bridge described in [/Users/armanisadeghi/code/common-docs/systems/clients/extension/CHANNELS.md](/Users/armanisadeghi/code/common-docs/systems/clients/extension/CHANNELS.md).

---

## The patterns to steal first

If a Next.js dev only has time for ONE pattern from this repo, take the
**pending-request inbox** in [`src/state/tool-inbox.ts`](../src/state/tool-inbox.ts) +
[`src/hooks/use-tool-inbox.ts`](../src/hooks/use-tool-inbox.ts) +
[`src/features/chat/AgentAskUserCard.tsx`](../src/features/chat/AgentAskUserCard.tsx).
That trio gives you `user`, `update_plan`, `request_user_takeover`,
and any future ask-user-tier tool in one ~200-line surface.

After that, the **per-conversation map + broadcast + zustand mirror**
pattern in [`src/lib/lists/storage.ts`](../src/lib/lists/storage.ts) +
[`src/state/lists.ts`](../src/state/lists.ts) is the chassis for
`tasks`, `user_todos`, and anything else that lives per-conversation.

Everything else builds on those two foundations.
