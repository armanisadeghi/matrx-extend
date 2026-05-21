# Turn-boundary inbox — server requests (status)

> **Context:** the extension implements the client side of the turn-boundary
> inbox ([TURN_BOUNDARY_INBOX.md](./TURN_BOUNDARY_INBOX.md)): while a run is
> streaming, the user can keep typing and "send" — we POST to
> `/ai/conversations/{id}/inbox`, float a "waiting its turn" card above the
> composer, and on `injection_consumed` slot the message into the transcript.
>
> **Status: all requests resolved except #6 (force-in / interrupt), which the
> server team deliberately deferred.** Kept as a record + the one open item.

| # | Ask | Status | Client wiring |
|---|---|---|---|
| 1 | Type `injection_consumed` in the generated registry | **Done** | `InjectionConsumedEvent` after `pnpm update-api-types`; consumed in [use-chat-stream.ts](../src/hooks/use-chat-stream.ts). `inbox_continue` handled as a standard `info` event. |
| 2 | Echo `text` + `is_visible_to_user` on consumed items | **Done (contract); deployed schema lags** | We read both defensively and honor `is_visible_to_user`; fall back to our local record. See note below. |
| 3 | List pending items | **Done** | `listPendingInboxMessages()` in [routes/ai.ts](../src/lib/api/routes/ai.ts). Not auto-called yet (reopening the side panel starts a fresh chat in this extension, so there's no live run to rebuild cards for). Available for future surfaces. |
| 4 | Cancel a pending item | **Done + wired** | `cancelInboxMessage()` → the × (retract) button on a pending card. Handles 409 (drained) / 404 (gone). |
| 5 | Edit a pending item | **Done + wired** | `editInboxMessage()` → the pencil (edit) button → inline editor on a pending card. Handles 409 / 404. |
| 6 | "Force in" / interrupt mid-tool | **Deferred (server)** | Not built. See below. |

## Note on #2 — deployed schema lags the contract

The contract says every `injection_consumed` item carries `text` and
`is_visible_to_user`, but the **generated** `ConsumedInjection` type pulled from
the live backend (`pnpm update-api-types`, 2026-05-20) still only has
`{ injection_id, kind, position, message_id }`. So the deployed event-schema
hasn't caught up to the doc.

The client reads `text` / `is_visible_to_user` defensively (present → use them;
absent → fall back to the local record of what we sent), so it works either
way. **Once the deployed schema includes those fields, no client change is
needed** — re-running `pnpm update-api-types` will just make the casts
unnecessary. Worth confirming the server actually emits `text` at runtime.

## The one open item — #6, force-in / interrupt

Deferred by the server team: today delivery is at the next natural boundary
(right after the in-flight tool batch returns, before the next model call),
which is already soon. A true "abort the running tool *right now*" overlaps
cancellation semantics and needs its own design. If the product need is real,
spec "interrupt" precisely (abort in-flight tool vs. deliver-before-next-model-
call) as a follow-up. **No client work until that's specced.**

## Client status (where it all lives)

- **Enqueue / list / cancel / edit:** [src/lib/api/routes/ai.ts](../src/lib/api/routes/ai.ts).
- **State:** [src/state/turn-inbox.ts](../src/state/turn-inbox.ts) (ephemeral).
- **UI:** [src/features/chat/QueuedMessageCard.tsx](../src/features/chat/QueuedMessageCard.tsx)
  (waiting cards + retract/edit) and the gradient/clock send button in the
  ChatView composer (only while streaming).
- **Delivery:** `injection_consumed` in [use-chat-stream.ts](../src/hooks/use-chat-stream.ts).
- **Scope:** Assistant Chat surface only. Pilot
  ([use-pilot-chat-stream](../src/hooks/use-pilot-chat-stream.ts)) follows the
  same pattern when wired.
