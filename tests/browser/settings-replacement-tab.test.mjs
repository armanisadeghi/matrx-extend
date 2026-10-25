import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import {
  click,
  tabTitlePredicateExpression,
  waitForReplacementSettingsTab,
} from './settings-panel-driver.mjs';

function panelWithTabStates(states) {
  let samples = 0;
  return {
    panel: {
      async send(method, { expression }) {
        assert.equal(method, 'Runtime.evaluate');
        const state = states[Math.min(samples++, states.length - 1)];
        const tabs = Array.from({ length: state.matched }, () => ({
          getBoundingClientRect: () => ({
            width: state.visible ? 28 : 0,
            height: state.visible ? 28 : 0,
          }),
          closest: () => null,
          getAttribute: (name) => (name === 'title' ? 'Settings' : null),
        }));
        return {
          result: {
            value: runInNewContext(expression, {
              document: { querySelectorAll: () => tabs },
              getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
            }),
          },
        };
      },
    },
    samples: () => samples,
  };
}

test('replacement Settings tab must appear and be uniquely visible before native click', async () => {
  const { panel, samples } = panelWithTabStates([
    { matched: 0, visible: false },
    { matched: 1, visible: false },
    { matched: 1, visible: true },
  ]);
  const result = await waitForReplacementSettingsTab(panel, 500);
  assert.equal(result.first.matched, 0);
  assert.equal(result.last.matched, 1);
  assert.equal(result.last.visible, 1);
  assert.equal(samples(), 3);
});

test('replacement Settings readiness rejects a tab that never renders', async () => {
  const { panel } = panelWithTabStates([{ matched: 0, visible: false }]);
  await assert.rejects(
    waitForReplacementSettingsTab(panel, 120),
    /replacement_settings_tab_ready_not_observed/,
  );
});

test('native guest Settings opening awaits replacement readiness before trusted click', async () => {
  const source = await readFile(new URL('./settings-panel-driver.mjs', import.meta.url), 'utf8');
  const start = source.indexOf(
    'export async function openGuestSettings(panel, onStep = () => {}) {',
  );
  const end = source.indexOf('\nexport async function openSection(', start);
  assert.ok(start >= 0 && end > start, 'shared native Settings opening function must be present');
  const opening = source.slice(start, end).replace('export async function', 'async function');
  const fullRunner = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  assert.match(
    fullRunner,
    /async function settings\(panel, onStep = \(\) => \{\}\) \{\s*await openGuestSettings\(panel, onStep\);/,
  );
  const readinessCall = '  await waitForReplacementSettingsTab(panel);';
  assert.ok(opening.includes(readinessCall), 'native Settings opening must await tab readiness');
  const subject =
    process.env.SETTINGS_NEGATIVE_CONTROL_BYPASS_READINESS === '1'
      ? opening.replace(readinessCall, '')
      : opening;
  const events = [];
  const settings = new Function(
    'waitForReplacementSettingsTab',
    'click',
    'waitFor',
    'evaluate',
    'tabTitlePredicateExpression',
    `${subject}; return openGuestSettings;`,
  )(
    async () => {
      events.push('tab_ready');
    },
    async () => {
      events.push('trusted_click');
    },
    async (_label, read, accept) => {
      const result = await read();
      assert.equal(accept(result), true);
      events.push('guest_observed');
    },
    async () => ({ active: true, guest: true }),
    tabTitlePredicateExpression,
  );
  await settings({}, (step) => events.push(step));
  assert.deepEqual(events, [
    'settings_tab_wait_started',
    'tab_ready',
    'before_click',
    'trusted_click',
    'click_returned',
    'guest_wait_started',
    'guest_observed',
  ]);
});

// A tooltip lift removes title from the real tab; fake selector replies cannot catch this.
for (const scenario of [
  { name: 'native label', attributes: 'title="Settings"', ready: true },
  { name: 'lifted label', attributes: 'data-matrx-title="Settings"', ready: true },
  { name: 'other label', attributes: 'data-matrx-title="Tools"', ready: false },
  { name: 'duplicate labels', attributes: 'title="Settings"', duplicate: true, ready: false },
  {
    name: 'inert lifted tab',
    attributes: 'data-matrx-title="Settings"',
    inert: true,
    ready: false,
  },
]) {
  test(`replacement Settings readiness with actual DOM: ${scenario.name}`, async () => {
    const window = new Window();
    try {
      window.document.body.innerHTML = `<div id="app"><div ${scenario.inert ? 'inert' : ''}>
        <button role="tab" ${scenario.attributes}></button>
        ${scenario.duplicate ? '<button role="tab" data-matrx-title="Settings"></button>' : ''}
      </div></div>`;
      for (const tab of window.document.querySelectorAll('button'))
        tab.getBoundingClientRect = () => ({ width: 28, height: 28 });
      const panel = {
        async send(method, { expression }) {
          assert.equal(method, 'Runtime.evaluate');
          return { result: { value: window.eval(expression) } };
        },
      };
      if (scenario.ready) {
        const receipt = await waitForReplacementSettingsTab(panel, 120);
        assert.deepEqual([receipt.last.matched, receipt.last.visible], [1, 1]);
      } else {
        await assert.rejects(waitForReplacementSettingsTab(panel, 120), (error) => {
          assert.equal(error.readinessDiagnostic.stage, 'tab_not_ready');
          assert.equal(
            error.readinessDiagnostic.last.matched,
            scenario.duplicate ? 2 : scenario.name === 'other label' ? 0 : 1,
          );
          return true;
        });
      }
    } finally {
      await window.happyDOM.abort();
    }
  });
}

// Drive the real pointer sample against DOM with a lifted Tools owner. The
// occluder must be attributed to the page-side title variable, not a literal.
test('lifted tab pointer occluder names its owning pane', async () => {
  const window = new Window();
  try {
    window.document.body.innerHTML = `<div id="app">
      <button role="tab" data-matrx-title="Settings" aria-controls="settings-pane"></button>
      <div id="settings-pane" role="tabpanel"></div>
      <button role="tab" data-matrx-title="Tools" aria-controls="tools-pane"></button>
      <div id="tools-pane" role="tabpanel"><div id="occluder"></div></div>
    </div>`;
    const rect = {
      x: 10,
      y: 10,
      left: 10,
      top: 10,
      right: 110,
      bottom: 40,
      width: 100,
      height: 30,
    };
    window.HTMLElement.prototype.getBoundingClientRect = () => rect;
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLElement.prototype.getAnimations = () => [];
    window.document.elementFromPoint = () => window.document.getElementById('occluder');
    let sample;
    const panel = {
      async send(method, { expression }) {
        assert.equal(method, 'Runtime.evaluate');
        sample = window.eval(expression);
        throw new Error('sample captured before any pointer dispatch');
      },
    };
    await assert.rejects(click(panel, 'title', 'Settings'), /pointer_initial_evaluation_failed/);
    assert.equal(sample.sampleFailed, undefined);
    assert.equal(sample.matchedCount, 1);
    assert.equal(sample.pointerDiagnostic.center_occluder.owning_panel, 'tools');
  } finally {
    await window.happyDOM.abort();
  }
});
