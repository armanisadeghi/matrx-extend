import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { waitForReplacementSettingsTab } from './settings-panel-driver.mjs';

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
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('async function settings(panel, onStep = () => {}) {');
  const end = source.indexOf('\nasync function reloadSettings(', start);
  assert.ok(start >= 0 && end > start, 'native Settings opening function must be present');
  const opening = source.slice(start, end);
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
    `${subject}; return settings;`,
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
