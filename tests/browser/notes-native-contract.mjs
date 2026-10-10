import assert from 'node:assert/strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A stopped run can recover its owned note only within the selected organization. */
export function requireNotesOrganizationId(id) {
  assert.ok(typeof id === 'string' && UUID.test(id), 'notes_selected_organization_id_missing');
  return id;
}

export function ownedNotesFixtureReceipt(status, fields) {
  assert.ok(['created', 'deleted_confirmed'].includes(status), 'notes_fixture_status_invalid');
  return {
    schema_version: 1,
    status,
    note_id: fields.noteId,
    note_title: fields.noteTitle,
    organization_id: requireNotesOrganizationId(fields.organizationId),
    role: fields.role,
    source_sha: fields.sourceSha,
    tree_sha256: fields.treeSha256,
  };
}

/** The imported artifact belongs to its source commit, which may predate this checkout. */
export function verifyNotesSnapshot({ receipt, manifest, treeSha256, sourceVersion }) {
  assert.equal(receipt?.kind, 'local_dev_unpacked', 'notes_build_receipt_required');
  assert.equal(manifest?.version, receipt.version, 'notes_build_version_mismatch');
  assert.equal(sourceVersion, receipt.version, 'notes_build_version_mismatch');
  assert.ok(typeof manifest.key === 'string' && manifest.key, 'notes_build_key_missing');
  assert.equal(treeSha256, receipt.treeSha256, 'notes_build_hash_mismatch');
  return { version: receipt.version, treeSha256: receipt.treeSha256 };
}

/** An autosave hold must never intercept a foreign or unproven note. */
export function shouldHoldOwnedNotesPatch(request, ownedNoteId, mode, pendingPatch) {
  return (
    mode === 'hold_patch' &&
    !pendingPatch &&
    request.inScope === true &&
    request.method === 'PATCH' &&
    request.deleting !== true &&
    typeof ownedNoteId === 'string' &&
    request.id === ownedNoteId
  );
}
