import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { watchOwnedScreenshotDelete } from './screenshot-owned-delete-observer.mjs';

function panel() {
  const events = new EventEmitter();
  return {
    on: (name, listener) => {
      events.on(name, listener);
      return () => events.off(name, listener);
    },
    emit: (name, value) => events.emit(name, value),
  };
}

function request(panel, id, row, status, finish = true) {
  panel.emit('Network.requestWillBeSent', {
    requestId: id,
    request: {
      method: 'DELETE',
      url: `https://database.invalid/rest/v1/wbx_screenshot?id=eq.${row}`,
    },
  });
  panel.emit('Network.responseReceived', { requestId: id, response: { status } });
  if (finish) panel.emit('Network.loadingFinished', { requestId: id });
}

// Harbor Dental's owned screenshot may be checked absent only after its exact
// DELETE finishes successfully. A matching click or unrelated mutation is not proof.
test('owned-row absence check waits for the exact completed DELETE', async () => {
  const channel = panel();
  const owned = watchOwnedScreenshotDelete(channel, 'harbor-guide');
  const order = [];
  const pending = owned.clickAndWait(
    async () => {
      order.push('click');
      request(channel, 'other', 'insurance-guide', 204);
      channel.emit('Network.requestWillBeSent', {
        requestId: 'owned',
        request: {
          method: 'DELETE',
          url: 'https://database.invalid/rest/v1/wbx_screenshot?id=eq.harbor-guide',
        },
      });
      channel.emit('Network.responseReceived', {
        requestId: 'owned',
        response: { status: 204 },
      });
      queueMicrotask(() => {
        order.push('mutation-finished');
        channel.emit('Network.loadingFinished', { requestId: 'owned' });
      });
    },
    () => {},
    500,
  );
  await assert.rejects(pending, /exact_owned_delete_mutation_not_observed/);
  assert.deepEqual(order, ['click', 'mutation-finished']);
  owned.stop();
});

test('exact successful mutation resolves only after network completion', async () => {
  const channel = panel();
  const owned = watchOwnedScreenshotDelete(channel, 'harbor-guide');
  let resolved = false;
  const mutation = owned.clickAndWait(
    async () => {
      channel.emit('Network.requestWillBeSent', {
        requestId: 'owned',
        request: {
          method: 'DELETE',
          url: 'https://database.invalid/rest/v1/wbx_screenshot?id=eq.harbor-guide',
        },
      });
      channel.emit('Network.responseReceived', {
        requestId: 'owned',
        response: { status: 204 },
      });
    },
    () => {},
    500,
  );
  mutation.then(() => {
    resolved = true;
  });
  await Promise.resolve();
  assert.equal(resolved, false);
  channel.emit('Network.loadingFinished', { requestId: 'owned' });
  const result = await mutation;
  assert.equal(resolved, true);
  assert.equal(result.completedExactCount, 1);
  assert.equal(result.otherCount, 0);
  owned.stop();
});

test('failed exact DELETE never authorizes row absence verification', async () => {
  const channel = panel();
  const owned = watchOwnedScreenshotDelete(channel, 'harbor-guide');
  await assert.rejects(
    owned.clickAndWait(
      async () => request(channel, 'owned', 'harbor-guide', 403),
      () => {},
      150,
    ),
    /exact_owned_delete_mutation_not_observed/,
  );
  owned.stop();
});
