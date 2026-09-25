'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const FAILED_RUN_ID = '7356f61d-8b6e-4445-b0bd-0961e69c6dc3';
const FAILED_PROOF_SHA256 = 'fcd684846071376c061808a90d59be82475afb38b5d55bf0a4a72164498207f3';
const RECOVERY_SHA256 = '7f864a0243c62e697dfb4b103a6e0967257ba5c2c47743096eaa6e3128d3a28f';
const LEASE_RETIREMENT_SHA256 = '02ab2a54c7f1dac390d5467b5084cb8dc8eea1dbf35fe6e4a38e23fc2d17b344';
const FRESH_NONOWNED_BASELINE_SHA256 =
  '6f837f99946929f30802980e6149050464b140eea0f6e81e088e852a3e9eda1f';
const ROUTER_SHA256 = '53e19fea4a7ddf57a1c8b12a0a641e9e694e8ce2527112520d5c85fd5520006c';
const SERVICE_SHA256 = 'd62944d5e9968bcb6323182487a410a600f03771942f05127df5ff1f0e1f4ff8';
const RETIRED_OWNER_PID = 9706;
const RETIRED_OWNER_NONCE = 'd4fea5a0-cffe-4bec-bf48-efffee4825e4';
const RETIRED_OWNER_SHA256 = '4e727ce8c52fb10e9138f334ebcd88ff40bf3bf66dd43dea920a83b5b464c238';
const OWNED_FIXTURE_IDS = Object.freeze([
  '33e60bbf-2928-4005-bb62-e9e924fdc0b2',
  '551e9cf2-956f-4f5c-ac2b-dcb7996f7bb8',
  '4a38d2b7-b470-43ef-b03a-1ba9bbda7642',
  'e71471d6-40e3-427f-884b-20bae44cdd5a',
]);
const FAILED_PROOF_PATH = path.join(
  REPO_ROOT,
  '.matrx/realbrowser-vault/save-update-headless',
  FAILED_RUN_ID,
  'proof.json',
);
const RECOVERY_PATH = path.join(REPO_ROOT, '.matrx/task1-active/recovery-7356-result.json');
const LEASE_RETIREMENT_PATH = path.join(
  REPO_ROOT,
  '.matrx/task1-active/lease-retirement-7356.json',
);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const exactSet = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  new Set(actual).size === expected.length &&
  actual.every((value) => expected.includes(value));
const uuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function assertExactPaths(failedProofPath, recoveryPath, leaseRetirementPath) {
  assert.equal(path.resolve(failedProofPath), FAILED_PROOF_PATH, '7356_failed_proof_path_mismatch');
  assert.equal(path.resolve(recoveryPath), RECOVERY_PATH, '7356_recovery_path_mismatch');
  assert.equal(
    path.resolve(leaseRetirementPath),
    LEASE_RETIREMENT_PATH,
    '7356_lease_retirement_path_mismatch',
  );
}

function assertFailedRecord(record) {
  assert.equal(record?.schema, 3, '7356_failed_schema_mismatch');
  assert.equal(record?.runId, FAILED_RUN_ID, '7356_failed_run_id_mismatch');
  assert.equal(record?.mode, 'receipt_backed_save_update', '7356_failed_mode_mismatch');
  assert.equal(record?.ok, false, '7356_failed_run_must_remain_failed');
  assert.equal(
    exactSet(record?.ownedFixtureIds, OWNED_FIXTURE_IDS),
    true,
    '7356_failed_owned_fixture_ids_mismatch',
  );
  assert.equal(record?.cleanup?.localAuthLogoutStatus, 504, '7356_old_logout_status_mismatch');
  assert.equal(
    record?.cleanup?.remoteAuthRevocationStatus,
    504,
    '7356_old_remote_revocation_status_mismatch',
  );
  assert.equal(record?.cleanup?.browserClosed, true, '7356_old_browser_cleanup_missing');
  assert.equal(record?.cleanup?.profileRemoved, true, '7356_old_profile_cleanup_missing');
  assert.equal(record?.cleanup?.localFixtureServerClosed, true, '7356_old_server_cleanup_missing');
}

