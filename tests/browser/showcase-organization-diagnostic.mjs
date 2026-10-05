// Only fixed labels and booleans may cross into a hosted acceptance receipt.
const SUBSTAGES = new Set([
  'resource_gate',
  'organization_section',
  'organization_picker',
  'organization_select',
  'organization_skip',
  'organization_storage',
  'organization_rendered_identity',
  'organization_identity_read',
  'organization_identity_compare',
]);
const OBSERVATIONS = new Set([
  'admin_role_verified',
  'picker_available',
  'picker_has_selection',
  'selection_required',
  'storage_has_uuid',
  'storage_name_matches',
  'rendered_email_matches',
  'rendered_role_matches',
  'rendered_profile_matches',
  'rendered_organization_matches',
  'menu_open',
  'visible_option_count',
  'exact_match_count',
  'exact_visible_match_count',
  'target_in_viewport',
  'target_center_hit',
  'archive_filter',
]);
const KNOWN_FAILURES = new Set([
  'Organization_section_ready_not_observed',
  'Organization_expanded_not_observed',
  'd87_required_organization_picker_not_observed',
  'd87_member_organization_option_unavailable',
  'd87_required_organization_storage_not_observed',
  'd87_rendered_identity_not_observed',
  'd87_required_rendered_identity_unverified',
  'showcase_profile_changed',
  'showcase_organization_changed',
]);
const POINTER_FAILURES = new Set([
  'pointer_target_not_unique',
  'pointer_stable_hit_not_observed',
  'pointer_followup_evaluation_failed',
  'pointer_page_sample_failed',
]);

export function createShowcaseOrganizationDiagnostic() {
  return {
    substage: 'resource_gate',
    observations: {},
  };
}

export function observeShowcaseOrganization(diagnostic, values) {
  for (const [key, value] of Object.entries(values)) {
    if (!OBSERVATIONS.has(key)) continue;
    if (key === 'archive_filter' && ['active', 'archived', 'all', 'unknown'].includes(value)) {
      diagnostic.observations[key] = value;
    } else if (
      ['visible_option_count', 'exact_match_count', 'exact_visible_match_count'].includes(key) &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 10000
    ) {
      diagnostic.observations[key] = value;
    } else if (
      ![
        'archive_filter',
        'visible_option_count',
        'exact_match_count',
        'exact_visible_match_count',
      ].includes(key) &&
      (typeof value === 'boolean' || value === null)
    ) {
      diagnostic.observations[key] = value;
    }
  }
}

export function stageShowcaseOrganization(diagnostic, value) {
  if (SUBSTAGES.has(value)) diagnostic.substage = value;
}

export function safeShowcaseOrganizationFailure(error) {
  const pointer = error?.driverFailure?.code;
  if (POINTER_FAILURES.has(pointer)) return pointer;
  const message = error?.message;
  if (typeof message !== 'string') return 'organization_unclassified_failure';
  if (message.startsWith('NATIVE_RESOURCE_BOUNDARY_REFUSED:')) {
    return 'organization_resource_boundary_refused';
  }
  const code = message.split(':', 1)[0];
  return KNOWN_FAILURES.has(code) ? code : 'organization_unclassified_failure';
}
