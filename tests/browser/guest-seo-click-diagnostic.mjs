// A failed native pointer must leave a useful receipt, even when the panel
// contains account data. Keep only the driver's fixed categories and counts.
const PHASES = new Set([
  'before_target_resolution',
  'target_selected',
  'press_attempted',
  'press_returned',
  'release_attempted',
  'release_returned',
]);
const POINTER_CODES = new Set([
  'pointer_initial_evaluation_failed',
  'pointer_page_sample_failed',
  'pointer_target_not_unique',
  'pointer_followup_evaluation_failed',
  'pointer_stable_hit_not_observed',
  'pointer_press_dispatch_failed',
  'pointer_release_dispatch_failed',
]);
const SAMPLE_STAGES = new Set([
  'target_resolution',
  'visibility_filter',
  'scroll_preparation',
  'clipping_geometry',
  'hit_testing',
  'animation_observation',
]);
const HIT_CATEGORIES = new Set([
  'none',
  'target',
  'dialog',
  'listbox',
  'modal_overlay',
  'target_ancestor',
  'header_or_tabs',
  'other_element',
]);
const OWNER_CATEGORIES = new Set(['none', 'seo', 'unmapped_tabpanel']);
const NOTICE_CATEGORIES = new Set([
  'none',
  'capture_no_workspace',
  'other_no_workspace',
  'database_refused',
  'database_missing_relation',
  'database_not_authenticated',
  'database_unreachable',
  'other_alert',
]);

function category(value, allowed) {
  return allowed.has(value) ? value : null;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : null;
}

function flag(value) {
  return typeof value === 'boolean' ? value : null;
}

export function captureSeoClickFailure(error, phase) {
  const receipt = {
    phase: category(phase, PHASES),
    source: POINTER_CODES.has(error?.driverFailure?.code) ? 'pointer_driver' : 'other_exception',
  };
  if (receipt.source !== 'pointer_driver') return receipt;
  const failure = error.driverFailure;
  const occluder = failure.centerOccluder;
  return {
    ...receipt,
    code: failure.code,
    sample_stage: category(failure.sampleStage, SAMPLE_STAGES),
    matched_target_count: count(failure.matchedTargetCount),
    visible_match_count: count(failure.visibleMatchCount),
    hit_target: flag(failure.hitTarget),
    stable_samples: count(failure.stableSamples),
    selected_point_available: flag(failure.selectedPointAvailable),
    center_hit_category: category(failure.centerHitCategory, HIT_CATEGORIES),
    center_occluder:
      occluder && typeof occluder === 'object'
        ? {
            owning_panel: category(occluder.owning_panel, OWNER_CATEGORIES),
            known_notice: category(occluder.known_notice, NOTICE_CATEGORIES),
          }
        : null,
  };
}

export async function clickSeoReaudit(panel, report, click) {
  report.click_phase = 'before_target_resolution';
  try {
    return await click(panel, 'button', 'Re-audit', (phase) => {
      report.click_phase = phase;
    });
  } catch (error) {
    report.click_failure_diagnostic = captureSeoClickFailure(error, report.click_phase);
    throw error;
  }
}
