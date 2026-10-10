import assert from 'node:assert/strict';
import test from 'node:test';
import { observeDuplicateSourceSave } from './scrape-save-duplicate-observer.mjs';

const sourceId = '6b8c38dd-6d68-4824-b664-a380b7611627';

async function observedSave({
  reused = true,
  landedId = sourceId,
  landStatus = 201,
  renameStatus = 200,
} = {}) {
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
  emit('Network.responseReceived', { requestId: 'land', response: { status: landStatus } });
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
  assert.deepEqual(valid.snapshot(sourceId), {
    ready: true,
    landCount: 1,
    renameCount: 1,
    land_response_received: true,
    land_http_status: 201,
    land_status_class: 2,
    land_finished: true,
    land_transport_failed: false,
    land_body_observed: true,
    land_reused_existing: true,
    land_same_source_id: true,
    rename_response_received: true,
    rename_http_status: 200,
    rename_status_class: 2,
    rename_finished: true,
    rename_transport_failed: false,
    rename_target_matches_source: true,
  });
  assert.deepEqual(valid.verify(sourceId), {
    reused_existing: true,
    same_source_id: true,
    rename_succeeded: true,
  });
  valid.stop();

  for (const [input, failure] of [
    [{ landStatus: 200 }, /scrape_save_duplicate_land_response_failed/],
    [{ landStatus: 409 }, /scrape_save_duplicate_land_response_failed/],
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

test('duplicate rejection retains bounded status evidence without response text or identifiers', async () => {
  const rejected = await observedSave({ landStatus: 409, renameStatus: 503 });
  const observations = {};
  await assert.rejects(
    rejected.run(sourceId, observations, async () => rejected.verify(sourceId)),
    /scrape_save_duplicate_land_response_failed/,
  );
  const diagnostic = observations.duplicate_transport;
  assert.ok(diagnostic, 'scrape_save_duplicate_transport_diagnostic_missing');
  assert.equal(diagnostic.land_response_received, true);
  assert.equal(diagnostic.land_http_status, 409);
  assert.equal(diagnostic.land_status_class, 4);
  assert.equal(diagnostic.rename_http_status, 503);
  assert.equal(diagnostic.rename_status_class, 5);
  assert.equal(diagnostic.land_reused_existing, true);
  assert.equal(diagnostic.land_same_source_id, true);
  assert.doesNotMatch(
    JSON.stringify(diagnostic),
    /6b8c38dd|processed_document_id|responseBody|text/,
  );
});
