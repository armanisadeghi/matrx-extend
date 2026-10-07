import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assessD47Trace,
  cleanupD47Probe,
  discoveryTerminal,
  sanitizeD47Failure,
} from './showcase-d47-driver-evidence.mjs';

const origin = 'http://127.0.0.1:4179';
const oldPageContext = { unique_id: 'old-unique', frame_id: 'main' };
const expectedBodySha256 = 'a'.repeat(64);
const options = { origin, oldPageContext, expectedBodySha256 };
const trace = (terminal = 'context_destroyed', commitOrder = 5) => [
  {
    order: 1,
    kind: 'context_created',
    tab_id: 7,
    id: 9,
    unique_id: 'old-unique',
    frame_id: 'main',
  },
  terminal === 'context_destroyed'
    ? { order: 2, kind: 'context_destroyed', tab_id: 7, id: 9 }
    : { order: 2, kind: 'contexts_cleared', tab_id: 7 },
  {
    order: 3,
    kind: 'context_created',
    tab_id: 7,
    id: 10,
    unique_id: 'new-unique',
    frame_id: 'main',
  },
  {
    order: 4,
    kind: 'binding',
    tab_id: 7,
    context_id: 10,
    binding_name: '__matrx_capture_1',
    handshake: true,
  },
  {
    order: commitOrder,
    kind: 'frame_navigated',
    tab_id: 7,
    frame_id: 'main',
    current_fixture: true,
  },
  {
    order: 6,
    kind: 'binding',
    tab_id: 7,
    context_id: 10,
    binding_name: '__matrx_capture_1',
    target_packet: true,
    current_payload: true,
    old_payload: false,
    url: `${origin}/api/document-race`,
    method: 'GET',
    source: 'fetch',
    request_body_key: 'none',
    status: 200,
    body_sha256: expectedBodySha256,
    request_sequence: 1,
  },
];

test('seed discovery only ends after capture window reaches terminal UI', () => {
  assert.equal(discoveryTerminal({ discovering: true, responses: false, error: false }), false);
  assert.equal(discoveryTerminal({ discovering: false, responses: true, error: false }), true);
  assert.equal(discoveryTerminal({ discovering: false, responses: false, error: false }), false);
  assert.equal(discoveryTerminal({ discovering: false, responses: true, error: true }), false);
});

test('current request provenance accepts both Chrome event orderings and context teardown forms', () => {
  assert.equal(assessD47Trace(trace(), options).ok, true);
  assert.equal(assessD47Trace(trace('contexts_cleared', 7), options).ok, true);
  assert.equal(assessD47Trace(trace(), options).current_packet_before_commit, false);
  assert.equal(
    assessD47Trace(trace('context_destroyed', 7), options).current_packet_before_commit,
    true,
  );
});

test('trace refuses swapped request identity, old payload and absent positive control', () => {
  for (const [change, reason] of [
    [
      (events) => {
        events[5].method = 'POST';
      },
      'current_request_identity_mismatch',
    ],
    [
      (events) => {
        events[5].request_body_key = 'sha256:other';
      },
      'current_request_identity_mismatch',
    ],
    [
      (events) => {
        events[5].body_sha256 = 'b'.repeat(64);
      },
      'current_request_identity_mismatch',
    ],
    [
      (events) => {
        events[5].source = 'xhr';
      },
      'current_request_identity_mismatch',
    ],
    [
      (events) => {
        events[5].old_payload = true;
      },
      'old_binding_payload_observed',
    ],
    [
      (events) => {
        events.splice(3, 1);
      },
      'current_binding_handshake_missing',
    ],
    [
      (events) => {
        events.splice(1, 1);
      },
      'old_context_terminal_missing',
    ],
    [
      (events) => {
        events[5].context_id = 9;
      },
      'current_context_identity_missing',
    ],
  ]) {
    const events = trace();
    change(events);
    assert.equal(assessD47Trace(events, options).reason, reason);
  }
});

