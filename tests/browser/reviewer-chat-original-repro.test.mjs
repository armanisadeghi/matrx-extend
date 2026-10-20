import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enterFirstPartyRoute,
  requireOpeningPageText,
  requireOriginalGuestSequence,
  runFollowupBeforeOpeningPageTextJoin,
  summarizeOpeningPageTextBoundary,
} from './member-chat-original-repro.mjs';

const first = 'a'.repeat(16);
const second = 'b'.repeat(16);
const guestTurns = () => [
  {
    attempt: 'opening',
    is_new: true,
    conversation_fingerprint: first,
    status: 200,
    loading_finished: true,
    terminal_success: true,
    semantic_completion: 'success',
    pending_tool_count: 0,
    stream_error: false,
  },
  {
    attempt: 'same_conversation_followup',
    is_new: false,
    conversation_fingerprint: first,
    status: 200,
    loading_finished: true,
    terminal_success: true,
    semantic_completion: 'success',
    pending_tool_count: 0,
    stream_error: false,
  },
];

test('D261 opens first-party sign-in only after two terminal guest turns', async () => {
  const steps = [];
  const entered = await enterFirstPartyRoute({
    checkResource: async () => {
      steps.push('resource_checked');
    },
    runGuest: async () => {
      steps.push('guest_opening_and_followup');
      return requireOriginalGuestSequence(guestTurns());
    },
    openTab: async () => {
      steps.push('first_party_tab');
      return { tab: 'owned' };
    },
  });
  assert.deepEqual(steps, ['resource_checked', 'guest_opening_and_followup', 'first_party_tab']);
  assert.deepEqual(entered.web, { tab: 'owned' });
  let opened = false;
  await assert.rejects(
    enterFirstPartyRoute({
      checkResource: async () => {},
      runGuest: async () => ({ status: 'pending_guest' }),
      openTab: async () => {
        opened = true;
      },
    }),
    /guest prelude must finish/,
  );
  assert.equal(opened, false, 'unfinished guest turn must prevent first-party login');
});

test('D261 persists a real follow-up before a still-fatal opening Page Text join', async () => {
  const openingTransport = {
    start_count: 1,
    organization_header_fingerprint: 'c'.repeat(16),
    organization_header_matches_approved: true,
    start_http_status: 200,
    response_matches_request_conversation: true,
    backend_request_fingerprint: 'd'.repeat(16),
  };
  const requests = [
    {
      attempt: 'opening',
      conversation_fingerprint: first,
      semantic_events: [{ event: 'tool_delegated', call_fingerprint: second }],
    },
  ];
  const matching = [
    {
      tool_class: 'get_page_text',
      conversation_fingerprint: first,
      call_fingerprint: second,
      is_error_false: true,
      output_ok: true,
      result_url_matches_fixture: true,
      result_has_stages: true,
      status: 200,
      result_accepted: true,
      resolved_calls: [second],
    },
  ];
  const run = (events, transport = openingTransport) => {
    const order = [];
    return {
      order,
      args: {
        openingTransport: transport,
        requests: [
          {
            ...requests[0],
            terminal_success: true,
            result_resume_verified: true,
            tool_results: events,
          },
        ],
        heading: 'Matrx Extend Demo',
        pageTextFailureCode: 'reviewer_member_page_text_event_missing',
        runFollowup: async () => {
          order.push('followup');
          return { terminal: true, conversation_fingerprint: first };
        },
        persistFollowup: async (proof) => {
          assert.deepEqual(proof, { terminal: true, conversation_fingerprint: first });
          order.push('persist');
        },
      },
    };
  };

  const missing = run([]);
  await assert.rejects(
    runFollowupBeforeOpeningPageTextJoin(missing.args),
    /reviewer_member_page_text_event_missing/,
  );
  assert.deepEqual(missing.order, ['followup', 'persist']);

  const badTransport = run(matching, {
    ...openingTransport,
    response_matches_request_conversation: false,
  });
  await assert.rejects(
    runFollowupBeforeOpeningPageTextJoin(badTransport.args),
    /Chat response must match the sent conversation/,
  );
  assert.deepEqual(badTransport.order, []);

  const complete = run(matching);
  assert.equal(
    (await runFollowupBeforeOpeningPageTextJoin(complete.args)).page_text_call_fingerprint,
    second,
  );
  assert.deepEqual(complete.order, ['followup', 'persist']);
});

