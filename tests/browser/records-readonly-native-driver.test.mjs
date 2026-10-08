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
  recordsCompletionShape,
  recordsVisibleShape,
  retainRecordsFailure,
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
const negativeInputs = [
  { action: 'metadata_search', args: { organization_id: organizationId, query: null } },
  { action: 'record_read', args: { record_id: 'not-a-uuid' } },
  { action: 'record_aggregate', args: { table_id: 'not-a-uuid', measure: 'count' } },
];
const negativeResult = (field) => ({
  success: false,
  error: { error_type: 'invalid_arguments', message: `Invalid arguments: ${field} is invalid` },
});
const fixtureTableId = '3b80fd38-4db8-4cc9-8629-f8b751d5b337';
const fixtureRowId = '6cf44320-25a4-4fa9-9107-254cf18d6f88';
const fixtureRowName = 'EXT-F-4130-owned-row';
const positiveInputs = [
  { action: 'record_read', args: { record_id: fixtureRowId } },
  {
    action: 'record_aggregate',
    args: { table_id: fixtureTableId, measure: 'count', match: { name: fixtureRowName } },
  },
];
const positiveRead = (value = fixtureRowName) => ({
  success: true,
  output: {
    action: 'record_read',
    record: {
      id: fixtureRowId,
      table_id: fixtureTableId,
      organization_id: organizationId,
      values: { name: value },
    },
    triples: [
      { field: 'name', record_id: fixtureRowId, field_id: fixtureTableId, value_version: 1 },
    ],
  },
});
const positiveAggregate = (count = 1) => ({
  success: true,
  output: {
    action: 'record_aggregate',
    table_id: fixtureTableId,
    measure: 'count',
    buckets: [{ row_count: count, measure: { count } }],
  },
});
const tableListSchema = (visibilityField = 'include_platform_tables') => ({
  action: { enum: ['table_list', 'metadata_search', 'record_read', 'record_aggregate'] },
  $variants: {
    table_list: {
      [visibilityField]: { type: 'boolean', default: false },
      limit: { type: 'integer', default: 50 },
      organization_id: { type: 'string' },
    },
    metadata_search: { query: { type: 'string' } },
    record_read: { record_id: { type: 'string' } },
    record_aggregate: { table_id: { type: 'string' } },
  },
});

