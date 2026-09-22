/* Real extension lifecycle actions. The caller supplies CDP-backed worker and
 * panel handles from vault-realbrowser-acceptance; no DOM state is fabricated. */
const crypto = require('node:crypto');

const assert = (value, code) => { if (!value) throw new Error(code); };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function inspectIdentity(worker) {
  const session = await worker.evaluate(async () => {
    const keys = ['matrx.user.profile', 'matrx.auth.accessToken', 'matrx.auth.refreshTokenEnc', 'matrx.auth.refreshTokenIv', 'matrx.org.active'];
    const value = await chrome.storage.local.get(keys);
    return {
      userId: typeof value['matrx.user.profile']?.id === 'string' ? value['matrx.user.profile'].id : null,
      access: typeof value['matrx.auth.accessToken'] === 'string',
      refresh: typeof value['matrx.auth.refreshTokenEnc'] === 'string' && typeof value['matrx.auth.refreshTokenIv'] === 'string',
      organization: typeof value['matrx.org.active']?.id === 'string',
    };
  });
  assert(typeof session?.userId === 'string' && session.access && session.refresh, 'lifecycle_initial_identity_unavailable');
  return { identitySha256: hash(session.userId), activeOrganizationPresent: session.organization === true };
}

async function runExtensionReload({ worker, refreshWorker, verifySettingsIdentity, checkpoint, proof }) {
  const before = await inspectIdentity(worker);
  checkpoint('lifecycle_extension_reload');
  await worker.evaluate(() => chrome.runtime.reload());
  const replacement = await refreshWorker(worker);
  const after = await inspectIdentity(replacement);
  const settingsUiRecovered = await verifySettingsIdentity(after.identitySha256);
  proof.lifecycle ||= {};
  proof.lifecycle.initialIdentitySha256 ||= before.identitySha256;
  proof.lifecycle.extensionReload = {
    disposition: before.identitySha256 === after.identitySha256 && settingsUiRecovered ? 'passed' : 'failed',
    replacementWorkerObserved: replacement !== worker,
    sameIdentityRecovered: before.identitySha256 === after.identitySha256,
    settingsUiRecovered,
    identitySha256: after.identitySha256,
  };
  return replacement;
}

async function runSettingsSignOut({ worker, panel, checkpoint, proof, waitForLogout204, verifyBearerlessVaultRefusal }) {
  checkpoint('lifecycle_settings_sign_out');
  // Settings is the product navigation item; use the real CDP click helper.
  await panel.click(`Array.from(document.querySelectorAll('button')).find((element) => element.textContent.trim() === 'Settings')`);
  await panel.waitFor(`document.body.innerText.includes('Settings')`);
  await panel.click(`Array.from(document.querySelectorAll('button')).find((element) => element.textContent.trim() === 'Sign out')`);
  await panel.waitFor(`document.body.innerText.includes('Sign in to start using the extension')`);
  const cleared = await worker.evaluate(async () => {
    const keys = ['matrx.user.profile', 'matrx.auth.accessToken', 'matrx.auth.refreshTokenEnc', 'matrx.auth.refreshTokenIv', 'matrx.org.active'];
    const value = await chrome.storage.local.get(keys);
    return keys.every((key) => value[key] === undefined);
  });
  const remoteLogout204 = await waitForLogout204();
  const vaultRequestRefusedWithoutBearer = await verifyBearerlessVaultRefusal();
  proof.lifecycle ||= {};
  proof.lifecycle.signOut = {
    disposition: cleared && remoteLogout204 && vaultRequestRefusedWithoutBearer ? 'passed' : 'failed', settingsSignOutClicked: true,
    settingsUiShowsSignedOut: true, localAuthMaterialAbsent: cleared,
    activeOrganizationAbsent: cleared,
    remoteLogout204,
    vaultRequestRefusedWithoutBearer,
  };
  assert(cleared && remoteLogout204 && vaultRequestRefusedWithoutBearer, 'lifecycle_sign_out_evidence_incomplete');
}

module.exports = { inspectIdentity, runExtensionReload, runSettingsSignOut };
