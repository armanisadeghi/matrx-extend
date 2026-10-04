const POINTER_CODES = new Set([
  'pointer_initial_evaluation_failed',
  'pointer_page_sample_failed',
  'pointer_target_not_unique',
  'pointer_followup_evaluation_failed',
  'pointer_stable_hit_not_observed',
  'pointer_press_dispatch_failed',
  'pointer_release_dispatch_failed',
]);
const POINTER_CALLS = new Set([
  'account_menu',
  'profile_menu_item',
  'back_from_draft',
  'back_after_save',
  'back_after_restore',
  'back_before_owner_read_denial',
  'account_menu_for_retry',
  'profile_menu_item_for_retry',
  'retry_owner_read',
]);
const PROFILE_RESTORATION_STAGES = new Set([
  'fault_teardown',
  'journal_reconcile',
  'restore_profile_ui',
  'restore_owned_write',
  'verify_restored_reopen',
  'discard_local_draft',
]);
const PROFILE_FIELD_PHASES = new Set([
  'fill',
  'draft_assert',
  'save',
  'journal_before_action',
  'save_click',
  'save_settled',
  'journal_after_action',
  'reopen',
]);
const PROFILE_FIELD_NAMES = new Set([
  'First name',
  'Middle',
  'Last name',
  'Preferred',
  'Suffix',
  'Pronouns',
  'Birthday',
  'Company',
  'Title',
]);
const PROFILE_EXPANDER_PHASES = new Set([
  'ensure_open',
  'sample_original',
  'fill',
  'sample_section',
  'expand',
  'collapse',
  'reexpand',
  'draft_assert',
  'discard',
  'discard_assert',
]);
const PROFILE_EXPANDER_SECTIONS = new Set([
  'Identity',
  'Phones',
  'Emails',
  'Web',
  'Shipping address',
  'Billing address',
  'Employment',
  'Emergency contacts',
]);
const PROFILE_FAILURE_CODES = new Set([
  ...POINTER_CODES,
  'profile_original_row_absent_mutation_refused',
  'profile_initial_load_failed',
  'profile_owner_get_failed',
  'profile_owner_get_status',
  'profile_owner_delete_failed',
  'profile_owner_delete_status',
  'profile_owner_row_not_unique',
  'owned_profile_cleanup_row_missing',
  'owned_profile_conditional_delete_missed',
  'owned_profile_deleted_wrong_owner',
  'owned_profile_absence_not_restored',
  'owned_delete_concurrent_change',
  'owned_delete_marker_changed',
  'owned_delete_organization_changed',
  'owned_delete_owner_changed',
  'owned_delete_row_missing',
  'owned_delete_row_replaced',
  'owned_delete_version_invalid',
  'owned_write_unverified',
  'first_save_row_missing',
  'first_save_was_not_an_insert',
  'first_save_mode_unverified',
  'first_save_first_party_identity_unverified',
  'first_save_identity_mismatch',
  'first_save_token_missing',
  'first_save_role_mismatch',
  'first_save_device_organization_unverified',
  'first_save_designated_admin_unverified',
  'first_save_organization_mismatch',
  'first_save_member_unverified',
  'first_save_member_role_unverified',
  'profile_fault_enable_failed',
  'profile_fault_disable_failed',
  'profile_fault_interception_failed',
  'profile_fault_multiple_upserts',
  'profile_fault_not_exercised_exactly_once',
  'profile_case_restoration_failed',
  'profile_reload_authenticated_menu_ready_not_observed',
  'reload_profile_identity_changed',
  'reload_profile_role_changed',
  'reload_organization_changed',
  'profile_save_failure_receipt_not_provisional',
  'profile_original_restored_not_observed',
]);

export function safeProfileFailureCode(error) {
  const driverCode = error?.driverFailure?.code;
  if (POINTER_CODES.has(driverCode)) return driverCode;
  const candidate = typeof error?.message === 'string' ? error.message.split(/[:\n]/, 1)[0] : '';
  return PROFILE_FAILURE_CODES.has(candidate) ? candidate : 'profile_unclassified_failure';
}

