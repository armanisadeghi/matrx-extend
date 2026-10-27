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
  'member_logical_organization_proof',
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
  'member_logical_org_backend_not_production',
  'member_logical_org_backend_override_present',
  'd87_member_backend_origin_unverified',
  'd87_member_logical_organization_ambiguous',
  'd87_member_logical_organization_unauthenticated',
  'd87_member_logical_organization_mismatch',
  'd87_member_logical_organization_get_failed',
  'd87_member_logical_organization_not_armed',
]);

const WAIT_CODES = new Set([
  'd87_web_identity',
  'd87_extension_signin_ready',
  'd87_extension_identity',
  'd87_member_organization',
  'd87_member_organization_selected',
  'd87_member_organization_option_unavailable',
  'd87_rendered_identity',
  'd87_member_logical_organization_get',
  'showcase_tools_catalog_ready',
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

// Read only owned data properties: accessors and proxies cannot replace the primary failure.
function ownValue(value, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

const POINTER_FIELDS = {
  matched_target_count: ['matchedTargetCount', 'count'],
  visible_target_count: ['visibleMatchCount', 'count'],
  hit_target: ['hitTarget', 'boolean'],
  animating: ['animating', 'boolean'],
  position_stable: ['positionStable', 'boolean'],
  stable_samples: ['stableSamples', 'count'],
  target_has_area: ['targetHasArea', 'boolean'],
  clipped_target_has_area: ['clippedTargetHasArea', 'boolean'],
  selected_point_available: ['selectedPointAvailable', 'boolean'],
  target_disabled: ['targetDisabled', 'boolean'],
  pointer_events_none: ['pointerEventsNone', 'boolean'],
  clipping_ancestor_count: ['clippingAncestorCount', 'count'],
  tested_point_count: ['testedPointCount', 'count'],
  animation_category: ['animationCategory', ['none', 'color_only', 'hit_affecting_or_unknown']],
  center_hit_category: [
    'centerHitCategory',
    [
      'none',
      'target',
      'dialog',
      'listbox',
      'modal_overlay',
      'target_ancestor',
      'header_or_tabs',
      'other_element',
    ],
  ],
};

/** Project only finite, non-content pointer facts already sampled by the driver. */
export function safeMemberPointerDiagnostic(value, projected = false) {
  const result = {};
  for (const [key, [source, type]] of Object.entries(POINTER_FIELDS)) {
    const item = ownValue(value, projected ? key : source);
    if (type === 'boolean' && typeof item === 'boolean') result[key] = item;
    else if (type === 'count' && Number.isSafeInteger(item) && item >= 0 && item <= 100)
      result[key] = item;
    else if (Array.isArray(type) && type.includes(item)) result[key] = item;
  }
  return result;
}

export function safeMemberAuthFailureCode(error, stage) {
  const rawMessage = ownValue(error, 'message');
  const message = typeof rawMessage === 'string' ? rawMessage : '';
  const prefix = message.split(':', 1)[0];
  if (ASSERTION_CODES.has(prefix)) return prefix;
  for (const label of WAIT_CODES) {
    if (prefix === `${label}_not_observed`) return prefix;
  }
  const pointerCode = ownValue(ownValue(error, 'driverFailure'), 'code');
  if (POINTER_CODES.has(pointerCode)) return pointerCode;
  if (ownValue(error, 'code') === 'ERR_ASSERTION' && STAGES.has(stage))
    return `${stage}_assertion_failed`;
  return STAGES.has(stage) ? `${stage}_failed` : 'member_auth_failed';
}

export function memberAuthFailureReport(error, fallbackStage) {
  const boundary = ownValue(error, 'memberAuthBoundary');
  const stage = STAGES.has(boundary)
    ? boundary
    : typeof fallbackStage === 'string' && /^[a-z][a-z0-9_:-]{1,80}$/.test(fallbackStage)
      ? fallbackStage
      : 'unknown';
  return {
    stage,
    code: STAGES.has(boundary)
      ? ownValue(error, 'memberAuthFailureCode')
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
    const failure = ownValue(error, 'driverFailure');
    const code = ownValue(failure, 'code');
    if (POINTER_CODES.has(code))
      diagnostic.driverFailure = { code, ...safeMemberPointerDiagnostic(failure) };
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
