import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {
  assertRecordsVisibleCompletion,
  observeRecordsExecution,
  signInRecordsAdmin,
} from './records-readonly-native-proof.mjs';

// Execute the callback passed by the acceptance driver itself, without launching
// Chrome or importing its top-level runner. The parser only locates the callback;
// the assertions below operate on its behavior.
const source = await readFile(
  new URL('./records-readonly-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const tree = ts.createSourceFile(
  'records-readonly-native-acceptance.mjs',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
let callback;
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'exercisePanel') {
    assert.equal(callback, undefined, 'one Records driver callback required');
    callback = node.initializer.getText(tree);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(callback, 'Records driver callback required');

const sha = (value) => createHash('sha256').update(value).digest('hex');
const organizationId = 'ba05beee-625e-43bb-931e-c2ea99d718d2';
const approved = { id: organizationId, name: 'Harbor Dental' };
const tableResult = (name) => ({
  success: true,
  output: {
    action: 'table_list',
    tables: [{ name, organization_id: organizationId }],
    organizations_covered: [organizationId],
  },
});

function runDriver({
  token = 'admin-session',
  visibleResult = tableResult('appointments'),
  completionResult = tableResult('appointments'),
  visibleChangesAfterWait = false,
  driverSource = callback,
} = {}) {
  const events = new EventEmitter();
  const active = new Set();
  const report = { native_stage: null, request: null, result: null };
  const stages = [];
  const expectedInput = {
    action: 'table_list',
    args: { organization_id: organizationId, include_app_tables: true, limit: 50 },
  };
  const panel = {
    on(name, listener) {
      events.on(name, listener);
      active.add(listener);
      return () => {
        events.off(name, listener);
        active.delete(listener);
      };
    },
    async send(name, options = {}) {
      if (
        name === 'Network.enable' ||
        name === 'Input.dispatchKeyEvent' ||
        name === 'Input.insertText'
      )
        return {};
      if (name === 'Network.getResponseBody') {
        assert.equal(options.requestId, 'records-execute');
        return {
          body: `${JSON.stringify({ event: 'completion', data: { operation: 'tool_execution', result: { full_result: completionResult } } })}\n`,
        };
      }
      throw new Error(`unexpected CDP command ${name}`);
    },
  };
  const waitFor = async (label, read, accept) => {
    const value = await read();
    assert.equal(Boolean(accept(value)), true, `${label}_not_accepted`);
    if (label === 'records_output_visible' && visibleChangesAfterWait) {
      return { visible: true, raw: JSON.stringify(tableResult('invoices')) };
    }
    return value;
  };
  const outputState = async () => ({ visible: true, raw: JSON.stringify(visibleResult) });
  const evaluate = async (_panel, script) => {
    if (
      script.includes('document.activeElement===t') ||
      script.includes("querySelector('textarea')?.value")
    )
      return true;
    return true;
  };
  const click = async () => {
    const requestId = 'records-execute';
    events.emit('Network.requestWillBeSent', {
      requestId,
      request: {
        url: 'https://server.app.matrxserver.com/tools/test/execute',
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'X-Organization-Id': organizationId },
        postData: JSON.stringify({ tool_name: 'records', arguments: expectedInput }),
      },
    });
    events.emit('Network.responseReceived', { requestId, response: { status: 200 } });
    events.emit('Network.loadingFinished', { requestId });
  };
  const signIn = (options) =>
    signInRecordsAdmin(options, async ({ onStage }) => {
      onStage('admin_authenticated');
      return { admin_role: true };
    });
  const bindings = {
    stage: (value) => stages.push(value),
    report,
    approved,
    REPO: '/repo',
    process: { env: {} },
    signInRecordsAdmin: signIn,
    runShowcaseOrganizationCheckpoint: async () => {},
    waitFor,
    evaluate,
    click,
    panelBearerHash: async () => sha('admin-session'),
    observeRecordsExecution,
    outputState,
    assertRecordsVisibleCompletion,
    assert,
  };
  const names = Object.keys(bindings);
  const driver = new Function(...names, `return ${driverSource};`)(...Object.values(bindings));
  return {
    run: () => driver({ page: {}, panel, resourceAction: (action) => action() }),
    report,
    stages,
    active,
  };
}

test('actual Records driver forwards sign-in stages and accepts a correlated request and completion', async () => {
  const scenario = runDriver();
  await scenario.run();
  assert.equal(scenario.report.native_stage, 'admin_authenticated');
  assert.deepEqual(scenario.report.request, {
    path: '/tools/test/execute',
    method: 'POST',
    organization_matches: true,
    authenticated_principal_matches: true,
    completion_observed: true,
    include_app_tables: true,
    status: 200,
    finished: true,
  });
  assert.deepEqual(scenario.report.result, {
    visible: true,
    success: true,
    action: 'table_list',
    count: 1,
    approved_organization_covered: true,
  });
  assert.equal(scenario.active.size, 0, 'CDP listeners must be removed');
  assert.doesNotMatch(JSON.stringify(scenario.report), /admin-session|appointments|Bearer/);
});

test('actual Records driver refuses a different execute bearer and cleans up listeners', async () => {
  const scenario = runDriver({ token: 'another-session' });
  await assert.rejects(scenario.run(), /records_execute_principal_mismatch/);
  assert.equal(scenario.active.size, 0);
  assert.equal(scenario.report.result, null);
  assert.doesNotMatch(JSON.stringify(scenario.report), /another-session|Bearer/);
});

test('actual Records driver refuses a stale visible result after the wait and cleans up listeners', async () => {
  const scenario = runDriver({ visibleChangesAfterWait: true });
  await assert.rejects(scenario.run(), /records_output_completion_mismatch/);
  assert.equal(scenario.active.size, 0);
  assert.equal(scenario.report.result, null);
  assert.doesNotMatch(JSON.stringify(scenario.report), /appointments|invoices|Bearer/);
});

test('driver seam mutation proof catches omitted stage, bearer assertion, and final completion assertion separately', async () => {
  const mutate = (pattern, replacement) => {
    const changed = callback.replace(pattern, replacement);
    assert.notEqual(changed, callback, 'mutation must change the actual callback');
    return changed;
  };
  const noStage = mutate(/onStage: \(value\) => \{\s*report\.native_stage = value;\s*\},/, '');
  const missingStage = runDriver({ driverSource: noStage });
  await assert.rejects(missingStage.run(), /records_auth_stage_callback_required/);
  assert.equal(missingStage.active.size, 0);

  const noBearerCheck = mutate(
    /assert\.equal\(request\.bearerMatches, true, 'records_execute_principal_mismatch'\);/,
    '',
  );
  const wrongPrincipal = runDriver({ token: 'another-session', driverSource: noBearerCheck });
  await wrongPrincipal.run();
  assert.equal(
    wrongPrincipal.report.result?.success,
    true,
    'bearer mutation must escape without the assertion',
  );
  assert.equal(wrongPrincipal.active.size, 0);

  const noCompletionCheck = mutate(
    'assertRecordsVisibleCompletion(visible, completion)',
    'JSON.parse(visible.raw)',
  );
  const staleOutput = runDriver({ visibleChangesAfterWait: true, driverSource: noCompletionCheck });
  await staleOutput.run();
  assert.equal(
    staleOutput.report.result?.success,
    true,
    'completion mutation must escape without final assertion',
  );
  assert.equal(staleOutput.active.size, 0);

  const constantReceipt = runDriver({
    token: 'another-session',
    driverSource: `async () => { report.result = { visible: true, success: true, action: 'table_list', count: 1, approved_organization_covered: true }; }`,
  });
  await constantReceipt.run();
  assert.equal(
    constantReceipt.report.result?.success,
    true,
    'constant-return gut check: the wrong-principal rejection must fail against this mutant',
  );
});
