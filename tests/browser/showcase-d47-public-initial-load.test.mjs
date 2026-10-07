import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { trustedD47PanelClick } from './showcase-d47-driver-evidence.mjs';
import { classifyPublicReplay, publicTrustedClick } from './showcase-d47-public-initial-load.mjs';

const captured = {
  exact_row: true,
  running: false,
  unavailable: false,
  last_run_exact: true,
  hits_rows: true,
  no_match_guidance: false,
  error: false,
};
const guidance = {
  exact_row: true,
  running: false,
  unavailable: false,
  last_run_exact: false,
  hits_rows: false,
  no_match_guidance: true,
  error: true,
};
const verdicts = (classify) => [
  classify(captured),
  classify(guidance),
  classify({ ...captured, exact_row: false }),
  classify({ ...captured, running: true }),
  classify({ ...captured, hits_rows: false }),
  classify({ ...captured, error: true }),
  classify({ ...guidance, no_match_guidance: false }),
  classify({ ...guidance, hits_rows: true }),
];
const expected = [
  'captured_initial_request',
  'honest_retrigger_guidance',
  'unverified',
  'unverified',
  'unverified',
  'unverified',
  'unverified',
  'unverified',
];

test('public saved replay requires exact terminal rows or exact no-match remedy', () => {
  assert.deepEqual(verdicts(classifyPublicReplay), expected);
});

test('constant success and permissive guidance mutants are rejected by the oracle cases', () => {
  assert.notDeepEqual(
    verdicts(() => 'captured_initial_request'),
    expected,
  );
  const permissive = (state) =>
    state.error ? 'honest_retrigger_guidance' : 'captured_initial_request';
  assert.notDeepEqual(verdicts(permissive), expected);
});

// Real use case: a saved HN Search Network recipe is selected and rerun through
// the public driver's trusted panel path. CDP transport is the only stand-in.
test('public driver records each trusted click boundary before dispatching the selected control', async () => {
  const window = new Window();
  const { document } = window;
  document.body.innerHTML = `<div role="tablist"><button role="tab">Network</button><button role="tab" data-state="active" aria-controls="patterns-pane">Patterns</button></div><div id="patterns-pane" data-state="active">All saved patterns for hn.algolia.com, across every mode.<div class="group"><span class="truncate text-sm font-medium">HN Search recipe</span><button title="Run pattern"><svg></svg></button></div></div>`;
  const network = document.querySelector('[role="tab"]');
  const run = document.querySelector('button[title="Run pattern"]');
  for (const element of [network, run]) {
    element.getBoundingClientRect = () => ({ left: 20, top: 30, width: 40, height: 20 });
    element.scrollIntoView = () => {};
    element.style.visibility = 'visible';
  }
  let hit = network;
  document.elementFromPoint = () => hit;
  const inputs = [];
  const panel = {
    async send(method, args) {
      if (method === 'Runtime.evaluate') return { result: { value: window.eval(args.expression) } };
      inputs.push({ type: args.type, x: args.x, y: args.y });
      return {};
    },
  };
  const report = { stage: 'initial_capture', click_observations: [] };
  const networkTarget = { selector: '[role="tablist"] [role="tab"]', text: 'Network' };
  try {
    // The prior public driver call shape fails before the first CDP input.
    await assert.rejects(
      () => trustedD47PanelClick(panel, networkTarget, undefined, 0),
      /panel_target_ready_not_observed/,
    );
    assert.deepEqual(inputs, []);
    await publicTrustedClick(panel, networkTarget, report);
    hit = run.querySelector('svg');
    report.stage = 'saved_replay';
    await publicTrustedClick(
      panel,
      {
        selector: 'button[title], button[data-matrx-title]',
        patternName: 'HN Search recipe',
        expectedHost: 'hn.algolia.com',
        semanticTitle: 'Run pattern',
      },
      report,
    );
    assert.deepEqual(
      inputs,
      ['mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased'].map((type) => ({
        type,
        x: 40,
        y: 40,
      })),
    );
    assert.deepEqual(
      report.click_observations.map(({ stage, phase }) => [stage, phase]),
      ['initial_capture', 'saved_replay'].flatMap((stage) =>
        [
          'target_evaluation',
          'target_resolution',
          'mouse_press',
          'mouse_release',
          'mouse_released',
        ].map((phase) => [stage, phase]),
      ),
    );
    assert.equal(report.click_observations[6].state.exact_row_count, 1);
    assert.equal(report.click_observations[6].state.host_matches, true);
    assert.equal(JSON.stringify(report.click_observations).includes('HN Search recipe'), false);
  } finally {
    await window.happyDOM.close();
  }
});
