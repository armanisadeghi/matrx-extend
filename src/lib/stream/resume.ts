/**
 * MOVED to @ai-matrx/api (`decideStallResume`, `attemptStallResume`). The
 * chrome.storage kill switch and logging stay here and are injected.
 *
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
import { attemptStallResume, decideStallResume } from '@ai-matrx/api';

const RESUME_ENABLED_KEY = 'matrx.stream.resume.enabled';

export interface ResumeTarget {
  runId: string;
  conversationId: string | null;
  /**
   * The server's `user_request_id` for the stalled turn — latched from
   * `STREAM_OPENED.requestId` (== the `X-Request-ID` response header ==
   * `cx_user_request.id`). OPTIONAL since 2026-07-23: `/resume` is keyed by
   * the conversation id in the URL; when this is null the server resolves
   * the turn from the conversation's newest answered client-delegated tool
   * call (404 `resume_target_not_found` if there's nothing to resume).
   * When present it is still sent and remains exact.
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
 * Delegates to @ai-matrx/api `decideStallResume`.
 */
export function decideResume(target: ResumeTarget): ResumeDecision {
  return decideStallResume(target);
}

/**
 * Kill-switch flag. Defaults ON — a missing/unset flag must not silently
 * disable a working recovery path. Set `matrx.stream.resume.enabled: false` in
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
 * Attempt to resume a stalled run via the live `/resume` endpoint (see the
 * header). The caller must have already reset its own run bookkeeping to
 * "idle" BEFORE calling. Never throws. Result reasons are unchanged from the
 * pre-move implementation: a `409 resume_conflict` still reports
 * `resume-run-error` (the package's finer `resume-conflict` is folded back so
 * callers see exactly what they always did).
 */
export async function attemptResume(
  target: ResumeTarget,
  resumeRun: (conversationId: string, userRequestId: string | null) => Promise<string | null>,
): Promise<ResumeResult> {
  const result = await attemptStallResume(target, resumeRun, { enabled: isResumeEnabled });
  switch (result.reason) {
    case 'no-conversation-id':
      log.info('stream', `stall resume skipped: ${result.reason}`, target);
      break;
    case 'resume-disabled':
      log.info('stream', 'stall resume skipped: disabled via matrx.stream.resume.enabled', target);
      break;
    case 'resume-run-declined':
      log.warn(
        'stream',
        'stall resume declined by resumeRun (not idle / claim lost / no selection)',
        target,
      );
      break;
    case 'resume-conflict':
    case 'resume-run-error':
      log.warn('stream', 'stall resume: resumeRun threw', result.error);
      return { resumed: false, reason: 'resume-run-error' };
  }
  return { resumed: result.resumed, reason: result.reason };
}
