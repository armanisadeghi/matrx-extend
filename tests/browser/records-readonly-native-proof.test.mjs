import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  assertRecordsVisibleCompletion,
  observeRecordsExecution,
  signInRecordsAdmin,
} from './records-readonly-native-proof.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');

test('Records sign-in supplies the mandatory stage callback to the real auth contract', async () => {
  const stages = [];
  const result = await signInRecordsAdmin(
    { page: {}, panel: {}, repo: '/repo', onStage: (value) => stages.push(value) },
    async ({ mode, onStage }) => {
      assert.equal(mode, 'admin');
      onStage('admin_web_navigation');
      return { admin_role: true };
    },
  );
  assert.deepEqual(stages, ['admin_web_navigation']);
  assert.equal(result.admin_role, true);
  await assert.rejects(
    signInRecordsAdmin({ page: {}, panel: {}, repo: '/repo' }, async () => ({ admin_role: true })),
    /records_auth_stage_callback_required/,
  );
});

function panelFor(completions) {
  const events = new EventEmitter();
  const removed = [];
  const panel = {
    on: (name, callback) => {
      events.on(name, callback);
      return () => {
        events.off(name, callback);
        removed.push(name);
      };
    },
    send: async (name, { requestId } = {}) => {
      if (name === 'Network.enable') return {};
      if (name === 'Network.getResponseBody') return { body: completions[requestId] };
      throw new Error(`unexpected_${name}`);
    },
  };
  return { panel, events, removed };
}

function emitRequest(events, requestId, token, organizationId) {
  events.emit('Network.requestWillBeSent', {
    requestId,
    request: {
      url: 'https://server.app.matrxserver.com/tools/test/execute',
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Organization-Id': organizationId },
      postData: JSON.stringify({ tool_name: 'records', arguments: { action: 'table_list' } }),
    },
  });
  events.emit('Network.responseReceived', { requestId, response: { status: 200 } });
  events.emit('Network.loadingFinished', { requestId });
}

test('Records execute observer binds the request to the signed-in principal', async () => {
  const { panel, events } = panelFor({});
  const observer = observeRecordsExecution(panel, 'org-1', hash('admin-token'));
  await observer.start();
  emitRequest(events, 'wrong-actor', 'other-token', 'org-1');
  assert.equal(observer.entries()[0].bearerMatches, false);
  observer.stop();
});

test('Records output must equal the completion from the same finished request', async () => {
  const live = {
    success: true,
    output: { action: 'table_list', tables: [{ name: 'appointments' }] },
  };
  const stale = { success: true, output: { action: 'table_list', tables: [{ name: 'invoices' }] } };
  const completions = {
    active: `${JSON.stringify({ event: 'completion', data: { operation: 'tool_execution', result: { full_result: live } } })}\n`,
    unrelated: `${JSON.stringify({ event: 'completion', data: { operation: 'tool_execution', result: { full_result: stale } } })}\n`,
  };
  const { panel, events, removed } = panelFor(completions);
  const observer = observeRecordsExecution(panel, 'org-1', hash('admin-token'));
  await observer.start();
  emitRequest(events, 'active', 'admin-token', 'org-1');
  const [request] = observer.entries();
  assert.equal(request.bearerMatches, true);
  const completion = await observer.completion(request);
  assert.deepEqual(completion, live);
  assert.throws(
    () => assertRecordsVisibleCompletion({ visible: true, raw: JSON.stringify(stale) }, completion),
    /records_output_completion_mismatch/,
  );
  assert.deepEqual(
    assertRecordsVisibleCompletion({ visible: true, raw: JSON.stringify(live) }, completion),
    live,
  );
  observer.stop();
  assert.equal(removed.length, 4);
});
