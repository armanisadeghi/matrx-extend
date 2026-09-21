import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runFirefoxCaptureSaveCheck } from './capture-save-acceptance.mjs';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const FIRST_KEY = '11111111-1111-4111-8111-111111111111';
const SECOND_KEY = '22222222-2222-4222-8222-222222222222';

function receipt(keys, requests = [{ requestId: 'save-request' }]) {
  return {
    requests,
    responses: requests.map(entry => ({ requestId: entry.requestId, status: 201 })),
    keys,
  };
}

function harness({ receipts, saveClick, persistFailure = false }) {
  let fixtureUrl = null;
  let read = 0;
  const calls = [];
  const proof = {};
  const persisted = [];
  const adapter = {
    trustedClick: async selector => {
      calls.push(`click:${selector}`);
      if (selector === '#save') return saveClick();
    },
    waitFor: async () => '#save',
    startVaultCreateReceiptObserver: async () => calls.push('start'),
    readVaultCreateReceiptObserver: async () => {
      const value = receipts[Math.min(read++, receipts.length - 1)];
      if (value instanceof Error) throw value;
      return value;
    },
    disposeVaultCreateReceiptObserver: async () => {
      calls.push('dispose');
      assert.ok(calls.some(call => call.startsWith('persist:')), 'receipt_must_persist_before_dispose');
      return { disposed: true };
    },
  };
  const wdPost = async (_base, path, body) => {
    if (path.endsWith('/window/new')) return { handle: 'fixture-tab' };
    if (path.endsWith('/url')) {
      fixtureUrl = body.url;
      return {};
    }
    if (path.endsWith('/element')) return { [ELEMENT_KEY]: body.value };
    if (path.endsWith('/click') && String(path).includes('button')) {
      await fetch(new URL('/submitted', fixtureUrl), { method: 'POST' });
      return {};
    }
    return {};
  };
  return {
    calls,
    persisted,
    proof,
    run: () =>
      runFirefoxCaptureSaveCheck({
        adapter,
        base: 'http://webdriver.invalid',
        sessionId: 'session',
        wdPost,
        wdGet: async (_base, path) =>
          path.endsWith('/window/handles') ? ['original-tab'] : 'original-tab',
        wdDelete: async () => ({}),
        getContext: async () => undefined,
        probeFixtureBridge: async () => true,
        persistOwnedCreateMutationKeys: async keys => {
          if (persistFailure) throw new Error('durable proof unavailable');
          persisted.push([...keys]);
          calls.push(`persist:${keys.length}`);
        },
        proof,
      }),
  };
}

test('persists every observed receipt key before disposing after a post-commit trusted-click timeout', async () => {
  const subject = harness({
    receipts: [receipt([FIRST_KEY, SECOND_KEY])],
    saveClick: async () => {
      throw new Error('trusted_click_timeout_after_commit');
    },
  });

  await assert.rejects(subject.run(), /trusted_click_timeout_after_commit/);
  assert.deepEqual(subject.persisted, [[FIRST_KEY, SECOND_KEY]]);
  assert.deepEqual(subject.proof.ownedCreateMutationKeys, [FIRST_KEY, SECOND_KEY]);
  assert.equal(subject.calls.at(-1), 'dispose');
});

test('reports an empty receipt as an acceptance failure instead of dereferencing its first request', async () => {
  const subject = harness({ receipts: [receipt([], [])], saveClick: async () => undefined });

  await assert.rejects(subject.run(), /capture_save_create_request_count/);
  assert.deepEqual(subject.persisted, []);
  assert.equal(subject.calls.at(-1), 'dispose');
});

test('fails acceptance but persists a later second observed key before disposal', async () => {
  const subject = harness({
    receipts: [receipt([FIRST_KEY]), receipt([FIRST_KEY, SECOND_KEY])],
    saveClick: async () => undefined,
  });

  await assert.rejects(subject.run(), /capture_save_idempotency_key_count/);
  assert.deepEqual(subject.persisted, [[FIRST_KEY], [FIRST_KEY, SECOND_KEY]]);
  assert.deepEqual(subject.proof.ownedCreateMutationKeys, [FIRST_KEY, SECOND_KEY]);
  assert.equal(subject.calls.at(-1), 'dispose');
});

test('retains the observer when the final receipt read fails after a trusted-click timeout', async () => {
  const subject = harness({
    receipts: [new Error('receipt read unavailable')],
    saveClick: async () => {
      throw new Error('trusted_click_timeout_after_commit');
    },
  });

  await assert.rejects(subject.run(), /trusted_click_timeout_after_commit/);
  assert.equal(subject.calls.includes('dispose'), false);
  assert.equal(subject.proof.captureSave.receiptObserverDisposed, false);
});

test('retains the observer when receipt-key persistence fails', async () => {
  const subject = harness({
    receipts: [receipt([FIRST_KEY])],
    saveClick: async () => undefined,
    persistFailure: true,
  });

  await assert.rejects(subject.run(), /capture_save_receipt_persist_failed/);
  assert.equal(subject.calls.includes('dispose'), false);
  assert.equal(subject.proof.captureSave.receiptObserverDisposed, false);
});
