import assert from 'node:assert/strict';

export const DEBUG_MODE_STORAGE_KEY = 'matrx.store.debug-mode';
export const ADMIN_TAB_TITLES = [
  'Showcase (admin only)',
  'Pilot (admin only — sandboxed tab group)',
  'Token broker (admin only)',
  'Debug (admin only)',
];

export function parseDebugModePreference(storageValue) {
  if (storageValue === undefined || storageValue === null) return false;
  if (typeof storageValue !== 'string') throw new Error('debug_mode_storage_shape_invalid');
  let persisted;
  try {
    persisted = JSON.parse(storageValue);
  } catch {
    throw new Error('debug_mode_storage_json_invalid');
  }
  if (typeof persisted?.state?.on !== 'boolean')
    throw new Error('debug_mode_storage_preference_invalid');
  return persisted.state.on;
}

export function requireAdminTabProjection({ isVerifiedAdmin, debugModeOn, visibleAdminTabTitles }) {
  assert.equal(typeof isVerifiedAdmin, 'boolean', 'verified_admin_state_required');
  assert.equal(typeof debugModeOn, 'boolean', 'debug_preference_state_required');
  const expected = isVerifiedAdmin && debugModeOn ? ADMIN_TAB_TITLES : [];
  assert.deepEqual(visibleAdminTabTitles, expected, 'admin_tab_projection_mismatch');
  return expected.length > 0;
}

const ADMIN_AUTH_STAGES = new Set([
  'admin_credentials',
  'admin_web_navigation',
  'admin_web_route',
  'admin_credentials_read',
  'admin_web_form_fill',
  'admin_web_submit',
  'admin_extension_settings_click',
  'admin_extension_account_open',
  'admin_extension_signin_ready',
  'admin_extension_click',
  'admin_extension_auth_completion',
]);

const ADMIN_AUTH_OUTCOMES = new Set([
  'extension_completion_unobserved',
  'other_admin_auth_failure',
  'rendered_identity_unobserved',
  'rendered_identity_check_failed',
]);

const ADMIN_AUTH_CLICK_FAILURES = new Set([
  'pointer_initial_evaluation_failed',
  'pointer_page_sample_failed',
  'pointer_target_not_unique',
  'pointer_followup_evaluation_failed',
  'pointer_stable_hit_not_observed',
  'pointer_press_dispatch_failed',
  'pointer_release_dispatch_failed',
  'other',
]);

const ADMIN_AUTH_BOOLEAN_FIELDS = [
  'web_dashboard_reached',
  'settings_panel_active',
  'account_expanded',
  'sign_in_present',
  'sign_out_present',
  'auth_error_present',
  'auth_retry_present',
  'loading_present',
  'rendered_admin_email',
  'rendered_admin_role',
  'organization_selector_present',
  'storage_access_token_present',
  'storage_profile_present',
  'storage_admin_flag',
];

export function projectAdminAuthStage(stage) {
  return ADMIN_AUTH_STAGES.has(stage) ? stage : 'unknown_admin_phase';
}

export function projectAdminAuthDiagnostic(value) {
  const booleanOrNull = (item) => (typeof item === 'boolean' ? item : null);
  const outcome = ADMIN_AUTH_OUTCOMES.has(value?.outcome)
    ? value.outcome
    : 'other_admin_auth_failure';
  return {
    phase: projectAdminAuthStage(value?.phase),
    outcome,
    extension_click_failure_code: ADMIN_AUTH_CLICK_FAILURES.has(value?.extension_click_failure_code)
      ? value.extension_click_failure_code
      : null,
    ...Object.fromEntries(
      ADMIN_AUTH_BOOLEAN_FIELDS.map((key) => [key, booleanOrNull(value?.[key])]),
    ),
    http_category: value?.http_category === 'unobserved' ? 'unobserved' : 'other',
  };
}
