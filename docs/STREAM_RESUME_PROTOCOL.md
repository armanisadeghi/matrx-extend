# Stall-recovery resume — retired proposal, replaced by the live `/resume` endpoint

> **Status: superseded.** This doc used to specify a cursor-replay protocol
> (`GET /ai/agent/runs/{request_id}/resume?cursor=N`) for recovering a stalled
> stream. The backend never built that endpoint — it was a proposal only, and
> `src/lib/stream/resume.ts` was a permanent no-op scaffolded against it,
> which meant every 75s stall fell through to a full-turn REPLAY (re-running
> tool side effects, double-billing).
>
> **The fix (shipped):** stall recovery now reuses the durable-continuation
> endpoint that already exists and is already proven —
> `POST /ai/conversations/{id}/resume` (`user_request_id` body), the same one
> `useChatStream.resumeRun()` / `usePilotChatStream`'s equivalent call after a
> `STREAM_CONTINUE` broadcast (client-tool hard-suspend). That endpoint
> reconstructs the whole loop from the DB, so it needs no cursor and no
> per-request event buffering — it works equally well for "the server
> hard-suspended" and "the client gave up waiting."
>
> The key fact that makes this work: the `requestId` the client already
> latches from `STREAM_OPENED` (sourced from the `X-Request-ID` response
> header) **is** the server's `user_request_id` — aidream's
> `AuthMiddleware._build_context` mints `ctx.request_id` from that header (or
> a fresh UUID), echoes it back verbatim as `X-Request-ID`, and uses it as the
> PK of `cx_user_request` — the same id `POST /tool_results` returns as
> `user_request_id`. See `aidream/api/docs/cx_ids_streaming_timeline.md` and
> `aidream/api/docs/agents-route-flow.md`.
>
> Current implementation:
> - [`src/lib/stream/resume.ts`](../src/lib/stream/resume.ts) — pure decision
>   logic (`decideResume`) + a thin orchestrator (`attemptResume`) that calls a
>   caller-supplied `resumeRun`. Unit tests:
>   [`tests/unit/stream-resume.test.ts`](../tests/unit/stream-resume.test.ts).
> - [`src/hooks/use-chat-stream.ts`](../src/hooks/use-chat-stream.ts)
>   `onStallRef` — on stall, resets the run to idle (so `resumeRun`'s
>   "previous run still finalizing" guard doesn't just queue the attempt),
>   then calls `attemptResume`. Falls back to today's Retry-banner behavior
>   (full-turn replay) only when the decision says no, the
>   `matrx.stream.resume.enabled` flag is off, or `resumeRun` itself declines
>   or throws.
> - [`src/hooks/use-pilot-chat-stream.ts`](../src/hooks/use-pilot-chat-stream.ts) —
>   same wiring for the Pilot surface (it now also latches `requestIdRef` from
>   `STREAM_OPENED`, which it previously ignored).
> - Kill switch: `matrx.stream.resume.enabled` in `chrome.storage.local`,
>   **default ON**. Flip to `false` to force the old replay-on-stall path.
>
> The `409 outstanding_delegated_calls` / `resume_conflict` / `not_resumable`
> handling on `/resume` (already shipped for the STREAM_CONTINUE path) is
> unchanged and applies identically to a stall-triggered resume, since it's
> the exact same call.
