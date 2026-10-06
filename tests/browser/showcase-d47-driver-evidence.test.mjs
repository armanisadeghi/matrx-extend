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