function runDriver({
  platform = 'darwin',
  token = 'admin-session',
  completions = [
    positive('appointments'),
    refusal,
    positive('invoices'),
    metadataResult(),
    negativeResult('query'),
    negativeResult('record_id'),
    negativeResult('table_id'),
    positiveRead(),
    positiveAggregate(),
  ],
  changedVisible = false,
  visibleMode = 'normal',
  responseMode = 'normal',
  httpStatus = 200,
  reloadedProfile = 'admin-id',
  driverSource = callback,
  inputHelper = enterRecordsInput,
  serverSchema = tableListSchema(),
  cardReady = true,
  schemaReady = true,
  contractObservationFails = false,
  fixtureHelper = async ({ exercise, onStage }) => {
    onStage('records_fixture_table_create');
    try {
      await exercise({ tableId: fixtureTableId, rowId: fixtureRowId, rowName: fixtureRowName });
    } finally {
      onStage('records_fixture_cleanup');
    }
    return { archived_verified: true };
  },
} = {}) {
  const events = new EventEmitter();
  const active = new Set();
  const report = {
    stage: 'inputs',
    native_stage: null,
    request: null,
    result: null,
    metadata_search: null,
    negative_reads: [],
    positive_reads: [],
    fixture_cleanup: null,
    invalid_input: null,
    reload: null,
    completion_diagnostics: [],
    card_diagnostic: null,
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
        if (responseMode === 'malformed') return { body: 'not-json\n' };
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
  const outputState = async () =>
    visibleMode === 'missing'
      ? { visible: false, raw: null }
      : visibleMode === 'stale'
        ? { visible: true, raw: JSON.stringify(positive('stale')) }
        : { visible: true, raw: JSON.stringify(completions[runs - 1]) };
  const evaluate = async (_panel, script) => {
    if (script.includes('server action contract')) {
      if (contractObservationFails) throw new Error('private contract error');
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
    if (script.includes(".some(el => el.querySelector('span.font-mono')")) return cardReady;
    if (script.includes("return Boolean(b?.parentElement?.querySelector('textarea')"))
      return schemaReady;
    if (script.includes('t.focus()')) {
      editor.focused = true;
      return true;
    }
    if (script.includes('selectionStart'))
      return editor.focused && editor.start === 0 && editor.end === editor.value.length;
    if (script.includes("querySelector('textarea')?.value"))
      return (
        editor.value ===
        JSON.stringify(
          runs === 1
            ? invalid
            : runs === 3
              ? metadataInput
              : runs >= 7
                ? positiveInputs[runs - 7]
                : runs >= 4
                  ? negativeInputs[runs - 4]
                  : input,
        )
      );
    return true;
  };
  const click = async (_panel, kind, label) => {
    if (label === 'Run') {
      const expected =
        runs === 1
          ? invalid
          : runs === 3
            ? metadataInput
            : runs >= 7
              ? positiveInputs[runs - 7]
              : runs >= 4
                ? negativeInputs[runs - 4]
                : input;
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
      events.emit('Network.responseReceived', { requestId, response: { status: httpStatus } });
      events.emit('Network.loadingFinished', { requestId });
    } else if (kind === 'title' && label === 'Settings')
      assert.equal(reloads, 1, 'Settings must follow full panel reload');
  };
  const bindings = {
    stage: (value) => {
      stages.push(value);
      report.stage = value;
    },
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
    recordsCompletionShape,
    recordsVisibleShape,
    outputState,
    assertRecordsVisibleCompletion,
    enterRecordsInput: inputHelper,
    withRecordsPositiveFixture: fixtureHelper,
    output: '/tmp/records-driver-test-report.json',
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
  assert.equal(scenario.runs, 9);
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
  assert.deepEqual(
    scenario.report.negative_reads.map(
      ({ inventory_case, action, error_class, positive_read_verified }) => ({
        inventory_case,
        action,
        error_class,
        positive_read_verified,
      }),
    ),
    [
      {
        inventory_case: 'EXT-F-4130-C03',
        action: 'metadata_search',
        error_class: 'invalid_arguments',
        positive_read_verified: false,
      },
      {
        inventory_case: 'EXT-F-4130-C04',
        action: 'record_read',
        error_class: 'invalid_arguments',
        positive_read_verified: false,
      },
      {
        inventory_case: 'EXT-F-4130-C05',
        action: 'record_aggregate',
        error_class: 'invalid_arguments',
        positive_read_verified: false,
      },
    ],
  );
  assert.equal(scenario.active.size, 0);
  assert.deepEqual(
    scenario.report.positive_reads.map((row) => row.inventory_case),
    ['EXT-F-4130-C04', 'EXT-F-4130-C05'],
  );
  assert.equal(scenario.report.fixture_cleanup.archived_verified, true);
  assert.doesNotMatch(
    JSON.stringify(scenario.report),
    /admin-session|appointments|invoices|Bearer/,
  );
});

test('trusted input helper replaces an existing draft on Linux', async () => {
  const scenario = runDriver({ platform: 'linux' });
  await scenario.run();
  assert.equal(scenario.runs, 9);
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

test('actual callback persists safe card, schema and contract failure classes before execution', async () => {
  const cases = [
    [{ cardReady: false }, 'card_ready', 'card_not_ready', false, null, null],
    [{ schemaReady: false }, 'schema_ready', 'schema_not_ready', true, false, null],
    [
      { contractObservationFails: true },
      'contract_observation',
      'contract_observation_failed',
      true,
      true,
      null,
    ],
    [{ serverSchema: null }, 'contract_observation', 'contract_unavailable', true, true, false],
    [
      { serverSchema: tableListSchema('include_app_tables') },
      'contract_observation',
      'contract_drift',
      true,
      true,
      true,
      {
        canonical_boolean: false,
        retired_field_present: true,
        action_available: true,
        limit_integer: true,
      },
    ],
    [
      {
        serverSchema: {
          ...tableListSchema(),
          $variants: {
            table_list: {
              ...tableListSchema().$variants.table_list,
              include_platform_tables: { type: 'string' },
            },
          },
        },
      },
      'contract_observation',
      'contract_drift',
      true,
      true,
      true,
      {
        canonical_boolean: false,
        retired_field_present: false,
        action_available: true,
        limit_integer: true,
      },
    ],
    [
      { serverSchema: { ...tableListSchema(), action: { enum: ['metadata_search'] } } },
      'contract_observation',
      'contract_drift',
      true,
      true,
      true,
      {
        canonical_boolean: true,
        retired_field_present: false,
        action_available: false,
        limit_integer: true,
      },
    ],
    [
      {
        serverSchema: {
          ...tableListSchema(),
          $variants: {
            table_list: {
              ...tableListSchema().$variants.table_list,
              limit: { type: 'string' },
            },
          },
        },
      },
      'contract_observation',
      'contract_drift',
      true,
      true,
      true,
      {
        canonical_boolean: true,
        retired_field_present: false,
        action_available: true,
        limit_integer: false,
      },
    ],
  ];
  for (const [options, phase, failure, ready, schema, contractPresent, contractShape] of cases) {
    const scenario = runDriver(options);
    await assert.rejects(scenario.run());
    const saved = JSON.parse(JSON.stringify(scenario.report));
    retainRecordsFailure(saved);
    assert.equal(saved.card_diagnostic.phase, phase);
    assert.equal(saved.card_diagnostic.failure, failure);
    assert.equal(saved.card_diagnostic.card_ready, ready);
    assert.equal(saved.card_diagnostic.schema_ready, schema);
    assert.equal(saved.card_diagnostic.contract?.present ?? null, contractPresent);
    if (contractShape) {
      const { present, ...shape } = saved.card_diagnostic.contract;
      assert.equal(present, true);
      assert.deepEqual(shape, contractShape);
    }
    assert.equal(saved.failure_phase, phase);
    assert.equal(saved.failure_classification, failure);
    assert.equal(saved.completion_diagnostics.length, 0);
    assert.equal(scenario.runs, 0);
    assert.doesNotMatch(
      JSON.stringify(saved),
      /private contract error|admin-session|Bearer|appointments/,
    );
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

test('actual callback refuses malformed read inputs with their own field named', async () => {
  const base = [
    positive('appointments'),
    refusal,
    positive('invoices'),
    metadataResult(),
    negativeResult('query'),
    negativeResult('record_id'),
    negativeResult('table_id'),
  ];
  for (const [index, field, action] of [
    [4, 'query', 'metadata_search'],
    [5, 'record_id', 'record_read'],
    [6, 'table_id', 'record_aggregate'],
  ]) {
    for (const [bad, failure] of [
      [{ success: true, output: { action } }, /false_success/],
      [
        { success: false, error: { error_type: 'execution', message: `${field} invalid` } },
        /wrong_error_class/,
      ],
      [negativeResult('unrelated'), /field_missing/],
    ]) {
      const completions = [...base];
      completions[index] = bad;
      const scenario = runDriver({ completions });
      await assert.rejects(scenario.run(), failure);
      assert.equal(scenario.runs, index + 1);
      assert.equal(scenario.report.negative_reads.length, index - 4);
      assert.equal(scenario.active.size, 0);
    }
  }
});

test('negative read action or field missing from live card contract refuses before negative calls', async () => {
  const baseline = tableListSchema();
  for (const serverSchema of [
    {
      ...baseline,
      action: { enum: baseline.action.enum.filter((action) => action !== 'record_read') },
    },
    { ...baseline, $variants: { ...baseline.$variants, record_aggregate: {} } },
  ]) {
    const scenario = runDriver({ serverSchema });
    await assert.rejects(scenario.run(), /records_negative_read_contract_drift/);
    assert.equal(scenario.runs, 4);
    assert.deepEqual(scenario.report.negative_reads, []);
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

test('actual callback persists distinct safe failure phases after an authenticated HTTP 200', async () => {
  const cases = [
    [{ httpStatus: 422 }, 'request', 'http_rejected', null, 422],
    [{ responseMode: 'malformed' }, 'completion_parse', 'completion_parse_failed', null],
    [{ visibleMode: 'missing' }, 'visible_output_wait', 'visible_output_missing', false],
    [{ visibleMode: 'stale' }, 'visible_output_wait', 'visible_output_mismatch', true],
    [{ changedVisible: true }, 'visible_output_equality', 'visible_output_mismatch', true],
    [
      {
        completions: [
          { success: false, error: { error_type: 'execution', message: 'secret server detail' } },
        ],
      },
      'complete',
      'tool_refusal',
      true,
    ],
  ];
  for (const [options, phase, failure, visible, status = 200] of cases) {
    const scenario = runDriver(options);
    await assert.rejects(scenario.run());
    const saved = JSON.parse(JSON.stringify(scenario.report));
    assert.equal(saved.completion_diagnostics.length, 1);
    assert.deepEqual(
      {
        phase: saved.completion_diagnostics[0].phase,
        failure: saved.completion_diagnostics[0].failure,
        http_status: saved.completion_diagnostics[0].http_status,
        visible: saved.completion_diagnostics[0].visible?.visible ?? null,
      },
      { phase, failure, http_status: status, visible },
    );
    assert.doesNotMatch(
      JSON.stringify(saved),
      /secret server detail|appointments|stale|admin-session|Bearer/,
    );
    assert.equal(scenario.active.size, 0);
  }
});

test('successful callback retains all exact completion guards and safe shapes', async () => {
  const scenario = runDriver();
  await scenario.run();
  const saved = JSON.parse(JSON.stringify(scenario.report));
  assert.deepEqual(saved.card_diagnostic, {
    phase: 'complete',
    failure: null,
    card_ready: true,
    schema_ready: true,
    contract: {
      present: true,
      canonical_boolean: true,
      retired_field_present: false,
      action_available: true,
      limit_integer: true,
    },
  });
  assert.equal(saved.completion_diagnostics.length, 9);
  assert.deepEqual(
    saved.completion_diagnostics.map(({ failure }) => failure),
    [null, null, null, null, null, null, null, null, null],
  );
  assert.deepEqual(
    saved.completion_diagnostics.map(({ completion }) => completion?.action),
    ['table_list', null, 'table_list', 'metadata_search', null, null, null, null, null],
  );
  assert.equal(saved.completion_diagnostics[0].completion.tables_count, 1);
  assert.equal(saved.completion_diagnostics[3].completion.matches_count, 1);
});

test('positive Records reads reject a different owned value or aggregate count', async () => {
  for (const [index, replacement, error] of [
    [7, positiveRead('different-row'), /records_positive_read_wrong_value/],
    [8, positiveAggregate(2), /records_positive_aggregate_wrong_rows/],
  ]) {
    const completions = [
      positive('appointments'),
      refusal,
      positive('invoices'),
      metadataResult(),
      negativeResult('query'),
      negativeResult('record_id'),
      negativeResult('table_id'),
      positiveRead(),
      positiveAggregate(),
    ];
    completions[index] = replacement;
    const scenario = runDriver({ completions });
    await assert.rejects(scenario.run(), error);
    assert.equal(scenario.stages.includes('records_fixture_cleanup'), true);
    assert.equal(scenario.report.fixture_cleanup, null);
    assert.equal(scenario.active.size, 0);
  }
});
