import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ownedNotesFixtureReceipt,
  requireNotesOrganizationId,
  shouldHoldOwnedNotesPatch,
  verifyNotesSnapshot,
} from './notes-native-contract.mjs';

test('owned fixture recovery requires the selected organization UUID', () => {
  const id = 'b47fc412-46fb-43e5-a496-8ff73d85cc80';
  assert.equal(requireNotesOrganizationId(id), id);
  for (const value of [null, '', 'Choose…', 'not-a-uuid']) {
    assert.throws(
      () => requireNotesOrganizationId(value),
      /notes_selected_organization_id_missing/,
    );
  }
});

test('created and deleted fixture receipts preserve the exact organization', () => {
  const organizationId = 'b47fc412-46fb-43e5-a496-8ff73d85cc80';
  const fields = {
    noteId: '59f39144-1a73-46ac-8c06-aa1311c707f9',
    noteTitle: 'owned test note',
    organizationId,
    role: 'member',
    sourceSha: 'a'.repeat(40),
    treeSha256: 'b'.repeat(64),
  };
  for (const status of ['created', 'deleted_confirmed']) {
    assert.deepEqual(ownedNotesFixtureReceipt(status, fields), {
      schema_version: 1,
      status,
      note_id: fields.noteId,
      note_title: fields.noteTitle,
      organization_id: organizationId,
      role: 'member',
      source_sha: fields.sourceSha,
      tree_sha256: fields.treeSha256,
    });
  }
  assert.throws(
    () => ownedNotesFixtureReceipt('created', { ...fields, organizationId: null }),
    /notes_selected_organization_id_missing/,
  );
});

test('an imported Notes snapshot uses its source version and rejects a mismatched tree', () => {
  const receipt = {
    kind: 'local_dev_unpacked',
    version: '0.2.175',
    treeSha256: 'a'.repeat(64),
  };
  const manifest = { version: '0.2.175', key: 'keyed-development-build' };
  assert.deepEqual(
    verifyNotesSnapshot({
      receipt,
      manifest,
      treeSha256: 'a'.repeat(64),
      sourceVersion: '0.2.175',
    }),
    { version: '0.2.175', treeSha256: 'a'.repeat(64) },
  );
  assert.throws(
    () =>
      verifyNotesSnapshot({
        receipt,
        manifest,
        treeSha256: 'b'.repeat(64),
        sourceVersion: '0.2.175',
      }),
    /notes_build_hash_mismatch/,
  );
  assert.throws(
    () =>
      verifyNotesSnapshot({
        receipt,
        manifest,
        treeSha256: 'a'.repeat(64),
        sourceVersion: '0.2.176',
      }),
    /notes_build_version_mismatch/,
  );
});

test('held autosave must belong to the one created Notes fixture', () => {
  const ownedId = '59f39144-1a73-46ac-8c06-aa1311c707f9';
  const foreignId = 'a27fbfa6-683a-4d9d-b36e-f79e8e8b1557';
  const request = (id, deleting = false) => ({
    inScope: true,
    method: 'PATCH',
    id,
    deleting,
  });
  assert.equal(shouldHoldOwnedNotesPatch(request(ownedId), ownedId, 'hold_patch', false), true);
  assert.equal(shouldHoldOwnedNotesPatch(request(foreignId), ownedId, 'hold_patch', false), false);
  assert.equal(shouldHoldOwnedNotesPatch(request(ownedId), null, 'hold_patch', false), false);
  assert.equal(
    shouldHoldOwnedNotesPatch(request(ownedId, true), ownedId, 'hold_patch', false),
    false,
  );
  assert.equal(shouldHoldOwnedNotesPatch(request(ownedId), ownedId, 'observe', false), false);
  assert.equal(shouldHoldOwnedNotesPatch(request(ownedId), ownedId, 'hold_patch', true), false);
});
