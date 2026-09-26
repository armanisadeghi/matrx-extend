const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertVaultExtensionLifecycleVerdict } = require('./vault-extension-lifecycle-verdict.cjs');

const fingerprint = (value) => crypto.createHash('sha256').update(value).digest('hex');
const initialIdentitySha256 = fingerprint('admin identity observed by real settings panel');
const passed = {
  initialIdentitySha256,
  extensionReload: {
    disposition: 'passed',
    settingsUiRecovered: true,
    replacementWorkerObserved: true,
    sameIdentityRecovered: true,
    previousWorkerTargetRetired: true,
    previousPanelTargetRetired: true,
    initialWorkerTargetId: 'A'.repeat(32),
    replacementWorkerTargetId: 'B'.repeat(32),
    initialPanelTargetId: 'C'.repeat(32),
    replacementPanelTargetId: 'D'.repeat(32),
    identitySha256: initialIdentitySha256,
  },
  disableEnable: {
    disposition: 'passed',
    disabledInExtensionsUi: true,
    enabledInExtensionsUi: true,
    replacementWorkerObserved: true,
    settingsUiRecovered: true,
    sameIdentityRecovered: true,
    identitySha256: initialIdentitySha256,
  },
  browserRestart: {
    disposition: 'passed',
    previousBrowserExited: true,
    newBrowserProcessObserved: true,
    settingsUiRecovered: true,
    sameIdentityRecovered: true,
    previousWorkerTargetGone: true,
    previousPanelTargetGone: true,
    replacementWorkerObserved: true,
    replacementPanelObserved: true,
    noVaultWrites: true,
    replacementJournalBound: true,
    launchProvenanceVerified: true,
    previousBrowserPid: 101,
    replacementBrowserPid: 102,
    identitySha256: initialIdentitySha256,
  },
  signOut: {
    disposition: 'passed',
    settingsSignOutClicked: true,
    sidePanelShowsSignedOut: true,
    signedOutVaultHidden: true,
    localAuthMaterialAbsent: true,
    activeOrganizationAbsent: true,
    bearerlessVaultApiRefusal: { status: 401, authorizationHeaderAbsent: true, refused: true },
    remoteLogout204: true,
  },
  freshRecovery: {
    disposition: 'passed',
    interactiveSignInCompleted: true,
    settingsUiRecovered: true,
    localAuthMaterialPresent: true,
    verifiedIdentityRecovered: true,
    identitySha256: initialIdentitySha256,
  },
  accountInvalidation: {
    disposition: 'passed',
    preSignOutIdentityWasObserved: true,
    signedOutBearerlessVaultRefused: true,
    freshSameIdentityRecoveredAfterInteractiveSignIn: true,
  },
  organizationInvalidation: {
    disposition: 'passed',
    twoAdminMembershipsObserved: true,
    oldOrganizationAuthorityRefusedAfterSwitch: true,
    newOrganizationResolvedAfterSwitch: true,
    disposableRecordScopePreserved: true,
    oldOrganizationSha256: fingerprint('first admin organization'),
    newOrganizationSha256: fingerprint('second admin organization'),
  },
};

assert.doesNotThrow(() => assertVaultExtensionLifecycleVerdict({ lifecycle: passed }));
assert.doesNotThrow(() =>
  assertVaultExtensionLifecycleVerdict({
    lifecycle: { ...passed, organizationInvalidation: undefined },
    requireOrganizationSwitch: false,
  }),
);
for (const [section, prefix, field] of [
  ['extensionReload', 'extensionReload', 'replacementWorkerObserved'],
  ['disableEnable', 'disableEnable', 'disabledInExtensionsUi'],
  ['browserRestart', 'browserRestart', 'newBrowserProcessObserved'],
  ['signOut', 'sign_out', 'signedOutVaultHidden'],
  ['freshRecovery', 'fresh_recovery', 'interactiveSignInCompleted'],
  ['accountInvalidation', 'account_invalidation', 'signedOutBearerlessVaultRefused'],
  [
    'organizationInvalidation',
    'organization_invalidation',
    'oldOrganizationAuthorityRefusedAfterSwitch',
  ],
]) {
  assert.throws(
    () =>
      assertVaultExtensionLifecycleVerdict({
        lifecycle: { ...passed, [section]: { ...passed[section], [field]: false } },
      }),
    new RegExp(`vault_lifecycle_${prefix}_missing_${field}`),
  );
}
assert.throws(
  () =>
    assertVaultExtensionLifecycleVerdict({
      lifecycle: {
        ...passed,
        browserRestart: { ...passed.browserRestart, noVaultWrites: undefined },
      },
    }),
  /vault_lifecycle_browserRestart_missing_noVaultWrites/,
);
assert.throws(
  () =>
    assertVaultExtensionLifecycleVerdict({
      lifecycle: {
        ...passed,
        browserRestart: { ...passed.browserRestart, replacementBrowserPid: 101 },
      },
    }),
  /vault_lifecycle_browserRestart_process_not_replaced/,
);
assert.throws(
  () =>
    assertVaultExtensionLifecycleVerdict({
      lifecycle: {
        ...passed,
        extensionReload: {
          ...passed.extensionReload,
          previousPanelTargetRetired: false,
        },
      },
    }),
  /vault_lifecycle_extensionReload_missing_previousPanelTargetRetired/,
);
assert.throws(
  () =>
    assertVaultExtensionLifecycleVerdict({
      lifecycle: {
        ...passed,
        extensionReload: {
          ...passed.extensionReload,
          replacementPanelTargetId: passed.extensionReload.initialPanelTargetId,
        },
      },
    }),
  /vault_lifecycle_extensionReload_panel_target_not_replaced/,
);
assert.throws(
  () =>
    assertVaultExtensionLifecycleVerdict({
      lifecycle: {
        ...passed,
        freshRecovery: { ...passed.freshRecovery, identitySha256: fingerprint('different user') },
      },
    }),
  /vault_lifecycle_fresh_recovery_identity_changed/,
);
assert.throws(
  () =>
    assertVaultExtensionLifecycleVerdict({
      lifecycle: {
        ...passed,
        organizationInvalidation: {
          ...passed.organizationInvalidation,
          newOrganizationSha256: passed.organizationInvalidation.oldOrganizationSha256,
        },
      },
    }),
  /vault_lifecycle_organization_invalidation_identity_unchanged/,
);

// Mutation proof: a truthiness gate would accept a fabricated observation.
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'vault-extension-lifecycle-truthiness-'),
);
try {
  const sourcePath = path.join(__dirname, 'vault-extension-lifecycle-verdict.cjs');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const weakened = source.replace('if (value !== true)', 'if (!value)');
  assert.notEqual(weakened, source, 'truthiness_mutation_not_applied');
  const weakenedPath = path.join(temporaryRoot, 'vault-extension-lifecycle-verdict.cjs');
  fs.writeFileSync(weakenedPath, weakened);
  const { assertVaultExtensionLifecycleVerdict: weakenedGate } = require(weakenedPath);
  assert.doesNotThrow(() =>
    weakenedGate({
      lifecycle: {
        ...passed,
        signOut: { ...passed.signOut, signedOutVaultHidden: 'fabricated-truthy-value' },
      },
    }),
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(
  'PASS: Vault lifecycle evidence cannot mistake stale authority for recovery\n',
);
