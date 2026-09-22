const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  inspectIdentity,
  sameLifecycleIdentity,
  runExtensionReload,
  runSettingsSignOut,
  visibleSettingsControl,
  visibleVaultControl,
} = require('./vault-extension-lifecycle-acceptance.cjs');

(async () => {
  const state = {
    'matrx.user.profile': { id: '8ed08df2-2d6a-4f7d-a6f7-1a6b7c362cce' },
    'matrx.auth.accessToken': 'token',
    'matrx.auth.refreshTokenEnc': 'cipher',
    'matrx.auth.refreshTokenIv': 'iv',
    'matrx.org.active': { id: '439723a2-20cb-4531-8876-1b2e7c6e68ba' },
  };
  const snapshot = { userId: state['matrx.user.profile'].id, access: true, refresh: true, organization: true };
  const worker = { evaluate: async (fn) => fn.toString().includes('runtime.reload') ? undefined : snapshot };
  await assert.rejects(() => inspectIdentity({ evaluate: async () => ({ userId: null }) }), /lifecycle_initial_identity_unavailable/);
  const initialHash = crypto.createHash('sha256').update(snapshot.userId).digest('hex');
  assert.equal(sameLifecycleIdentity(initialHash, initialHash), true);
  assert.equal(sameLifecycleIdentity(initialHash, crypto.createHash('sha256').update('other').digest('hex')), false);
  assert.equal(sameLifecycleIdentity(undefined, initialHash), false);
  assert.match(visibleSettingsControl, /button\[title="Settings"\]/);
  assert.doesNotMatch(visibleSettingsControl, /textContent/);
  assert.match(visibleVaultControl, /button\[title="Vault"\]/);
  assert.doesNotMatch(visibleVaultControl, /textContent/);

  const reloadProof = {};
  const replacement = { ...worker };
  const returned = await runExtensionReload({ worker, refreshWorker: async () => replacement, verifySettingsIdentity: async () => true, checkpoint: () => {}, proof: reloadProof });
  assert.equal(returned, replacement);
  assert.equal(reloadProof.lifecycle.extensionReload.disposition, 'passed');

  const order = [];
  const signOutProof = {};
  await runSettingsSignOut({
    worker: { evaluate: async () => true },
    panel: {
      click: async () => { order.push('click'); },
      waitFor: async (expression) => { order.push(expression.includes("'Sign in'") ? 'signedout-ui-wait' : 'settings-wait'); },
      evaluate: async () => true,
    },
    checkpoint: () => {},
    proof: signOutProof,
    waitForLogout204: async () => { order.push('logout204'); return true; },
    verifySignedOutVaultHidden: async () => { order.push('vault-hidden'); return true; },
    verifyBearerlessVaultApiRefusal: async () => ({ status: 401, authorizationHeaderAbsent: true, refused: true }),
  });
  assert.ok(order.indexOf('logout204') < order.indexOf('signedout-ui-wait'), 'logout must be observed before later UI waits');
  assert.equal(signOutProof.lifecycle.signOut.disposition, 'passed');
  assert.equal(signOutProof.lifecycle.signOut.signedOutVaultHidden, true);
  assert.deepEqual(signOutProof.lifecycle.signOut.bearerlessVaultApiRefusal, { status: 401, authorizationHeaderAbsent: true, refused: true });
  process.stdout.write('PASS: lifecycle helpers require actual signed-out UI, hidden Vault navigation, and bearerless API refusal\n');
})().catch((error) => { console.error(error); process.exitCode = 1; });
