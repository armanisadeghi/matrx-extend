# Streaming Pipeline

## Wire format: NDJSON, not SSE

The Matrx FastAPI backend streams **newline-delimited JSON** — one JSON object per line, separated by `\n`. This matches [matrx-frontend/lib/api/stream-parser.ts](../../matrx-frontend/lib/api/stream-parser.ts).

Two event shapes appear on the wire:

```jsonc
// Standard form
{ "event": "chunk", "data": { "text": "hello" } }
{ "event": "phase", "data": { "phase": "generating" } }
{ "event": "completion", "data": { /* … */ } }
{ "event": "error", "data": { "error_type": "...", "message": "...", "user_message": "..." } }
{ "event": "end", "data": { "reason": "complete" } }

// Compact form (chunks only — saves bytes on hot path)
{ "e": "c", "t": "hello" }      // chunk
{ "e": "r", "t": "thinking..." } // reasoning_chunk
```

`expandCompactEvent()` from `types/python-generated/stream-events.ts` normalizes the compact form to the standard form. Everything downstream sees standard events.

## Why offscreen?

MV3 service workers are killed after ~30s idle. Long agent runs / scrape jobs easily exceed that, and the `fetch()` reader dies with the SW. The offscreen document is a regular web page that persists for the duration of its declared `reasons`, so the reader stays alive across SW kills.

We declare `reasons: ['BLOBS']`; the doc is created on first stream and reused for subsequent ones.

## Why distinct channels for SW→offscreen?

If the SW broadcasts `STREAM_START` to forward it to the offscreen, the SW catches its own broadcast (Chrome's `chrome.runtime.sendMessage` echoes to the SW's own listeners). With a single `STREAM_START` channel, the SW's handler would call itself — infinite loop, instant hang.

Solution: distinct channel names per direction.

- `STREAM_START` (sidepanel → SW): "I want to start a stream"
- `STREAM_RUN` (SW → offscreen): "actually run this fetch with these pre-resolved headers + url"
- `STREAM_CANCEL` (sidepanel → SW): "cancel"
- `STREAM_KILL` (SW → offscreen): "abort"
- `STREAM_CHUNK` (offscreen → all): "here's an event from the stream"

## End-to-end flow

```
[1] sidepanel — useChatStream.send("hi", { agentId })
      pushes user msg + placeholder assistant msg
      runId = newId('run')
      send(STREAM_START, { runId, endpoint, body, parser })
                          ↓ chrome.runtime.sendMessage

[2] SW — STREAM_START handler (registered sync at bootstrap)
      bridge/bootstrap.ts:registerHandlers() → on(STREAM_START, …)
      offscreen-proxy.ts:startStream(args)
        ├─ resolves baseUrl via getApiBaseUrl()       ← reads chrome.storage.local
        ├─ resolves Authorization via getAccessToken() ← reads chrome.storage.local
        ├─ ensureOffscreen() → chrome.offscreen.createDocument({ reasons: ['BLOBS'] })
        └─ send(STREAM_RUN, { runId, url, headers, body, parser })
                              ↓

[3] offscreen — STREAM_RUN handler
      offscreen/main.ts → on(STREAM_RUN, …)
      streamFetch({ url, headers, body, parser, signal, onEvent })
        ├─ POST <url>
        ├─ split res.body by '\n'
        ├─ for each line:
        │    JSON.parse → log raw → expandCompactEvent if compact → dispatch
        ├─ dispatch(event, onEvent):
        │    isChunkEvent       → onEvent({ type: 'text', content: data.text })
        │    isReasoningChunk   → onEvent({ type: 'reasoning', content: data.text })
        │    isErrorEvent       → onEvent({ type: 'error', message })
        │    isEndEvent         → onEvent({ type: 'event', eventName: 'end', data })
        │    everything else    → onEvent({ type: 'event', eventName, data })
        └─ finally: onEvent({ type: 'done' })

      For each onEvent call:
        broadcast(STREAM_CHUNK, { runId, type, payload })
                                   ↓

[4] sidepanel — STREAM_CHUNK listener (in useChatStream)
      filter chunk.runId === runIdRef.current
      switch chunk.type:
        'text'     → appendAssistantText(targetId, payload.content)
        'reasoning'→ log only (no UI yet)
        'event'    → log only
        'error'    → appendAssistantText(targetId, "_Error:_ ${msg}")
        'done'     → finalizeAssistant + setStreaming(false)
```

