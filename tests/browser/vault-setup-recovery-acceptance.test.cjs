'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { allMatchingVaultListReadsRefused } = require('./vault-setup-recovery-acceptance.cjs');

test('requires every observed matching Vault list read to be refused', () => {
  assert.equal(allMatchingVaultListReadsRefused({ matchingRequests: 2, refusedRequests: 2, observerErrors: 0 }), true);
  assert.equal(allMatchingVaultListReadsRefused({ matchingRequests: 0, refusedRequests: 0, observerErrors: 0 }), false);
  assert.equal(allMatchingVaultListReadsRefused({ matchingRequests: 2, refusedRequests: 1, observerErrors: 0 }), false);
  assert.equal(allMatchingVaultListReadsRefused({ matchingRequests: 2, refusedRequests: 2, observerErrors: 1 }), false);
});
