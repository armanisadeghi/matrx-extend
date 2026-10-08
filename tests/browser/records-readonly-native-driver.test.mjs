import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {
  assertRecordsVisibleCompletion,
  enterRecordsInput,
  observeRecordsExecution,
  signInRecordsAdmin,
} from './records-readonly-native-proof.mjs';

// Evaluate the callback the native acceptance actually passes to the shared harness.
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
assert.ok(callback);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const organizationId = 'ba05beee-625e-43bb-931e-c2ea99d718d2';
const approved = { id: organizationId, name: 'Harbor Dental' };
const positive = (name) => ({
  success: true,
  output: {
    action: 'table_list',
    tables: [{ id: 'f2c1d147-bb97-4dcb-9486-b1b4a7dab7dc', name, organization_id: organizationId }],
    organizations_covered: [organizationId],
  },
});
const refusal = {
  success: false,
  error: {
    error_type: 'invalid_arguments',
    message: 'Invalid arguments for records: limit must be an integer',
  },
};
const input = {
  action: 'table_list',
  args: { organization_id: organizationId, include_platform_tables: true, limit: 50 },
};
const invalid = {
  action: 'table_list',
  args: { organization_id: organizationId, include_platform_tables: true, limit: 'not-a-number' },
};
const metadataInput = {
  action: 'metadata_search',
  args: { organization_id: organizationId, query: 'invoices', limit: 50 },
};
const metadataResult = (
  matches = [
    {
      id: 'f2c1d147-bb97-4dcb-9486-b1b4a7dab7dc',
      kind: 'table',
      name: 'invoices',
      organization_id: organizationId,
    },
  ],
) => ({
  success: true,
  output: {
    action: 'metadata_search',
    query: 'invoices',
    matches,
    count: matches.length,
    organizations_covered: [organizationId],
  },
});
const tableListSchema = (visibilityField = 'include_platform_tables') => ({
  action: { enum: ['table_list', 'metadata_search'] },
  $variants: {
    table_list: {
      [visibilityField]: { type: 'boolean', default: false },
      limit: { type: 'integer', default: 50 },
      organization_id: { type: 'string' },
    },
  },
});

