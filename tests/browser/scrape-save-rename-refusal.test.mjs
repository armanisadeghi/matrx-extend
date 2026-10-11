import assert from 'node:assert/strict';
import test from 'node:test';
import { refuseFirstSourceRename } from './scrape-save-rename-refusal.mjs';

const origin = 'https://server.app.matrxserver.com';
const ownedId = '6b8c38dd-6d68-4824-b664-a380b7611627';

function harness({ failFulfill = false } = {}) {
  const calls = [];
  let listener;
  const panel = {
    on(name, callback) {
      assert.equal(name, 'Fetch.requestPaused');
      listener = callback;
      return () => {
        listener = null;
      };
    },
    async send(method, params) {
      calls.push({ method, params });
      if (failFulfill && method === 'Fetch.fulfillRequest') throw new Error('cdp_refusal_failed');
      return {};
    },
  };
  return {
    controller: refuseFirstSourceRename(panel, origin, ownedId),
    calls,
    async pause(requestId, url, method = 'POST') {
      listener({ requestId, request: { url, method } });
      await new Promise(setImmediate);
    },
    listening: () => listener !== null,
  };
}

test('controlled refusal isolates one owned rename and lets the retry reach the real service', async () => {
  // Break: broad interception, refusing every rename, or continuing the first rename.
  const h = harness();
  await h.controller.start();
  assert.deepEqual(h.calls[0], {
    method: 'Fetch.enable',
    params: {
      patterns: [{ urlPattern: `${origin}/sources/${ownedId}/edit`, requestStage: 'Request' }],
    },
  });
  await h.pause('land', `${origin}/sources/land`);
  await h.pause('other-source', `${origin}/sources/483b99c0-04ef-4213-89b8-c85cd9eca502/edit`);
  await h.pause('read', `${origin}/sources/${ownedId}/edit`, 'GET');
  await h.pause('refused', `${origin}/sources/${ownedId}/edit`);
  await h.pause('retry', `${origin}/sources/${ownedId}/edit`);
  assert.deepEqual(
    h.calls
      .filter((c) => c.method === 'Fetch.fulfillRequest')
      .map((c) => [c.params.requestId, c.params.responseCode]),
    [['refused', 503]],
  );
  assert.deepEqual(
    h.calls.filter((c) => c.method === 'Fetch.continueRequest').map((c) => c.params.requestId),
    ['land', 'other-source', 'read', 'retry'],
  );
  assert.deepEqual(h.controller.verify(), { refused: 1, continued: 4, failures: 0, pending: 0 });
  await h.controller.stop();
  assert.equal(h.calls.at(-1).method, 'Fetch.disable');
  assert.equal(h.listening(), false);
});

test('missing or failed fault injection cannot pass as a controlled refusal', async () => {
  const untouched = harness();
  await untouched.controller.start();
  assert.throws(
    () => untouched.controller.verify(),
    /scrape_save_rename_refusal_not_injected_once/,
  );
  await untouched.controller.stop();
  const failed = harness({ failFulfill: true });
  await failed.controller.start();
  await failed.pause('refused', `${origin}/sources/${ownedId}/edit`);
  assert.throws(() => failed.controller.verify(), /scrape_save_rename_refusal_controller_failed/);
  await assert.rejects(failed.controller.stop(), /scrape_save_rename_refusal_controller_failed/);
  assert.equal(failed.listening(), false);
});
