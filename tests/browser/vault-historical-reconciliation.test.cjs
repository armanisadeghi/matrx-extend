'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readFile } = require('node:fs/promises');
const {
  FAILED_PROOF_PATH,
  FRESH_PROOF_PATH,
  _assertFreshRecord,
  assertHistoricalChromeReconciliation,
  verifyHistoricalChromeReconciliation,
} = require('./vault-historical-reconciliation.cjs');

async function records() {
  const [failedRaw, freshRaw] = await Promise.all([
    readFile(FAILED_PROOF_PATH),
    readFile(FRESH_PROOF_PATH),
  ]);
  return { failedRaw, freshRaw };
}

test('accepts only the declared failed Chrome record and fresh Firefox reconciliation', async () => {
  const proof = await verifyHistoricalChromeReconciliation();
  assert.deepEqual(proof, {
    failedRunRemainsFailed: true,
    cleanBaselineBeforeAndAfter: true,
    historicalFixture404Count: 4,
    zeroFreshVaultMutations: true,
    authResourceAndLeaseCleanupComplete: true,
  });
});

test('rejects altered proof bytes and path substitution', async () => {
  const { failedRaw, freshRaw } = await records();
  const invoke = (overrides = {}) =>
    assertHistoricalChromeReconciliation({
      failedProofPath: FAILED_PROOF_PATH,
      failedRaw,
      freshProofPath: FRESH_PROOF_PATH,
      freshRaw,
      ...overrides,
    });
  assert.throws(
    () => invoke({ failedRaw: Buffer.concat([failedRaw, Buffer.from('\n')]) }),
    /failed_proof_hash_changed/,
  );
  assert.throws(
    () => invoke({ freshProofPath: `${FRESH_PROOF_PATH}.copy` }),
    /fresh_proof_path_mismatch/,
  );
});

test('fresh-record semantic validator rejects cleanup, status, and mutation drift', async () => {
  const { freshRaw } = await records();
  const fresh = JSON.parse(freshRaw);
  const mutate = (apply, expected) => {
    const record = structuredClone(fresh);
    apply(record);
    assert.throws(() => _assertFreshRecord(record), expected);
  };
  mutate((record) => {
    record.acceptanceLeaseAcquired = false;
  }, /acceptanceLeaseAcquired_missing/);
  mutate((record) => {
    record.nativeSignOutNetwork.addonLogout204Observed = false;
  }, /native_logout_204_missing/);
  mutate((record) => {
    record.nativeSignOutNetwork.addonLogoutRequestObserved = false;
  }, /native_logout_request_missing/);
  mutate((record) => {
    record.nativeSignOutNetwork.nodeFallbackAttempted = true;
  }, /native_logout_used_fallback/);
  mutate((record) => {
    record.nativeVaultNetwork.addonItemsRequestObserved = false;
  }, /native_vault_request_missing/);
  mutate((record) => {
    record.nativeVaultNetwork.addonItems2xxObserved = false;
  }, /native_vault_2xx_missing/);
  mutate((record) => {
    record.nativeVaultNetwork.responseStatus = 401;
  }, /native_vault_response_not_2xx/);
  mutate((record) => {
    record.networkObserver.dropped = 1;
  }, /network_events_dropped/);
  mutate((record) => {
    record.networkObserver.observerErrors = 1;
  }, /network_observer_errors/);
  mutate((record) => {
    record.cleanupNetworkObserver = { ...record.networkObserver, dropped: 1 };
  }, /cleanup_network_events_dropped/);
  mutate((record) => {
    record.cleanupNetworkObserver = { ...record.networkObserver, observerErrors: 1 };
  }, /cleanup_network_observer_errors/);
  mutate((record) => {
    record.vaultMutationRequests = 1;
  }, /mutation_observed/);
  mutate((record) => {
    record.historicalReconciliation.ownedFixtureStatuses[0].status = 200;
  }, /fixture_statuses_mismatch/);
});
