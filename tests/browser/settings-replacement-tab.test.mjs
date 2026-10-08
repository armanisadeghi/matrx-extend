import assert from 'node:assert/strict';
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