export function recordProfileFinalFailure(report, error) {
  const code = safeProfileFailureCode(error);
  report.status = code === 'profile_original_row_absent_mutation_refused' ? 'unverified' : 'failed';
  report.failure_code = code;
}

export async function runProfilePointer(click, panel, kind, label, call) {
  try {
    return await click(panel, kind, label);
  } catch (error) {
    if (error?.driverFailure) error.profilePointerCall = call;
    throw error;
  }
}

// The native runner's error boundary must retain only fixed labels and counts.
export async function captureProfileExecutionFailure(report, error, { operation, readUiState }) {
  const failure = {
    stage: report.stage,
    operation: operation ?? 'unknown',
  };
  const driver = error?.driverFailure;
  const restoration = error?.profileRestorationFailure;
  const field = error?.profileFieldFailure;
  const expander = error?.profileExpanderFailure;
  if (expander) {
    failure.expander = {
      phase: PROFILE_EXPANDER_PHASES.has(expander.phase) ? expander.phase : 'unknown',
      section: PROFILE_EXPANDER_SECTIONS.has(expander.section) ? expander.section : null,
    };
  }
  if (field) {
    failure.field = {
      phase: PROFILE_FIELD_PHASES.has(field.phase) ? field.phase : 'unknown',
      name: PROFILE_FIELD_NAMES.has(field.field) ? field.field : null,
      desired_value_matches: typeof field.fieldMatched === 'boolean' ? field.fieldMatched : null,
    };
  }
  if (restoration) {
    failure.restoration = {
      code: restoration.code === 'profile_case_restoration_failed' ? restoration.code : 'unknown',
      stage: PROFILE_RESTORATION_STAGES.has(restoration.stage) ? restoration.stage : 'unknown',
    };
  }
  if (driver) {
    failure.pointer_call = POINTER_CALLS.has(error?.profilePointerCall)
      ? error.profilePointerCall
      : 'unknown';
    failure.code = POINTER_CODES.has(driver.code) ? driver.code : 'unknown';
    failure.matched_target_count = Number.isInteger(driver.matchedTargetCount)
      ? driver.matchedTargetCount
      : null;
    failure.visible_match_count = Number.isInteger(driver.visibleMatchCount)
      ? driver.visibleMatchCount
      : null;
    let ui;
    try {
      ui = await readUiState();
    } catch {
      ui = null;
    }
    failure.ui =
      ui && !ui.sample_unavailable
        ? {
            active_settings_tab: ui.active_settings_tab === true,
            active_chat_tab: ui.active_chat_tab === true,
            active_tab_count: Number.isInteger(ui.active_tab_count) ? ui.active_tab_count : null,
            account_button_count: Number.isInteger(ui.account_button_count)
              ? ui.account_button_count
              : null,
            profile_button_count: Number.isInteger(ui.profile_button_count)
              ? ui.profile_button_count
              : null,
            back_button_count: Number.isInteger(ui.back_button_count) ? ui.back_button_count : null,
            menu_count: Number.isInteger(ui.menu_count) ? ui.menu_count : null,
          }
        : { sample_unavailable: true };
  }
  report.execution_failure = failure;
}

// The acceptance runner uses this boundary around its real UI sequence. Returning
// the primary error lets owned-row restoration run before the runner rethrows it.
export async function runProfileExecutionBoundary(report, execute, { getOperation, readUiState }) {
  try {
    await execute();
    return null;
  } catch (error) {
    report.execution_failure_code = safeProfileFailureCode(error);
    await captureProfileExecutionFailure(report, error, {
      operation: getOperation(),
      readUiState,
    });
    return error;
  }
}

// Only these documented backend codes are useful in the public Profile report.
// Syntax/length validation cannot distinguish a code from a credential.
const PROFILE_BACKEND_CODES = new Set(['42501', '23505', 'PGRST116', 'PGRST301', 'PGRST302']);
export function safeProfileBackendCode(code) {
  if (code === undefined || code === null) return null;
  return PROFILE_BACKEND_CODES.has(code) ? code : 'profile_backend_unclassified_error';
}
