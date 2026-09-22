/*
 * Admission for the standalone real-browser Vault lifecycle probe.
 *
 * These fields are observations from the loaded extension and its actual
 * settings UI; they deliberately cannot be satisfied by a storage fixture or
 * a synthetic auth-state broadcast.  In particular, a restarted worker is
 * insufficient unless the side panel has re-hydrated the same signed-in
 * identity, and a signed-out panel is insufficient unless the real Vault API
 * refuses a request that deliberately omits Authorization.
 */

function requireTrue(record, fields, prefix) {
  for (const field of fields) {
    const value = field.split('.').reduce((current, key) => current?.[key], record);
    if (value !== true) throw new Error(`${prefix}_missing_${field.replace('.', '_')}`);
  }
}

function requireDisposition(record, prefix) {
  if (record?.disposition !== 'passed') throw new Error(`${prefix}_not_passed`);
}

function assertVaultExtensionLifecycleVerdict({ lifecycle, requireOrganizationSwitch = true }) {
  if (!lifecycle || typeof lifecycle !== 'object') throw new Error('vault_lifecycle_evidence_missing');
  if (typeof lifecycle.initialIdentitySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(lifecycle.initialIdentitySha256))
    throw new Error('vault_lifecycle_initial_identity_fingerprint_invalid');

  for (const [name, required] of [
    ['extensionReload', ['settingsUiRecovered', 'replacementWorkerObserved', 'sameIdentityRecovered']],
    ['disableEnable', ['disabledInExtensionsUi', 'enabledInExtensionsUi', 'replacementWorkerObserved', 'settingsUiRecovered', 'sameIdentityRecovered']],
    ['browserRestart', ['previousBrowserExited', 'newBrowserProcessObserved', 'settingsUiRecovered', 'sameIdentityRecovered']],
  ]) {
    const evidence = lifecycle[name];
    requireDisposition(evidence, `vault_lifecycle_${name}`);
    requireTrue(evidence, required, `vault_lifecycle_${name}`);
    if (evidence.identitySha256 !== lifecycle.initialIdentitySha256)
      throw new Error(`vault_lifecycle_${name}_identity_changed`);
  }

  const signOut = lifecycle.signOut;
  requireDisposition(signOut, 'vault_lifecycle_sign_out');
  requireTrue(signOut, [
    'settingsSignOutClicked',
    'settingsUiShowsSignedOut',
    'localAuthMaterialAbsent',
    'activeOrganizationAbsent',
    'signedOutVaultHidden',
    'bearerlessVaultApiRefusal.refused',
    'bearerlessVaultApiRefusal.authorizationHeaderAbsent',
    'remoteLogout204',
  ], 'vault_lifecycle_sign_out');
  if (![401, 403].includes(signOut?.bearerlessVaultApiRefusal?.status))
    throw new Error('vault_lifecycle_sign_out_bearerless_api_status_invalid');

  const recovery = lifecycle.freshRecovery;
  requireDisposition(recovery, 'vault_lifecycle_fresh_recovery');
  requireTrue(recovery, [
    'interactiveSignInCompleted',
    'settingsUiRecovered',
    'localAuthMaterialPresent',
    'verifiedIdentityRecovered',
  ], 'vault_lifecycle_fresh_recovery');
  if (recovery.identitySha256 !== lifecycle.initialIdentitySha256)
    throw new Error('vault_lifecycle_fresh_recovery_identity_changed');

  const account = lifecycle.accountInvalidation;
  requireDisposition(account, 'vault_lifecycle_account_invalidation');
  requireTrue(account, [
    'preSignOutIdentityWasObserved',
    'oldIdentityAuthorityRefusedAfterSignOut',
    'freshIdentityOnlyAfterInteractiveSignIn',
  ], 'vault_lifecycle_account_invalidation');

  if (!requireOrganizationSwitch) return;
  const organization = lifecycle.organizationInvalidation;
  requireDisposition(organization, 'vault_lifecycle_organization_invalidation');
  requireTrue(organization, [
    'twoAdminMembershipsObserved',
    'oldOrganizationAuthorityRefusedAfterSwitch',
    'newOrganizationResolvedAfterSwitch',
    'disposableRecordScopePreserved',
  ], 'vault_lifecycle_organization_invalidation');
  if (organization.oldOrganizationSha256 === organization.newOrganizationSha256)
    throw new Error('vault_lifecycle_organization_invalidation_identity_unchanged');
}

module.exports = { assertVaultExtensionLifecycleVerdict };
