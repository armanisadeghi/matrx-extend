import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { prepareReloadSenderDocument } from './reload-sender-document-diagnostic.mjs';

// SUT owns opt-in, reload ordering and verification; Chrome document lifetime
// is the external dependency. These guards give no native lifecycle credit.
function ownedPage({ retainDocument = false, navigateAway = false } = {}) {
  const calls = [];
  let document = { location: { href: 'https://www.aimatrx.com/catalog' } };
  return {
    calls,
    page: {
      async evaluate(fn, value) {
        calls.push('evaluate');
        document.input = value;
        return runInNewContext(`(${fn.toString()})(input)`, document);
      },
      async reload(options) {
        calls.push('reload');
        assert.equal(options.waitUntil, 'domcontentloaded');
        if (!retainDocument) document = { location: document.location };
        if (navigateAway) document.location = { href: 'https://www.aimatrx.com/login' };
      },
    },
  };
}

function evidence(enabled) {
  return {
    refresh_requested: enabled,
    refresh_completed: false,
    new_document_observed: false,
    same_url_observed: null,
  };
}

test('retained sender control performs no document work', async () => {
  const { page, calls } = ownedPage();
  const receipt = evidence(false);
  await prepareReloadSenderDocument(page, receipt);
  assert.deepEqual(calls, []);
  assert.deepEqual(receipt, evidence(false));
});

test('fresh sender requires reload between marker installation and verification', async () => {
  const { page, calls } = ownedPage();
  const receipt = evidence(true);
  await prepareReloadSenderDocument(page, receipt);
  assert.deepEqual(calls, ['evaluate', 'reload', 'evaluate']);
  assert.deepEqual(receipt, {
    refresh_requested: true,
    refresh_completed: true,
    new_document_observed: true,
    same_url_observed: true,
  });
});

for (const [name, behavior, expected] of [
  ['retained document', { retainDocument: true }, [false, true]],
  ['redirected document', { navigateAway: true }, [true, false]],
]) {
  test(`fresh sender refuses ${name} and preserves bounded observations`, async () => {
    const { page } = ownedPage(behavior);
    const receipt = evidence(true);
    await assert.rejects(prepareReloadSenderDocument(page, receipt), {
      message: 'native_reload_sender_document_refresh_unverified',
    });
    assert.equal(receipt.refresh_completed, true);
    assert.deepEqual([receipt.new_document_observed, receipt.same_url_observed], expected);
  });
}
