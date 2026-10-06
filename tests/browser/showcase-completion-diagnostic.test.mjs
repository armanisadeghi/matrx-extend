import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  listStateExpression,
  runShowcaseCompletionBoundary,
} from './showcase-completion-diagnostic.mjs';

// ListPatternTab renders the selected-field heading with text-transform: uppercase.
// The expression must accept that actual innerText while rejecting other field counts.
function panelState(text, disabled = false) {
  const extract = { textContent: 'Extract', disabled };
  const tab = {
    textContent: 'List Pattern',
    getAttribute: (key) => (key === 'data-state' ? 'active' : 'list'),
  };
  const content = {
    innerText: text,
    getAttribute: () => 'active',
    querySelectorAll: () => [extract],
  };
  const document = {
    querySelectorAll: () => [{ getAttribute: () => 'showcase' }],
    getElementById: (id) => (id === 'showcase' ? { querySelectorAll: () => [tab] } : content),
  };
  return runInNewContext(listStateExpression(), { document });
}

test('builder readiness accepts the rendered uppercase single field, rejects eleven and zero', () => {
  assert.equal(panelState('1 SELECTED FIELD').selectedField, true);
  assert.equal(panelState('root: #events\n  1 SELECTED FIELD  \nNeon Nights').selectedField, true);
  assert.equal(panelState('11 selected fields').selectedField, false);
  assert.equal(panelState('0 selected fields').selectedField, false);
  assert.equal(panelState('1 selected field').selectedField, true);
  assert.equal(panelState('1 SELECTED FIELD', true).extract, false);
});

test('completion retains the failing operation and post-failure facts before rethrowing', async () => {
  const diagnostic = { boundaries: [] };
  let attached = true;
  const failure = new Error('private diagnostic content');
  const options = {
    diagnostic,
    name: 'done_B_click',
    page: { evaluate: async () => ({ attached }) },
    readPanel: async () => ({ extract: !attached, private: 'private diagnostic content' }),
    readRelays: async () => [],
    action: async () => {
      attached = false;
      throw failure;
    },
  };
  await assert.rejects(runShowcaseCompletionBoundary(options), (error) => error === failure);
  assert.equal(diagnostic.boundaries[0].status, 'failed');
  assert.equal(diagnostic.boundaries[0].before.overlay.attached, true);
  assert.equal(diagnostic.boundaries[0].after.overlay.attached, false);
  assert.equal(diagnostic.boundaries[0].after.panel.extract, true);
  assert.equal(JSON.stringify(diagnostic).includes('private diagnostic content'), false);
  assert.equal(
    await runShowcaseCompletionBoundary({
      ...options,
      name: 'extract_B_rows',
      action: async () => 3,
    }),
    3,
  );
  assert.equal(diagnostic.boundaries[1].status, 'passed');
});

test('extraction requires exactly three rendered rows despite uppercase heading', () => {
  assert.equal(panelState('3 ROWS').rowCount, true);
  assert.equal(panelState('13 rows').rowCount, false);
  assert.equal(panelState('0 rows').rowCount, false);
  assert.equal(panelState('3 rows').rowCount, true);
});
