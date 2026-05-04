# Heads-up for the Python team: new `sleep` browser-DOM tool

Tiny note — most likely no server-side change needed, but flagging the one
case where it might matter.

## What it is

`sleep` is a new client-side browser-DOM tool the agent can call to pause
itself for a fixed duration. Use cases: waiting for a YouTube video to
play before transcript capture, letting a debounced search settle,
waiting out a rate-limit window, anything time-based the page does on its
own.

- **Category**: `interact` (on-demand via `load_browser_tools`)
- **Tier**: `action`
- **Args**: `{ ms: integer 50–300000, reason?: string ≤200 chars }`
- **Behavior**: extension awaits `setTimeout(ms)` then posts the result.
- **Result**: `{ ok: true, slept_ms: number, reason: string | null }`

## Server impact

The mechanism is the same as every other delegated tool — server emits
the call, client runs it, client posts back via the existing
`/conversations/{id}/tool_results` endpoint. The server isn't blocked
during the sleep; the agent loop pauses just like any other tool call.

## The one thing to double-check

**Tool-call timeout settings.** If the server has a default timeout for
delegated tools that's shorter than 5 minutes, `sleep` calls that use the
upper end of the range will be marked failed even though the client is
still working correctly. Two options:

1. **Raise the global timeout** to ≥5 minutes (cap matches the client-side
   schema cap of `300_000` ms).
2. **Read the `ms` arg** when registering the tool call's deadline:
   `deadline = now + args.ms + slack` (e.g. 30s slack for round-trip
   variance).

Option 2 is cleaner — tool-specific deadlines are robust to future changes
in the cap.

If the server already does no-timeout-or-very-long-timeout for delegated
tools, ignore this note entirely.

## Cancellation (not for v0, but worth knowing)

The current client implementation runs the timer in the SW with no
cancellation hook. If a conversation is cancelled mid-sleep, the timer
still completes and posts the (now-orphaned) result. Server should
already drop tool results for cancelled conversations — that path
handles `sleep` correctly.

If you want true cancellation, we'd add a kill mechanism in the SW
(track in-flight sleeps, abort on `STREAM_KILL`). Out of scope for now.