test('probe cleanup removes listener and detaches even after removal fails', async () => {
  const calls = [];
  const worker = {
    detach: async () => {
      calls.push('detach');
    },
  };
  assert.deepEqual(
    await cleanupD47Probe(worker, true, async () => {
      calls.push('remove');
      throw new Error('remove_failed');
    }),
    ['remove_failed'],
  );
  assert.deepEqual(calls, ['remove', 'detach']);
  calls.length = 0;
  assert.equal(
    await cleanupD47Probe(worker, false, async () => {
      calls.push('remove');
    }),
    null,
  );
  assert.deepEqual(calls, ['detach']);
});

test('failure receipt retains safe class and stage but strips raw error text', () => {
  assert.deepEqual(
    sanitizeD47Failure(
      new Error('seed_discovery_terminal_not_observed:{"password":"secret"}'),
      'capture_seed',
    ),
    { name: 'Error', stage: 'capture_seed', message_code: 'seed_discovery_terminal_not_observed' },
  );
  assert.equal(
    sanitizeD47Failure(new Error('https://host/?token=secret'), 'native').message_code,
    'unclassified_error',
  );
});

// Real use case: the controlled concert listing's saved Network recipe is
// temporarily absent/disabled after document reload. DOM/layout and CDP are
// external; selector resolution, classification and dispatch ordering stay real.
async function targetHarness({ state = 'ready', fail = null, mutate = null } = {}) {
  const { Window } = await import('happy-dom');
  const { trustedD47PanelClick } = await import('./showcase-d47-driver-evidence.mjs');
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `<div role="tablist"><button role="tab" data-state="active" aria-controls="patterns-pane">Patterns</button></div><div id="patterns-pane" data-state="active">All saved patterns for 127.0.0.1:4179, across every mode.<div class="group"><span class="truncate text-sm font-medium">Concert listing</span><button title="Run pattern" style="visibility:visible"><svg></svg></button></div></div>`;
  const button = document.querySelector('button[title]');
  button.getBoundingClientRect = () => ({
    left: 20,
    top: 30,
    width: state === 'hidden' ? 0 : 40,
    height: 20,
  });
  button.scrollIntoView = () => {};
  document.elementFromPoint = () =>
    state === 'occluded' ? document.body : button.querySelector('svg');
  if (['disabled', 'becomes-ready', 'stored-disabled'].includes(state)) button.disabled = true;
  if (state === 'wrong-host')
    document.getElementById('patterns-pane').firstChild.textContent =
      'All saved patterns for another-host';
  if (state === 'inactive')
    document.getElementById('patterns-pane').setAttribute('data-state', 'inactive');
  if (state.startsWith('stored-')) {
    button.setAttribute('data-matrx-title', button.title);
    button.removeAttribute('title');
  }
  if (state === 'stored-wrong') button.setAttribute('data-matrx-title', 'Rename');
  if (state === 'stored-native-mismatch') button.setAttribute('title', 'Rename');
  if (state === 'stored-native-empty') button.setAttribute('title', '');
  if (state === 'native-precedence') button.setAttribute('data-matrx-title', 'Rename');
  if (state === 'missing') button.remove();
  if (state === 'duplicate' || state === 'stored-duplicate') {
    const clone = button.cloneNode(true);
    clone.getBoundingClientRect = button.getBoundingClientRect;
    button.after(clone);
  }
  if (state === 'wrong-recipe')
    document.querySelector('span').textContent = 'Another concert listing';
  const records = [];
  const inputs = [];
  let error;
  let samples = 0;
  try {
    await trustedD47PanelClick(
      {
        async send(method, args) {
          if (method === 'Runtime.evaluate') {
            samples++;
            if (state === 'becomes-ready' && samples === 2) button.disabled = false;
            if (fail === 'evaluate') throw new Error('private transport detail');
            let expression = args.expression;
            if (mutate) expression = mutate(expression);
            return { result: { value: window.eval(expression) } };
          }
          inputs.push(args.type);
          if (fail === args.type) throw new Error('private transport detail');
          return {};
        },
      },
      {
        selector: 'button[title], button[data-matrx-title]',
        semanticTitle: 'Run pattern',
        patternName: 'Concert listing',
        expectedHost: '127.0.0.1:4179',
      },
      (record) => records.push(record),
      state === 'becomes-ready' ? 1000 : 0,
    );
  } catch (caught) {
    error = caught;
  } finally {
    await window.happyDOM.close();
  }
  return { records, inputs, error };
}

