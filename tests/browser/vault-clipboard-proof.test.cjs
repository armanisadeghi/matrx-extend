'use strict';
const assert = require('node:assert/strict');
const { hasIsolatedHeadlessClipboardProof } = require('./vault-generator-acceptance.cjs');

const valid = () => ({
  clipboardIsolation: {
    runtime: 'Chrome/153.0.8010.12',
    ownedHeadlessProcess: true,
    sourceAndProbe: 'd37f9103-bbb3-4eb3-9cf2-537eb75c7339',
  },
  generator: {
    displayMode: 'HEADLESS_NO_CLIPBOARD',
    positiveGeneratorUi: true,
    clipboard: {
      freshProcessClipboardEmpty: true,
      copyAttempted: true,
      disposition: 'owned_value_replaced',
    },
    checks: {
      passwordCopyNativePasteAndOwnedGeneratedClipboardReplacementVerified: true,
      passwordCopyControlledFailureCustody: true,
    },
    ownedFixtureServersClosed: true,
  },
});

assert.equal(hasIsolatedHeadlessClipboardProof(valid()), true);
const mutations = [
  (proof) => { proof.clipboardIsolation.runtime = 'Chrome/152.0.0.0'; },
  (proof) => { proof.clipboardIsolation.ownedHeadlessProcess = false; },
  (proof) => { proof.clipboardIsolation.sourceAndProbe = 'unreviewed'; },
  (proof) => { proof.generator.displayMode = 'HEADED'; },
  (proof) => { proof.generator.positiveGeneratorUi = false; },
  (proof) => { proof.generator.clipboard.freshProcessClipboardEmpty = false; },
  (proof) => { proof.generator.clipboard.copyAttempted = false; },
  (proof) => { proof.generator.clipboard.disposition = 'unknown'; },
  (proof) => { proof.generator.checks.passwordCopyNativePasteAndOwnedGeneratedClipboardReplacementVerified = false; },
  (proof) => { proof.generator.checks.passwordCopyControlledFailureCustody = false; },
  (proof) => { proof.generator.ownedFixtureServersClosed = false; },
];
for (const mutate of mutations) {
  const proof = valid();
  mutate(proof);
  assert.equal(hasIsolatedHeadlessClipboardProof(proof), false);
}
assert.equal(hasIsolatedHeadlessClipboardProof({}), false);
process.stdout.write('PASS: isolated headless clipboard proof requires every runtime, Copy, custody, and cleanup fact\n');
