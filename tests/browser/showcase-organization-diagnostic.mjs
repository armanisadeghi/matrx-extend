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
  'organization_product_request',
  'organization_bearer_read',
  'organization_observer_request',
  'organization_observer_response',
  'organization_observer_finished',
  'organization_observer_failed',
  'organization_observer_enable',
  'organization_tools_gate',
  'organization_tools_click',
  'organization_records_gate',
  'organization_records_click',
  'organization_request_wait',
  'organization_request_validate',
  'organization_observer_cleanup',
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
  'product_request_observed',
  'product_request_duplicate',
  'product_response_observed',
  'product_response_finished',
  'product_loading_failed',
  'observer_cleanup_success',
  'product_response_success',
  'product_header_matches',
  'product_principal_matches',
  'menu_open',
  'visible_option_count',
  'exact_match_count',
  'exact_visible_match_count',
  'target_in_viewport',
  'target_center_hit',
  'archive_filter',
  'records_target_match_count',
  'records_target_visible_count',
  'tools_panel_active',
  'tools_view_state',
  'tools_catalog_row_count',
  'tools_catalog_search_empty',
  'tools_catalog_filters_default',
]);
const KNOWN_FAILURES = new Set([
  ...[...SUBSTAGES].map((stage) => `${stage}_failed`),
  'showcase_organization_pointer_failed',
  'organization_resource_boundary_failed',
  'Organization_section_ready_not_observed',
  'Organization_expanded_not_observed',
  'd87_required_organization_picker_not_observed',
  'd87_member_organization_option_unavailable',
  'd87_required_organization_storage_not_observed',
  'd87_approved_organization_id_required',
  'd87_rendered_identity_not_observed',
  'd87_required_rendered_identity_unverified',
  'showcase_profile_changed',
  'showcase_organization_changed',
  'showcase_product_organization_request_not_observed',
  'showcase_tools_catalog_ready_not_observed',
  'showcase_product_organization_header_mismatch',
  'showcase_product_principal_mismatch',
  'showcase_product_response_failed',
  'showcase_authenticated_token_unavailable',
]);
const POINTER_FAILURES = new Set([
  'pointer_initial_evaluation_failed',
  'pointer_press_dispatch_failed',
  'pointer_release_dispatch_failed',
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
      key === 'tools_view_state' &&
      ['inactive', 'loading', 'catalog', 'other_tab', 'unknown'].includes(value)
    ) {
      diagnostic.observations[key] = value;
    } else if (
      [
        'visible_option_count',
        'exact_match_count',
        'exact_visible_match_count',
        'records_target_match_count',
        'records_target_visible_count',
        'tools_catalog_row_count',
      ].includes(key) &&
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
        'records_target_match_count',
        'records_target_visible_count',
        'tools_catalog_row_count',
        'tools_view_state',
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
  const code = message.split(/[:\n]/, 1)[0];
  return KNOWN_FAILURES.has(code) ? code : 'organization_unclassified_failure';
}

// The fallback is selected from our fixed stage vocabulary, never an external error string.
export function recordShowcaseOrganizationFailure(diagnostic, error) {
  if (diagnostic.substage === 'organization_records_click') {
    const pointer = error?.driverFailure;
    observeShowcaseOrganization(diagnostic, {
      records_target_match_count: pointer?.matchedTargetCount,
      records_target_visible_count: pointer?.visibleMatchCount,
      tools_panel_active: pointer?.toolsPanelActive,
      tools_view_state: pointer?.toolsViewState,
      tools_catalog_row_count: pointer?.toolsCatalogRowCount,
      tools_catalog_search_empty: pointer?.toolsCatalogSearchEmpty,
      tools_catalog_filters_default: pointer?.toolsCatalogFiltersDefault,
    });
  }
  const known = safeShowcaseOrganizationFailure(error);
  diagnostic.failure_code =
    known === 'organization_unclassified_failure'
      ? `${SUBSTAGES.has(diagnostic.substage) ? diagnostic.substage : 'organization_product_request'}_failed`
      : known;
}