async function assertTargetCases(mutate = null) {
  for (const [state, counts] of [
    ['ready', [1, 1, 1, 1, 1, 0]],
    ['disabled', [1, 1, 1, 0, 1, 0]],
    ['hidden', [1, 1, 0, 0, 1, 0]],
    ['stored-title', [1, 1, 1, 1, 1, 1]],
    ['stored-disabled', [1, 1, 1, 0, 1, 1]],
    ['stored-duplicate', [2, 2, 2, 2, 1, 2]],
    ['stored-wrong', [1, 0, 0, 0, 1, 0]],
    ['stored-native-mismatch', [1, 0, 0, 0, 1, 1]],
    ['stored-native-empty', [1, 0, 0, 0, 1, 1]],
    ['native-precedence', [1, 1, 1, 1, 1, 0]],
    ['missing', [0, 0, 0, 0, 1, 0]],
    ['duplicate', [2, 2, 2, 2, 1, 0]],
    ['wrong-recipe', [1, 0, 0, 0, 0, 0]],
  ]) {
    const result = await targetHarness({ state, mutate });
    const last = result.records.at(-1);
    const value = last.state;
    assert.deepEqual(
      [
        value?.selector_count,
        value?.exact_match_count,
        value?.visible_count,
        value?.enabled_count,
        value?.exact_row_count,
        value?.row_stored_title_count,
      ],
      counts,
      `target classification: ${state}`,
    );
    assert.deepEqual(
      result.inputs,
      ['ready', 'stored-title', 'native-precedence'].includes(state)
        ? ['mousePressed', 'mouseReleased']
        : [],
      `trusted dispatch: ${state}`,
    );
    if (['ready', 'stored-title', 'native-precedence'].includes(state))
      assert.equal(result.error, undefined);
    else assert.match(result.error.message, /^panel_target_ready_not_observed:/);
    assert.equal(JSON.stringify(result.records).includes('Concert listing'), false);
  }
}

test('live target receipt distinguishes absent, hidden, disabled, duplicate and renamed controls before teardown', async () => {
  await assertTargetCases();
});

test('live target receipt preserves the exact failed transport boundary without private messages', async () => {
  for (const [fail, phase, message] of [
    ['evaluate', 'target_evaluation', 'panel_target_evaluation_failed'],
    ['mousePressed', 'mouse_press', 'panel_mouse_press_failed'],
    ['mouseReleased', 'mouse_release', 'panel_mouse_release_failed'],
  ]) {
    const result = await targetHarness({ fail });
    assert.equal(result.records.at(-1).phase, phase);
    assert.equal(result.error.message, message);
    assert.equal(sanitizeD47Failure(result.error, 'saved_replay').message_code, message);
    assert.equal(JSON.stringify(result.records).includes('private'), false);
  }
});

test('target guard kills constant-success and skipped-disabled classification in memory', async () => {
  await assert.rejects(
    () =>
      assertTargetCases(
        () =>
          `({diagnostic: {selector_count:1,exact_match_count:1,visible_count:1,enabled_count:1,exact_row_count:1,row_stored_title_count:0},point:{x:40,y:40}})`,
      ),
    /target classification: disabled/,
  );
  await assert.rejects(
    () =>
      assertTargetCases((source) =>
        source.replace('visible.filter((el) => !el.disabled)', 'visible'),
      ),
    /target classification: disabled/,
  );
});