function runDriver({
  platform = 'darwin',
  token = 'admin-session',
  completions = [positive('appointments'), refusal, positive('invoices'), metadataResult()],
  changedVisible = false,
  reloadedProfile = 'admin-id',
  driverSource = callback,
  inputHelper = enterRecordsInput,
  serverSchema = tableListSchema(),
} = {}) {
  const events = new EventEmitter();
  const active = new Set();
  const report = {
    native_stage: null,
    request: null,
    result: null,
    metadata_search: null,
    invalid_input: null,
    reload: null,
  };
  const stages = [];
  const editor = { value: '{"action":"old"}', focused: false, start: 0, end: 0 };
  let runs = 0;
  let reloads = 0;
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
      if (name === 'Network.enable') return {};
      if (name === 'Page.reload') {
        reloads++;
        editor.value = '{}';
        return {};
      }
      if (name === 'Input.dispatchKeyEvent') {
        if (
          options.type === 'keyDown' &&
          options.key === 'a' &&
          options.modifiers === (platform === 'darwin' ? 4 : 2) &&
          options.commands?.includes('selectAll') &&
          editor.focused
        ) {
          editor.start = 0;
          editor.end = editor.value.length;
        }
        return {};
      }
      if (name === 'Input.insertText') {
        assert.equal(editor.focused, true, 'trusted input requires focus');
        editor.value =
          editor.value.slice(0, editor.start) + options.text + editor.value.slice(editor.end);
        editor.start = editor.end = editor.value.length;
        return {};
      }
      if (name === 'Network.getResponseBody') {
        const index = Number(options.requestId?.split('-').at(-1));
        assert.ok(index >= 0 && index < runs, 'response must belong to a sent request');
        return {
          body: `${JSON.stringify({ event: 'completion', data: { operation: 'tool_execution', result: { full_result: completions[index] } } })}\n`,
        };
      }
      throw new Error(`unexpected CDP command ${name}`);
    },
  };
  const waitFor = async (label, read, accept) => {
    const value = await read();
    assert.equal(Boolean(accept(value)), true, `${label}_not_accepted`);
    if (label.endsWith('_output_visible') && changedVisible)
      return { visible: true, raw: JSON.stringify(positive('stale')) };
    return value;
  };
  const outputState = async () => ({ visible: true, raw: JSON.stringify(completions[runs - 1]) });
  const evaluate = async (_panel, script) => {
    if (script.includes('server action contract')) {
      const pre = {
        textContent: JSON.stringify(serverSchema),
        getClientRects: () => [1],
      };
      const label = {
        textContent: 'server action contract',
        children: [],
        parentElement: { parentElement: { querySelector: () => pre } },
      };
      const row = {
        querySelector: () => ({ textContent: 'records' }),
        parentElement: { querySelectorAll: () => [label] },
      };
      const document = { querySelectorAll: () => [row] };
      return new Function('document', `return ${script};`)(document);
    }
    if (script.includes('t.focus()')) {
      editor.focused = true;
      return true;
    }
    if (script.includes('selectionStart'))
      return editor.focused && editor.start === 0 && editor.end === editor.value.length;
    if (script.includes("querySelector('textarea')?.value"))
      return (
        editor.value === JSON.stringify(runs === 1 ? invalid : runs === 3 ? metadataInput : input)
      );
    return true;
  };
  const click = async (_panel, kind, label) => {
    if (label === 'Run') {
      const expected = runs === 1 ? invalid : runs === 3 ? metadataInput : input;
      assert.equal(editor.value, JSON.stringify(expected), 'Run requires actual input');
      const requestId = `records-execute-${runs++}`;
      events.emit('Network.requestWillBeSent', {
        requestId,
        request: {
          url: 'https://server.app.matrxserver.com/tools/test/execute',
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'X-Organization-Id': organizationId },
          postData: JSON.stringify({ tool_name: 'records', arguments: expected }),
        },
      });
      events.emit('Network.responseReceived', { requestId, response: { status: 200 } });
      events.emit('Network.loadingFinished', { requestId });
    } else if (kind === 'title' && label === 'Settings')
      assert.equal(reloads, 1, 'Settings must follow full panel reload');
  };
  const bindings = {
    stage: (value) => stages.push(value),
    report,
    approved,
    REPO: '/repo',
    process: { env: {}, platform },
    signInRecordsAdmin: (options) =>
      signInRecordsAdmin(options, async ({ onStage }) => {
        onStage('admin_authenticated');
        return { admin_role: true, email: 'admin@admin.com', profileId: 'admin-id' };
      }),
    runShowcaseOrganizationCheckpoint: async () => {},
    waitFor,
    evaluate,
    click,
    openSection: async () => {},
    toolsCatalogState: async () => 'catalog',
    accountIdentity: async () => ({
      emailMatches: true,
      adminRole: true,
      signOutVisible: true,
      organizationSelected: true,
      organizationLabel: approved.name,
    }),
    panelIdentity: async () => ({
      accessTokenPresent: true,
      isAdmin: true,
      profileId: reloadedProfile,
      organizationId,
      organizationName: approved.name,
    }),
    panelBearerHash: async () => sha('admin-session'),
    observeRecordsExecution,
    outputState,
    assertRecordsVisibleCompletion,
    enterRecordsInput: inputHelper,
    assert,
  };
  const driver = new Function(...Object.keys(bindings), `return ${driverSource};`)(
    ...Object.values(bindings),
  );
  return {
    run: () => driver({ page: {}, panel, resourceAction: (action) => action() }),
    report,
    stages,
    active,
    get runs() {
      return runs;
    },
    get reloads() {
      return reloads;
    },
  };
}

test('actual callback requires finished matching success, refusal, and post-reload success', async () => {
  const scenario = runDriver();
  await scenario.run();
  assert.equal(scenario.runs, 4);
  assert.equal(scenario.reloads, 1);
  assert.equal(scenario.report.native_stage, 'admin_authenticated');
  assert.equal(scenario.report.result?.success, true);
  assert.deepEqual(scenario.report.invalid_input, {
    finished: true,
    status: 200,
    completion_observed: true,
    visible: true,
    success: false,
    error_type: 'invalid_arguments',
    limit_named: true,
  });
  assert.deepEqual(scenario.report.reload, {
    full_panel_reload: true,
    admin_identity_matches: true,
    organization_matches: true,
    authenticated_principal_matches: true,
    finished: true,
    completion_observed: true,
    visible: true,
    success: true,
    count: 1,
  });
  assert.deepEqual(scenario.report.metadata_search, {
    inventory_case: 'EXT-F-4130-C03',
    finished: true,
    status: 200,
    completion_observed: true,
    visible: true,
    success: true,
    action: 'metadata_search',
    independent_table_identity_matched: true,
    count: 1,
  });
  assert.equal(scenario.active.size, 0);
  assert.doesNotMatch(
    JSON.stringify(scenario.report),
    /admin-session|appointments|invoices|Bearer/,
  );
});

