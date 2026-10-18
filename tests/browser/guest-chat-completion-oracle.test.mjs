import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  classifyGuestTurn,
  classifyPackageGuestTurn,
  containsOrderedWholeTerms,
  createGuestComposerProbe,
  createGuestStreamCollector,
  readGuestReactDraft,
} from './guest-chat-completion-oracle.mjs';
import * as guestChatOracle from './guest-chat-completion-oracle.mjs';

// Break caught: a rendered tool badge saying "Used" must not become the "Use" stage.
test('browser-serializable stage matcher accepts whole words in order', () => {
  const browserMatcher = runInNewContext(`(${containsOrderedWholeTerms.toString()})`);
  const stages = ['Capture', 'Understand', 'Use'];
  assert.equal(browserMatcher('Used 1 tool. capture, understand; USE.', stages), true);
  assert.equal(browserMatcher('Use, Capture; Understand.', stages), false);
  assert.equal(browserMatcher('Recapture, Understand; Used.', stages), false);
  assert.equal(browserMatcher('Capture, Understand; Used 1 tool.', stages), false);
  assert.equal(browserMatcher('Capture Understand Usefulness', stages), false);
  assert.equal(browserMatcher('Capture Understand Use_value', stages), false);
  assert.equal(browserMatcher('Capture Understand Use\u0301', stages), false);
  assert.equal(browserMatcher('Capture Understand Use\u203Fvalue', stages), false);
  assert.equal(browserMatcher('**Capture** → Understand — use.', stages), true);
});

// Break caught: CDP text insertion can lose focus, emit an input event that
// React later clears, or leave a nonempty composer with Send still disabled.
test('composer probe distinguishes focus loss, cleared input, and disabled send without text', () => {
  const composer = new EventTarget();
  composer.isConnected = true;
  composer.value = '';
  let focused = composer;
  let enabled = false;
  let current = composer;
  const probe = createGuestComposerProbe({
    findComposer: () => current,
    activeElement: () => focused,
    sendEnabled: () => enabled,
  });
  assert.deepEqual(probe.snapshot(), {
    observedNodePresent: true,
    observedNodeConnected: true,
    currentNodePresent: true,
    currentNodeSame: true,
    currentNodeConnected: true,
    currentNodeFocused: true,
    currentValueLength: 0,
    inputEvents: 0,
    changeEvents: 0,
    sendEnabled: false,
  });
  focused = null;
  assert.equal(probe.snapshot().currentNodeFocused, false);
  assert.equal(probe.snapshot().inputEvents, 0);
  composer.value = 'Capture Understand Use';
  composer.dispatchEvent(new Event('input'));
  composer.value = '';
  const cleared = probe.snapshot();
  assert.equal(cleared.inputEvents, 1);
  assert.equal(cleared.currentValueLength, 0);
  focused = composer;
  composer.value = 'Capture Understand Use';
  composer.dispatchEvent(new Event('change'));
  const disabled = probe.snapshot();
  assert.equal(disabled.currentValueLength, 22);
  assert.equal(disabled.changeEvents, 1);
  assert.equal(disabled.sendEnabled, false);
  assert.equal(JSON.stringify(disabled).includes('Capture'), false);
  current = new EventTarget();
  current.isConnected = true;
  current.value = '';
  composer.isConnected = false;
  assert.equal(probe.snapshot().observedNodeConnected, false);
  assert.equal(probe.snapshot().currentNodeSame, false);
  enabled = true;
  assert.equal(probe.snapshot().sendEnabled, true);
  probe.stop();
  composer.dispatchEvent(new Event('input'));
  assert.equal(probe.snapshot().inputEvents, 1);
});

const expectedTerms = ['C82F4A', 'Capture', 'Understand', 'Use'];

