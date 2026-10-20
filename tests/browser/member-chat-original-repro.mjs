import assert from 'node:assert/strict';

/** Admission and guest history must finish before the first-party login tab exists. */
export async function enterFirstPartyRoute({ checkResource, runGuest = null, openTab }) {
  await checkResource();
  const guest = runGuest ? await runGuest() : null;
  if (runGuest)
    assert.equal(
      guest?.status,
      'terminal_two_turn_guest',
      'D261 guest prelude must finish before sign-in',
    );
  return { guest, web: await openTab() };
}

/** Require two terminal guest sends in one conversation before member authentication. */
export function requireOriginalGuestSequence(requests) {
  assert.equal(requests.length, 2, 'original guest prelude requires exactly two turns');
  assert.deepEqual(
    requests.map((row) => row.attempt),
    ['opening', 'same_conversation_followup'],
  );
  assert.equal(requests[0].is_new, true, 'guest opening requires a new conversation');
  assert.equal(requests[1].is_new, false, 'guest followup requires the same conversation');
  assert.match(requests[0].conversation_fingerprint ?? '', /^[a-f0-9]{16}$/);
  assert.equal(requests[1].conversation_fingerprint, requests[0].conversation_fingerprint);
  for (const row of requests)
    assert.ok(
      row.status === 200 &&
        row.loading_finished === true &&
        row.terminal_success === true &&
        row.semantic_completion === 'success' &&
        row.pending_tool_count === 0 &&
        row.stream_error === false,
      `original_guest_${row.attempt}_terminal_transport`,
    );
  return { status: 'terminal_two_turn_guest', completed_turns: 2 };
}

/** Join the passive extension event to the delegated call of this opening request. */
export function requireOpeningPageText({ events, requests, heading }) {
  const openingRows = requests.filter((row) => row.attempt === 'opening');
  assert.equal(openingRows.length, 1, 'D261 Page Text requires one member opening');
  const opening = openingRows[0];
  assert.match(opening.conversation_fingerprint ?? '', /^[a-f0-9]{16}$/);
  assert.ok(heading?.trim(), 'D261 Page Text requires observed demo heading');
  const delegated = new Set(
    (opening.semantic_events ?? [])
      .filter((event) => event.event === 'tool_delegated')
      .map((event) => event.call_fingerprint),
  );
  const match = events.find(
    (event) =>
      event.tool_class === 'get_page_text' &&
      event.phase === 'completed' &&
      event.conversation_fingerprint === opening.conversation_fingerprint &&
      /^[a-f0-9]{16}$/.test(event.call_fingerprint ?? '') &&
      delegated.has(event.call_fingerprint) &&
      event.result_has_heading === true &&
      event.result_has_stages === true,
  );
  assert.ok(match, 'D261 opening requires correlated completed Page Text with real page data');
  return {
    completed_actual_page_result: true,
    opening_conversation_fingerprint: opening.conversation_fingerprint,
    page_text_call_fingerprint: match.call_fingerprint,
  };
}

/** Bounded, content-free diagnosis of the same opening join. */
export function summarizeOpeningPageTextBoundary({ events, requests }) {
  const openingRows = requests.filter((row) => row.attempt === 'opening');
  const opening = openingRows.length === 1 ? openingRows[0] : null;
  const delegated = new Set(
    (opening?.semantic_events ?? [])
      .filter((event) => event.event === 'tool_delegated')
      .map((event) => event.call_fingerprint),
  );
  const page = events.filter((event) => event.tool_class === 'get_page_text');
  const completed = page.filter((event) => event.phase === 'completed');
  const conversation = completed.filter(
    (event) => event.conversation_fingerprint === opening?.conversation_fingerprint,
  );
  const call = conversation.filter((event) => delegated.has(event.call_fingerprint));
  const content = call.filter(
    (event) => event.result_has_heading === true && event.result_has_stages === true,
  );
  const failure_code =
    !opening || !/^[a-f0-9]{16}$/.test(opening.conversation_fingerprint ?? '')
      ? 'reviewer_member_page_text_opening_unverified'
      : page.length === 0
        ? 'reviewer_member_page_text_event_missing'
        : completed.length === 0
          ? 'reviewer_member_page_text_completion_missing'
          : conversation.length === 0
            ? 'reviewer_member_page_text_conversation_mismatch'
            : call.length === 0
              ? 'reviewer_member_page_text_call_mismatch'
              : content.length === 0
                ? 'reviewer_member_page_text_content_mismatch'
                : null;
  return {
    failure_code,
    opening_conversation_fingerprint: opening?.conversation_fingerprint ?? null,
    delegated_call_fingerprints: [...delegated].filter((value) => /^[a-f0-9]{16}$/.test(value)),
    events: events.map((event) => ({
      tool_class: ['get_page_text', 'read_page', 'find'].includes(event.tool_class)
        ? event.tool_class
        : 'other',
      phase: ['started', 'completed', 'error'].includes(event.phase) ? event.phase : 'other',
      call_fingerprint: /^[a-f0-9]{16}$/.test(event.call_fingerprint ?? '')
        ? event.call_fingerprint
        : null,
      conversation_fingerprint: /^[a-f0-9]{16}$/.test(event.conversation_fingerprint ?? '')
        ? event.conversation_fingerprint
        : null,
      result_has_heading: event.result_has_heading === true,
      result_has_stages: event.result_has_stages === true,
    })),
  };
}

/** Retain a real same-conversation follow-up before the strict Page Text verdict. */
export async function runFollowupBeforeOpeningPageTextJoin({
  openingTransport,
  events,
  requests,
  heading,
  pageTextFailureCode,
  runFollowup,
  persistFollowup,
}) {
  assert.equal(openingTransport.start_count, 1, 'one actual member Chat start required');
  assert.ok(
    openingTransport.organization_header_fingerprint,
    'member Chat must carry a valid organization',
  );
  assert.equal(
    openingTransport.organization_header_matches_approved,
    true,
    'member Chat header must match approved organization config',
  );
  assert.equal(
    openingTransport.start_http_status,
    200,
    'server must accept member Chat organization',
  );
  assert.equal(
    openingTransport.response_matches_request_conversation,
    true,
    'Chat response must match the sent conversation',
  );
  assert.ok(
    openingTransport.backend_request_fingerprint,
    'real member Chat backend request required',
  );

  const followupProof = await runFollowup();
  await persistFollowup(followupProof);
  try {
    return requireOpeningPageText({ events, requests, heading });
  } catch {
    throw new Error(pageTextFailureCode ?? 'reviewer_member_page_text_join_unverified');
  }
}