test('trusted input helper replaces an existing draft on Linux', async () => {
  const scenario = runDriver({ platform: 'linux' });
  await scenario.run();
  assert.equal(scenario.runs, 4);
});

test('missing selection refuses before execution', async () => {
  const helper = async (panel, evaluate, stage, value, platform) => {
    const intercepted = {
      ...panel,
      send: (name, options) =>
        panel.send(
          name,
          name === 'Input.dispatchKeyEvent' ? { ...options, commands: [] } : options,
        ),
    };
    return enterRecordsInput(intercepted, evaluate, stage, value, platform);
  };
  const scenario = runDriver({ inputHelper: helper });
  await assert.rejects(scenario.run(), /records_input_selection_missing/);
  assert.equal(scenario.runs, 0);
});

test('server schema drift refuses before the first Records execute', async () => {
  for (const serverSchema of [tableListSchema('include_app_tables'), null]) {
    const scenario = runDriver({ serverSchema });
    await assert.rejects(scenario.run(), /records_table_list_server_contract_drift/);
    assert.equal(scenario.runs, 0);
    assert.equal(scenario.report.result, null);
  }
});

test('wrong principal, stale completion and wrong post-reload identity each fail', async () => {
  for (const [options, message] of [
    [{ token: 'other-session' }, /records_principal_mismatch/],
    [{ changedVisible: true }, /records_output_completion_mismatch/],
    [{ reloadedProfile: 'another-id' }, /records_identity_after_reload_not_accepted/],
  ]) {
    const scenario = runDriver(options);
    await assert.rejects(scenario.run(), message);
    assert.equal(scenario.active.size, 0);
    assert.equal(scenario.report.reload, null);
  }
});

test('negative and reload assertions catch false success and omitted reload', async () => {
  const falselySuccessful = runDriver({
    completions: [positive('appointments'), positive('wrong'), positive('invoices')],
  });
  await assert.rejects(falselySuccessful.run(), /records_invalid_limit_false_success/);
  assert.equal(falselySuccessful.reloads, 0);
  for (const wrong of [
    { success: false, error: { error_type: 'execution', message: 'limit must be an integer' } },
    { success: false, error: { error_type: 'invalid_arguments', message: 'unrelated field' } },
  ]) {
    const scenario = runDriver({
      completions: [positive('appointments'), wrong, positive('invoices')],
    });
    await assert.rejects(scenario.run(), /records_invalid_limit_(wrong_error|field_missing)/);
    assert.equal(scenario.reloads, 0);
  }
  const failedReloadRead = runDriver({ completions: [positive('appointments'), refusal, refusal] });
  await assert.rejects(failedReloadRead.run(), /records_reloaded_tool_refused/);
  assert.equal(failedReloadRead.report.reload, null);
  const noReloadSource = callback.replace(
    "await panel.send('Page.reload', { ignoreCache: true });",
    '',
  );
  assert.notEqual(noReloadSource, callback);
  await assert.rejects(
    runDriver({ driverSource: noReloadSource }).run(),
    /Settings must follow full panel reload/,
  );
});

test('metadata search rejects unrelated matches, wrong echo, and false success', async () => {
  for (const [completion, failure] of [
    [
      metadataResult([
        { id: 'another-id', kind: 'table', name: 'invoices', organization_id: organizationId },
      ]),
      /records_metadata_oracle_match_missing/,
    ],
    [
      { ...metadataResult(), output: { ...metadataResult().output, query: 'appointments' } },
      /records_metadata_wrong_query/,
    ],
    [
      { success: false, error: { error_type: 'execution' } },
      /records_metadata_search_tool_refused/,
    ],
  ]) {
    const scenario = runDriver({
      completions: [positive('appointments'), refusal, positive('invoices'), completion],
    });
    await assert.rejects(scenario.run(), failure);
    assert.equal(scenario.runs, 4);
    assert.equal(scenario.report.metadata_search, null);
    assert.equal(scenario.active.size, 0);
  }
});

test('constant completion cannot pass callback identity and request checks', async () => {
  const scenario = runDriver({
    driverSource: 'async () => { report.result = { success: true }; }',
  });
  await scenario.run();
  assert.equal(scenario.runs, 0);
  assert.equal(scenario.report.invalid_input, null);
  assert.equal(scenario.report.reload, null);
});