test('serialized browser collector records URL components with its injected classifier', () => {
  const browserFactory = runInNewContext(`(${createGuestStreamCollector.toString()})`, { URL });
  const browserClassifier = runInNewContext(
    `(${guestChatOracle.classifyFixtureUrlMatch.toString()})`,
    { URL },
  );
  const collector = browserFactory({
    fixtureTabId: 21,
    fixtureUrl: 'https://example.invalid/article?case=private#fixture-secret',
    classifyUrlMatch: browserClassifier,
  });
  collector.accept({
    __matrx: true,
    kind: 'tool:timeline-event',
    payload: {
      callId: 'fixture-call',
      toolName: 'get_page_text',
      phase: 'started',
      args: { tab_id: '21' },
    },
  });
  collector.accept({
    __matrx: true,
    kind: 'tool:timeline-event',
    payload: {
      callId: 'fixture-call',
      toolName: 'get_page_text',
      phase: 'completed',
      output: { url: 'https://example.invalid/article?case=private' },
    },
  });
  const snapshot = JSON.parse(JSON.stringify(collector.snapshot()));
  const event = snapshot.toolEvents.at(-1);
  assert.equal(event.resultUrlMatchesFixture, false);
  assert.deepEqual(event.resultUrlComponents, {
    exactMatch: false,
    originMatch: true,
    pathnameMatch: true,
    searchMatch: true,
    hashMatch: false,
    expectedHasSearch: true,
    actualHasSearch: true,
    expectedHasHash: true,
    actualHasHash: false,
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /example\.invalid|private|fixture-secret/);
});

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
  const resumed = {
    ...suspended,
    userRequestOutcome: 'success',
    delegated: false,
    startReplyCount: 2,
  };
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
  const resumed = {
    ...suspended,
    userRequestOutcome: 'success',
    delegated: false,
    startReplyCount: 2,
  };
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
  const resumed = {
    ...suspended,
    userRequestOutcome: 'success',
    delegated: false,
    startReplyCount: 2,
    doneAt: Date.now(),
  };
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

// Break caught: a rendered old or optimistic answer cannot turn an HTTP-only
// package request into a completed, page-grounded guest turn.
test('package turn requires terminal wire success and a newly settled grounded assistant reply', () => {
  const state = {
    latestReplyText: 'Capture Understand Use OPEN-73',
    replyCount: 2,
    streaming: false,
    errorNotice: false,
    terminalAnswerError: false,
    answerIsRefusal: false,
  };
  const request = {
    attempt: 'opening',
    status: 200,
    loading_finished: true,
    terminal_success: true,
    semantic_completion: 'success',
    pending_tool_count: 0,
    stream_error: false,
  };
  const classify = (requests, observed = state) =>
    classifyPackageGuestTurn({
      requests,
      attempt: 'opening',
      state: observed,
      priorReplyCount: 1,
      expectedTerms: ['OPEN-73', 'Capture', 'Understand', 'Use'],
      orderedTerms: ['Capture', 'Understand', 'Use'],
    });
  assert.equal(classify([{ ...request, status: 402 }]), 'terminal_error');
  assert.equal(classify([{ ...request, terminal_success: false }]), 'in_progress');
  assert.equal(classify([{ ...request, stream_error: true }]), 'terminal_error');
  assert.equal(classify([request], { ...state, replyCount: 1 }), 'in_progress');
  assert.equal(classify([request], { ...state, streaming: true }), 'in_progress');
  assert.equal(
    classify([request], { ...state, latestReplyText: 'Capture Understand Use' }),
    'terminal_wrong_answer',
  );
  assert.equal(
    classify([request], {
      ...state,
      latestReplyText: 'Used 1 tool. OPEN-73: capture, understand; USE.',
    }),
    'terminal_answer',
  );
  assert.equal(
    classify([request], { ...state, latestReplyText: 'OPEN-73: Capture Understand Use_value' }),
    'terminal_wrong_answer',
  );
  assert.equal(classify([request]), 'terminal_answer');
});

function streamEvent(runId, eventName, data) {
  return streamMessage(runId, 'event', {
    eventName,
    data: ['init', 'completion'].includes(eventName)
      ? { operation_id: `${runId}-operation`, ...data }
      : data,
  });
}

test('tool diagnostics retain target and marker booleans without tool content', () => {
  const collector = createGuestStreamCollector({
    markers: ['OPEN-73', 'FOLLOW-92', 'Fixture heading'],
    fixtureTabId: 21,
    fixtureUrl: 'https://www.aimatrx.com/matrx-extend-demo#fixture',
  });
  collector.accept(
    streamEvent('run-a', 'tool_event', {
      event: 'tool_delegated',
      call_id: 'private-call',
      tool_name: 'get_page_text',
    }),
  );
  collector.accept({
    __matrx: true,
    kind: 'tool:timeline-event',
    payload: {
      callId: 'private-call',
      toolName: 'get_page_text',
      phase: 'started',
      args: { tab_id: '21', secret: 'NEVER-STORE' },
    },
  });
  collector.accept({
    __matrx: true,
    kind: 'tool:timeline-event',
    payload: {
      callId: 'private-call',
      toolName: 'get_page_text',
      phase: 'completed',
      output: {
        url: 'https://www.aimatrx.com/matrx-extend-demo',
        text: 'OPEN-73 Fixture heading NEVER-STORE',
      },
    },
  });
  const events = collector.snapshot().toolEvents;
  assert.deepEqual(events.at(-1), {
    name: 'get_page_text',
    phase: 'completed',
    target: 'fixture_tab',
    resultUrlMatchesFixture: false,
    resultUrlComponents: {
      exactMatch: false,
      originMatch: true,
      pathnameMatch: true,
      searchMatch: true,
      hashMatch: false,
      expectedHasSearch: false,
      actualHasSearch: false,
      expectedHasHash: true,
      actualHasHash: false,
    },
    resultContainsOpeningCode: true,
    resultContainsFollowupCode: false,
    resultContainsFixtureHeading: true,
  });
  assert.equal(JSON.stringify(collector.snapshot()).includes('NEVER-STORE'), false);
  assert.equal(JSON.stringify(collector.snapshot()).includes('OPEN-73'), false);
});

test('tool URL receipt separates path and search drift without retaining values', () => {
  const collector = createGuestStreamCollector({
    fixtureTabId: 21,
    fixtureUrl: 'https://example.invalid/owned/article?case=private#fixture-secret',
  });
  collector.accept({
    __matrx: true,
    kind: 'tool:timeline-event',
    payload: {
      callId: 'fixture-call',
      toolName: 'get_page_text',
      phase: 'started',
      args: { tab_id: '21' },
    },
  });
  collector.accept({
    __matrx: true,
    kind: 'tool:timeline-event',
    payload: {
      callId: 'fixture-call',
      toolName: 'get_page_text',
      phase: 'completed',
      output: { url: 'https://example.invalid/other/article?case=changed#other-secret' },
    },
  });
  const snapshot = JSON.parse(JSON.stringify(collector.snapshot()));
  const event = snapshot.toolEvents.at(-1);
  assert.equal(event.resultUrlMatchesFixture, false);
  assert.deepEqual(event.resultUrlComponents, {
    exactMatch: false,
    originMatch: true,
    pathnameMatch: false,
    searchMatch: false,
    hashMatch: false,
    expectedHasSearch: true,
    actualHasSearch: true,
    expectedHasHash: true,
    actualHasHash: true,
  });
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /example\.invalid|private|fixture-secret|other-secret/,
  );
});