test('D261 guest sequence refuses a skipped, uncorrelated or delegated follow-up', () => {
  assert.equal(requireOriginalGuestSequence(guestTurns()).completed_turns, 2);
  for (const changed of [
    (rows) => rows.pop(),
    (rows) => {
      rows[1].conversation_fingerprint = second;
    },
    (rows) => {
      rows[1].is_new = true;
    },
    (rows) => {
      rows[1].pending_tool_count = 1;
    },
    (rows) => {
      rows[0].terminal_success = false;
    },
  ]) {
    const rows = guestTurns();
    changed(rows);
    assert.throws(() => requireOriginalGuestSequence(rows), { code: 'ERR_ASSERTION' });
  }
});

test('D261 Page Text must be a completed delegated call on this member opening', () => {
  const requests = [
    {
      attempt: 'opening',
      conversation_fingerprint: first,
      semantic_events: [{ event: 'tool_delegated', call_fingerprint: second }],
    },
  ];
  const event = {
    tool_class: 'get_page_text',
    conversation_fingerprint: first,
    call_fingerprint: second,
    is_error_false: true,
    output_ok: true,
    result_url_matches_fixture: true,
    result_has_stages: true,
    status: 200,
    result_accepted: true,
    resolved_calls: [second],
  };
  requests[0].terminal_success = true;
  requests[0].result_resume_verified = true;
  requests[0].tool_results = [event];
  assert.equal(
    requireOpeningPageText({ requests, heading: 'Matrx Extend Demo' }).page_text_call_fingerprint,
    second,
  );
  for (const mismatch of [
    { ...event, tool_class: 'read_page' },
    { ...event, call_fingerprint: 'c'.repeat(16) },
    { ...event, is_error_false: false },
    { ...event, result_has_stages: false },
  ])
    assert.throws(
      () =>
        requireOpeningPageText({
          requests: [{ ...requests[0], tool_results: [mismatch] }],
          heading: 'Matrx Extend Demo',
        }),
      /correlated successful Page Text/,
    );
  assert.throws(
    () =>
      requireOpeningPageText({
        requests: [{ ...requests[0], semantic_events: [] }],
        heading: 'Matrx Extend Demo',
      }),
    /correlated successful Page Text/,
  );
  assert.equal(summarizeOpeningPageTextBoundary({ requests }).failure_code, null);
  assert.equal(
    summarizeOpeningPageTextBoundary({
      requests: [{ ...requests[0], tool_results: [{ ...event, tool_class: 'read_page' }] }],
    }).failure_code,
    'reviewer_member_page_text_result_missing',
  );
  assert.equal(
    summarizeOpeningPageTextBoundary({
      requests: [
        { ...requests[0], tool_results: [{ ...event, call_fingerprint: 'c'.repeat(16) }] },
      ],
    }).failure_code,
    'reviewer_member_page_text_call_mismatch',
  );
});

test('D269 package Page Text completion is the exact successful canonical result, acknowledgement, and resume', () => {
  const call = 'db760ddbd90bd7ff';
  const conversation = 'd267b8af803a54ab';
  const proof = {
    tool_class: 'get_page_text',
    conversation_fingerprint: conversation,
    call_fingerprint: call,
    is_error_false: true,
    output_ok: true,
    result_url_matches_fixture: true,
    result_has_stages: true,
    status: 200,
    result_accepted: true,
    resolved_calls: [call],
  };
  const opening = {
    attempt: 'opening',
    conversation_fingerprint: conversation,
    semantic_events: [{ event: 'tool_delegated', call_fingerprint: call }],
    terminal_success: true,
    result_resume_verified: true,
    tool_results: [proof],
  };
  const verify = (changed) =>
    requireOpeningPageText({
      requests: [changed],
      heading: 'A clear three-stage browser workflow',
    });
  assert.equal(verify(opening).page_text_call_fingerprint, call);
  for (const changed of [
    { ...proof, tool_class: 'read_page' },
    { ...proof, call_fingerprint: '1565d1dace91d42e' },
    { ...proof, is_error_false: false },
    { ...proof, output_ok: false },
    { ...proof, result_url_matches_fixture: false },
    { ...proof, result_has_stages: false },
    { ...proof, status: 500 },
    { ...proof, resolved_calls: [] },
  ])
    assert.throws(() => verify({ ...opening, tool_results: [changed] }));
  assert.throws(() => verify({ ...opening, conversation_fingerprint: first }));
  assert.throws(() => verify({ ...opening, result_resume_verified: false }));
  assert.throws(() => verify({ ...opening, terminal_success: false }));
});
