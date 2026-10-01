import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGuestTurn, createGuestStreamCollector } from './guest-chat-completion-oracle.mjs';

const expectedTerms = ['C82F4A', 'Capture', 'Understand', 'Use'];
const suspended = {
  done: true,
  delegated: true,
  error: false,
  endReason: 'complete',
  userRequestCompleted: false,
  startReplyCount: 0,
  doneAt: Date.now() - 1000,
};

test('a finalized tool bubble is still awaiting its delegated-tool resume', () => {
  const observed = { replyCount: 2, streaming: false, assistantText: 'Reasoning\nFinding text' };
  assert.equal(
    observed.replyCount > 0 && !observed.streaming,
    true,
    'the prior acceptance predicate passed at the captured intermediate state',
  );
  assert.equal(
    classifyGuestTurn({
      runs: [suspended],
      assistantText: observed.assistantText,
      replyCount: observed.replyCount,
      expectedTerms,
      errorNotice: false,
    }),
    'awaiting_tool_resume',
  );
});

test('completed resume with the wrong answer terminates as a failure', () => {
  const resumed = { ...suspended, delegated: false, startReplyCount: 2 };
  assert.equal(
    classifyGuestTurn({
      runs: [suspended, resumed],
      assistantText: 'The page has three stages.',
      replyCount: 3,
      expectedTerms,
      errorNotice: false,
    }),
    'terminal_wrong_answer',
  );
});

test('completed resume needs its own rendered nonce-grounded answer', () => {
  const resumed = { ...suspended, delegated: false, startReplyCount: 2 };
  assert.equal(
    classifyGuestTurn({
      runs: [suspended, resumed],
      assistantText: 'C82F4A: Capture, Understand, Use.',
      replyCount: 3,
      expectedTerms,
      errorNotice: false,
    }),
    'terminal_answer',
  );
  assert.equal(
    classifyGuestTurn({
      runs: [suspended, resumed],
      assistantText: 'Reasoning\nFinding text',
      replyCount: 2,
      expectedTerms,
      errorNotice: false,
    }),
    'terminal_empty_answer',
  );
});

test('wire completion waits for React to render its final bubble', () => {
  const resumed = { ...suspended, delegated: false, startReplyCount: 2, doneAt: Date.now() };
  assert.equal(
    classifyGuestTurn({
      runs: [suspended, resumed],
      assistantText: 'Reasoning\nFinding text',
      replyCount: 2,
      expectedTerms,
      errorNotice: false,
    }),
    'rendering_terminal',
  );
});

test('stream errors remain terminal even without answer text', () => {
  assert.equal(
    classifyGuestTurn({
      runs: [{ ...suspended, delegated: false, error: true }],
      assistantText: '',
      replyCount: 0,
      expectedTerms,
      errorNotice: false,
    }),
    'terminal_error',
  );
});

function streamMessage(runId, type, payload = {}) {
  return { __matrx: true, kind: 'stream:chunk', payload: { runId, type, payload } };
}

function streamEvent(runId, eventName, data) {
  return streamMessage(runId, 'event', { eventName, data });
}

test('tool diagnostics retain target and marker booleans without tool content', () => {
  const collector = createGuestStreamCollector({
    markers: ['OPEN-73', 'FOLLOW-92', 'Fixture heading'],
    fixtureTabId: 21,
    fixtureUrl: 'https://www.aimatrx.com/matrx-extend-demo#fixture',
  });
  collector.accept(streamEvent('run-a', 'tool_event', {
    event: 'tool_delegated', call_id: 'private-call', tool_name: 'get_page_text',
  }));
  collector.accept({ __matrx: true, kind: 'tool:timeline-event', payload: {
    callId: 'private-call', toolName: 'get_page_text', phase: 'started', args: { tab_id: '21', secret: 'NEVER-STORE' },
  } });
  collector.accept({ __matrx: true, kind: 'tool:timeline-event', payload: {
    callId: 'private-call', toolName: 'get_page_text', phase: 'completed',
    output: { url: 'https://www.aimatrx.com/matrx-extend-demo#fixture', text: 'OPEN-73 Fixture heading NEVER-STORE' },
  } });
  const events = collector.snapshot().toolEvents;
  assert.deepEqual(events.at(-1), {
    name: 'get_page_text', phase: 'completed', target: 'fixture_tab',
    resultUrlMatchesFixture: true, resultContainsOpeningCode: true,
    resultContainsFollowupCode: false, resultContainsFixtureHeading: true,
  });
  assert.equal(JSON.stringify(collector.snapshot()).includes('NEVER-STORE'), false);
  assert.equal(JSON.stringify(collector.snapshot()).includes('OPEN-73'), false);
});

