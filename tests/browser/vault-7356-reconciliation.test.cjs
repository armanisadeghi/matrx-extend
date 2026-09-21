'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readFile } = require('node:fs/promises');
const {
  FAILED_PROOF_PATH,
  LEASE_RETIREMENT_PATH,
  RECOVERY_PATH,
  _assertFailedRecord,
  _assertLeaseRetirementRecord,
  _assertRecoveryRecord,
  assert7356RecoveryAdmission,
  verify7356RecoveryAdmission,
} = require('./vault-7356-reconciliation.cjs');

async function records() {
  const [failedRaw, recoveryRaw, leaseRetirementRaw] = await Promise.all([
    readFile(FAILED_PROOF_PATH), readFile(RECOVERY_PATH), readFile(LEASE_RETIREMENT_PATH),
  ]);
  return { failedRaw, recoveryRaw, leaseRetirementRaw };
}

test('admits only the exact 7356 failed proof, cleanup record, and retired lease', async () => {
  assert.deepEqual(await verify7356RecoveryAdmission(), {
    admitNewSerializedRun: true,
    failedRunRemainsFailed: true,
    oldRemoteRevocation: 'unconfirmed_504_no_old_bearer_retained',
    fourOwnedReceiptsDeletedAndMissing: true,
    freshNonOwnedInventoryCount: 35,
    freshLogout204Observed: true,
    oldBrowserProfileAndServerGone: true,
    leaseRetirementRecorded: true,
  });
});

test('rejects byte and path substitution', async () => {
  const { failedRaw, recoveryRaw, leaseRetirementRaw } = await records();
  const invoke = (overrides = {}) => assert7356RecoveryAdmission({
    failedProofPath: FAILED_PROOF_PATH, failedRaw,
    recoveryPath: RECOVERY_PATH, recoveryRaw,
    leaseRetirementPath: LEASE_RETIREMENT_PATH, leaseRetirementRaw,
    ...overrides,
  });
  assert.throws(() => invoke({ recoveryRaw: Buffer.concat([recoveryRaw, Buffer.from('\n')]) }), /7356_recovery_hash_changed/);
  assert.throws(() => invoke({ leaseRetirementPath: `${LEASE_RETIREMENT_PATH}.copy` }), /7356_lease_retirement_path_mismatch/);
  assert.throws(() => invoke({ failedProofPath: `${FAILED_PROOF_PATH}.copy` }), /7356_failed_proof_path_mismatch/);
});

test('semantic validators reject missing cleanup, stale receipt, nonowned, logout, and lease evidence', async () => {
  const { failedRaw, recoveryRaw, leaseRetirementRaw } = await records();
  const failed = JSON.parse(failedRaw);
  const recovery = JSON.parse(recoveryRaw);
  const lease = JSON.parse(leaseRetirementRaw);
  const mutate = (record, assertion, apply, expected) => {
    const altered = structuredClone(record);
    apply(altered);
    assert.throws(() => assertion(altered), expected);
  };
  mutate(failed, _assertFailedRecord, record => { record.ok = true; }, /failed_run_must_remain_failed/);
  mutate(failed, _assertFailedRecord, record => { record.cleanup.localAuthLogoutStatus = 204; }, /old_logout_status_mismatch/);
  mutate(failed, _assertFailedRecord, record => { record.cleanup.browserClosed = false; }, /old_browser_cleanup_missing/);
  mutate(recovery, _assertRecoveryRecord, record => { record.adapter.attempts[0].deleteStatus = 500; }, /owned_receipt_delete_get_sequence_mismatch/);
  mutate(recovery, _assertRecoveryRecord, record => { record.adapter.attempts[0].finalGetStatus = 200; }, /owned_receipt_delete_get_sequence_mismatch/);
  mutate(recovery, _assertRecoveryRecord, record => { record.adapterExitCode = 1; }, /cleanup_adapter_exit_code_mismatch/);
  mutate(recovery, _assertRecoveryRecord, record => { record.adapter.route = 'unproven'; }, /cleanup_adapter_route_mismatch/);
  mutate(recovery, _assertRecoveryRecord, record => { record.adapter.sourceSha256.router = 'a'.repeat(64); }, /cleanup_router_hash_mismatch/);
  mutate(recovery, _assertRecoveryRecord, record => { record.freshBaselineUnchanged = false; }, /fresh_nonowned_baseline_changed/);
  mutate(recovery, _assertRecoveryRecord, record => { record.inventoryBeforeCount = 40; }, /fresh_inventory_before_count_mismatch/);
  mutate(recovery, _assertRecoveryRecord, record => { record.inventoryAfterCount = 34; }, /fresh_nonowned_inventory_count_mismatch/);
  mutate(recovery, _assertRecoveryRecord, record => { record.freshBaseline[0].id = record.adapter.attempts[0].id; }, /fresh_nonowned_baseline_shape_mismatch/);
  mutate(recovery, _assertRecoveryRecord, record => { record.freshLogoutStatuses = [504]; }, /fresh_logout_204_missing/);
  mutate(recovery, _assertRecoveryRecord, record => { record.oldRemoteRevocation = 'revoked'; }, /old_revocation_must_remain_unconfirmed/);
  mutate(lease, _assertLeaseRetirementRecord, record => { record.leaseRetired = false; }, /lease_retirement_missing/);
  mutate(lease, _assertLeaseRetirementRecord, record => { record.ownerProcessGone = false; }, /owner_process_missing/);
  mutate(lease, _assertLeaseRetirementRecord, record => { record.owner.schema = 2; }, /owner_schema_mismatch/);
  mutate(lease, _assertLeaseRetirementRecord, record => { record.owner.pid = 1; }, /owner_pid_mismatch/);
  mutate(lease, _assertLeaseRetirementRecord, record => { record.owner.nonce = 'wrong'; }, /owner_nonce_mismatch/);
  mutate(lease, _assertLeaseRetirementRecord, record => { record.ownerSha256 = 'a'.repeat(64); }, /owner_hash_mismatch/);
  mutate(lease, _assertLeaseRetirementRecord, record => { record.oldRemoteRevocation = 'revoked'; }, /old_revocation_overclaimed/);
});
