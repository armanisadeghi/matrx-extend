import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPackageGuestTurn as classifyMemberChatTurn } from './guest-chat-completion-oracle.mjs';
import {
  requireMemberChatSequence,
  requireMemberOrganizationBinding,
} from './member-chat-completion-oracle.mjs';

// A signed-in reviewer asks about Capture/Understand/Use, then asks which stage is second.
const row = {
  status: 200,
  loading_finished: true,
  terminal_success: true,
  stream_error: false,
  path_class: 'canonical',
  conversation_fingerprint: 'ec8c373c1df3c614',
};
const opening = { ...row, attempt: 'opening', is_new: true };
const followup = { ...row, attempt: 'same_conversation_followup', is_new: false };
const verdicts = { opening: 'terminal_answer', same_conversation_followup: 'terminal_answer' };
const state = {
  replyCount: 1,
  latestReplyText: 'Capture, Understand, Use.',
  streaming: false,
  errorNotice: false,
  terminalAnswerError: false,
  answerIsRefusal: false,
};

test('a visible member answer stays incomplete without successful terminal SSE', () => {
  const input = {
    requests: [opening],
    attempt: 'opening',
    state,
    priorReplyCount: 0,
    expectedTerms: ['Capture', 'Understand', 'Use'],
  };
  assert.equal(classifyMemberChatTurn(input), 'terminal_answer');
  for (const changed of [
    { terminal_success: false },
    { loading_finished: false },
    { status: null },
  ])
    assert.equal(
      classifyMemberChatTurn({ ...input, requests: [{ ...opening, ...changed }] }),
      'in_progress',
    );
  assert.equal(
    classifyMemberChatTurn({ ...input, requests: [{ ...opening, stream_error: true }] }),
    'terminal_error',
  );
  assert.equal(
    classifyMemberChatTurn({ ...input, state: { ...state, latestReplyText: 'I cannot help.' } }),
    'terminal_wrong_answer',
  );
  assert.equal(
    classifyMemberChatTurn({ ...input, state: { ...state, replyCount: 0 } }),
    'in_progress',
  );
});
test('follow-up must add real assistant content after its own terminal response', () => {
  const input = {
    requests: [opening, followup],
    attempt: 'same_conversation_followup',
    state: { ...state, replyCount: 2, latestReplyText: 'Understand.' },
    priorReplyCount: 1,
    expectedTerms: ['Understand'],
  };
  assert.equal(classifyMemberChatTurn(input), 'terminal_answer');
  assert.equal(
    classifyMemberChatTurn({ ...input, state: { ...input.state, replyCount: 1 } }),
    'in_progress',
  );
  assert.equal(
    classifyMemberChatTurn({ ...input, state: { ...input.state, latestReplyText: 'Capture.' } }),
    'terminal_wrong_answer',
  );
  assert.equal(classifyMemberChatTurn({ ...input, requests: [opening] }), 'in_progress');
});
test('two member turns require same request conversation and new-to-existing transition', () => {
  assert.deepEqual(requireMemberChatSequence([opening, followup], verdicts), {
    opening_terminal_complete: true,
    followup_terminal_complete: true,
    same_conversation: true,
    completed_turns: 2,
  });
  for (const changed of [
    { conversation_fingerprint: '1a5c399c7ded3c01' },
    { is_new: true },
    { terminal_success: false },
    { stream_error: true },
  ])
    assert.throws(() =>
      requireMemberChatSequence([opening, { ...followup, ...changed }], verdicts),
    );
  assert.throws(() => requireMemberChatSequence([opening], verdicts), /exactly_two/);
  assert.throws(
    () =>
      requireMemberChatSequence([opening, followup], {
        ...verdicts,
        same_conversation_followup: 'in_progress',
      }),
    /assistant_content_unverified/,
  );
});

test('a different valid organization shared by both headers still fails selected UI binding', () => {
  const selected = 'c61c7d9a9d805d4e';
  const starts = [
    { http_status: 200, organization_header_fingerprint: selected },
    { http_status: 200, organization_header_fingerprint: selected },
  ];
  assert.deepEqual(requireMemberOrganizationBinding(selected, starts), {
    selected_organization_fingerprint: selected,
    both_headers_match_selection: true,
  });
  const wrong = starts.map((row) => ({
    ...row,
    organization_header_fingerprint: '5687839f735578e9',
  }));
  assert.throws(
    () => requireMemberOrganizationBinding(selected, wrong),
    /header_must_match_selected_organization/,
  );
  assert.throws(
    () => requireMemberOrganizationBinding(selected, [starts[0], wrong[1]]),
    /header_must_match_selected_organization/,
  );
  assert.throws(
    () => requireMemberOrganizationBinding(null, starts),
    /selected_organization_unobserved/,
  );
  assert.throws(() => requireMemberOrganizationBinding(selected, [starts[0]]), /two_starts/);
});
