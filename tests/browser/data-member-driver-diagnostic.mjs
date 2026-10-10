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
  const diagnostic = captureDataMemberDriverDiagnostic(error);
  if (diagnostic && report && typeof report === 'object') report.driver_diagnostic = diagnostic;
  return diagnostic;
}
