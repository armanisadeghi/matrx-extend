import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectNotesFindHomePrecondition } from './notes-find-home-precondition.mjs';

const selectedOrg = '4b190b81-7ea2-40e1-8d6d-87fa4b520dfc';
const otherOrg = '6a70d8c9-d151-4ae0-8417-cc21bc20b928';
const generalId = 'b47fc412-46fb-43e5-a496-8ff73d85cc80';
const typeId = '52c40999-6f82-4c96-bfa7-f7b462316d77';

function tree(scopes) {
  return {
    scopes,
    types: [{ id: typeId, organization_id: selectedOrg }],
  };
}

test('T02 selects the one typed General in the selected organization', () => {
  const result = inspectNotesFindHomePrecondition(
    tree([
      { id: generalId, organization_id: selectedOrg, name: 'General', scope_type_id: typeId },
      {
        id: 'd2cb8a01-ae9a-4df5-a06e-8ba430850e89',
        organization_id: otherOrg,
        name: 'General',
        scope_type_id: typeId,
      },
    ]),
    selectedOrg,
  );
  assert.equal(result.code, null);
  assert.equal(result.general.id, generalId);
  assert.equal(result.typeId, typeId);
  assert.deepEqual(result.diagnostic, {
    selected_org_scope_count: 1,
    selected_org_type_count: 1,
    literal_general_count: 1,
    general_type_id_valid: true,
    general_type_in_tree: true,
  });
});

test('T02 distinguishes missing, duplicate, and invalid typed General without exposing tree rows', () => {
  const cases = [
    [[], 'notes_find_general_home_missing', 0],
    [
      [{ id: generalId, organization_id: selectedOrg, name: 'Intake', scope_type_id: typeId }],
      'notes_find_general_home_missing',
      1,
    ],
    [
      [
        { id: generalId, organization_id: selectedOrg, name: 'General', scope_type_id: typeId },
        {
          id: 'd2cb8a01-ae9a-4df5-a06e-8ba430850e89',
          organization_id: selectedOrg,
          name: 'General',
          scope_type_id: typeId,
        },
      ],
      'notes_find_general_home_duplicate',
      2,
    ],
    [
      [{ id: generalId, organization_id: selectedOrg, name: 'General', scope_type_id: null }],
      'notes_find_general_home_type_id_invalid',
      1,
    ],
  ];
  for (const [scopes, code, scopeCount] of cases) {
    const result = inspectNotesFindHomePrecondition(tree(scopes), selectedOrg);
    assert.equal(result.code, code);
    assert.equal(result.general, null);
    assert.equal(result.typeId, null);
    assert.equal(result.diagnostic.selected_org_scope_count, scopeCount);
    assert.equal(
      result.diagnostic.literal_general_count,
      scopes.filter((s) => s.name === 'General').length,
    );
    assert.deepEqual(Object.keys(result.diagnostic).sort(), [
      'general_type_id_valid',
      'general_type_in_tree',
      'literal_general_count',
      'selected_org_scope_count',
      'selected_org_type_count',
    ]);
  }
});

test('T02 refuses a General type absent from the selected organization tree', () => {
  const general = {
    id: generalId,
    organization_id: selectedOrg,
    name: 'General',
    scope_type_id: typeId,
  };
  for (const types of [[], [{ id: typeId, organization_id: otherOrg }]]) {
    const result = inspectNotesFindHomePrecondition({ scopes: [general], types }, selectedOrg);
    assert.equal(result.code, 'notes_find_general_home_type_unavailable');
    assert.equal(result.general, null);
    assert.equal(result.typeId, null);
    assert.deepEqual(result.diagnostic, {
      selected_org_scope_count: 1,
      selected_org_type_count: 0,
      literal_general_count: 1,
      general_type_id_valid: true,
      general_type_in_tree: false,
    });
    assert.equal(JSON.stringify(result.diagnostic).includes(typeId), false);
    assert.equal(JSON.stringify(result.diagnostic).includes(selectedOrg), false);
  }
});
