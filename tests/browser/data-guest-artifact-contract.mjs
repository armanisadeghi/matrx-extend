import assert from 'node:assert/strict';

/** Verify the wrapper's CI proof together with the imported unpacked receipt. */
export function verifyDataGuestArtifact({
  localReceipt,
  ciReceipt,
  env,
  treeSha256,
  manifestVersion,
}) {
  assert.equal(localReceipt?.kind, 'local_dev_unpacked', 'data_guest_local_receipt_required');
  assert.equal(
    localReceipt?.publish_state,
    'not_published',
    'data_guest_unpublished_receipt_required',
  );
  assert.equal(treeSha256, localReceipt.treeSha256, 'data_guest_tree_mismatch');
  assert.equal(manifestVersion, localReceipt.version, 'data_guest_version_mismatch');

  assert.equal(ciReceipt?.schema_version, 1, 'data_guest_ci_receipt_required');
  assert.equal(ciReceipt.kind, 'ci_development_test', 'data_guest_ci_receipt_required');
  assert.equal(ciReceipt.eligibleStore, false, 'data_guest_store_eligibility_refused');
  assert.equal(ciReceipt.publish_state, 'not_published', 'data_guest_published_artifact_refused');
  assert.match(ciReceipt.sourceSha ?? '', /^[a-f0-9]{40}$/, 'data_guest_ci_source_required');
  assert.ok(
    Number.isSafeInteger(ciReceipt.runId) && ciReceipt.runId > 0,
    'data_guest_ci_run_required',
  );
  assert.ok(
    Number.isSafeInteger(ciReceipt.artifactId) && ciReceipt.artifactId > 0,
    'data_guest_ci_artifact_required',
  );
  assert.equal(ciReceipt.treeSha256, localReceipt.treeSha256, 'data_guest_ci_tree_mismatch');
  assert.equal(ciReceipt.version, localReceipt.version, 'data_guest_ci_version_mismatch');

  assert.equal(env.MATRX_DATA_CI_SOURCE_SHA, ciReceipt.sourceSha, 'data_guest_ci_source_mismatch');
  assert.equal(env.MATRX_DATA_CI_RUN_ID, String(ciReceipt.runId), 'data_guest_ci_run_mismatch');
  assert.equal(
    env.MATRX_DATA_CI_ARTIFACT_ID,
    String(ciReceipt.artifactId),
    'data_guest_ci_artifact_mismatch',
  );

  return {
    source_sha: ciReceipt.sourceSha,
    run_id: ciReceipt.runId,
    artifact_id: ciReceipt.artifactId,
    tree_sha256: localReceipt.treeSha256,
    version: localReceipt.version,
  };
}
