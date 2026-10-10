import {
  accountIdentity,
  currentSettingsIdentityMatches,
  isNativeUuid,
  panelIdentity,
} from './settings-native-auth-driver.mjs';

// This report contains only fixed booleans. Raw account and storage values stay in memory.
export function settingsIdentityDiagnostic(value, expected) {
  const account = value ?? {};
  const expectedStorageOrganizationId =
    expected.organizationResolution === 'load_ladder' ? null : expected.organizationId;
  const organizationMatches =
    expected.organizationResolution === 'load_ladder'
      ? expected.mode === 'member' &&
        isNativeUuid(expected.organizationId) &&
        account.organizationId === null &&
        account.organizationName === null &&
        account.organizationSelected === true &&
        typeof expected.requiredOrganizationName === 'string' &&
        account.organizationLabel === expected.requiredOrganizationName
      : expected.organizationResolution !== undefined &&
          expected.organizationResolution !== 'device_choice'
        ? false
        : expected.organizationId === null
          ? !expected.requireSelectedOrganization &&
            account.organizationId === null &&
            account.organizationName === null
          : account.organizationId === expected.organizationId &&
            isNativeUuid(account.organizationId) &&
            Boolean(account.organizationSelected) &&
            account.organizationLabel === account.organizationName &&
            (!expected.requireSelectedOrganization ||
              (typeof expected.requiredOrganizationName === 'string' &&
                account.organizationName === expected.requiredOrganizationName &&
                account.organizationLabel === expected.requiredOrganizationName));
  return {
    email_matches: account.emailMatches === true,
    sign_out_visible: account.signOutVisible === true,
    access_token_present: account.accessTokenPresent === true,
    profile_matches: account.profileId === expected.profileId,
    role_matches:
      expected.mode === 'admin'
        ? account.adminRole === true && account.isAdmin === true
        : account.roleAbsent === true && account.adminRole !== true && account.isAdmin !== true,
    rendered_role_absent: account.roleAbsent === true,
    rendered_admin_role: account.adminRole === true,
    storage_admin_flag_true: account.isAdmin === true,
    expected_device_choice_absent: expectedStorageOrganizationId === null,
    stored_device_choice_absent:
      account.organizationId === null && account.organizationName === null,
    stored_organization_matches_expected: account.organizationId === expectedStorageOrganizationId,
    stored_organization_uuid_valid: isNativeUuid(account.organizationId),
    rendered_organization_selected: account.organizationSelected === true,
    rendered_organization_matches_storage:
      account.organizationLabel != null && account.organizationLabel === account.organizationName,
    organization_matches: Boolean(organizationMatches),
    identity_ready: currentSettingsIdentityMatches(value, expected),
  };
}

export async function readSettingsIdentityDiagnostic(panel, expected) {
  const [account, storage] = await Promise.allSettled([
    accountIdentity(panel, expected.email),
    panelIdentity(panel),
  ]);
  const value = {
    ...(account.status === 'fulfilled' ? account.value : {}),
    ...(storage.status === 'fulfilled' ? storage.value : {}),
  };
  return {
    account_read_succeeded: account.status === 'fulfilled',
    storage_read_succeeded: storage.status === 'fulfilled',
    ...settingsIdentityDiagnostic(value, expected),
  };
}

export async function recordSettingsIdentityFailure({
  report,
  panel,
  mode,
  operation,
  failureCode,
  expected,
  readDiagnostic = readSettingsIdentityDiagnostic,
}) {
  if (
    mode !== 'member' ||
    operation !== 'settings_ready' ||
    failureCode !== 'd87_rendered_identity_not_observed'
  )
    return;
  report.failure_identity_checks = await readDiagnostic(panel, expected).catch(() => null);
}
