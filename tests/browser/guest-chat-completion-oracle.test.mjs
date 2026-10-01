import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGuestTurn } from './guest-chat-completion-oracle.mjs';

const expectedTerms = ['C82F4A', 'Capture', 'Understand', 'Use'];
const suspended = {
  done: true, delegated: true, error: false, endReason: 'complete',
  userRequestCompleted: false, startReplyCount: 0, doneAt: Date.now() - 1000,
};

test('a finalized tool bubble is still awaiting its delegated-tool resume', () => {
  const observed = { replyCount: 2, streaming: false, assistantText: 'Reasoning\nFinding text' };
  assert.equal(observed.replyCount > 0 && !observed.streaming, true,
    'the prior acceptance predicate passed at the captured intermediate state');
  assert.equal(classifyGuestTurn({ runs: [suspended],
    assistantText: observed.assistantText, replyCount: observed.replyCount,
    expectedTerms, errorNotice: false }), 'awaiting_tool_resume');
});

test('completed resume with the wrong answer terminates as a failure', () => {
  const resumed = { ...suspended, delegated: false, startReplyCount: 2 };
  assert.equal(classifyGuestTurn({ runs: [suspended, resumed],
    assistantText: 'The page has three stages.', replyCount: 3,
    expectedTerms, errorNotice: false }), 'terminal_wrong_answer');
});

test('completed resume needs its own rendered nonce-grounded answer', () => {
  const resumed = { ...suspended, delegated: false, startReplyCount: 2 };
  assert.equal(classifyGuestTurn({ runs: [suspended, resumed],
    assistantText: 'C82F4A: Capture, Understand, Use.', replyCount: 3,
    expectedTerms, errorNotice: false }), 'terminal_answer');
  assert.equal(classifyGuestTurn({ runs: [suspended, resumed],
    assistantText: 'Reasoning\nFinding text', replyCount: 2,
    expectedTerms, errorNotice: false }), 'terminal_empty_answer');
});

test('wire completion waits for React to render its final bubble', () => {
  const resumed = { ...suspended, delegated: false, startReplyCount: 2, doneAt: Date.now() };
  assert.equal(classifyGuestTurn({ runs: [suspended, resumed],
    assistantText: 'Reasoning\nFinding text', replyCount: 2,
    expectedTerms, errorNotice: false }), 'rendering_terminal');
});

test('stream errors remain terminal even without answer text', () => {
  assert.equal(classifyGuestTurn({ runs: [{ ...suspended, delegated: false, error: true }],
    assistantText: '', replyCount: 0, expectedTerms, errorNotice: false }),
  'terminal_error');
});
