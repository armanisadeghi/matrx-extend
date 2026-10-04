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
    report.execution_failure_code = String(error?.message ?? 'unknown')
      .split(':', 1)[0]
      .slice(0, 100);
    await captureProfileExecutionFailure(report, error, {
      operation: getOperation(),
      readUiState,
    });
    return error;
  }
}
