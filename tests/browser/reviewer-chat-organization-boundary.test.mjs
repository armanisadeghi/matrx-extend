import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  requireMemberChatSequence,
  requireMemberOrganizationBinding,
} from './member-chat-completion-oracle.mjs';

const source = await readFile(
  new URL('./reviewer-chat-store-acceptance.mjs', import.meta.url),
  'utf8',
);

// Run the actual default-lane prerequisite, rather than a replica of its decision.
// A first-login member's account/startup ladder selection has no device override.
test('signed-in member reaches Chat without a persisted device organization override', async () => {
  const start = source.indexOf(
    '        if (UNINTERRUPTED) {\n          await exerciseApproval(native);',
  );
  const end = source.indexOf("        await waitFor(\n          'reviewer_chat_visible'", start);
  assert.ok(start > 0 && end > start, 'default Chat prerequisite must be located');
  for (const activeOrganizationPresent of [false, true]) {
    const clicks = [];
    const waits = [];
    await runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
      assert,
      UNINTERRUPTED: false,
      storageShape: { activeOrganizationPresent },
      panel: {},
      email: 'member',
      report: { account: {} },
      stage: '',
      waitFor: async (label, _read, accept) => {
        waits.push(label);
        assert.equal(accept({ swipeFileVisible: true }), true);
        assert.equal(accept({ swipeFileVisible: false }), false);
      },
      click: async (_panel, kind, label) => clicks.push([kind, label]),
    });
    assert.deepEqual(waits, ['reviewer_swipe_file_tab_visible']);
    assert.deepEqual(
      clicks,
      [['title', 'Chat']],
      'organization ladder must reach the actual send flow',
    );
  }
});

// This checks the harness verdict, not product behavior. Captured network metadata
// remains mandatory even when the UI has rendered a completed answer.
test('member Chat verdict refuses absent, rejected or uncorrelated organization transport', () => {
  const start = source.indexOf('        const network = memberTransport.snapshot();');
  const end = source.indexOf('        await typeQuestion(', start);
  assert.ok(start > 0 && end > start, 'member transport oracle must be located');
  const oracle = (network) =>
    runInNewContext(source.slice(start, end), {
      assert,
      memberTransport: { snapshot: () => network },
      report: {},
    });
  const accepted = {
    start_count: 1,
    organization_header_fingerprint: 'observed-org-fingerprint',
    start_http_status: 200,
    response_matches_request_conversation: true,
    backend_request_fingerprint: 'observed-request-fingerprint',
  };
  oracle(accepted);
  for (const changed of [
    { start_count: 0 },
    { start_count: 2 },
    { organization_header_fingerprint: null },
    { start_http_status: 422 },
    { response_matches_request_conversation: false },
    { backend_request_fingerprint: null },
  ])
    assert.throws(() => oracle({ ...accepted, ...changed }), { code: 'ERR_ASSERTION' });
  assert.throws(() => oracle({}), { code: 'ERR_ASSERTION' });
});

// Break caught: two valid matching request headers can still target the wrong UI org.
test('actual two-turn member verdict binds both headers to the checked UI organization', () => {
  const start = source.indexOf('        const sequence = requireMemberChatSequence(');
  const end = source.indexOf('        report.screenshots.result', start);
  assert.ok(start > 0 && end > start, 'member two-turn verdict seam must exist');
  const selected = 'c61c7d9a9d805d4e';
  const transport = (fingerprint) => ({
    start_count: 1,
    member_turn_requests: [
      {
        kind: 'start',
        http_status: 200,
        organization_header_fingerprint: fingerprint,
        conversation_fingerprint: 'ec8c373c1df3c614',
      },
      {
        kind: 'followup',
        http_status: 200,
        organization_header_fingerprint: fingerprint,
        conversation_fingerprint: 'ec8c373c1df3c614',
      },
    ],
  });
  const requests = [
    {
      attempt: 'opening',
      is_new: true,
      status: 200,
      loading_finished: true,
      terminal_success: true,
      semantic_completion: 'success',
      pending_tool_count: 0,
      stream_error: false,
      path_class: 'canonical',
      conversation_fingerprint: 'ec8c373c1df3c614',
    },
    {
      attempt: 'same_conversation_followup',
      is_new: false,
      status: 200,
      loading_finished: true,
      terminal_success: true,
      semantic_completion: 'success',
      pending_tool_count: 0,
      stream_error: false,
      path_class: 'conversation',
      conversation_fingerprint: 'ec8c373c1df3c614',
    },
  ];
  const verdict = (fingerprint) => {
    const report = {};
    runInNewContext(source.slice(start, end), {
      assert,
      report,
      selectedOrganizationFingerprint: selected,
      requireMemberChatSequence,
      requireMemberOrganizationBinding,
      memberTransport: { turnRequests: () => requests, snapshot: () => transport(fingerprint) },
      network: { organization_header_fingerprint: fingerprint },
      turns: { opening: 'terminal_answer', same_conversation_followup: 'terminal_answer' },
      followup: { completedReplyCount: 2 },
    });
    return report.chat_sequence;
  };
  assert.equal(verdict(selected).both_headers_match_selection, true);
  assert.throws(() => verdict('5687839f735578e9'), /header_must_match_selected_organization/);
});
