import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { waitForReplacementScrapeTab } from './scrape-replacement-tab.mjs';

function panelWithTabStates(states) {
  let sample = 0;
  const panel = {
    async send(method, { expression }) {
      assert.equal(method, 'Runtime.evaluate');
      const state = states[Math.min(sample++, states.length - 1)];
      const count = typeof state === 'number' ? state : state.count;
      const shown = typeof state === 'number' || state.visible;
      const tabs = Array.from({ length: count }, () => ({
        getBoundingClientRect: () => ({ width: shown ? 28 : 0, height: shown ? 28 : 0 }),
        closest: () => null,
      }));
      const value = runInNewContext(expression, {
        document: { querySelectorAll: () => tabs },
        getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
      });
      return { result: { value } };
    },
  };
  return { panel, samples: () => sample };
}

test('replacement Scrape readiness waits for the tab after a live panel context initially has no tab', async () => {
  const { panel, samples } = panelWithTabStates([0, 1]);
  const result = await waitForReplacementScrapeTab(panel);
  assert.equal(result.first.matched, 0);
  assert.equal(result.last.matched, 1);
  assert.equal(result.last.visible, 1);
  assert.equal(result.attempts, 2);
  assert.equal(samples(), 2);
});

test('replacement Scrape readiness requires a unique visible tab', async () => {
  const { panel, samples } = panelWithTabStates([2, 1]);
  const result = await waitForReplacementScrapeTab(panel);
  assert.equal(result.first.matched, 2);
  assert.equal(result.last.matched, 1);
  assert.equal(result.last.visible, 1);
  assert.equal(result.attempts, 2);
  assert.equal(samples(), 2);
});

test('replacement Scrape readiness waits until the sole tab is visible', async () => {
  const { panel, samples } = panelWithTabStates([{ count: 1, visible: false }, 1]);
  const result = await waitForReplacementScrapeTab(panel);
  assert.equal(result.first.visible, 0);
  assert.equal(result.last.visible, 1);
  assert.equal(samples(), 2);
});

test('replacement Scrape readiness refuses a panel that never renders the tab', async () => {
  const { panel } = panelWithTabStates([0]);
  await assert.rejects(
    waitForReplacementScrapeTab(panel, 120),
    /replacement_scrape_tab_ready_not_observed/,
  );
});