test('Run waits for fresh exact host and enabled row without dispatching to a stale or unrelated page', async () => {
  const ready = await targetHarness({ state: 'becomes-ready' });
  assert.equal(ready.error, undefined);
  assert.deepEqual(
    ready.records.filter((r) => r.phase === 'target_resolution').map((r) => r.state.enabled_count),
    [0, 1],
  );
  assert.deepEqual(ready.inputs, ['mousePressed', 'mouseReleased']);
  for (const state of ['wrong-host', 'inactive', 'occluded']) {
    const refused = await targetHarness({ state });
    assert.deepEqual(refused.inputs, []);
    assert.match(refused.error.message, /^panel_target_ready_not_observed:/);
    if (state === 'occluded') assert.equal(refused.records.at(-1).state.center_hits_target, false);
    else assert.equal(refused.records.at(-1).state.host_matches, false);
  }
});

test('semantic title guard kills title-only lookup and reversed native-title precedence in memory', async () => {
  await assert.rejects(
    () =>
      assertTargetCases((source) =>
        source.replace(
          "el.getAttribute('title') ?? el.getAttribute('data-matrx-title')",
          "el.getAttribute('title')",
        ),
      ),
    /target classification: stored-title/,
  );
  await assert.rejects(
    () =>
      assertTargetCases((source) =>
        source.replace(
          "el.getAttribute('title') ?? el.getAttribute('data-matrx-title')",
          "el.getAttribute('data-matrx-title') ?? el.getAttribute('title')",
        ),
      ),
    /target classification: stored-native-mismatch/,
  );
});