test('collector keeps failed user-request completion terminal even after end complete', () => {
  let replies = 0;
  const collector = createGuestStreamCollector({ replyCount: () => replies, now: () => 1000 });
  collector.accept(
    streamMessage('failed-run', 'text', { content: 'C82F4A Capture Understand Use' }),
  );
  collector.accept(
    streamEvent('failed-run', 'completion', { operation: 'user_request', status: 'failed' }),
  );
  collector.accept(streamEvent('failed-run', 'end', { reason: 'complete' }));
  collector.accept(streamMessage('failed-run', 'done'));
  replies = 1;
  const { runs, events } = collector.snapshot();
  assert.equal(runs[0].userRequestOutcome, 'failed');
  assert.equal(
    events.some((event) => event.kind === 'user_request_failed'),
    true,
  );
  assert.equal(
    classifyGuestTurn({
      runs,
      assistantText: 'C82F4A Capture Understand Use',
      replyCount: replies,
      expectedTerms,
      errorNotice: false,
      now: 2000,
    }),
    'terminal_error',
  );
});

test('collector accepts successful completion with a real new assistant reply', () => {
  let replies = 0;
  const collector = createGuestStreamCollector({ replyCount: () => replies, now: () => 1000 });
  collector.accept(
    streamEvent('successful-run', 'completion', { operation: 'user_request', status: 'success' }),
  );
  collector.accept(streamEvent('successful-run', 'end', { reason: 'complete' }));
  collector.accept(streamMessage('successful-run', 'done'));
  replies = 1;
  assert.equal(
    classifyGuestTurn({
      runs: collector.snapshot().runs,
      assistantText: 'C82F4A Capture, Understand, Use.',
      replyCount: replies,
      expectedTerms,
      errorNotice: false,
      now: 2000,
    }),
    'terminal_answer',
  );
});

test('completed Error reply cannot pass by echoing the fixture code and stages', () => {
  const collector = createGuestStreamCollector({ replyCount: () => 0, now: () => 1000 });
  collector.accept(
    streamEvent('error-text-run', 'completion', { operation: 'user_request', status: 'success' }),
  );
  collector.accept(streamEvent('error-text-run', 'end', { reason: 'complete' }));
  collector.accept(streamMessage('error-text-run', 'done'));
  const answer = 'Error: failed to read C82F4A. Capture, Understand, Use.';
  assert.equal(
    classifyGuestTurn({
      runs: collector.snapshot().runs,
      assistantText: answer,
      replyCount: 1,
      expectedTerms,
      orderedTerms: ['Capture', 'Understand', 'Use'],
      errorNotice: false,
      terminalAnswerError: /^\s*Error\s*:/i.test(answer),
      now: 2000,
    }),
    'terminal_error',
  );
});

test('opening answer must list the page stages in order', () => {
  const collector = createGuestStreamCollector({ replyCount: () => 0, now: () => 1000 });
  collector.accept(
    streamEvent('ordered-run', 'completion', { operation: 'user_request', status: 'success' }),
  );
  collector.accept(streamEvent('ordered-run', 'end', { reason: 'complete' }));
  collector.accept(streamMessage('ordered-run', 'done'));
  const common = {
    runs: collector.snapshot().runs,
    replyCount: 1,
    expectedTerms,
    orderedTerms: ['Capture', 'Understand', 'Use'],
    errorNotice: false,
    now: 2000,
  };
  assert.equal(
    classifyGuestTurn({ ...common, assistantText: 'C82F4A: Use, Understand, Capture.' }),
    'terminal_wrong_answer',
  );
  assert.equal(
    classifyGuestTurn({ ...common, assistantText: 'C82F4A: Capture, Understand, Use.' }),
    'terminal_answer',
  );
});

test('uncoded 409 remains pending while another delegated tool resolves', () => {
  let replies = 0;
  const collector = createGuestStreamCollector({ replyCount: () => replies, now: () => 1000 });
  collector.accept(streamEvent('initial-run', 'tool_event', { event: 'tool_delegated' }));
  collector.accept(streamMessage('initial-run', 'done'));
  replies = 1;
  collector.accept({ __matrx: true, kind: 'stream:continue', payload: {} });
  collector.accept(streamMessage('premature-resume', 'error', { status: 409 }));
  collector.accept(streamMessage('premature-resume', 'done'));
  assert.equal(
    classifyGuestTurn({
      runs: collector.snapshot().runs,
      assistantText: '',
      replyCount: replies,
      expectedTerms,
      errorNotice: false,
      now: 2000,
    }),
    'awaiting_tool_resume',
  );
  collector.accept({ __matrx: true, kind: 'stream:continue', payload: {} });
  collector.accept(
    streamEvent('final-resume', 'completion', { operation: 'user_request', status: 'success' }),
  );
  collector.accept(streamEvent('final-resume', 'end', { reason: 'complete' }));
  collector.accept(streamMessage('final-resume', 'done'));
  replies = 2;
  assert.equal(
    classifyGuestTurn({
      runs: collector.snapshot().runs,
      assistantText: 'C82F4A Capture, Understand, Use.',
      replyCount: replies,
      expectedTerms,
      errorNotice: false,
      now: 2000,
    }),
    'terminal_answer',
  );
});
