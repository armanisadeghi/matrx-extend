const KNOWN_FAILURES = new Set([
  'tab_groups_artifact_inputs_missing',
  'tab_groups_source_missing',
  'tab_groups_ci_run_missing',
  'tab_groups_ci_artifact_missing',
  'tab_groups_artifact_tree_mismatch',
  'tab_groups_member_identity_unverified',
  'tab_groups_create_refused',
  'tab_groups_create_group_id_missing',
  'tab_groups_create_collapsed_native_readback_mismatch',
  'tab_groups_owned_tab_cleanup_unverified',
  'tab_groups_five_owned_tabs_required',
  'tab_groups_owned_fixture_not_ready',
  'tab_groups_operation_refused',
  'tab_groups_created_group_not_owned',
  'tab_groups_operation_native_readback_mismatch',
  'tab_groups_list_native_readback_mismatch',
  'tab_groups_cleanup_non_owned_mutation',
  'tab_groups_stale_manual_result',
]);

const MANUAL_STEPS = new Set([
  'tools_tab_click',
  'catalog_ready',
  'surface_filter_click',
  'all_handlers_option_ready',
  'all_handlers_option_click',
  'all_handlers_selected',
  'search_input',
  'tab_groups_row_ready',
  'tab_groups_row_click',
  'tab_groups_form_ready',
]);

export function tabGroupsFailureCode(error, report) {
  const firstLine = typeof error?.message === 'string' ? error.message.split('\n', 1)[0] : null;
  if (KNOWN_FAILURES.has(firstLine)) return firstLine;
  if (report.stage === 'tools_manual_runner' && MANUAL_STEPS.has(report.manual_runner_step))
    return `tab_groups_manual_${report.manual_runner_step}_failed`;
  if (
    /^tab_groups_(create_true|create_false|update_true|update_false|add|remove|list)(_get_tab_groups)?$/.test(
      report.stage,
    )
  )
    return `${report.stage}_failed`;
  return 'unclassified_failure';
}

export async function withOwnedTabCleanup(report, body, cleanup, onFailure = async () => {}) {
  let hasPrimaryError = false;
  let primaryError;
  let result;
  try {
    result = await body();
  } catch (error) {
    hasPrimaryError = true;
    primaryError = error;
    report.failure_stage = report.stage;
    report.failure_step =
      report.stage === 'tools_manual_runner' ? (report.manual_runner_step ?? null) : null;
    report.failure_code = tabGroupsFailureCode(error, report);
    try {
      await onFailure();
    } catch {
      report.manual_runner_observation = { availability: 'unavailable' };
    }
  }
  if (!hasPrimaryError) report.stage = 'cleanup';
  let cleanupError;
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
    report.cleanup_failure_code = tabGroupsFailureCode(error, { stage: 'cleanup' });
  }
  if (hasPrimaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return result;
}