test('collector keeps failed user-request completion terminal even after end complete', () => {
  let replies = 0;
  const collector = createGuestStreamCollector({ replyCount: () => replies, now: () => 1000 });
  collector.accept(
    streamMessage('failed-run', 'text', { content: 'C82F4A Capture Understand Use' }),
  );
  collector.accept(streamEvent('failed-run', 'init', { operation: 'user_request' }));
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
  collector.accept(streamEvent('successful-run', 'init', { operation: 'user_request' }));
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
  collector.accept(streamEvent('error-text-run', 'init', { operation: 'user_request' }));
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
  collector.accept(streamEvent('ordered-run', 'init', { operation: 'user_request' }));
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
  assert.equal(
    classifyGuestTurn({
      ...common,
      assistantText: 'Used 1 tool. C82F4A: capture, understand; USE.',
    }),
    'terminal_answer',
  );
  assert.equal(
    classifyGuestTurn({ ...common, assistantText: 'C82F4A: Used, Capture, Understand.' }),
    'terminal_wrong_answer',
  );
});

test('a completed prior turn cannot terminate a pending same-conversation follow-up', () => {
  let replies = 0;
  const collector = createGuestStreamCollector({ replyCount: () => replies, now: () => 1000 });
  collector.accept(streamEvent('opening-run', 'init', { operation: 'user_request' }));
  collector.accept(
    streamEvent('opening-run', 'completion', { operation: 'user_request', status: 'success' }),
  );
  collector.accept(streamEvent('opening-run', 'end', { reason: 'complete' }));
  collector.accept(streamMessage('opening-run', 'done'));
  replies = 1;
  const boundary = { priorRunCount: collector.snapshot().runs.length, priorReplyCount: replies };
  const common = {
    ...boundary,
    assistantText: 'C82F4A: Capture, Understand, Use.',
    replyCount: replies,
    expectedTerms: ['FOLLOW-92', 'Fixture heading'],
    errorNotice: false,
    now: 2000,
  };
  assert.equal(classifyGuestTurn({ ...common, runs: collector.snapshot().runs }), 'in_progress');
  collector.accept(streamMessage('followup-run', 'text', { content: 'reading page' }));
  assert.equal(classifyGuestTurn({ ...common, runs: collector.snapshot().runs }), 'in_progress');
  collector.accept(streamEvent('followup-run', 'init', { operation: 'user_request' }));
  collector.accept(
    streamEvent('followup-run', 'completion', { operation: 'user_request', status: 'success' }),
  );
  collector.accept(streamEvent('followup-run', 'end', { reason: 'complete' }));
  collector.accept(streamMessage('followup-run', 'done'));
  replies = 2;
  assert.equal(
    classifyGuestTurn({
      ...common,
      runs: collector.snapshot().runs,
      replyCount: replies,
      assistantText: 'FOLLOW-92 under Fixture heading.',
    }),
    'terminal_answer',
  );
  assert.equal(
    classifyGuestTurn({
      ...common,
      runs: collector.snapshot().runs,
      replyCount: replies,
      assistantText: 'The page is ready.',
    }),
    'terminal_wrong_answer',
  );
});

