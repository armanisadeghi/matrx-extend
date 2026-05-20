# Stream resume protocol (proposed) — backend coordination

> Status: **client scaffold shipped, backend not yet implemented.**
> Owner of the client side: matrx-extend (`src/lib/stream/resume.ts` +
> `src/lib/stream/watchdog.ts`). Owner of the server side: aidream
> (`/ai/agent` streaming route). Coordinate via the `connect-aidream` skill.

## Why

The extension streams agent runs over NDJSON (sidepanel → SW → offscreen →
`fetch`). There was **no client-side timeout**: if the offscreen document died,
the network hung mid-stream, or the server went silent without a terminal
`done`, the sidepanel never learned the run ended and the spinner spun forever
(the "stuck UI" bug).

The client now runs a **stall watchdog** (`createStreamWatchdog`, 75s of total
silence — any chunk, including the server's `heartbeat` event, resets it). On
stall it clears the spinner and shows a Retry banner. Retry currently **replays
the whole turn**, which re-runs tool side effects and bills again. True
**resume** — re-attaching to the still-running request and replaying only the
unsent tail — needs backend support.

## Client behavior today

1. `STREAM_OPENED` gives us `request_id` + `conversation_id`; we keep them and a
   running `cursor` (count of events received).
2. On stall, `attemptResume({ runId, conversationId, requestId, cursor })` is
   called. It is gated by the `matrx.stream.resume.enabled` storage flag and
   currently returns `{ resumed: false, reason: 'resume-unsupported' }`, so the
   watchdog falls back to the Retry banner.
3. When the backend ships the endpoint below, flip the flag (or default it on)
   and implement the re-open in `attemptResume` (resolve auth → `STREAM_START`
   with the resume URL so the offscreen doc re-attaches).

## Proposed wire contract

```
GET /ai/agent/runs/{request_id}/resume?conversation_id={cid}&cursor={n}
Accept: text/x-ndjson
Authorization: Bearer <token>   (or X-Fingerprint-ID for guests)
```

Responses:

| Status | Meaning | Client action |
|---|---|---|
| `200 text/x-ndjson` | Run still live (or buffered). Server replays events **after** `cursor`, then continues the live stream. | Re-attach; watchdog re-arms. |
| `409 Conflict` | Run already completed while we were disconnected. | Don't replay — reconcile from the persisted `cx_conversation` / `cx_message` records, then mark the turn done. |
| `404 Not Found` | Run unknown / expired / not resumable. | Fall back to Retry (replay the turn). |

### Server requirements

- Buffer (or be able to re-derive) emitted events per `request_id` for a short
  TTL (e.g. 2–5 min) so a reconnect within the window can replay from `cursor`.
- Emit `heartbeat` events on a fixed cadence (≤ ~20s) during long tool calls so
  the client watchdog doesn't false-positive on legitimately slow steps. The
  client already consumes `heartbeat` as a liveness signal (resets the
  watchdog) — it just needs them to actually arrive during long gaps.
- Make `cursor` semantics match the client's count: 1 increment per NDJSON
  event line the client received (see `eventCountRef` in `use-chat-stream.ts`).

## Open questions for the backend

1. Is per-request event buffering feasible, or should resume reconcile purely
   from the DB records (which would make `200`-replay impossible and leave only
   the `409`-reconcile path)?
2. What's the heartbeat cadence today, and during tool execution specifically?
3. Should guest (fingerprint) runs be resumable, or Retry-only?
