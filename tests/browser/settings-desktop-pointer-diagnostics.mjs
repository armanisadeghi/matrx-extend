import { click } from './settings-panel-driver.mjs';

export async function clickDesktopPairFixture(panel, report, readiness) {
  const boolean = (value) => (typeof value === 'boolean' ? value : null);
  const count = (value) =>
    Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : null;
  const diagnostic = {
    readiness: Object.fromEntries(
      ['settingsActive', 'pairAvailable', 'pairInputPresent', 'pairKeyPresent'].map((key) => [
        key,
        boolean(readiness?.[key]),
      ]),
    ),
    inputPhases: {
      targetSelected: false,
      pressAttempted: false,
      pressReturned: false,
      releaseAttempted: false,
      releaseReturned: false,
    },
  };
  report.diagnostics = { ...report.diagnostics, desktop_pair_fixture: diagnostic };
  const phases = {
    target_selected: 'targetSelected',
    press_attempted: 'pressAttempted',
    press_returned: 'pressReturned',
    release_attempted: 'releaseAttempted',
    release_returned: 'releaseReturned',
  };
  try {
    // Preserve the fixture's exact selector and trusted dispatch behavior.
    return await click(panel, 'button', 'Pair', (phase) => {
      if (Object.hasOwn(phases, phase)) diagnostic.inputPhases[phases[phase]] = true;
    });
  } catch (error) {
    const failure = error?.driverFailure;
    diagnostic.pointerFailure = {
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
      ...Object.fromEntries(
        [
          'matchedTargetCount',
          'visibleMatchCount',
          'stableSamples',
          'clippingAncestorCount',
          'testedPointCount',
        ].map((key) => [key, count(failure?.[key])]),
      ),
      ...Object.fromEntries(
        [
          'uniqueVisibleTarget',
          'settingsPanelActive',
          'hitTarget',
          'animating',
          'positionStable',
          'targetHasArea',
          'clippedTargetHasArea',
          'selectedPointAvailable',
          'targetDisabled',
          'pointerEventsNone',
        ].map((key) => [key, boolean(failure?.[key])]),
      ),
      centerHitCategory: [
        'none',
        'target',
        'dialog',
        'listbox',
        'modal_overlay',
        'target_ancestor',
        'header_or_tabs',
        'other_element',
      ].includes(failure?.centerHitCategory)
        ? failure.centerHitCategory
        : null,
    };
    throw error;
  }
}

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
