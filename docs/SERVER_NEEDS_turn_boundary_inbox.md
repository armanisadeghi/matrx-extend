# Turn-boundary inbox — server requests (status)

> **Context:** the extension implements the client side of the turn-boundary
> inbox ([TURN_BOUNDARY_INBOX.md](./TURN_BOUNDARY_INBOX.md)): while a run is
> streaming, the user can keep typing and "send" — we POST to
> `/ai/conversations/{id}/inbox`, float a "waiting its turn" card above the
> composer, and on `injection_consumed` slot the message into the transcript.
>
> **Status: ALL requests resolved AND fully wired client-side** — #6 (interrupt)
> is delivered server-side (server captures the partial assistant turn +
> auto-marker; no special endpoint) and now wired in the composer as the
> "stop & send" affordance. #2's defensive casts were dropped once the deployed
> schema caught up (`pnpm update-api-types`, 2026-05-22 — `ConsumedInjection`
> now carries `text` + `is_visible_to_user`). Canonical server contract:
> aidream `docs/TURN_BOUNDARY_INBOX.md`.

| # | Ask | Status | Client wiring |
|---|---|---|---|
| 1 | Type `injection_consumed` in the generated registry | **Done** | `InjectionConsumedEvent` after `pnpm update-api-types`; consumed in [use-chat-stream.ts](../src/hooks/use-chat-stream.ts). `inbox_continue` handled as a standard `info` event. |
| 2 | Echo `text` + `is_visible_to_user` on consumed items | **Done (contract); deployed schema lags** | We read both defensively and honor `is_visible_to_user`; fall back to our local record. See note below. |
| 3 | List pending items | **Done** | `listPendingInboxMessages()` in [routes/ai.ts](../src/lib/api/routes/ai.ts). Not auto-called yet (reopening the side panel starts a fresh chat in this extension, so there's no live run to rebuild cards for). Available for future surfaces. |
| 4 | Cancel a pending item | **Done + wired** | `cancelInboxMessage()` → the × (retract) button on a pending card. Handles 409 (drained) / 404 (gone). |
| 5 | Edit a pending item | **Done + wired** | `editInboxMessage()` → the pencil (edit) button → inline editor on a pending card. Handles 409 / 404. |
| 6 | "Force in" / immediate interrupt | **Done + wired** | "Stop & send" composer button: `interruptAndSend()` in [use-chat-stream.ts](../src/hooks/use-chat-stream.ts) aborts the stream, waits a short grace period for the server to flush the partial turn + marker, then sends normally. Amber→rose button with a stop badge, distinct from the (waiting) queue send and the plain Stop. See below. |

## Note on #2 — RESOLVED (deployed schema caught up)

The contract says every `injection_consumed` item carries `text` and
`is_visible_to_user`. As of `pnpm update-api-types` on **2026-05-22**, the
generated `ConsumedInjection` type now includes both
(`{ injection_id, kind, text?, is_visible_to_user?, position?, message_id? }`),
and the drain echoes `text` at runtime — the deploy shipped.

`handleInjectionConsumed` in [use-chat-stream.ts](../src/hooks/use-chat-stream.ts)
now reads the generated typed fields directly (no `Record<string, unknown>`
casts). It still falls back to the local record of what we sent when `text` is
empty — covers a consumed item we never queued locally with no echoed text.

## #6 — immediate interrupt (now delivered)

The server did NOT build "abort the running tool mid-syscall" (that overlaps
cancellation semantics and is fragile). It built the **right** thing: a clean
cut that keeps what the model already said.

**Mechanism (fully server-managed):** when a run is interrupted, the server
captures the partial assistant text it streamed up to the last chunk, saves it
as a normal (truncated) assistant turn, and appends an automatic marker:
`\n\n[⚠️ Response interrupted by the user before completion.]` — so both the user
(transcript) and the model (next turn) see exactly what happened.

**Client wiring (interrupt = "stop & redirect"):**
1. **Abort the current stream** (close the SSE connection). The server cancels
   the run and persists the partial assistant turn (with the marker) — no
   client-supplied content; the server owns the capture.
2. **Send the new message normally** (`POST /ai/conversations/{id}`). The fresh
   run loads history — now including that truncated, marked assistant turn — and
   responds to the redirect.

**Sequencing:** send the redirect *after* the aborted stream has fully closed,
so the partial turn is persisted before the new run loads history. No special
endpoint and no `priority` flag — abort + normal send is the whole flow. (A
future synchronous `/interrupt` endpoint could remove even that ordering
nuance; not needed today.)

This is distinct from the inbox: **inbox = wait for the boundary, same run;
interrupt = cut now, keep the partial, fresh run.** Both are exposed as two
affordances while streaming:
- **"send while running"** — the indigo→violet clock-badge button → `queueMessage()` → POST `/inbox`.
- **"stop & send"** — the amber→rose stop-badge button → `interruptAndSend()` (abort → 350ms grace → normal send).

`interruptAndSend` lives in [use-chat-stream.ts](../src/hooks/use-chat-stream.ts);
the buttons live in the ChatView `Composer` (only while `isStreaming`, both
gated on a server-assigned conversation id). The plain Stop square remains for
"stop, don't send."

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