function assertRecoveryRecord(record) {
  assert.equal(record?.schema, 1, '7356_recovery_schema_mismatch');
  assert.equal(record?.failedRunId, FAILED_RUN_ID, '7356_recovery_failed_run_id_mismatch');
  assert.equal(
    record?.failedProofSha256,
    FAILED_PROOF_SHA256,
    '7356_recovery_failed_hash_mismatch',
  );
  assert.equal(record?.ok, true, '7356_recovery_not_complete');
  // The old bearer was intentionally not retained after its 504. This proves
  // neither its revocation nor continued validity; only the fresh logout is
  // a completed session-revocation observation.
  assert.equal(
    record?.oldRemoteRevocation,
    'unconfirmed_504_no_old_bearer_retained',
    '7356_old_revocation_must_remain_unconfirmed',
  );
  assert.deepEqual(record?.freshLogoutStatuses, [204], '7356_fresh_logout_204_missing');
  assert.equal(record?.freshRemoteRevoked, true, '7356_fresh_remote_revocation_missing');
  assert.equal(record?.freshSignInStatus, 200, '7356_fresh_sign_in_status_mismatch');
  assert.equal(record?.adminVerified, true, '7356_admin_identity_missing');
  assert.equal(record?.ownedItemsGone, true, '7356_owned_items_not_gone');
  assert.equal(record?.ownedFixtureCleanupComplete, true, '7356_owned_fixture_cleanup_missing');
  assert.equal(record?.adapterExitCode, 0, '7356_cleanup_adapter_exit_code_mismatch');
  assert.equal(
    record?.adapter?.route,
    'local_canonical_authmiddleware',
    '7356_cleanup_adapter_route_mismatch',
  );
  assert.equal(
    record?.adapter?.provenance,
    'local_router_and_service_hash_pinned',
    '7356_cleanup_adapter_provenance_mismatch',
  );
  assert.equal(
    record?.adapter?.sourceSha256?.router,
    ROUTER_SHA256,
    '7356_cleanup_router_hash_mismatch',
  );
  assert.equal(
    record?.adapter?.sourceSha256?.service,
    SERVICE_SHA256,
    '7356_cleanup_service_hash_mismatch',
  );
  assert.equal(record?.inventoryBeforeCount, 39, '7356_fresh_inventory_before_count_mismatch');
  assert.equal(record?.freshBaselineUnchanged, true, '7356_fresh_nonowned_baseline_changed');
  assert.equal(record?.inventoryAfterCount, 35, '7356_fresh_nonowned_inventory_count_mismatch');
  assert.equal(
    Array.isArray(record?.freshBaseline) &&
      record.freshBaseline.length === 35 &&
      new Set(record.freshBaseline.map((entry) => entry?.id)).size === 35 &&
      record.freshBaseline.every((entry) => uuid(entry?.id) && sha(entry?.metadataSha256)) &&
      record.freshBaseline.every((entry) => !OWNED_FIXTURE_IDS.includes(entry?.id)) &&
      sha256(JSON.stringify(record.freshBaseline)) === FRESH_NONOWNED_BASELINE_SHA256,
    true,
    '7356_fresh_nonowned_baseline_shape_mismatch',
  );
  const attempts = record?.adapter?.attempts;
  assert.equal(record?.adapter?.ok, true, '7356_cleanup_adapter_not_complete');
  assert.equal(
    record?.adapter?.receiptCount,
    OWNED_FIXTURE_IDS.length,
    '7356_cleanup_receipt_count_mismatch',
  );
  assert.equal(
    Array.isArray(attempts) &&
      attempts.length === OWNED_FIXTURE_IDS.length &&
      new Set(attempts.map((entry) => entry?.id)).size === OWNED_FIXTURE_IDS.length &&
      attempts.every(
        (entry) =>
          OWNED_FIXTURE_IDS.includes(entry?.id) &&
          entry?.initialGetStatus === 200 &&
          entry?.deleteStatus === 204 &&
          entry?.finalGetStatus === 404 &&
          entry?.terminal === 'deleted_and_missing',
      ),
    true,
    '7356_owned_receipt_delete_get_sequence_mismatch',
  );
}

