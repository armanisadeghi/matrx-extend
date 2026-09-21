'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const FAILED_RUN_ID = 'b208d813-9a59-4d87-b437-772ee05eb3b7';
const FAILED_PROOF_SHA256 = '317bbc4724038577ec023b5ea797b559d9c91fb9cb4e4210f1a0768d1ec90d86';
const FRESH_RUN_ID = '02442e69-dfc8-4923-84a8-bfce442d1c49';
const FRESH_PROOF_SHA256 = '90a541aa079e6be7484a9a78752d79600745a8fa0e6b16b9d7d496857418c4f2';
const CLEAN_BASELINE_SHA256 = '0b18f97a9727116b746ea4bc4432fcbd6bb1821f5449b0a219062e69b2726bab';
const HISTORICAL_FIXTURE_IDS = Object.freeze([
  'fc98086a-33a9-4ee4-aaeb-31af47ceebe8',
  '47965c99-5482-43ab-bf54-25e7fd5abc95',
  '490b5d93-449b-4700-abd0-197bca4e9560',
  'aefb713a-fbb3-476a-a0a3-a4facadf5e43',
]);
const FAILED_PROOF_PATH = path.join(REPO_ROOT, '.matrx/realbrowser-vault/save-update-headless', FAILED_RUN_ID, 'proof.json');
const FRESH_PROOF_PATH = path.join(REPO_ROOT, '.matrx/task1-active/firefox-sidebar-probe/authenticated-harness/auth-runs', FRESH_RUN_ID, 'proof.json');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const exactSet = (actual, expected) => Array.isArray(actual) && actual.length === expected.length
  && new Set(actual).size === expected.length && actual.every((value) => expected.includes(value));

function assertExactPaths(failedProofPath, freshProofPath) {
  assert.equal(path.resolve(failedProofPath), FAILED_PROOF_PATH, 'historical_reconciliation_failed_proof_path_mismatch');
  assert.equal(path.resolve(freshProofPath), FRESH_PROOF_PATH, 'historical_reconciliation_fresh_proof_path_mismatch');
}

function assertFailedRecord(record) {
  assert.equal(record?.schema, 3, 'historical_reconciliation_failed_schema_mismatch');
  assert.equal(record?.runId, FAILED_RUN_ID, 'historical_reconciliation_failed_run_id_mismatch');
  assert.equal(record?.mode, 'receipt_backed_save_update', 'historical_reconciliation_failed_mode_mismatch');
  assert.equal(record?.ok, false, 'historical_reconciliation_failed_run_must_remain_failed');
  assert.equal(record?.failureCode, 'preferences_quiet_fill_feedback_timeout', 'historical_reconciliation_failed_verdict_mismatch');
  assert.equal(exactSet(record?.ownedFixtureIds, HISTORICAL_FIXTURE_IDS), true, 'historical_reconciliation_failed_fixture_ids_mismatch');
  const cleanup = record?.cleanup;
  assert.equal(cleanup?.receiptReconciled, true, 'historical_reconciliation_failed_receipt_cleanup_missing');
  assert.equal(cleanup?.createdItemsGone, true, 'historical_reconciliation_failed_fixture_cleanup_missing');
  assert.equal(cleanup?.localAuthLogoutStatus, 204, 'historical_reconciliation_failed_local_auth_cleanup_missing');
  assert.equal(cleanup?.remoteAuthRevocationStatus, 204, 'historical_reconciliation_failed_remote_auth_cleanup_missing');
  assert.equal(cleanup?.browserClosed, true, 'historical_reconciliation_failed_browser_cleanup_missing');
  assert.equal(cleanup?.localFixtureServerClosed, true, 'historical_reconciliation_failed_fixture_server_cleanup_missing');
  assert.equal(cleanup?.profileRemoved, true, 'historical_reconciliation_failed_profile_cleanup_missing');
}

