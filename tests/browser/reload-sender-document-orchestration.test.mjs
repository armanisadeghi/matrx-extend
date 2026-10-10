import assert from 'node:assert/strict';
import test from 'node:test';
import { reloadCase } from './native-reload-fixture.mjs';

for (const enabled of [false, true]) {
  test(`reload orchestration ${enabled ? 'refreshes' : 'retains'} sender before the first open click`, async () => {
    const senderEvents = [];
    const result = await reloadCase({
      initiallyEnabled: true,
      reloadSenderDocumentDiagnostic: enabled,
      senderEvents,
    });
    assert.deepEqual(
      senderEvents,
      enabled ? ['evaluate', 'reload', 'evaluate', 'open_click'] : ['open_click'],
    );
    assert.deepEqual(result.retirement_evidence.sender_document, {
      refresh_requested: enabled,
      refresh_completed: enabled,
      new_document_observed: enabled,
      same_url_observed: enabled ? true : null,
    });
  });
}

test('sender refresh failure records its boundary and never sends an open request', async () => {
  const senderEvents = [];
  await assert.rejects(
    reloadCase({
      initiallyEnabled: true,
      reloadSenderDocumentDiagnostic: true,
      senderEvents,
      failOperation: 'sender_document_prepare',
      expectFailure: true,
    }),
    (error) => {
      assert.equal(error.reloadOperationFailure.operation, 'sender_document_prepare');
      assert.equal(error.lifecycleEvidence.sender_document.refresh_completed, false);
      assert.equal(error.lifecycleEvidence.open_panel_request, undefined);
      return true;
    },
  );
  assert.deepEqual(senderEvents, ['evaluate', 'reload']);
});
