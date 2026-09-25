'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  allMatchingVaultListReadsRefused,
  runVaultListTransportRecoveryChecks,
} = require('./vault-setup-recovery-acceptance.cjs');

test('requires every observed matching Vault list read to be refused', () => {
  assert.equal(
    allMatchingVaultListReadsRefused({
      matchingRequests: 2,
      refusedRequests: 2,
      observerErrors: 0,
    }),
    true,
  );
  assert.equal(
    allMatchingVaultListReadsRefused({
      matchingRequests: 0,
      refusedRequests: 0,
      observerErrors: 0,
    }),
    false,
  );
  assert.equal(
    allMatchingVaultListReadsRefused({
      matchingRequests: 2,
      refusedRequests: 1,
      observerErrors: 0,
    }),
    false,
  );
  assert.equal(
    allMatchingVaultListReadsRefused({
      matchingRequests: 2,
      refusedRequests: 2,
      observerErrors: 1,
    }),
    false,
  );
});

test('transport orchestration keeps Boolean evidence separate from diagnostics', async () => {
  const listeners = new Set();
  const panel = {
    clicks: 0,
    async send() {},
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async click() {
      this.clicks += 1;
      if (this.clicks === 1 || this.clicks === 3) {
        for (const listener of listeners) {
          listener('Fetch.requestPaused', {
            requestId: `owned-${this.clicks}`,
            request: {
              method: 'GET',
              url: 'https://server.example.test/api/vault/items?principal_type=user',
            },
          });
        }
      }
    },
    async waitFor() {
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
  const proof = {};
  const result = await runVaultListTransportRecoveryChecks({
    context: {},
    realPanel: panel,
    minimumOwnListRows: 1,
    apiOrigin: 'https://server.example.test',
    exactPanelDocumentUrl: 'chrome-extension://owned/sidepanel.html',
    getVaultWriteCount: () => 0,
    snapshotOwnedReceiptState: () => [],
    assert: (condition, code) => assert.ok(condition, code),
    proof,
    verifyRealVaultPanel: async () => {},
  });
  assert.deepEqual(result, {
    initialPanelListReady: true,
    permissionLossClearsStaleList: true,
    permissionRecoveryRestoresServerList: true,
    offlineClearsStaleList: true,
    offlineRecoveryRestoresServerList: true,
    noVaultWritesOrReceiptChanges: true,
    interceptorsRemoved: true,
  });
  assert.equal(proof.setupTransportDiagnostics.forbidden.beforeDispose.refusedRequests, 1);
  assert.equal(proof.setupTransportDiagnostics.offline.afterDispose.pendingTasks, 0);
});
