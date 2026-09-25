'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  _captureDiagnostic: captureDiagnostic,
  _recordCaptureDiagnostic: recordCaptureDiagnostic,
} = require('./vault-password-change-acceptance.cjs');

test('password-change diagnostic preserves only structural matching evidence', () => {
  assert.deepEqual(
    captureDiagnostic({
      candidatePresent: true,
      candidateTabMatchesActive: true,
      existingCount: 4,
      searchControlPresent: true,
      updateButtonCount: 4,
      unrelated: true,
    }),
    {
      snapshotUnavailable: false,
      candidatePresent: true,
      candidateTabMatchesActive: true,
      existingCount: 4,
      searchControlPresent: true,
      updateButtonCount: 4,
    },
  );
});

test('password-change diagnostic marks malformed counts as unavailable', () => {
  assert.deepEqual(captureDiagnostic({ existingCount: -1, updateButtonCount: '4' }), {
    snapshotUnavailable: false,
    candidatePresent: false,
    candidateTabMatchesActive: false,
    existingCount: null,
    searchControlPresent: false,
    updateButtonCount: null,
  });
});

test('password-change diagnostic failure is recorded without replacing the acceptance failure', async () => {
  const proof = {};
  await recordCaptureDiagnostic(proof, async () => {
    throw new Error('panel transport unavailable');
  }, 17);
  assert.deepEqual(proof.passwordChangeDiagnostic, {
    snapshotUnavailable: true,
    candidatePresent: false,
    candidateTabMatchesActive: false,
    existingCount: null,
    searchControlPresent: false,
    updateButtonCount: null,
  });
});
