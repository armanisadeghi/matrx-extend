import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

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
    await runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
      assert,
      UNINTERRUPTED: false,
      storageShape: { activeOrganizationPresent },
      panel: {},
      stage: '',
      click: async (_panel, kind, label) => clicks.push([kind, label]),
    });
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
  const end = source.indexOf('        report.screenshots.result', start);
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
