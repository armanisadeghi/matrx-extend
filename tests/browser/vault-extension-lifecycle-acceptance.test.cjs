const assert = require('node:assert/strict');
const { inspectIdentity, sameLifecycleIdentity, runExtensionReload } = require('./vault-extension-lifecycle-acceptance.cjs');
const state = { 'matrx.user.profile': { id: '8ed08df2-2d6a-4f7d-a6f7-1a6b7c362cce' }, 'matrx.auth.accessToken': 'token', 'matrx.auth.refreshTokenEnc': 'cipher', 'matrx.auth.refreshTokenIv': 'iv', 'matrx.org.active': { id: '439723a2-20cb-4531-8876-1b2e7c6e68ba' } };
const snapshot = { userId: state['matrx.user.profile'].id, access: true, refresh: true, organization: true };
const worker = { evaluate: async (fn) => fn.toString().includes('runtime.reload') ? undefined : snapshot };
// The adapter must execute the actual Chrome function shape, never return a fixture directly.
assert.rejects(() => inspectIdentity({ evaluate: async () => ({ userId: null }) }), /lifecycle_initial_identity_unavailable/);
const initialHash = require('node:crypto').createHash('sha256').update(snapshot.userId).digest('hex');
assert.equal(sameLifecycleIdentity(initialHash, initialHash), true);
assert.equal(sameLifecycleIdentity(initialHash, require('node:crypto').createHash('sha256').update('other').digest('hex')), false);
assert.equal(sameLifecycleIdentity(undefined, initialHash), false);
const proof = {};
const replacement = { ...worker };
runExtensionReload({ worker, refreshWorker: async () => replacement, verifySettingsIdentity: async () => true, checkpoint: () => {}, proof }).then((returned) => {
  assert.equal(returned, replacement);
  assert.equal(proof.lifecycle.extensionReload.disposition, 'passed');
  process.stdout.write('PASS: lifecycle reload observes extension storage through its worker\n');
});
