/* Real extension lifecycle actions. The caller supplies CDP-backed worker and
 * panel handles from vault-realbrowser-acceptance; no DOM state is fabricated. */
const crypto = require('node:crypto');

const assert = (value, code) => { if (!value) throw new Error(code); };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
// Settings is an icon-only navigation control. Scope it by its stable title
// and rendered geometry; a hidden duplicate remains an ambiguity, never a click.
const visibleSettingsControl = `(() => {
  const controls = Array.from(document.querySelectorAll('button[title="Settings"]')).filter((button) => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && button.getAttribute('aria-hidden') !== 'true';
  });
  return controls.length === 1 ? controls[0] : null;
})()`;
const visibleVaultControl = `(() => {
  const controls = Array.from(document.querySelectorAll('button[title="Vault"]')).filter((button) => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && button.getAttribute('aria-hidden') !== 'true';
  });
  return controls.length === 1 ? controls[0] : null;
})()`;
const signedOutSidePanelPredicate = `(() => {
  const visibleButtons = Array.from(document.querySelectorAll('button')).filter((button) => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && button.getAttribute('aria-hidden') !== 'true';
  });
  return visibleButtons.filter((button) => button.textContent.trim() === 'Sign in').length === 1
    && visibleButtons.filter((button) => button.textContent.trim() === 'Sign out').length === 0;
})()`;

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

function sameLifecycleIdentity(initialIdentitySha256, recoveredIdentitySha256) {
  return typeof initialIdentitySha256 === 'string'
    && /^[a-f0-9]{64}$/.test(initialIdentitySha256)
    && initialIdentitySha256 === recoveredIdentitySha256;
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
    disposition: sameLifecycleIdentity(before.identitySha256, after.identitySha256) && settingsUiRecovered ? 'passed' : 'failed',
    replacementWorkerObserved: replacement !== worker,
    sameIdentityRecovered: before.identitySha256 === after.identitySha256,
    settingsUiRecovered,
    identitySha256: after.identitySha256,
  };
  return replacement;
}

async function runSettingsSignOut({ worker, panel, checkpoint, proof, waitForLogout204, verifyBearerlessVaultApiRefusal, verifySignedOutVaultHidden }) {
  checkpoint('lifecycle_settings_sign_out');
  // Settings is the product navigation item; use the real CDP click helper.
  await panel.click(visibleSettingsControl);
  await panel.waitFor(`document.body.innerText.includes('Settings')`);
  await panel.click(`Array.from(document.querySelectorAll('button')).find((element) => element.textContent.trim() === 'Sign out')`);
  const remoteLogout204 = await waitForLogout204();
  const cleared = await worker.evaluate(async () => {
    const keys = ['matrx.user.profile', 'matrx.auth.accessToken', 'matrx.auth.refreshTokenEnc', 'matrx.auth.refreshTokenIv', 'matrx.org.active'];
    const value = await chrome.storage.local.get(keys);
    return keys.every((key) => value[key] === undefined);
  });
  await panel.waitFor(signedOutSidePanelPredicate);
  const sidePanelShowsSignedOut = await panel.evaluate(signedOutSidePanelPredicate);
  const signedOutVaultHidden = await verifySignedOutVaultHidden();
  const bearerlessVaultApiRefusal = await verifyBearerlessVaultApiRefusal();
  proof.lifecycle ||= {};
  proof.lifecycle.signOut = {
    disposition: cleared && remoteLogout204 && sidePanelShowsSignedOut && signedOutVaultHidden && bearerlessVaultApiRefusal?.refused ? 'passed' : 'failed', settingsSignOutClicked: true,
    sidePanelShowsSignedOut, signedOutVaultHidden, localAuthMaterialAbsent: cleared,
    activeOrganizationAbsent: cleared,
    remoteLogout204,
    bearerlessVaultApiRefusal,
  };
  assert(cleared && remoteLogout204 && sidePanelShowsSignedOut && signedOutVaultHidden && bearerlessVaultApiRefusal?.refused, 'lifecycle_sign_out_evidence_incomplete');
}

module.exports = { inspectIdentity, sameLifecycleIdentity, runExtensionReload, runSettingsSignOut, visibleSettingsControl, visibleVaultControl, signedOutSidePanelPredicate };
