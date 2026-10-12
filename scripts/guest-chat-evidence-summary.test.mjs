import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeGuestChatEvidence } from './guest-chat-evidence-summary.mjs';

const capturedReport = {
  status: 'pass',
  guest: { fresh: true },
  opening_turn_verdict: 'terminal_answer',
  same_conversation_turn_verdict: 'terminal_answer',
  followup_turn_verdict: 'terminal_answer',
  guest_ai_requests: [
    { attempt: 'opening', status: 200, is_new: true },
    { attempt: 'same_conversation_followup', status: 200, is_new: false },
    { attempt: 'post_reload_new_conversation', status: 200, is_new: true },
  ],
  chat: {
    answer_contains_unpredictable_page_code: true,
    same_conversation_followup_contains_page_code: true,
    followup_contains_unpredictable_page_code: true,
  },
  stage_progress: [
    'real_guest_answer',
    'real_same_conversation_followup_answer',
    'artifact_unchanged',
  ],
  build: {
    version: '0.2.509',
    tree_sha256: 'captured-tree-hash',
    receipt_kind: 'local_dev_unpacked',
    extension_id: 'captured-extension-id',
    artifact_unchanged: true,
  },
  server_version_before: { git_sha: 'captured-server-sha' },
  server_version_after: { git_sha: 'captured-server-sha' },
  server_version_stable: true,
  failure_stage: null,
  failure_code: null,
};

test('terminal_answer verdicts produce compact reply completion without content', () => {
  const summary = summarizeGuestChatEvidence(capturedReport, 38190156680);
  assert.equal(summary.completion.initial_reply_completed, true);
  assert.equal(summary.completion.same_conversation_followup_completed, true);
  assert.equal(summary.completion.post_reload_new_conversation_completed, true);
  assert.equal(summary.completion.all_three_terminal_replies_observed, true);
  assert.equal(summary.completion.all_observed_chat_requests_http_200, true);
  assert.equal(summary.completion.raw_assistant_content_included, false);
  assert.equal('opening_turn_timeline' in summary, false);
});

test('one nonterminal turn stays incomplete while the other terminal replies remain recorded', () => {
  const summary = summarizeGuestChatEvidence(
    { ...capturedReport, same_conversation_turn_verdict: 'awaiting_tool_resume' },
    38190156680,
  );
  assert.equal(summary.completion.initial_reply_completed, true);
  assert.equal(summary.completion.same_conversation_followup_completed, false);
  assert.equal(summary.completion.post_reload_new_conversation_completed, true);
  assert.equal(summary.completion.all_three_terminal_replies_observed, false);
});