test('a newly completed follow-up error is terminal despite an older successful answer', () => {
  let replies = 0;
  const collector = createGuestStreamCollector({ replyCount: () => replies, now: () => 1000 });
  collector.accept(streamEvent('opening-run', 'init', { operation: 'user_request' }));
  collector.accept(
    streamEvent('opening-run', 'completion', { operation: 'user_request', status: 'success' }),
  );
  collector.accept(streamEvent('opening-run', 'end', { reason: 'complete' }));
  collector.accept(streamMessage('opening-run', 'done'));
  replies = 1;
  collector.accept(streamEvent('followup-run', 'init', { operation: 'user_request' }));
  collector.accept(
    streamEvent('followup-run', 'completion', { operation: 'user_request', status: 'failed' }),
  );
  collector.accept(streamEvent('followup-run', 'end', { reason: 'complete' }));
  collector.accept(streamMessage('followup-run', 'done'));
  assert.equal(
    classifyGuestTurn({
      runs: collector.snapshot().runs,
      priorRunCount: 1,
      priorReplyCount: 1,
      assistantText: 'C82F4A: Capture, Understand, Use.',
      replyCount: 1,
      expectedTerms: ['FOLLOW-92'],
      errorNotice: false,
    }),
    'terminal_error',
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
  collector.accept(streamEvent('final-resume', 'init', { operation: 'user_request' }));
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

// Break caught: DOM-only input must never be reported as a converged Redux draft.
test('React draft diagnostic separates DOM-only, committed, missing and ambiguous stores', () => {
  const question = 'Read the current page.';
  for (const text of ['', question]) {
    const entry = { text, submissionPhase: 'idle' };
    const store = {
      getState: () => ({ instanceUserInput: { byConversationId: { conversation: entry } } }),
    };
    const composer = {
      value: question,
      __reactProps$receipt: {
        value: text,
        onChange() {
          throw Error('must not invoke');
        },
      },
      __reactFiber$receipt: {
        memoizedProps: { conversationId: 'conversation' },
        dependencies: {
          firstContext: { memoizedValue: { store }, next: null },
        },
        return: null,
      },
    };
    const result = readGuestReactDraft(composer, question);
    assert.equal(result.domMatchesExpected, true);
    assert.equal(result.reactValueMatchesExpected, text === question);
    assert.equal(result.reduxDraftMatchesExpected, text === question);
    assert.equal(result.reduxDraftLength, text.length);
    assert.equal(result.matchingStoreCount, 1);
    assert.equal(JSON.stringify(result).includes(question), false);
    const secondStore = { getState: store.getState };
    composer.__reactFiber$receipt.dependencies.firstContext.next = {
      memoizedValue: { store: secondStore },
    };
    assert.equal(readGuestReactDraft(composer, question).reduxDraftMatchesExpected, null);
  }
  assert.equal(readGuestReactDraft({ value: question }, question).reduxDraftMatchesExpected, null);
  assert.equal(readGuestReactDraft(null, question).domMatchesExpected, null);
});

// Break: transport EOF while a delegated browser call is still working is mistaken for an answer.
test('package oracle waits for semantic success and delegated result settlement', () => {
  const input = {
    attempt: 'opening',
    priorReplyCount: 0,
    expectedTerms: ['Capture', 'Understand', 'Use'],
    state: { streaming: false, replyCount: 1, latestReplyText: 'Capture Understand Use' },
    requests: [
      {
        attempt: 'opening',
        status: 200,
        loading_finished: true,
        terminal_success: true,
        stream_error: false,
        semantic_completion: null,
        pending_tool_count: 1,
      },
    ],
  };
  assert.equal(classifyPackageGuestTurn(input), 'in_progress');
  const row = { ...input.requests[0], semantic_completion: 'success', pending_tool_count: 0 };
  assert.equal(classifyPackageGuestTurn({ ...input, requests: [row] }), 'terminal_answer');
  assert.equal(
    classifyPackageGuestTurn({ ...input, requests: [{ ...row, pending_tool_count: 1 }] }),
    'in_progress',
  );
  assert.equal(
    classifyPackageGuestTurn({ ...input, requests: [{ ...row, semantic_completion: 'failed' }] }),
    'terminal_error',
  );
  assert.equal(
    classifyPackageGuestTurn({
      ...input,
      requests: [row],
      state: { ...input.state, latestReplyText: 'Page Text' },
    }),
    'terminal_wrong_answer',
  );
  assert.equal(
    classifyPackageGuestTurn({
      ...input,
      requests: [row],
      state: { ...input.state, replyCount: 0, latestReplyText: '' },
    }),
    'in_progress',
  );
  assert.equal(
    classifyPackageGuestTurn({
      ...input,
      requests: [row],
      expectedTerms: ['Understand'],
      state: { ...input.state, latestReplyText: 'Understand' },
    }),
    'terminal_answer',
  );
});

test('legacy turn never treats transport end or row completion as semantic success', () => {
  const collector = createGuestStreamCollector({ now: () => 1000 });
  collector.accept(
    streamEvent('transport-only', 'record_update', {
      table: 'chat.user_request',
      status: 'completed',
    }),
  );
  collector.accept(streamEvent('transport-only', 'end', { reason: 'complete' }));
  collector.accept(streamMessage('transport-only', 'done'));
  const input = {
    runs: collector.snapshot().runs,
    assistantText: 'Capture Understand Use',
    replyCount: 1,
    expectedTerms: ['Capture', 'Understand', 'Use'],
    now: 2000,
  };
  assert.equal(classifyGuestTurn(input), 'in_progress');
  collector.accept(streamEvent('transport-only', 'init', { operation: 'user_request' }));
  collector.accept(
    streamEvent('transport-only', 'completion', { operation: 'user_request', status: 'success' }),
  );
  assert.equal(classifyGuestTurn({ ...input, runs: collector.snapshot().runs }), 'terminal_answer');
});

for (const scenario of ['missing_init', 'missing_operation_id', 'mismatched_operation_id']) {
  test(`legacy collector refuses ${scenario} at semantic completion`, () => {
    const collector = createGuestStreamCollector({ now: () => 1000 });
    if (scenario !== 'missing_init')
      collector.accept(streamEvent('operation-check', 'init', { operation: 'user_request' }));
    collector.accept(
      streamMessage('operation-check', 'event', {
        eventName: 'completion',
        data: {
          operation: 'user_request',
          status: 'success',
          ...(scenario === 'missing_operation_id'
            ? {}
            : {
                operation_id:
                  scenario === 'mismatched_operation_id'
                    ? 'unrelated-operation'
                    : 'operation-check-operation',
              }),
        },
      }),
    );
    collector.accept(streamEvent('operation-check', 'end', { reason: 'complete' }));
    collector.accept(streamMessage('operation-check', 'done'));
    assert.equal(
      classifyGuestTurn({
        runs: collector.snapshot().runs,
        assistantText: 'Capture Understand Use',
        replyCount: 1,
        expectedTerms: ['Capture', 'Understand', 'Use'],
        now: 2000,
      }),
      'in_progress',
    );
  });
}