function assertLeaseRetirementRecord(record) {
  assert.equal(record?.schema, 1, '7356_lease_retirement_schema_mismatch');
  assert.equal(
    record?.kind,
    'reviewed_exact_quarantine_retirement',
    '7356_lease_retirement_kind_mismatch',
  );
  assert.equal(record?.owner?.schema, 1, '7356_lease_retirement_owner_schema_mismatch');
  assert.equal(record?.owner?.runId, FAILED_RUN_ID, '7356_lease_retirement_run_id_mismatch');
  assert.equal(record?.owner?.kind, 'chrome', '7356_lease_retirement_kind_owner_mismatch');
  assert.equal(record?.owner?.pid, RETIRED_OWNER_PID, '7356_lease_retirement_owner_pid_mismatch');
  assert.equal(
    record?.owner?.nonce,
    RETIRED_OWNER_NONCE,
    '7356_lease_retirement_owner_nonce_mismatch',
  );
  assert.equal(
    record?.ownerSha256,
    RETIRED_OWNER_SHA256,
    '7356_lease_retirement_owner_hash_mismatch',
  );
  assert.equal(
    record?.failedProofSha256,
    FAILED_PROOF_SHA256,
    '7356_lease_retirement_failed_hash_mismatch',
  );
  assert.equal(
    record?.recoverySha256,
    RECOVERY_SHA256,
    '7356_lease_retirement_recovery_hash_mismatch',
  );
  assert.equal(
    record?.failedRunRemainsFailed,
    true,
    '7356_lease_retirement_failed_verdict_missing',
  );
  assert.equal(
    record?.oldRemoteRevocation,
    'unconfirmed_504_no_old_bearer_retained',
    '7356_lease_retirement_old_revocation_overclaimed',
  );
  assert.equal(record?.ownedFixturesReconciled, true, '7356_lease_retirement_fixtures_missing');
  assert.equal(
    record?.currentNonOwnedInventoryPreserved,
    true,
    '7356_lease_retirement_nonowned_inventory_missing',
  );
  assert.equal(record?.ownerProcessGone, true, '7356_lease_retirement_owner_process_missing');
  assert.equal(record?.leaseRetired, true, '7356_lease_retirement_missing');
}

function parse(raw, code) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(code);
  }
}

/**
 * Pure strict admission predicate. It deliberately validates the retirement
 * record rather than ambient lock absence, because a new serialized run may
 * legitimately hold the acceptance lease when this predicate is invoked.
 */
function assert7356RecoveryAdmission({
  failedProofPath,
  failedRaw,
  recoveryPath,
  recoveryRaw,
  leaseRetirementPath,
  leaseRetirementRaw,
}) {
  assertExactPaths(failedProofPath, recoveryPath, leaseRetirementPath);
  assert.equal(sha256(failedRaw), FAILED_PROOF_SHA256, '7356_failed_proof_hash_changed');
  assert.equal(sha256(recoveryRaw), RECOVERY_SHA256, '7356_recovery_hash_changed');
  assert.equal(
    sha256(leaseRetirementRaw),
    LEASE_RETIREMENT_SHA256,
    '7356_lease_retirement_hash_changed',
  );
  assertFailedRecord(parse(failedRaw, '7356_failed_proof_invalid_json'));
  assertRecoveryRecord(parse(recoveryRaw, '7356_recovery_invalid_json'));
  assertLeaseRetirementRecord(parse(leaseRetirementRaw, '7356_lease_retirement_invalid_json'));
  return Object.freeze({
    admitNewSerializedRun: true,
    failedRunRemainsFailed: true,
    oldRemoteRevocation: 'unconfirmed_504_no_old_bearer_retained',
    fourOwnedReceiptsDeletedAndMissing: true,
    freshNonOwnedInventoryCount: 35,
    freshLogout204Observed: true,
    oldBrowserProfileAndServerGone: true,
    leaseRetirementRecorded: true,
  });
}

async function verify7356RecoveryAdmission() {
  const [failedRaw, recoveryRaw, leaseRetirementRaw] = await Promise.all([
    readFile(FAILED_PROOF_PATH),
    readFile(RECOVERY_PATH),
    readFile(LEASE_RETIREMENT_PATH),
  ]);
  return assert7356RecoveryAdmission({
    failedProofPath: FAILED_PROOF_PATH,
    failedRaw,
    recoveryPath: RECOVERY_PATH,
    recoveryRaw,
    leaseRetirementPath: LEASE_RETIREMENT_PATH,
    leaseRetirementRaw,
  });
}

