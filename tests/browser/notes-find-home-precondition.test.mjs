import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectNotesFindHomePrecondition } from './notes-find-home-precondition.mjs';

const selectedOrg = '4b190b81-7ea2-40e1-8d6d-87fa4b520dfc';
const otherOrg = '6a70d8c9-d151-4ae0-8417-cc21bc20b928';
const generalId = 'b47fc412-46fb-43e5-a496-8ff73d85cc80';
const typeId = '52c40999-6f82-4c96-bfa7-f7b462316d77';
const unrelatedId = 'd2cb8a01-ae9a-4df5-a06e-8ba430850e89';

function homes(scopeId) {
  return [
    { organization_id: otherOrg, is_general: true, scope_id: unrelatedId },
    { organization_id: selectedOrg, is_general: false, scope_id: unrelatedId },
    { organization_id: selectedOrg, is_general: true, scope_id: scopeId },
  ];
}
function tree(name = 'General') {
  return {
    scopes: [{ id: generalId, organization_id: selectedOrg, name, scope_type_id: typeId }],
    types: [{ id: typeId, organization_id: selectedOrg }],
  };
}
function inspect(value, canonical = homes(generalId)) {
  const result = inspectNotesFindHomePrecondition(value, selectedOrg, canonical);
  const diagnostic = JSON.stringify(result.diagnostic);
  for (const privateValue of [selectedOrg, otherOrg, generalId, typeId, 'Harbor Dental'])
    assert.equal(diagnostic.includes(privateValue), false);
  assert.equal(
    Object.values(result.diagnostic).every((v) => typeof v === 'number' || typeof v === 'boolean'),
    true,
  );
  return result;
}

// The General home may be renamed; its canonical identity comes from platform.my_homes.
test('T02 selects the canonical typed home even when renamed or a different scope is named General', () => {
  const value = tree('Harbor Dental');
  value.scopes.push({
    id: unrelatedId,
    organization_id: selectedOrg,
    name: 'General',
    scope_type_id: typeId,
  });
  const result = inspect(value);
  assert.equal(result.code, null);
  assert.equal(result.general.id, generalId);
  assert.equal(result.typeId, typeId);
  assert.equal(result.diagnostic.canonical_general_in_tree, true);
});

test('T02 distinguishes a lazy uninitialized General from an initialized home missing from the tree', () => {
  const empty = { scopes: [], types: [] };
  const lazy = inspect(empty, homes(null));
  assert.equal(lazy.code, 'notes_find_general_home_uninitialized');
  assert.equal(lazy.general, null);
  assert.equal(lazy.typeId, null);
  assert.equal(lazy.diagnostic.canonical_general_uninitialized, true);
  const hidden = inspect(empty);
  assert.equal(hidden.code, 'notes_find_general_home_tree_unavailable');
  assert.equal(hidden.general, null);
  assert.equal(hidden.typeId, null);
  assert.equal(hidden.diagnostic.canonical_general_id_valid, true);
  assert.equal(hidden.diagnostic.canonical_general_in_tree, false);
});

test('T02 refuses missing, duplicate, and malformed canonical General receipts', () => {
  const cases = [
    [[], 'notes_find_general_home_missing'],
    [[...homes(generalId), homes(generalId).at(-1)], 'notes_find_general_home_duplicate'],
    [homes('General'), 'notes_find_general_home_id_invalid'],
    [homes(undefined), 'notes_find_general_home_id_invalid'],
  ];
  for (const [canonical, code] of cases) {
    const result = inspect(tree(), canonical);
    assert.equal(result.code, code);
    assert.equal(result.general, null);
    assert.equal(result.typeId, null);
  }
});

test('T02 refuses the canonical home when its tree type is invalid or outside the selected organization', () => {
  const invalid = tree();
  invalid.scopes[0].scope_type_id = null;
  assert.equal(inspect(invalid).code, 'notes_find_general_home_type_id_invalid');
  for (const types of [[], [{ id: typeId, organization_id: otherOrg }]]) {
    const value = tree();
    value.types = types;
    const result = inspect(value);
    assert.equal(result.code, 'notes_find_general_home_type_unavailable');
    assert.equal(result.general, null);
    assert.equal(result.typeId, null);
  }
});
