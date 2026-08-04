# Cold-resume — re-surfacing a paused conversation's outstanding tool calls

**Status:** implemented. Client-only; the server endpoints it relies on already
exist (see "Server contract" below). Operator runtime verification still
required — see the test path at the bottom.

---

## The problem

A client-delegated tool call (a browser action the extension must run, e.g.
`click_element`, `take_screenshot`) **hard-suspends** the agent on the server:
aidream durably commits the assistant message + a `cx_tool_call` row in
`status='delegated'`, emits the `tool_delegated` event, and **ends the SSE**.
The client is expected to run the tool, POST the result to
`/ai/conversations/{id}/tool_results`, and — when no delegated calls remain —
open `/ai/conversations/{id}/resume` to continue the turn.

That handshake only works while the side panel is open. If the user **closes
the side panel / extension** during the approval window (closes the tab
mid-prompt, walks away, comes back hours or weeks later), the live in-memory
waiter is gone. On reopen the conversation loads from the DB as a static
transcript and the agent sits paused forever — the user has no way to answer the
prompt that the run is blocked on.

## The fix

On conversation open, discover the outstanding delegated calls and re-drive them
through the **exact same** dispatch path a live `tool_delegated` event uses.

```
ChatView (conversation loaded)
  └─ triggerColdResume(conversationId)                 src/lib/chat/cold-resume.ts
       ├─ GET /ai/conversations/{id}/pending_calls     → PendingCall[]
       └─ for each call: send(COLD_RESUME_CALL, {…})    sidepanel → SW
                                                          (awaited, like STREAM_START)
SW dispatcher  COLD_RESUME_CALL handler                src/lib/tools/dispatch.ts
  ├─ markDispatched(runId, callId)   dedupe a remount / second open
  ├─ synthesize RunMeta + ToolContext (no live stream → supply tab + perm mode)
  └─ handleCall(handler, args, ctx, meta)              SAME path as live delegation
        ├─ permission gate → approval card (conversation-scoped, no live stream needed)
        ├─ run handler
        ├─ postResult → POST /tool_results
        └─ continuation_needed → broadcast STREAM_CONTINUE → use-chat-stream resumes
```

The synthetic `runId` is `coldresume:{userRequestId ?? conversationId}` — stable,
so a remount or a second open dedupes via `markDispatched` instead of double-running
the handler. The continuation handshake keys off the server's `user_request_id`
(returned by `/tool_results`), **not** the runId, so resume behaves identically to
the live path. (Since 2026-07-23 `user_request_id` may be null — the server's
resume is conversation-keyed, the id optional in the `/resume` body — so the
handshake falls back to per-conversation keying end-to-end.)
`use-chat-stream`'s `STREAM_CONTINUE` listener only resumes when the
conversation is the selected one — which it is, because selecting it is what
triggered the cold-resume.

## Why it routes through the SW, not a direct fetch

The delegated call still needs the full dispatch treatment: the permission card
(`action`/`privileged` tiers), the assigned-tab context, audit receipts, the
pilot-group gate, and the continuation broadcast. Re-using `handleCall` means
cold-resume inherits every one of those for free and can never drift from the
live path.

## Run context on a cold open

There is no `STREAM_START` to latch run metadata, so `triggerColdResume` supplies
what the SW would otherwise have captured:

- **assignedTabId** — the original tab is long gone; the current active tab is the
  only sensible target (`resolveActiveTab()`).
- **permissionMode** — read live from the chat store (`getPermissionMode(null)`).

Read-tier tools run immediately; action/privileged tools surface their approval
card in the reopened conversation exactly as they would live.

## Server contract (already shipped)

- `GET /ai/conversations/{id}/pending_calls` → `list[PendingCallSummary]`
  (`aidream/api/routers/conversations.py`). Filters `status='delegated'` +
  `is_client_delegated=true` for the conversation. The extension mirrors this as
  `PendingCall` in [src/lib/api/routes/tool-results.ts](../src/lib/api/routes/tool-results.ts).
- `POST /ai/conversations/{id}/tool_results` → `{ continuation_needed, user_request_id, … }`.
- `POST /ai/conversations/{id}/resume` — opened by `use-chat-stream` on the
  `STREAM_CONTINUE` broadcast.

## Operator test

1. Send a message that makes the agent call a browser **action** tool (e.g. "click
   the first link") in **Ask** mode so an approval card appears.
2. When the approval card shows, **close the side panel** without answering.
3. Reopen the side panel and select the same conversation.
4. **Expected:** the approval card re-appears. Approve it → the tool runs, the
   result posts, and the agent **resumes** and finishes its turn.
5. Edge cases: a read-tier delegated call runs immediately on reopen (no card);
   reopening twice in a row does not double-run the handler; a tool no longer in
   the registry posts a structured unknown-tool error rather than hanging.