function assertFreshRecord(record) {
  assert.equal(record?.schema, 1, 'historical_reconciliation_fresh_schema_mismatch');
  assert.equal(record?.runId, FRESH_RUN_ID, 'historical_reconciliation_fresh_run_id_mismatch');
  assert.equal(record?.mode, 'firefox_readonly_chrome_reconciliation', 'historical_reconciliation_fresh_mode_mismatch');
  assert.equal(record?.ok, true, 'historical_reconciliation_fresh_run_not_complete');
  assert.equal(record?.vaultMutationRequests, 0, 'historical_reconciliation_fresh_mutation_observed');
  assert.equal(record?.baselineReconciled, true, 'historical_reconciliation_fresh_baseline_not_reconciled');
  assert.equal(record?.baseline?.itemCount, 34, 'historical_reconciliation_clean_baseline_count_changed');
  assert.equal(record?.baseline?.metadataSha256, CLEAN_BASELINE_SHA256, 'historical_reconciliation_clean_baseline_metadata_changed');
  const reconciliation = record?.historicalReconciliation;
  assert.equal(reconciliation?.failedRunId, FAILED_RUN_ID, 'historical_reconciliation_linked_failed_run_mismatch');
  assert.equal(reconciliation?.failedProofSha256, FAILED_PROOF_SHA256, 'historical_reconciliation_linked_failed_hash_mismatch');
  assert.equal(reconciliation?.cleanBaselineBefore, true, 'historical_reconciliation_baseline_before_missing');
  assert.equal(reconciliation?.cleanBaselineAfter, true, 'historical_reconciliation_baseline_after_missing');
  const statuses = reconciliation?.ownedFixtureStatuses;
  assert.equal(Array.isArray(statuses) && statuses.length === HISTORICAL_FIXTURE_IDS.length
    && new Set(statuses.map((entry) => entry?.id)).size === HISTORICAL_FIXTURE_IDS.length
    && statuses.every((entry) => HISTORICAL_FIXTURE_IDS.includes(entry?.id) && entry?.status === 404), true,
  'historical_reconciliation_fixture_statuses_mismatch');
  for (const key of [
    'credentialsRead', 'authenticationAttempted', 'runtimeAttested', 'freshProfileAuthStorageEmpty',
    'popupSignInTrusted', 'oauthExpectedOrigin', 'oauthConsentAuthorized', 'independentAdminIdentity',
    'organizationSelectedByUiOrSingleMembership', 'nativeSidebarOpenedByPopupGesture', 'nativeVaultVisible',
    'localExtensionSignedOut', 'remoteSessionRevoked', 'networkObserverDisposed', 'addonUninstalled',
    'sessionDeleted', 'driverExited', 'firefoxExited', 'profileRemoved', 'allOwnedPidsGone',
    'acceptanceLeaseAcquired', 'acceptanceLeaseReleased',
  ]) assert.equal(record?.[key], true, `historical_reconciliation_fresh_${key}_missing`);
  assert.equal(record?.nativeSignOutNetwork?.addonLogout204Observed, true,
    'historical_reconciliation_fresh_native_logout_204_missing');
  assert.equal(record?.nativeSignOutNetwork?.addonLogoutRequestObserved, true,
    'historical_reconciliation_fresh_native_logout_request_missing');
  assert.equal(record?.nativeSignOutNetwork?.nodeFallbackAttempted, false,
    'historical_reconciliation_fresh_native_logout_used_fallback');
  assert.equal(record?.nativeVaultNetwork?.addonItemsRequestObserved, true,
    'historical_reconciliation_fresh_native_vault_request_missing');
  assert.equal(record?.nativeVaultNetwork?.addonItems2xxObserved, true,
    'historical_reconciliation_fresh_native_vault_2xx_missing');
  assert.equal(Number.isInteger(record?.nativeVaultNetwork?.responseStatus)
    && record.nativeVaultNetwork.responseStatus >= 200 && record.nativeVaultNetwork.responseStatus < 300, true,
  'historical_reconciliation_fresh_native_vault_response_not_2xx');
  assert.equal(record?.networkObserver?.dropped, 0, 'historical_reconciliation_fresh_network_events_dropped');
  assert.equal(record?.networkObserver?.observerErrors, 0, 'historical_reconciliation_fresh_network_observer_errors');
  // This pinned run predates the cleanup-specific copy; its terminal observer
  // record is the cleanup observation. Newer records supply the dedicated key.
  const cleanupNetwork = record?.cleanupNetworkObserver ?? record?.networkObserver;
  assert.equal(cleanupNetwork?.dropped, 0, 'historical_reconciliation_fresh_cleanup_network_events_dropped');
  assert.equal(cleanupNetwork?.observerErrors, 0, 'historical_reconciliation_fresh_cleanup_network_observer_errors');
  assert.equal(record?.nativeOsInputUsed, false, 'historical_reconciliation_fresh_native_os_input_used');
  assert.equal(record?.storedSessionSeeded, false, 'historical_reconciliation_fresh_session_seeded');
  assert.deepEqual(record?.cleanupErrors, [], 'historical_reconciliation_fresh_cleanup_errors_present');
  assert.equal(record?.terminalPhase, 'complete', 'historical_reconciliation_fresh_terminal_phase_incomplete');
}

/**
 * Strict pure predicate for parent-runner integration. Both byte strings and
 * paths must be the declared historical artifacts; no later run can substitute
 * equivalent-looking JSON for either record.
 */
function assertHistoricalChromeReconciliation({ failedProofPath, failedRaw, freshProofPath, freshRaw }) {
  assertExactPaths(failedProofPath, freshProofPath);
  assert.equal(sha256(failedRaw), FAILED_PROOF_SHA256, 'historical_reconciliation_failed_proof_hash_changed');
  assert.equal(sha256(freshRaw), FRESH_PROOF_SHA256, 'historical_reconciliation_fresh_proof_hash_changed');
  let failed;
  let fresh;
  try { failed = JSON.parse(failedRaw); } catch { throw new Error('historical_reconciliation_failed_proof_invalid_json'); }
  try { fresh = JSON.parse(freshRaw); } catch { throw new Error('historical_reconciliation_fresh_proof_invalid_json'); }
  assertFailedRecord(failed);
  assertFreshRecord(fresh);
  return Object.freeze({
    failedRunRemainsFailed: true,
    cleanBaselineBeforeAndAfter: true,
    historicalFixture404Count: HISTORICAL_FIXTURE_IDS.length,
    zeroFreshVaultMutations: true,
    authResourceAndLeaseCleanupComplete: true,
  });
}

async function verifyHistoricalChromeReconciliation() {
  const [failedRaw, freshRaw] = await Promise.all([readFile(FAILED_PROOF_PATH), readFile(FRESH_PROOF_PATH)]);
  return assertHistoricalChromeReconciliation({
    failedProofPath: FAILED_PROOF_PATH, failedRaw, freshProofPath: FRESH_PROOF_PATH, freshRaw,
  });
}

module.exports = {
  FAILED_PROOF_PATH,
  FAILED_PROOF_SHA256,
  FAILED_RUN_ID,
  FRESH_PROOF_PATH,
  FRESH_PROOF_SHA256,
  FRESH_RUN_ID,
  HISTORICAL_FIXTURE_IDS,
  _assertFailedRecord: assertFailedRecord,
  _assertFreshRecord: assertFreshRecord,
  assertHistoricalChromeReconciliation,
  verifyHistoricalChromeReconciliation,
};
