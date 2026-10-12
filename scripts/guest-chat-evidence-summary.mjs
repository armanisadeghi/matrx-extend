const terminal = (value) => value === 'terminal_answer';

/** Keep hosted Chat evidence compact while preserving the native driver's terminal verdicts. */
export function summarizeGuestChatEvidence(report, runId) {
  if (!report || typeof report !== 'object' || !Number.isSafeInteger(runId))
    throw new TypeError('A native guest Chat report and numeric run ID are required.');

  const requests = Array.isArray(report.guest_ai_requests) ? report.guest_ai_requests : [];
  const chat = report.chat ?? {};
  const opening = terminal(report.opening_turn_verdict);
  const sameConversation = terminal(report.same_conversation_turn_verdict);
  const postReload = terminal(report.followup_turn_verdict);

  return {
    schema_version: 1,
    source_run_id: runId,
    case: 'guest-chat',
    auth_mode: report.guest?.fresh === true ? 'fresh signed-out guest' : 'unverified guest state',
    native_driver_status: report.status,
    completion: {
      initial_reply_completed: opening,
      same_conversation_followup_completed: sameConversation,
      post_reload_new_conversation_completed: postReload,
      all_three_terminal_replies_observed: opening && sameConversation && postReload,
      all_observed_chat_requests_http_200:
        requests.length === 3 && requests.every((request) => request?.status === 200),
      requests: requests.map((request) => ({
        attempt: request?.attempt,
        http_status: request?.status,
        conversation_continued: request?.is_new === false,
      })),
      fixture_grounding_observed:
        chat.answer_contains_unpredictable_page_code === true &&
        chat.same_conversation_followup_contains_page_code === true &&
        chat.followup_contains_unpredictable_page_code === true,
      terminal_stage: report.stage_progress?.includes('artifact_unchanged')
        ? 'artifact_unchanged'
        : null,
      raw_assistant_content_included: false,
    },
    environment: {
      development_build_version: report.build?.version ?? null,
      runtime_tree_sha256: report.build?.tree_sha256 ?? null,
      receipt_kind: report.build?.receipt_kind ?? null,
      extension_id: report.build?.extension_id ?? null,
      artifact_unchanged: report.build?.artifact_unchanged === true,
      server_git_sha_before: report.server_version_before?.git_sha ?? null,
      server_git_sha_after: report.server_version_after?.git_sha ?? null,
      server_version_stable: report.server_version_stable === true,
    },
    native_driver_failure_stage: report.failure_stage ?? null,
    native_driver_failure_code: report.failure_code ?? null,
  };
}