// Concert listing: drive the real capture runner's timer and cleanup promise,
// then observe its result with the real terminal waiter. Only clock, CDP/core,
// and DOM are external doubles; no body/result is supplied by the waiter.
async function terminalTimeHarness({
  legacy = false,
  windowMs = null,
  wrongRecipe = false,
  waiter = null,
} = {}) {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const ts = (await import('typescript')).default;
  const { deriveD47TerminalBudget, terminalBudgetPaths, waitD47SavedTerminal } = await import(
    './showcase-d47-terminal-budget.mjs'
  );
  const sources = Object.fromEntries(
    await Promise.all(
      Object.entries(terminalBudgetPaths).map(async ([key, path]) => [
        key,
        await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'),
      ]),
    ),
  );
  if (windowMs !== null)
    sources.runner = sources.runner.replace(
      'opts.timeoutMs ?? 20_000',
      `opts.timeoutMs ?? ${windowMs}`,
    );
  const budget = deriveD47TerminalBudget(sources);
  const ast = ts.createSourceFile('runner.ts', sources.runner, ts.ScriptTarget.Latest, true);
  const runner = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'runNetworkCapturePattern',
  );
  const js = ts.transpile(runner.getText(ast).replace('export ', ''), {
    target: ts.ScriptTarget.ES2022,
  });
  let clock = 0;
  let nextId = 0;
  const timers = new Map();
  let rows = null;
  let productError = null;
  const setTimeout = (fn, delay) => {
    const id = ++nextId;
    timers.set(id, { at: clock + delay, fn });
    return id;
  };
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const advance = async (ms) => {
    const end = clock + ms;
    for (;;) {
      const next = [...timers.entries()]
        .filter(([, task]) => task.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      clock = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    clock = end;
    await flush();
  };
  const sandbox = {
    setTimeout,
    clearTimeout: (id) => timers.delete(id),
    crypto: { randomUUID: () => 'concert-capture' },
    AbortController,
    matchesUrlFilter: (url, filter) => url === filter,
    sanitizeNetworkUrl: (url) => url,
    transientCredentialFingerprint: () => '',
    rowsFromBody: (body) => JSON.parse(body).events,
    NetworkNoMatchError: Error,
    openDocumentNetworkCapture: async (options) => {
      options.onArmed();
      options.onEvent({
        capture_id: options.captureId,
        document_key: 'current-document',
        tab_id: 7,
        url: `${origin}/api/document-race`,
        method: 'GET',
        status: 200,
        request_body_key: 'none',
        request_sequence: 1,
        body: JSON.stringify({ events: [{ eventName: 'Canyon Frequency' }] }),
      });
      return {
        close: () =>
          new Promise((resolve) =>
            setTimeout(() => resolve('current-document'), budget.cleanup_ms - 1),
          ),
      };
    },
  };
  const run = runInNewContext(`${js};runNetworkCapturePattern`, sandbox);
  run({ url_filter: `${origin}/api/document-race`, body_match: 'ignore' }, 7, {
    initiation: 'user',
  }).then(
    (value) => {
      rows = value;
    },
    (error) => {
      productError = error;
    },
  );
  await flush();
  const samples = [];
  const chosenBudget = legacy ? { ...budget, timeout_ms: budget.delivery_ms } : budget;
  let error;
  try {
    await (waiter ?? waitD47SavedTerminal)({
      budget: chosenBudget,
      now: () => clock,
      sleep: advance,
      read: async () => ({
        exact_recipe: rows !== null && !wrongRecipe,
        current_row: rows?.[0]?.eventName === 'Canyon Frequency',
        old_row: false,
        running: rows === null,
        error_present: productError !== null,
        observation_unavailable: false,
        header_status: rows === null ? 'absent' : wrongRecipe ? 'mismatch' : 'exact',
        preview_status: rows === null ? 'absent' : 'current_only',
        private_text: 'must not enter evidence',
      }),
      record: (sample) => samples.push(sample),
    });
  } catch (caught) {
    error = caught;
  }
  assert.equal(productError, null);
  return { error, clock, rows, samples, budget };
}

test('old default deadline is RED before actual capture timer and cleanup; derived deadline observes the actual result', async () => {
  const red = await terminalTimeHarness({ legacy: true });
  assert.match(red.error.message, /saved_current_result_not_observed/);
  assert.equal(red.rows, null);
  assert.ok(red.clock < red.budget.capture_window_ms);
  const green = await terminalTimeHarness();
  assert.equal(green.error, undefined);
  assert.equal(green.rows[0].eventName, 'Canyon Frequency');
  assert.ok(green.clock >= green.budget.capture_window_ms + green.budget.cleanup_ms - 1);
  assert.equal(green.samples.at(-1).exact_recipe, true);
  assert.ok(
    green.samples.every((sample, i) => !i || sample.elapsed_ms >= green.samples[i - 1].elapsed_ms),
  );
  assert.equal(JSON.stringify(green.samples).includes('must not enter evidence'), false);
});

test('derived wait follows changed actual capture configuration and refuses a different recipe', async () => {
  const changed = await terminalTimeHarness({ windowMs: 35000 });
  assert.equal(changed.error, undefined);
  assert.equal(changed.budget.capture_window_ms, 35000);
  assert.ok(changed.clock >= 69999);
  const wrong = await terminalTimeHarness({ wrongRecipe: true });
  assert.match(wrong.error.message, /saved_current_result_not_observed/);
  assert.equal(wrong.rows[0].eventName, 'Canyon Frequency');
  assert.equal(wrong.clock, wrong.budget.timeout_ms);
});

test('terminal wait guard detects constant success without observing the operation', async () => {
  const assertCompleted = async (waiter) => {
    const result = await terminalTimeHarness({ waiter });
    assert.equal(result.error, undefined);
    assert.equal(
      result.rows?.[0]?.eventName,
      'Canyon Frequency',
      'waiter_returned_before_operation',
    );
  };
  await assertCompleted();
  await assert.rejects(
    () => assertCompleted(async () => ({ exact_recipe: true, current_row: true })),
    /waiter_returned_before_operation/,
  );
});

test('budget derivation refuses unobservable caller settings instead of assuming the default', async () => {
  const { readFile } = await import('node:fs/promises');
  const { deriveD47TerminalBudget, terminalBudgetPaths } = await import(
    './showcase-d47-terminal-budget.mjs'
  );
  const sources = Object.fromEntries(
    await Promise.all(
      Object.entries(terminalBudgetPaths).map(async ([key, path]) => [
        key,
        await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'),
      ]),
    ),
  );
  for (const setting of ['timeoutMs: 45000,', '...savedSettings,']) {
    const handler = sources.handler.replace(
      'runSavedPattern(pattern, tabId, {',
      'runSavedPattern(pattern, tabId, {' + setting,
    );
    assert.throws(
      () => deriveD47TerminalBudget({ ...sources, handler }),
      /terminal_budget_override_unavailable/,
    );
  }
});
