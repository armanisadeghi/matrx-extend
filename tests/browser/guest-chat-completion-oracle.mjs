/** Safe browser stream collector; also exercised directly by node tests. */
export function createGuestStreamCollector({
  replyCount = () => 0,
  now = Date.now,
  markers = [],
  fixtureTabId = null,
  fixtureUrl = null,
} = {}) {
  const runs = new Map();
  const order = [];
  const events = [];
  const toolEvents = [];
  const toolCalls = new Map();
  let continuations = 0;
  const runFor = (id) => {
    if (typeof id !== 'string') return null;
    if (!runs.has(id)) {
      runs.set(id, {
        ordinal: order.length + 1,
        done: false,
        delegated: false,
        error: false,
        errorCode: null,
        errorStatus: null,
        endReason: null,
        userRequestOutcome: null,
        textChunks: 0,
        startReplyCount: replyCount(),
        doneAt: null,
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
      if (kind === 'tool:timeline-event') {
        const payload = message.payload ?? {};
        const call = toolCalls.get(payload.callId);
        const name =
          typeof payload.toolName === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(payload.toolName)
            ? payload.toolName
            : (call?.name ?? 'unknown');
        if (!['started', 'completed', 'error'].includes(payload.phase)) return;
        const explicitTabId =
          payload.phase === 'started' && payload.args?.tab_id != null
            ? Number(payload.args.tab_id)
            : null;
        if (payload.phase === 'started' && call)
          call.explicitTabId = Number.isInteger(explicitTabId) ? explicitTabId : null;
        const targetTabId =
          call?.explicitTabId ?? (Number.isInteger(explicitTabId) ? explicitTabId : null);
        const hasResult = payload.phase === 'completed' && payload.output !== undefined;
        const result = hasResult ? JSON.stringify(payload.output) : '';
        const resultUrl = payload.output?.url;
        toolEvents.push({
          name,
          phase: payload.phase,
          target:
            targetTabId == null
              ? 'assigned_tab_or_non_tab_tool'
              : targetTabId === fixtureTabId
                ? 'fixture_tab'
                : 'different_tab',
          resultUrlMatchesFixture: typeof resultUrl === 'string' ? resultUrl === fixtureUrl : null,
          resultContainsOpeningCode: hasResult
            ? Boolean(markers[0] && result.includes(markers[0]))
            : null,
          resultContainsFollowupCode: hasResult
            ? Boolean(markers[1] && result.includes(markers[1]))
            : null,
          resultContainsFixtureHeading: hasResult
            ? Boolean(markers[2] && result.includes(markers[2]))
            : null,
        });
        return;
      }
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
        run.errorStatus = Number.isInteger(payload.payload?.status) ? payload.payload.status : null;
        const code = payload.payload?.code;
        run.errorCode = [
          'resume_conflict',
          'outstanding_delegated_calls',
          'not_resumable',
        ].includes(code)
          ? code
          : null;
        add({ kind: 'error', run: run.ordinal, status: run.errorStatus, code: run.errorCode });
      } else if (payload.type === 'text') {
        run.textChunks += 1;
      } else if (payload.type === 'event') {
        const name = payload.payload?.eventName;
        const data = payload.payload?.data;
        if (
          name === 'tool_event' &&
          ['tool_delegated', 'tool_started', 'tool_completed', 'tool_failed'].includes(data?.event)
        ) {
          if (data.event === 'tool_delegated') run.delegated = true;
          const toolName = data?.tool_name;
          const callId = data?.call_id;
          const safeName =
            typeof toolName === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(toolName)
              ? toolName
              : 'unknown';
          if (typeof callId === 'string' && typeof toolName === 'string') {
            toolCalls.set(callId, { name: safeName, explicitTabId: null });
          }
          const streamedOutput =
            data.event === 'tool_completed'
              ? (data?.data?.result ?? data?.data?.output ?? data?.output)
              : undefined;
          const hasStreamedOutput = streamedOutput !== undefined;
          const result = hasStreamedOutput ? JSON.stringify(streamedOutput) : '';
          const resultUrl = streamedOutput?.url;
          toolEvents.push({
            name: safeName,
            phase: data.event,
            target: 'server_event_target_unobserved',
            resultUrlMatchesFixture:
              typeof resultUrl === 'string' ? resultUrl === fixtureUrl : null,
            resultContainsOpeningCode: hasStreamedOutput
              ? Boolean(markers[0] && result.includes(markers[0]))
              : null,
            resultContainsFollowupCode: hasStreamedOutput
              ? Boolean(markers[1] && result.includes(markers[1]))
              : null,
            resultContainsFixtureHeading: hasStreamedOutput
              ? Boolean(markers[2] && result.includes(markers[2]))
              : null,
          });
          add({ kind: data.event, run: run.ordinal });
        } else if (
          name === 'record_update' &&
          /(?:^|\.)user_request$/.test(String(data?.table ?? '')) &&
          ['completed', 'failed'].includes(data?.status)
        ) {
          if (data.status === 'failed' || !['failed', 'cancelled'].includes(run.userRequestOutcome))
            run.userRequestOutcome = data.status === 'failed' ? 'failed' : 'success';
          add({ kind: 'user_request_' + run.userRequestOutcome, run: run.ordinal });
        } else if (
          name === 'completion' &&
          data?.operation === 'user_request' &&
          ['success', 'failed', 'cancelled'].includes(data?.status)
        ) {
          if (
            data.status !== 'success' ||
            !['failed', 'cancelled'].includes(run.userRequestOutcome)
          )
            run.userRequestOutcome = data.status;
          add({ kind: 'user_request_' + run.userRequestOutcome, run: run.ordinal });
        } else if (name === 'end') {
          const reason = data?.reason;
          run.endReason = [
            'complete',
            'error',
            'failed',
            'cancelled',
            'paused',
            'tool_delegated',
          ].includes(reason)
            ? reason
            : 'other';
          add({ kind: 'end', run: run.ordinal, reason: run.endReason });
        }
      }
    },
    snapshot() {
      return {
        runs: order.map((id) => ({ ...runs.get(id) })),
        continuations,
        events: [...events],
        toolEvents: [...toolEvents],
      };
    },
    runIds() {
      return [...order];
    },
  };
}

/** Classify one guest Chat turn from sanitized stream metadata and rendered assistant text. */
export function classifyGuestTurn({
  runs,
  assistantText,
  replyCount,
  priorRunCount = 0,
  priorReplyCount = 0,
  expectedTerms,
  orderedTerms = [],
  errorNotice,
  terminalAnswerError = false,
  now = Date.now(),
}) {
  const latest = runs.length > priorRunCount ? runs.at(-1) : null;
  if (
    errorNotice ||
    latest?.userRequestOutcome === 'failed' ||
    latest?.userRequestOutcome === 'cancelled'
  )
    return 'terminal_error';
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
  const priorReplyFloor = Math.max(latest.startReplyCount, priorReplyCount);
  if (replyCount <= priorReplyFloor && now - latest.doneAt < 700) return 'rendering_terminal';
  if (replyCount <= priorReplyFloor || !assistantText.trim()) return 'terminal_empty_answer';
  if (terminalAnswerError) return 'terminal_error';
  let after = -1;
  const inOrder = orderedTerms.every((term) => {
    const position = assistantText.indexOf(term, after + 1);
    if (position < 0) return false;
    after = position + term.length - 1;
    return true;
  });
  return inOrder && expectedTerms.every((term) => assistantText.includes(term))
    ? 'terminal_answer'
    : 'terminal_wrong_answer';
}
