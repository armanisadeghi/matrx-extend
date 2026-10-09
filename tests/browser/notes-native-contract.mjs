import assert from 'node:assert/strict';

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
