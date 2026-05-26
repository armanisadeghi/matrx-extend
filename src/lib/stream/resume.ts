/**
 * Stall recovery — cursor-replay resume (client scaffold, backend-pending).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NOT THE DURABLE CLIENT-TOOL RESUME. Do not confuse this with the
 * `/ai/conversations/{id}/resume` endpoint that ships TODAY and is called
 * from `useChatStream.resumeRun()` after a `STREAM_CONTINUE` broadcast — that
 * is the answer to "user submitted a tool answer; continue the agent loop."
 * That round-trip lives in:
 *     - sidepanel:  src/hooks/use-chat-stream.ts        (resumeRun)
 *     - SW broker:  src/lib/tools/dispatch.ts            (postResult)
 *     - SW client:  src/lib/api/routes/tool-results.ts   (conversationResumePath)
 *     - protocol:   matrx-frontend/features/agents/docs/CLIENT_TOOL_SUSPEND_RESUME.md
 *
 * THIS file is a different, separately-roadmapped feature: recovering an
 * interrupted live stream (network drop, tab sleep, watchdog stall) by
 * REPLAYING the unsent tail of a still-live run. It is keyed by `request_id`
 * + a `cursor` (events seen so far), not by `user_request_id`, and it must
 * NOT trigger any tool side effects. The aidream backend endpoint doesn't
 * exist yet — `attemptResume` is a gated no-op until it ships.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * When the {@link createStreamWatchdog} detects a stall, the ideal recovery is
 * to RESUME the interrupted run rather than replay the whole turn (a replay
 * re-runs tool side effects and bills a second time). True stall-recovery
 * resume requires the aidream backend to expose a cursor-replay endpoint keyed
 * by the `request_id` we already receive on `STREAM_OPENED` and to replay the
 * unsent tail of the NDJSON stream.
 *
 * That backend work does not exist yet, so this function is a gated no-op that
 * returns `{ resumed: false, reason: 'resume-unsupported' }`. The caller falls
 * back to a user-facing Retry. When the backend ships:
 *   1. Flip the `matrx.stream.resume.enabled` storage flag (or default it on).
 *   2. Implement the re-open below (POST resume → STREAM_START with the resume
 *      URL so the offscreen doc re-attaches to the live request).
 *
 * Proposed wire contract for the FUTURE cursor-replay endpoint
 * (NOT the live durable-continuation /resume; see docs/STREAM_RESUME_PROTOCOL.md):
 *   GET /ai/agent/runs/{request_id}/resume?conversation_id={cid}&cursor={n}
 *     → 200 text/x-ndjson  : resumes, replaying events after `cursor`
 *     → 409                : run already completed (client should reconcile via
 *                            the conversation record, not replay)
 *     → 404                : run unknown/expired → fall back to Retry
 */

import { log } from '@/lib/debug/log';

const RESUME_ENABLED_KEY = 'matrx.stream.resume.enabled';

export interface ResumeTarget {
  runId: string;
  conversationId: string | null;
  requestId: string | null;
  /** Count of events already received — the server replays only events after this. */
  cursor: number;
}

export interface ResumeResult {
  resumed: boolean;
  reason: string;
}

async function resumeEnabled(): Promise<boolean> {
  try {
    const r = await chrome.storage.local.get([RESUME_ENABLED_KEY]);
    return r[RESUME_ENABLED_KEY] === true;
  } catch {
    return false;
  }
}

/**
 * Attempt to resume a stalled run. Returns whether the live stream was
 * re-attached. Currently always returns `resumed: false` until the backend
 * resume endpoint ships; the caller must handle that by surfacing a Retry.
 */
export async function attemptResume(target: ResumeTarget): Promise<ResumeResult> {
  if (!target.requestId || !target.conversationId) {
    return { resumed: false, reason: 'no-request-id' };
  }
  if (!(await resumeEnabled())) {
    return { resumed: false, reason: 'resume-unsupported' };
  }
  // TODO(backend): once /ai/agent/runs/{request_id}/resume exists, re-open the
  // stream here (resolve auth → STREAM_START with the resume URL + cursor) and
  // return { resumed: true } so the watchdog re-arms instead of giving up.
  log.warn('stream', 'resume requested but not yet implemented', target);
  return { resumed: false, reason: 'resume-not-implemented' };
}
