/** Classify one guest Chat turn from sanitized stream metadata and rendered assistant text. */
export function classifyGuestTurn({ runs, assistantText, replyCount, expectedTerms, errorNotice }) {
  const latest = runs.at(-1);
  if (errorNotice) return 'terminal_error';
  if (latest?.errorCode === 'resume_conflict') return 'awaiting_resume_retry';
  if (latest?.errorCode === 'outstanding_delegated_calls') return 'awaiting_tool_resume';
  if (latest?.error) return 'terminal_error';
  if (!latest?.done) return 'in_progress';
  // A delegated tool hard-suspends the stream. Its `done` and a finalized
  // assistant bubble precede /tool_results and the answer-producing /resume.
  if (latest.delegated) return 'awaiting_tool_resume';
  if (['error', 'failed', 'cancelled'].includes(latest.endReason)) return 'terminal_error';
  const terminal = latest.userRequestCompleted || latest.endReason === 'complete';
  if (!terminal) return 'in_progress';
  // React can render the final bubble after the wire's done event. A prior
  // tool bubble must not be mistaken for the answer from this run.
  if (replyCount <= latest.startReplyCount && Date.now() - latest.doneAt < 700)
    return 'rendering_terminal';
  if (replyCount <= latest.startReplyCount) return 'terminal_empty_answer';
  if (!assistantText.trim()) return 'terminal_empty_answer';
  return expectedTerms.every((term) => assistantText.includes(term))
    ? 'terminal_answer'
    : 'terminal_wrong_answer';
}
