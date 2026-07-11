/**
 * Stall recovery — resume via the LIVE durable-continuation endpoint.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HISTORY: this file used to scaffold a DIFFERENT, never-built protocol —
 * a cursor-replay resume keyed by `request_id` + an event-count `cursor`
 * against a proposed `GET /ai/agent/runs/{request_id}/resume` endpoint. That
 * endpoint never existed and was never going to; `docs/STREAM_RESUME_PROTOCOL.md`
 * documented the proposal but the backend never built it. `attemptResume` was
 * therefore a permanent no-op ('resume-not-implemented'), so every stall fell
 * through to a full-turn REPLAY (re-running tool side effects, billing twice).
 *
 * FIX: the extension already has a genuine, PROVEN resume mechanism for a
 * different trigger — `POST /ai/conversations/{id}/resume`, called by
 * `useChatStream.resumeRun()` / `usePilotChatStream`'s equivalent whenever the
 * server hard-suspends a run after delegating a client tool
 * (`STREAM_CONTINUE` broadcast → `resumeRun(conversationId, userRequestId)`).
 * That endpoint takes a `user_request_id` and reconstructs the whole
 * conversation loop from the DB — it does not need a cursor or a buffered
 * tail, so it is equally valid for "the client went silent and gave up on a
 * live run" as it is for "the server hard-suspended and the client came back."
 *
 * Evidence that `requestId` (from `STREAM_OPENED`, sourced from the
 * `X-Request-ID` response header) IS `user_request_id`: aidream's
 * `AuthMiddleware._build_context` mints `ctx.request_id` from the
 * `X-Request-ID` header (or a fresh UUID), stamps it onto the `X-Request-ID`
 * response header verbatim, AND uses it as `cx_user_request.id` — the same
 * row `POST /tool_results` reports back as `user_request_id`. See
 * `aidream/api/docs/cx_ids_streaming_timeline.md` ("The stream never echoes
 * `cx_user_request.id` again unless you add it. It is the same UUID as
 * `X-Request-ID`.") and `aidream/api/docs/agents-route-flow.md`.
 *
 * So on a stall, we can call the SAME `resumeRun` the STREAM_CONTINUE path
 * uses, keyed by the requestId we already latched from STREAM_OPENED — no new
 * backend endpoint, no cursor bookkeeping, no replayed tool side effects.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This module is intentionally thin and side-effect-light: it holds the pure
 * "should we even try, and did the flag allow it" decision logic (fully unit
 * testable, no network), and a small orchestrator that calls a caller-supplied
 * `resumeRun` function — the actual HTTP/STREAM_START plumbing stays owned by
 * `use-chat-stream.ts` / `use-pilot-chat-stream.ts` so there is exactly one
 * implementation of "how to open a /resume stream" per surface.
 */

import { log } from '@/lib/debug/log';

const RESUME_ENABLED_KEY = 'matrx.stream.resume.enabled';

export interface ResumeTarget {
  runId: string;
  conversationId: string | null;
  /**
   * The server's `user_request_id` for the stalled turn — latched from
   * `STREAM_OPENED.requestId` (== the `X-Request-ID` response header ==
   * `cx_user_request.id`). Required to call `/resume`.
   */
  requestId: string | null;
}

export interface ResumeResult {
  resumed: boolean;
  reason: string;
}

export interface ResumeDecision {
  /** Whether a resume attempt is even possible given the target's ids. */
  attempt: boolean;
  reason: string;
}

/**
 * Pure decision: do we have enough information to attempt a resume at all?
 * Exported separately from `attemptResume` so it's trivially unit-testable
 * without touching chrome.storage or the network.
 */
export function decideResume(target: ResumeTarget): ResumeDecision {
  if (!target.conversationId) return { attempt: false, reason: 'no-conversation-id' };
  if (!target.requestId) return { attempt: false, reason: 'no-request-id' };
  return { attempt: true, reason: 'ok' };
}

/**
 * Kill-switch flag. Defaults ON — a missing/unset flag must not silently
 * disable a working recovery path (that's exactly how the old scaffold went
 * unnoticed: it defaulted off and nobody flipped it because the backend
 * dependency never shipped). Set `matrx.stream.resume.enabled: false` in
 * chrome.storage.local to force the old replay-on-stall behavior.
 */
export async function isResumeEnabled(): Promise<boolean> {
  try {
    const r = await chrome.storage.local.get([RESUME_ENABLED_KEY]);
    return r[RESUME_ENABLED_KEY] !== false;
  } catch {
    return true;
  }
}

/**
 * Attempt to resume a stalled run via the live `/resume` endpoint. The caller
 * must have already reset its own run bookkeeping (runIdRef/targetIdRef/etc.)
 * to "idle" BEFORE calling this — `resumeRun` refuses to open a new stream
 * while it still thinks a run is active, exactly like it does for a real
 * STREAM_CONTINUE. See `onStallRef` in `use-chat-stream.ts` for the reset
 * sequence.
 *
 * Returns `{ resumed: true }` only when `resumeRun` actually opened a new
 * stream (returned a runId). Any other outcome — decision said no, the flag
 * is off, `resumeRun` declined (conversation not selected, claim lost), or it
 * threw — returns `{ resumed: false, reason }` and the caller falls back to
 * today's give-up-and-show-Retry behavior.
 */
export async function attemptResume(
  target: ResumeTarget,
  resumeRun: (conversationId: string, userRequestId: string) => Promise<string | null>,
): Promise<ResumeResult> {
  const decision = decideResume(target);
  if (!decision.attempt) {
    log.info('stream', `stall resume skipped: ${decision.reason}`, target);
    return { resumed: false, reason: decision.reason };
  }
  if (!(await isResumeEnabled())) {
    log.info('stream', 'stall resume skipped: disabled via matrx.stream.resume.enabled', target);
    return { resumed: false, reason: 'resume-disabled' };
  }
  try {
    // Non-null per `decideResume` above.
    const conversationId = target.conversationId as string;
    const userRequestId = target.requestId as string;
    const runId = await resumeRun(conversationId, userRequestId);
    if (!runId) {
      log.warn(
        'stream',
        'stall resume declined by resumeRun (not idle / claim lost / no selection)',
        target,
      );
      return { resumed: false, reason: 'resume-run-declined' };
    }
    return { resumed: true, reason: 'ok' };
  } catch (err) {
    log.warn('stream', 'stall resume: resumeRun threw', err);
    return { resumed: false, reason: 'resume-run-error' };
  }
}
