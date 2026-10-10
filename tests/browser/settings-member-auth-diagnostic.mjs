const STAGES = new Set([
  'member_credential_validation',
  'member_web_identity_observation',
  'member_demo_route_assertion',
  'member_extension_signin_ready',
  'member_extension_token_observation',
  'member_nonadmin_role_observation',
  'member_organization_availability',
  'member_organization_selection',
  'member_organization_selected',
  'member_organization_storage_resolution',
  'member_rendered_identity',
]);

const ASSERTION_CODES = new Set([
  'd87_auth_mode_invalid',
  'd87_auth_secret_invalid',
  'd87_member_link_file_required',
  'd87_member_link_file_not_private',
  'd87_member_fingerprint_mismatch',
  'd87_member_link_invalid',
  'd87_member_expected_organization_unverified',
  'd87_demo_route_unverified',
  'd87_member_consent_unavailable',
  'd87_member_organization_label_unverified',
  'd87_member_organization_uuid_unverified',
  'd87_member_organization_storage_unverified',
  'd87_member_organization_mismatch',
  'reviewer_web_identity_unverified',
  'reviewer_canonical_nonadmin_role_unverified',
]);

const WAIT_CODES = new Set([
  'd87_web_identity',
  'd87_extension_signin_ready',
  'd87_extension_identity',
  'd87_member_organization',
  'd87_member_organization_selected',
  'd87_member_organization_option_unavailable',
  'd87_rendered_identity',
]);

const POINTER_CODES = new Set([
  'pointer_initial_evaluation_failed',
  'pointer_page_sample_failed',
  'pointer_target_not_unique',
  'pointer_followup_evaluation_failed',
  'pointer_stable_hit_not_observed',
  'pointer_press_dispatch_failed',
  'pointer_release_dispatch_failed',
  'other',
]);

export function safeMemberAuthFailureCode(error, stage) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const prefix = message.split(':', 1)[0];
  if (ASSERTION_CODES.has(prefix)) return prefix;
  for (const label of WAIT_CODES) {
    if (prefix === `${label}_not_observed`) return prefix;
  }
  if (POINTER_CODES.has(error?.driverFailure?.code)) return error.driverFailure.code;
  if (error?.code === 'ERR_ASSERTION' && STAGES.has(stage)) return `${stage}_assertion_failed`;
  return STAGES.has(stage) ? `${stage}_failed` : 'member_auth_failed';
}

export function memberAuthFailureReport(error, fallbackStage) {
  const stage = STAGES.has(error?.memberAuthBoundary)
    ? error.memberAuthBoundary
    : typeof fallbackStage === 'string' && /^[a-z][a-z0-9_:-]{1,80}$/.test(fallbackStage)
      ? fallbackStage
      : 'unknown';
  return {
    stage,
    code: STAGES.has(error?.memberAuthBoundary)
      ? error.memberAuthFailureCode
      : safeMemberAuthFailureCode(error, stage),
  };
}

export async function runMemberAuthBoundary(stage, onStage, action) {
  if (!STAGES.has(stage)) throw new Error('member_auth_diagnostic_stage_invalid');
  onStage?.(stage);
  try {
    return await action();
  } catch (error) {
    const diagnostic = new Error('member_auth_boundary_failed');
    diagnostic.memberAuthBoundary = stage;
    diagnostic.memberAuthFailureCode = safeMemberAuthFailureCode(error, stage);
    if (POINTER_CODES.has(error?.driverFailure?.code))
      diagnostic.driverFailure = { code: error.driverFailure.code };
    throw diagnostic;
  }
}

export function observeMemberExtensionIdentity({
  onStage,
  clickSignIn,
  openOrganization,
  waitForIdentity,
}) {
  return runMemberAuthBoundary('member_extension_token_observation', onStage, async () => {
    await clickSignIn();
    await openOrganization();
    return waitForIdentity();
  });
}
