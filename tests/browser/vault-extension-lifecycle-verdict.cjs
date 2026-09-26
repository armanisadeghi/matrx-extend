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
  if (!lifecycle || typeof lifecycle !== 'object')
    throw new Error('vault_lifecycle_evidence_missing');
  if (
    typeof lifecycle.initialIdentitySha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(lifecycle.initialIdentitySha256)
  )
    throw new Error('vault_lifecycle_initial_identity_fingerprint_invalid');

  for (const [name, required] of [
    [
      'extensionReload',
      [
        'settingsUiRecovered',
        'replacementWorkerObserved',
        'sameIdentityRecovered',
        'previousWorkerTargetRetired',
        'previousPanelTargetRetired',
      ],
    ],
    [
      'disableEnable',
      [
        'disabledInExtensionsUi',
        'enabledInExtensionsUi',
        'replacementWorkerObserved',
        'settingsUiRecovered',
        'sameIdentityRecovered',
      ],
    ],
    [
      'browserRestart',
      [
        'previousBrowserExited',
        'newBrowserProcessObserved',
        'settingsUiRecovered',
        'sameIdentityRecovered',
        'previousWorkerTargetGone',
        'previousPanelTargetGone',
        'replacementWorkerObserved',
        'replacementPanelObserved',
        'noVaultWrites',
        'replacementJournalBound',
        'postBindVaultReadRecovered',
        'launchProvenanceVerified',
      ],
    ],
  ]) {
    const evidence = lifecycle[name];
    requireDisposition(evidence, `vault_lifecycle_${name}`);
    requireTrue(evidence, required, `vault_lifecycle_${name}`);
    if (evidence.identitySha256 !== lifecycle.initialIdentitySha256)
      throw new Error(`vault_lifecycle_${name}_identity_changed`);
  }

  for (const kind of ['Worker', 'Panel']) {
    const initial = lifecycle.extensionReload[`initial${kind}TargetId`];
    const replacement = lifecycle.extensionReload[`replacement${kind}TargetId`];
    if (
      typeof initial !== 'string' ||
      typeof replacement !== 'string' ||
      !/^[A-Fa-f0-9]{32}$/.test(initial) ||
      !/^[A-Fa-f0-9]{32}$/.test(replacement) ||
      initial === replacement
    )
      throw new Error(`vault_lifecycle_extensionReload_${kind.toLowerCase()}_target_not_replaced`);
  }
  const restart = lifecycle.browserRestart;
  if (
    !Number.isSafeInteger(restart.previousBrowserPid) ||
    restart.previousBrowserPid <= 1 ||
    !Number.isSafeInteger(restart.replacementBrowserPid) ||
    restart.replacementBrowserPid <= 1 ||
    restart.previousBrowserPid === restart.replacementBrowserPid
  )
    throw new Error('vault_lifecycle_browserRestart_process_not_replaced');
  const custody = lifecycle.browserRestartCustody;
  const targetId = (value) => typeof value === 'string' && /^[A-Fa-f0-9]{32}$/.test(value);
  const sha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!sha256(custody?.profileSha256) || !sha256(custody?.executableSha256))
    throw new Error('vault_lifecycle_browserRestart_custody_source_invalid');
  if (
    custody?.initial?.browserPid !== restart.previousBrowserPid ||
    custody?.replacement?.browserPid !== restart.replacementBrowserPid ||
    custody.initial.cdpOwnerVerified !== true ||
    custody.replacement.cdpOwnerVerified !== true
  )
    throw new Error('vault_lifecycle_browserRestart_custody_process_invalid');
  for (const kind of ['worker', 'panel']) {
    const initial = custody.initial[`${kind}TargetId`];
    const replacement = custody.replacement[`${kind}TargetId`];
    if (!targetId(initial) || !targetId(replacement) || initial === replacement)
      throw new Error(`vault_lifecycle_browserRestart_custody_${kind}_invalid`);
  }
  if (custody.replacement.workerTargetId !== restart.replacementWorkerTargetId)
    throw new Error('vault_lifecycle_browserRestart_custody_worker_unbound');
  const journal = custody.replacement.journal;
  if (
    journal?.journalSemanticVersion !== 2 ||
    journal.boundTargetAttached !== true ||
    journal.panelItemsReadRequestSeen !== true ||
    journal.panelItemsReadResponse2xxSeen !== true ||
    journal.vaultMutationRequests !== 0 ||
    journal.observerError !== false ||
    journal.transportFatal !== false
  )
    throw new Error('vault_lifecycle_browserRestart_custody_journal_invalid');

  const signOut = lifecycle.signOut;
  requireDisposition(signOut, 'vault_lifecycle_sign_out');
  requireTrue(
    signOut,
    [
      'settingsSignOutClicked',
      'sidePanelShowsSignedOut',
      'localAuthMaterialAbsent',
      'activeOrganizationAbsent',
      'signedOutVaultHidden',
      'bearerlessVaultApiRefusal.refused',
      'bearerlessVaultApiRefusal.authorizationHeaderAbsent',
      'remoteLogout204',
    ],
    'vault_lifecycle_sign_out',
  );
  if (![401, 403].includes(signOut?.bearerlessVaultApiRefusal?.status))
    throw new Error('vault_lifecycle_sign_out_bearerless_api_status_invalid');

  const recovery = lifecycle.freshRecovery;
  requireDisposition(recovery, 'vault_lifecycle_fresh_recovery');
  requireTrue(
    recovery,
    [
      'interactiveSignInCompleted',
      'settingsUiRecovered',
      'localAuthMaterialPresent',
      'verifiedIdentityRecovered',
    ],
    'vault_lifecycle_fresh_recovery',
  );
  if (recovery.identitySha256 !== lifecycle.initialIdentitySha256)
    throw new Error('vault_lifecycle_fresh_recovery_identity_changed');

  const account = lifecycle.accountInvalidation;
  requireDisposition(account, 'vault_lifecycle_account_invalidation');
  requireTrue(
    account,
    [
      'preSignOutIdentityWasObserved',
      'signedOutBearerlessVaultRefused',
      'freshSameIdentityRecoveredAfterInteractiveSignIn',
    ],
    'vault_lifecycle_account_invalidation',
  );

  if (!requireOrganizationSwitch) return;
  const organization = lifecycle.organizationInvalidation;
  requireDisposition(organization, 'vault_lifecycle_organization_invalidation');
  requireTrue(
    organization,
    [
      'twoAdminMembershipsObserved',
      'oldOrganizationAuthorityRefusedAfterSwitch',
      'newOrganizationResolvedAfterSwitch',
      'personalVaultScopePreserved',
    ],
    'vault_lifecycle_organization_invalidation',
  );
  if (organization.oldOrganizationSha256 === organization.newOrganizationSha256)
    throw new Error('vault_lifecycle_organization_invalidation_identity_unchanged');
}

module.exports = { assertVaultExtensionLifecycleVerdict };
