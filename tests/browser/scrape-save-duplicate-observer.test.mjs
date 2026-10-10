import assert from 'node:assert/strict';
import test from 'node:test';
import { observeDuplicateSourceSave } from './scrape-save-duplicate-observer.mjs';

const sourceId = '6b8c38dd-6d68-4824-b664-a380b7611627';

async function observedSave({ reused = true, landedId = sourceId, renameStatus = 200 } = {}) {
  const listeners = new Map();
  const panel = {
    on(name, callback) {
      listeners.set(name, callback);
      return () => listeners.delete(name);
    },
    async send(name, args) {
      if (name === 'Network.enable') return {};
      if (name === 'Network.getResponseBody' && args.requestId === 'land')
        return {
          body: JSON.stringify({ processed_document_id: landedId, reused_existing: reused }),
        };
      throw new Error(`unexpected_cdp_command:${name}`);
    },
  };
  const observer = observeDuplicateSourceSave(panel, 'https://server.app.matrxserver.com');
  await observer.start();
  const emit = (name, event) => listeners.get(name)(event);
  emit('Network.requestWillBeSent', {
    requestId: 'land',
    request: { method: 'POST', url: 'https://server.app.matrxserver.com/sources/land' },
  });
  emit('Network.responseReceived', { requestId: 'land', response: { status: 200 } });
  emit('Network.loadingFinished', { requestId: 'land' });
  emit('Network.requestWillBeSent', {
    requestId: 'rename',
    request: { method: 'POST', url: `https://server.app.matrxserver.com/sources/${sourceId}/edit` },
  });
  emit('Network.responseReceived', { requestId: 'rename', response: { status: renameStatus } });
  emit('Network.loadingFinished', { requestId: 'rename' });
  await Promise.resolve();
  await Promise.resolve();
  return observer;
}

test('duplicate observer requires the reused response, same Source ID, and successful details rename', async () => {
  const valid = await observedSave();
  assert.equal(valid.snapshot().ready, true);
  assert.deepEqual(valid.verify(sourceId), {
    reused_existing: true,
    same_source_id: true,
    rename_succeeded: true,
  });
  valid.stop();

  for (const [input, failure] of [
    [{ reused: false }, /scrape_save_duplicate_reuse_not_observed/],
    [
      { landedId: 'c2eec5ab-3a51-4caf-a560-12880de46a23' },
      /scrape_save_duplicate_landed_new_source/,
    ],
    [{ renameStatus: 503 }, /scrape_save_duplicate_rename_response_failed/],
  ]) {
    const broken = await observedSave(input);
    assert.throws(() => broken.verify(sourceId), failure);
    broken.stop();
  }
});
