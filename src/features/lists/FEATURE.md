# Conversation plans and tasks

## Runtime contract

The Chat and Pilot surfaces each own exactly one `useListsSubscriber` call while their tab is
visible. `TaskPanel` and `TaskPanelChip` are renderers over the shared Zustand state; they must
never create their own subscriptions.

**Realtime is `@ai-matrx/realtime`'s — never a hand-rolled `supabase.channel(...)`** (guard:
`tests/unit/realtime-adoption.test.ts`). The three channels this feature owns are declared once
in [`src/lib/lists/realtime.ts`](../../lib/lists/realtime.ts) and opened with `useChannel`:

| Surface | Namespace | Scope |
|---|---|---|
| `useListsSubscriber` (Chat / Pilot) | `extend-lists-tasks-conversation` | `chat.agent_task` filtered to the active conversation |
| `ListsHubView` — the aggregate list | `extend-lists-tasks-all` | every `chat.agent_task` row RLS lets this user see |
| `ListsHubView` — the expanded row | `extend-lists-tasks-conversation` | filtered to the open conversation |

Three things the package now handles that this feature used to get wrong:

- **The unique topic is not ours to mint.** A per-mount `crypto.randomUUID()` suffix used to
  guard against React remounting onto a still-subscribed channel. The package mints a unique
  INSTANCE topic for every Postgres Changes channel itself — and deliberately does NOT for
  broadcast/presence, where the topic IS the room and a suffix would split it. Declaring a
  namespace is the whole job.
- **`onBackfill` is mandatory and is a real read.** Realtime has no replay: a task written while
  the sidepanel was closed, asleep, or offline never arrives. Every channel here re-reads its own
  slice on reconnect, wake, network restore, and queue overflow.
- **Own writes go on the shared write ledger.** `lib/lists/storage.ts::updateTask` calls
  `begin` before the request and `settle` with the server's `updated_at` after it, so our own
  echo does not cost a refetch. It passes NO fingerprint to `begin`: the update is a PATCH, and
  a fingerprint built from a patch cannot match the full row the echo carries — a wrong one
  reads as divergent content, i.e. a false conflict.

## Change log

- 2026-09-07 — Moved all three channels onto `@ai-matrx/realtime`; deleted `createTaskChannelTopic`
  (a `uniqueChannelTopic` twin — now a row in `scripts/package-twins.json`), the `removeChannel`
  teardowns, and the `CHANNEL_ERROR` console lines. Added the catch-up reads the feature never
  had, and the write-ledger registration on `updateTask`. The hub's DETAIL channel also gained the
  `conversation_id` filter its topic name always implied — it had been waking on every
  `agent_task` row in the account to refetch one conversation.
- 2026-08-17 — Moved subscription ownership to Chat/Pilot, removed duplicate subscriptions from
  the panel and chip, and collapsed three task-table callbacks into one pre-subscribe wildcard
  callback.
- 2026-08-17 — Made each effect mount's Realtime topic unique so React StrictMode cleanup/remount
  cannot reuse a channel that is still subscribed. *(Superseded 2026-09-07 — the package owns
  this.)*