## URL + headers resolved in the SW

The offscreen no longer reads `chrome.storage` itself. The SW pre-resolves:

- The full URL (`getApiBaseUrl()` + endpoint path)
- The complete `headers` object including `Authorization: Bearer …`

…and ships them with `STREAM_RUN`. This is more robust because:

1. `chrome.storage.sync` is undefined in offscreen on some Chrome configurations
2. The offscreen never has to import the auth flow module
3. Token resolution always happens in one place (the SW), with one mutex

## Cancellation

Sidepanel cancels via `cancel()` → `send(STREAM_CANCEL, { runId })` → SW → `cancelStream()` → `send(STREAM_KILL, { runId })` → offscreen aborts the relevant `AbortController`. Aborted streams emit `done` (no error log — `AbortError` is the normal cancel path).

If the user closes the side panel mid-stream, the SW is still alive (briefly), the offscreen is still streaming, but no listener is on `STREAM_CHUNK`. The chunks broadcast harmlessly. When the user re-opens the side panel, no auto-resume — the conversation history reload will fetch the persisted message from `cx_message`.

## Logging

Every step is logged via `src/lib/debug/log.ts`. With the Debug tab open during a stream, you'll see:

```
sidepanel/msg/info     → send stream:start
sidepanel/msg/info       <runId, endpoint, body>
sw/msg/info            ← receive stream:start
sw/stream/info         start <runId> → /ai/agent/<id>
sw/stream/info         creating offscreen document
sw/stream/success      offscreen document created
sw/msg/info            → send stream:run
offscreen/sys/info     offscreen ready
offscreen/msg/info     ← receive stream:run
offscreen/stream/info  offscreen run <runId> → <full url>
offscreen/stream/info  → POST <full url>           { auth: true, body: {…} }
offscreen/stream/success ← <full url> 200 stream open
offscreen/stream/info  raw event #1                { event: "init", … }
offscreen/stream/info  raw event #2                { e: "c", t: "Hi" }
offscreen/stream/info  raw event #3                { e: "c", t: " there" }
…
offscreen/stream/info  raw event #N                { event: "end", data: { reason: "complete" } }
offscreen/stream/success done (N lines, N events)
sidepanel/msg/info     ← receive stream:chunk      { type: 'text', payload: { content: 'Hi' } }
…
sidepanel/msg/info     ← receive stream:chunk      { type: 'done', payload: {} }
```

Every raw event from the server is logged (`raw event #N`). Click any row in the Debug tab to expand the full JSON.

## Files

- [src/lib/api/stream.ts](../src/lib/api/stream.ts) — `streamFetch` (NDJSON parser + dispatch)
- [src/lib/stream/offscreen-proxy.ts](../src/lib/stream/offscreen-proxy.ts) — SW-side: ensureOffscreen, startStream, cancelStream
- [src/entrypoints/offscreen/main.ts](../src/entrypoints/offscreen/main.ts) — offscreen handler for STREAM_RUN/STREAM_KILL
- [src/lib/messaging/schemas.ts](../src/lib/messaging/schemas.ts) — channel registry
- [src/hooks/use-chat-stream.ts](../src/hooks/use-chat-stream.ts) — sidepanel-side React hook
- [types/python-generated/stream-events.ts](../types/python-generated/stream-events.ts) — typed events + `expandCompactEvent` (regenerate with `pnpm update-api-types`)
