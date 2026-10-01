/** Safe browser stream collector; also exercised directly by node tests. */
export function createGuestStreamCollector({ replyCount = () => 0, now = Date.now } = {}) {
  const runs = new Map();
  const order = [];
  const events = [];
  let continuations = 0;
  const runFor = (id) => {
    if (typeof id !== 'string') return null;
    if (!runs.has(id)) {
      runs.set(id, {
        ordinal: order.length + 1, done: false, delegated: false,
        error: false, errorCode: null, errorStatus: null,
        endReason: null, userRequestOutcome: null, textChunks: 0,
        startReplyCount: replyCount(), doneAt: null,
      });
      order.push(id);
    }
    return runs.get(id);
  };
  const add = (event) => {
    events.push(event);
    if (events.length > 100) events.shift();
  };
  return {
    accept(message) {
      if (message?.__matrx !== true) return;
      const kind = message.kind;
      if (kind === 'stream:continue') {
        continuations += 1;
        add({ kind: 'continue', afterRun: order.length });
        return;
      }
      if (kind !== 'stream:chunk' && kind !== 'stream:opened') return;
      const payload = message.payload ?? {};
      const run = runFor(payload.runId);
      if (!run) return;
      if (kind === 'stream:opened') {
        add({ kind: 'opened', run: run.ordinal });
      } else if (payload.type === 'done') {
        run.done = true;
        run.doneAt = now();
        add({ kind: 'done', run: run.ordinal });
      } else if (payload.type === 'error') {
        run.error = true;
        run.errorStatus = Number.isInteger(payload.payload?.status)
          ? payload.payload.status : null;
        const code = payload.payload?.code;
        run.errorCode = ['resume_conflict', 'outstanding_delegated_calls',
          'not_resumable'].includes(code) ? code : null;
        add({ kind: 'error', run: run.ordinal,
          status: run.errorStatus, code: run.errorCode });
      } else if (payload.type === 'text') {
        run.textChunks += 1;
      } else if (payload.type === 'event') {
        const name = payload.payload?.eventName;
        const data = payload.payload?.data;
        if (name === 'tool_event' && data?.event === 'tool_delegated') {
          run.delegated = true;
          add({ kind: 'tool_delegated', run: run.ordinal });
        } else if (name === 'record_update' &&
          /(?:^|\.)user_request$/.test(String(data?.table ?? '')) &&
          ['completed', 'failed'].includes(data?.status)) {
          if (data.status === 'failed' ||
            !['failed', 'cancelled'].includes(run.userRequestOutcome))
            run.userRequestOutcome = data.status === 'failed' ? 'failed' : 'success';
          add({ kind: 'user_request_' + run.userRequestOutcome, run: run.ordinal });
        } else if (name === 'completion' && data?.operation === 'user_request' &&
          ['success', 'failed', 'cancelled'].includes(data?.status)) {
          if (data.status !== 'success' ||
            !['failed', 'cancelled'].includes(run.userRequestOutcome))
            run.userRequestOutcome = data.status;
          add({ kind: 'user_request_' + run.userRequestOutcome, run: run.ordinal });
        } else if (name === 'end') {
          const reason = data?.reason;
          run.endReason = ['complete', 'error', 'failed', 'cancelled', 'paused',
            'tool_delegated'].includes(reason) ? reason : 'other';
          add({ kind: 'end', run: run.ordinal, reason: run.endReason });
        }
      }
    },
    snapshot() {
      return { runs: order.map((id) => ({ ...runs.get(id) })),
        continuations, events: [...events] };
    },
  };
}

/** Classify one guest Chat turn from sanitized stream metadata and rendered assistant text. */
export function classifyGuestTurn({ runs, assistantText, replyCount, expectedTerms, errorNotice,
  now = Date.now() }) {
  const latest = runs.at(-1);
  if (errorNotice || latest?.userRequestOutcome === 'failed' ||
    latest?.userRequestOutcome === 'cancelled') return 'terminal_error';
  if (latest?.errorCode === 'not_resumable') return 'terminal_error';
  if (latest?.errorCode === 'resume_conflict') return 'awaiting_resume_retry';
  // The stream adapter carries only resume_conflict as a 409 code. An uncoded
  // 409 can be an outstanding delegated call; client code keeps its cards live.
  if (latest?.errorStatus === 409) return 'awaiting_tool_resume';
  if (latest?.error) return 'terminal_error';
  if (!latest?.done) return 'in_progress';
  if (latest.delegated) return 'awaiting_tool_resume';
  if (['error', 'failed', 'cancelled'].includes(latest.endReason)) return 'terminal_error';
  const terminal = latest.userRequestOutcome === 'success' || latest.endReason === 'complete';
  if (!terminal) return 'in_progress';
  if (replyCount <= latest.startReplyCount && now - latest.doneAt < 700)
    return 'rendering_terminal';
  if (replyCount <= latest.startReplyCount || !assistantText.trim())
    return 'terminal_empty_answer';
  return expectedTerms.every((term) => assistantText.includes(term))
    ? 'terminal_answer'
    : 'terminal_wrong_answer';
}