module.exports = {
  FAILED_PROOF_PATH,
  FAILED_PROOF_SHA256,
  FAILED_RUN_ID,
  LEASE_RETIREMENT_PATH,
  LEASE_RETIREMENT_SHA256,
  FRESH_NONOWNED_BASELINE_SHA256,
  OWNED_FIXTURE_IDS,
  RECOVERY_PATH,
  RECOVERY_SHA256,
  RETIRED_OWNER_NONCE,
  RETIRED_OWNER_PID,
  RETIRED_OWNER_SHA256,
  ROUTER_SHA256,
  SERVICE_SHA256,
  _assertFailedRecord: assertFailedRecord,
  _assertLeaseRetirementRecord: assertLeaseRetirementRecord,
  _assertRecoveryRecord: assertRecoveryRecord,
  assert7356RecoveryAdmission,
  verify7356RecoveryAdmission,
};

// A later HTTP 503 failed before any item was committed. This exact record is
// separate from successful cleanup: the original failed journey stays failed.
const NO_COMMIT_RUN = '2c07e860-52fa-492c-b8bf-f044e32529ec';
const NO_COMMIT_PROOF_PATH = path.join(
  REPO_ROOT,
  '.matrx/realbrowser-vault/save-update-headless',
  NO_COMMIT_RUN,
  'proof.json',
);
const NO_COMMIT_RECOVERY_PATH = path.join(
  REPO_ROOT,
  '.matrx/task1-active/recovery-2c07-no-commit.json',
);
const NO_COMMIT_PROOF_SHA = '6092208eec4413e83fcd06ab81625eecdc8aac281fcfb802d50ad52565b7fcad';
const NO_COMMIT_RECOVERY_SHA = 'b3947f3193fcff978c233dcf5af2184e52418d11b58f4e8f3c07f24eba9bedcf';
function assertNoCommitRecords(failed, recovery) {
  assert.equal(failed?.runId, NO_COMMIT_RUN);
  assert.equal(failed?.ok, false);
  assert.equal(failed?.failureCode, 'http_503_fixture_create');
  assert.deepEqual(failed?.ownedFixtureIds, []);
  assert.deepEqual(failed?.ownedCreateMutationKeys, ['3fab05d6-f77c-4162-a54a-56952b72a5bf']);
  assert.equal(failed?.vaultMutationRequests, 1);
  assert.equal(failed?.vaultItemPosts?.total, 1);
  assert.equal(failed?.vaultItemPosts?.withIdempotencyHeader, 1);
  for (const key of [
    'finalBaselineIdSetMatches',
    'finalBaselineMetadataMatches',
    'browserClosed',
    'profileRemoved',
    'localFixtureServerClosed',
  ])
    assert.equal(failed?.cleanup?.[key], true);
  assert.equal(failed?.cleanup?.localAuthLogoutStatus, 204);
  assert.equal(failed?.cleanup?.remoteAuthRevocationStatus, 204);
  assert.equal(recovery?.failedRunId, NO_COMMIT_RUN);
  assert.equal(recovery?.failedProofSha256, NO_COMMIT_PROOF_SHA);
  assert.equal(recovery?.actorId, '87a6e699-3622-4869-8843-d0867456c0dd');
  assert.equal(
    recovery?.receiptOrganizationScope,
    'all organizations; exact actor and mutation key, pending and completed',
  );
  assert.deepEqual(recovery?.ownedCreateMutationKeys, failed.ownedCreateMutationKeys);
  assert.equal(recovery?.receiptCountIncludingIncomplete, 0);
  for (const key of [
    'adminVerified',
    'finalBaselineUnchanged',
    'remoteLogout204',
    'localResourcesGone',
    'ownerProcessGone',
    'originalRunRemainsFailed',
    'leaseRetired',
  ])
    assert.equal(recovery?.[key], true);
}
async function verifyNoCommitRecovery() {
  const [failedRaw, recoveryRaw] = await Promise.all([
    readFile(NO_COMMIT_PROOF_PATH),
    readFile(NO_COMMIT_RECOVERY_PATH),
  ]);
  assert.equal(sha256(failedRaw), NO_COMMIT_PROOF_SHA);
  assert.equal(sha256(recoveryRaw), NO_COMMIT_RECOVERY_SHA);
  assertNoCommitRecords(JSON.parse(failedRaw), JSON.parse(recoveryRaw));
  return {
    admitNewSerializedRun: true,
    originalRunRemainsFailed: true,
    exactOwnedRequestUncommitted: true,
    remoteLogout204: true,
  };
}
Object.assign(module.exports, {
  NO_COMMIT_PROOF_PATH,
  NO_COMMIT_RECOVERY_PATH,
  _assertNoCommitRecords: assertNoCommitRecords,
  verifyNoCommitRecovery,
});
