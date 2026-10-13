import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  approvedOrganizationSelectionMatches,
  approvedOrganizationStateExpression,
} from './screenshot-organization-selection.mjs';

// Guards the real driver observation seam: requiring a device write rejects a
// valid ladder selection, while text alone admits a wrong effective selection.
async function observe({
  displayed = 'approved',
  checked = 'approved',
  stored,
  duplicate = false,
  identity = 'approved-id',
} = {}) {
  const window = new Window();
  window.document.body.innerHTML = `<div><span>Acting as</span><div><button role="combobox">${displayed}</button></div></div>
    <div role="option" data-value="${identity}" data-state="${checked === 'approved' ? 'checked' : 'unchecked'}">approved</div>
    <div role="option" data-state="${checked === 'other' ? 'checked' : 'unchecked'}">other</div>
    ${duplicate ? '<div role="option" data-state="checked">approved</div>' : ''}`;
  window.chrome = { storage: { local: { get: async () => ({ 'matrx.org.active': stored }) } } };
  try {
    return await window.eval(approvedOrganizationStateExpression('approved'));
  } finally {
    await window.happyDOM.close();
  }
}

test('accepts an already effective ladder organization without a device preference', async () => {
  assert.equal(approvedOrganizationSelectionMatches(await observe(), true), true);
});

test('accepts a changed effective organization only after the device choice persists', async () => {
  assert.equal(approvedOrganizationSelectionMatches(await observe(), false), false);
  assert.equal(
    approvedOrganizationSelectionMatches(
      await observe({ stored: { id: 'approved-id', name: 'approved' } }),
      false,
    ),
    true,
  );
});

test('refuses wrong or missing effective organization even with matching display and storage', async () => {
  for (const checked of ['other', 'none']) {
    const state = await observe({ checked, stored: { id: 'approved-id', name: 'approved' } });
    assert.equal(approvedOrganizationSelectionMatches(state, true), false);
  }
});

test('refuses contradictory storage, malformed storage, duplicate options and wrong display', async () => {
  for (const input of [
    { stored: { id: 'other-id', name: 'other' } },
    { stored: { id: 'other-id', name: 'approved' } },
    { identity: '' },
    { stored: { id: '', name: 'approved' } },
    { stored: {} },
    { duplicate: true },
    { displayed: 'other' },
  ])
    assert.equal(approvedOrganizationSelectionMatches(await observe(input), true), false);
});
