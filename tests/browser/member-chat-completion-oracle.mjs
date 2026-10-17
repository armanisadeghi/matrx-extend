import assert from 'node:assert/strict';
/** Same-conversation proof comes from request metadata, never a driver-assigned id. */
export function requireMemberChatSequence(requests, turns) {
  const successful = (attempt) => {
    const rows = requests.filter((row) => row.attempt === attempt);
    assert.equal(rows.length, 1, `member_${attempt}_requires_one_request`);
    const row = rows[0];
    assert.ok(
      row.status === 200 &&
        row.loading_finished === true &&
        row.terminal_success === true &&
        row.stream_error === false,
      `member_${attempt}_requires_terminal_complete`,
    );
    assert.ok(
      ['canonical', 'versioned'].includes(row.path_class),
      `member_${attempt}_route_unverified`,
    );
    assert.match(
      row.conversation_fingerprint ?? '',
      /^[a-f0-9]{16}$/,
      `member_${attempt}_conversation_unverified`,
    );
    assert.equal(
      turns[attempt],
      'terminal_answer',
      `member_${attempt}_assistant_content_unverified`,
    );
    return row;
  };
  assert.equal(requests.length, 2, 'member_requires_exactly_two_turn_requests');
  const opening = successful('opening');
  const followup = successful('same_conversation_followup');
  assert.equal(opening.is_new, true, 'member_opening_requires_new_conversation');
  assert.equal(followup.is_new, false, 'member_followup_requires_existing_conversation');
  assert.equal(
    followup.conversation_fingerprint,
    opening.conversation_fingerprint,
    'member_followup_requires_same_conversation',
  );
  return {
    opening_terminal_complete: true,
    followup_terminal_complete: true,
    same_conversation: true,
    completed_turns: 2,
  };
}

/** Bind both authenticated requests to the checked native organization option. */
export function requireMemberOrganizationBinding(selectedFingerprint, starts) {
  assert.match(
    selectedFingerprint ?? '',
    /^[a-f0-9]{16}$/,
    'member_selected_organization_unobserved',
  );
  assert.equal(starts.length, 2, 'member_org_binding_requires_two_starts');
  for (const start of starts) {
    assert.equal(start.http_status, 200, 'member_org_binding_requires_successful_start');
    assert.equal(
      start.organization_header_fingerprint,
      selectedFingerprint,
      'member_header_must_match_selected_organization',
    );
  }
  return {
    selected_organization_fingerprint: selectedFingerprint,
    both_headers_match_selection: true,
  };
}
