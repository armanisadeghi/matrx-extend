import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { trustedD47PanelClick } from './showcase-d47-driver-evidence.mjs';
import {
  classifyPublicReplay,
  inspectPublicCaptureCandidates,
  publicTrustedClick,
  selectPublicCaptureResponse,
} from './showcase-d47-public-initial-load.mjs';

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

// Break guarded: selecting by shortened label loses a valid /queries endpoint.
test('public capture selects the unique full endpoint after a shortened label and records only redacted evidence', async () => {
  const window = new Window();
  const { document } = window;
  const longLabel = '200 POST uj5wyc0l7x-dsn.algolia.net…api-key=opaque';
  const otherLabel = '200 POST other.algolia.com/1/indexes/*/queries';
  document.body.innerHTML = `<div>${[longLabel, otherLabel]
    .map((label) => `<button class="font-mono"><span class="flex-1">${label}</span></button>`)
    .join(
      '',
    )}</div><div class="space-y-2"><div class="font-mono break-all"></div><div>POST · 200 hits</div><input id="network-replay-url-filter"></div><div>rows extracted</div>`;
  const rows = [...document.querySelectorAll('button.font-mono')];
  rows.forEach((element, index) => {
    element.getBoundingClientRect = () => ({
      left: 20 + index * 60,
      top: 30,
      width: 40,
      height: 20,
    });
    element.scrollIntoView = () => {};
    element.style.visibility = 'visible';
  });
  document.elementFromPoint = (x) => rows[x < 80 ? 0 : 1];
  const input = document.querySelector('#network-replay-url-filter');
  let otherUrl = 'https://other.algolia.com/1/indexes/*/queries';
  const panel = {
    async send(method, args) {
      if (method === 'Runtime.evaluate') return { result: { value: window.eval(args.expression) } };
      if (args.type === 'mouseReleased') {
        rows.forEach((row, index) =>
          row.classList.toggle('ring-1', index === (args.x < 80 ? 0 : 1)),
        );
        input.value =
          args.x < 80
            ? 'https://uj5wyc0l7x-dsn.algolia.net/1/indexes/*/queries?key=opaque'
            : otherUrl;
        document.querySelector('.break-all').textContent = input.value;
      }
      return {};
    },
  };
  try {
    const report = { stage: 'initial_capture', click_observations: [], capture_observations: {} };
    const candidates = await inspectPublicCaptureCandidates(panel, report);
    assert.equal(candidates.length, 2);
    // The old predicate excludes the intended truncated row and selects the unrelated one.
    assert.equal(
      candidates.filter((label) => label.includes('queries')).includes(longLabel),
      false,
    );
    assert.equal(report.capture_observations.list.exact_candidates, 1);
    const selected = await selectPublicCaptureResponse(panel, report);
    assert.equal(selected.query_endpoint, true);
    assert.equal(selected.target_host, true);
    assert.equal(selected.post_200, true);
    assert.equal(report.capture_observations.matched_previews, 1);
    assert.equal(input.value.startsWith('https://uj5wyc0l7x-dsn.algolia.net/'), true);
    assert.equal(JSON.stringify(report).includes('opaque'), false);
    assert.equal(JSON.stringify(report).includes('other.algolia.com'), false);

    // Execute the real driver with the legacy label gate planted in memory only.
    rows[1].remove();
    const legacyDriver = new Function(
      'inspectPublicCaptureCandidates',
      'publicTrustedClick',
      'readSelectedCapture',
      'assert',
      `return (${selectPublicCaptureResponse
        .toString()
        .replace(
          'const candidates = await inspectPublicCaptureCandidates(panel, report);',
          "const candidates = (await inspectPublicCaptureCandidates(panel, report)).filter(label => label.includes('queries'));",
        )})`,
    )(
      inspectPublicCaptureCandidates,
      publicTrustedClick,
      () => {
        throw new Error('legacy_unexpected_preview');
      },
      assert,
    );
    const legacy = { stage: 'initial_capture', click_observations: [], capture_observations: {} };
    await assert.rejects(() => legacyDriver(panel, legacy), /public_initial_post_ambiguous/);
    assert.equal(legacy.capture_observations.list.algolia_post_200_rows, 1);
    assert.equal(legacy.capture_observations.list.exact_candidates, 0);
    assert.equal(legacy.capture_observations.matched_previews, 0);
    const corrected = {
      stage: 'initial_capture',
      click_observations: [],
      capture_observations: {},
    };
    assert.equal((await selectPublicCaptureResponse(panel, corrected)).target_host, true);
    rows[0].parentElement.append(rows[1]);

    otherUrl = 'https://uj5wyc0l7x-1.algolianet.com/1/indexes/*/queries?key=second';
    rows[1].querySelector('span').textContent =
      '200 POST uj5wyc0l7x-1.algolianet.com/1/indexes/*/queries?key=second';
    const ambiguous = {
      stage: 'initial_capture',
      click_observations: [],
      capture_observations: {},
    };
    await assert.rejects(
      () => selectPublicCaptureResponse(panel, ambiguous),
      /public_initial_post_ambiguous/,
    );
    assert.equal(ambiguous.capture_observations.matched_previews, 2);
    assert.equal(JSON.stringify(ambiguous).includes('second'), false);

    rows[0].remove();
    otherUrl = 'https://hn.algolia.com/1/indexes/*/queries?key=unrelated';
    document.elementFromPoint = () => rows[1];
    const unrelated = {
      stage: 'initial_capture',
      click_observations: [],
      capture_observations: {},
    };
    await assert.rejects(
      () => selectPublicCaptureResponse(panel, unrelated),
      /public_initial_post_ambiguous/,
    );
    assert.equal(unrelated.capture_observations.matched_previews, 0);
    assert.equal(unrelated.capture_observations.previews[0].target_host, false);
    assert.equal(JSON.stringify(unrelated).includes('unrelated'), false);

    document.body.innerHTML = '<div class="space-y-2"><input id="network-replay-url-filter"></div>';
    const missing = { stage: 'initial_capture', click_observations: [], capture_observations: {} };
    await assert.rejects(
      () => selectPublicCaptureResponse(panel, missing),
      /public_initial_post_ambiguous/,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(missing.capture_observations.list)), {
      visible_rows: 0,
      post_200_rows: 0,
      algolia_rows: 0,
      algolia_post_200_rows: 0,
      query_label_rows: 0,
      exact_candidates: 0,
    });
  } finally {
    await window.happyDOM.close();
  }
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
