import { click } from './settings-panel-driver.mjs';

// The first Forget action owns the readiness-to-pointer diagnostic boundary.
// Keep reporting independent of selector/click decisions and rethrow refusals.
export async function clickDesktopPairForget(panel, report, readiness) {
  const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
  const boolean = (value) => (typeof value === 'boolean' ? value : null);
  report.diagnostics = {
    ...report.diagnostics,
    desktop_pair_forget_control_readiness: {
      settingsActive: boolean(readiness?.settingsActive),
      pairAvailable: boolean(readiness?.pairAvailable),
      matchedCount: count(readiness?.forgetButtonMatchedCount),
      visibleCount: count(readiness?.forgetButtonVisibleCount),
    },
  };
  try {
    return await click(panel, 'settings-button', 'Forget pair code');
  } catch (error) {
    const failure = error?.driverFailure;
    report.diagnostics.desktop_pair_forget_pointer_failure = {
      code: [
        'pointer_target_not_unique',
        'pointer_stable_hit_not_observed',
        'pointer_initial_evaluation_failed',
        'pointer_followup_evaluation_failed',
        'pointer_page_sample_failed',
        'pointer_press_dispatch_failed',
        'pointer_release_dispatch_failed',
      ].includes(failure?.code)
        ? failure.code
        : 'pointer_failure',
      sampleStage: [
        'target_resolution',
        'visibility_filter',
        'scroll_preparation',
        'clipping_geometry',
        'hit_testing',
        'animation_observation',
      ].includes(failure?.sampleStage)
        ? failure.sampleStage
        : null,
      matchedTargetCount: count(failure?.matchedTargetCount),
      visibleMatchCount: count(failure?.visibleMatchCount),
      uniqueVisibleTarget: boolean(failure?.uniqueVisibleTarget),
      settingsPanelActive: boolean(failure?.settingsPanelActive),
    };
    throw error;
  }
}
