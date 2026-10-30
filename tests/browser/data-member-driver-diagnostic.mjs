const safeCount = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : null;

/** Retain only the bounded pointer-resolution counts for the member Data reopen diagnostic. */
export function captureDataMemberDriverDiagnostic(error) {
  const failure = error?.driverFailure;
  if (failure?.code !== 'pointer_target_not_unique' || failure.sampleStage !== 'visibility_filter')
    return null;

  const tab = failure.dataTabTargetDiagnostic;
  return {
    code: 'pointer_target_not_unique',
    sample_stage: 'visibility_filter',
    matched_target_count: safeCount(failure.matchedTargetCount),
    visible_target_count: safeCount(failure.visibleMatchCount),
    data_tab:
      tab && typeof tab === 'object'
        ? {
            matching_tab_count: safeCount(tab.matching_tab_count),
            visible_tab_count: safeCount(tab.visible_tab_count),
            active_tab_count: safeCount(tab.active_tab_count),
            active_data_pane_count: safeCount(tab.active_data_pane_count),
          }
        : null,
  };
}

export function recordDataMemberDriverDiagnostic(error, report) {
  if (
    ['data_member_reloaded_data_tab_ready', 'data_member_saved_pattern_survived_reload'].includes(
      error?.waitLabel,
    ) &&
    report &&
    typeof report === 'object'
  ) {
    report.reload_data_wait_diagnostic = {
      stage: 'extension_reload_reopen_data',
      target: 'data_tab_and_linked_pane',
      wait_label: error.waitLabel,
      wait_failure_category: [
        'panel_target_unavailable',
        'panel_runtime_unavailable',
        'panel_observation_unavailable',
      ].includes(error.waitFailureCategory)
        ? error.waitFailureCategory
        : null,
      last_wait: dataMemberReloadWaitSample(error.waitDiagnostic),
    };
  }
  if (
    error?.waitLabel === 'data_member_pattern_name_entered' &&
    report &&
    typeof report === 'object'
  ) {
    const entry = (report.name_entry_diagnostic ??= {});
    entry.last_wait = dataMemberNameEntrySample(error.waitDiagnostic);
    entry.wait_label = 'data_member_pattern_name_entered';
    entry.wait_failure_category = [
      'panel_target_unavailable',
      'panel_runtime_unavailable',
      'panel_observation_unavailable',
    ].includes(error.waitFailureCategory)
      ? error.waitFailureCategory
      : null;
  }
  const diagnostic = captureDataMemberDriverDiagnostic(error);
  if (diagnostic && report && typeof report === 'object') report.driver_diagnostic = diagnostic;
  return diagnostic;
}

const safeLength = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const safeBoolean = (value) => (typeof value === 'boolean' ? value : null);

/** Project the owned input observation; never retain values or waitFor's transient text. */
export function dataMemberNameEntrySample(value) {
  const sampled = typeof value?.active === 'boolean';
  const field = (raw, projected) => value?.[raw] ?? value?.[projected];
  const origin = field('documentTimeOrigin', 'document_time_origin');
  return {
    sampled,
    read_failure_category: sampled ? null : 'diagnostic_read_unavailable',
    active: safeBoolean(value?.active),
    input_count: safeCount(field('nameInputCount', 'input_count')),
    focused: safeBoolean(field('nameFocused', 'focused')),
    nonempty: safeBoolean(field('nameNonempty', 'nonempty')),
    value_length: safeLength(field('nameValueLength', 'value_length')),
    expected_length: safeLength(field('nameExpectedLength', 'expected_length')),
    matches: safeBoolean(field('nameMatches', 'matches')),
    document_time_origin: Number.isFinite(origin) && origin >= 0 ? origin : null,
  };
}

/** Diagnostic reads are best effort and cannot prevent the original trusted operations. */
export async function observeDataMemberNameEntry(report, stage, read) {
  if (!['before_click', 'after_click', 'after_insert'].includes(stage)) return;
  let sample;
  try {
    sample = dataMemberNameEntrySample(await read());
  } catch {
    sample = dataMemberNameEntrySample(null);
  }
  const entry = (report.name_entry_diagnostic ??= { input_replacement: 'unknown' });
  entry[stage] = sample;
  const origins = ['before_click', 'after_click', 'after_insert']
    .map((key) => entry[key]?.document_time_origin)
    .filter((value) => typeof value === 'number');
  entry.document_replaced =
    origins.length >= 2 ? origins.some((value) => value !== origins[0]) : null;
}

/** Fixed counts and categories only; transient errors, titles, identities and values never leave the wait. */
export function dataMemberReloadWaitSample(value) {
  const field = (raw, projected) => value?.[raw] ?? value?.[projected];
  return {
    sampled: typeof value?.active === 'boolean',
    active: safeBoolean(value?.active),
    matching_tab_count: safeCount(field('matchingTabCount', 'matching_tab_count')),
    visible_tab_count: safeCount(field('visibleTabCount', 'visible_tab_count')),
    active_tab_count: safeCount(field('activeTabCount', 'active_tab_count')),
    selected_tab_count: safeCount(field('selectedTabCount', 'selected_tab_count')),
    linked_pane_count: safeCount(field('linkedPaneCount', 'linked_pane_count')),
    linked_active_pane_count: safeCount(field('linkedActivePaneCount', 'linked_active_pane_count')),
    active_tab_category: ['data', 'chat', 'other', 'none', 'ambiguous'].includes(
      field('activeTabCategory', 'active_tab_category'),
    )
      ? field('activeTabCategory', 'active_tab_category')
      : null,
    render_error_present: safeBoolean(field('renderErrorPresent', 'render_error_present')),
    saved_pattern_visible: safeBoolean(field('savedPatternVisible', 'saved_pattern_visible')),
  };
}
