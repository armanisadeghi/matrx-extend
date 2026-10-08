const TARGETS = new Set([
  'restart_before_A',
  'A_start',
  'A_scope',
  'A_field',
  'A_capture',
  'A_cancel',
  'B_start',
  'A_release',
  'A_stamped',
  'B_scope',
  'B_detection',
  'B_stamped',
  'B_field',
  'B_done',
  'B_builder',
  'B_result',
  'B_extract',
  'lifecycle_prepare',
  'lifecycle_A_start',
  'lifecycle_A_hold',
  'lifecycle_A_cancel',
  'lifecycle_B_start',
  'lifecycle_A_release',
  'lifecycle_reinject',
  'lifecycle_B_scope',
  'lifecycle_B_detection',
  'lifecycle_B_detection_count',
  'lifecycle_B_field',
  'lifecycle_B_done',
  'lifecycle_B_result',
  'lifecycle_B_extract',
  'lifecycle_page_click',
]);
const FLAGS = new Set([
  'panel_start',
  'panel_picking',
  'panel_cancel',
  'panel_extract',
  'panel_selected_field',
  'panel_three_rows',
  'root_present',
  'A_held',
  'A_stamped',
  'B_detected',
  'B_stamped',
  'B_result_stamped',
  'cancel_held',
  'install_held',
  'context_start_distinct',
  'context_teardown_distinct',
  'context_start_world_matched',
  'context_start_world_start_distinct',
  'context_start_world_teardown_distinct',
]);
const COUNTS = new Set([
  'overlay_count',
  'held_count',
  'producer_count',
  'relay_count',
  'picked_field_count',
  'cancel_count',
  'install_count',
  'detected_count',
  'stamped_detected_count',
  'unstamped_detected_count',
  'current_session_detected_count',
  'other_session_detected_count',
  'producer_current_detected_count',
  'listener_click_count',
  'listener_hover_count',
]);

export function createShowcaseStaleDiagnostic(channel) {
  if (!['detected', 'result', 'cancel', 'install', 'reinject'].includes(channel))
    throw new Error('invalid_stale_channel');
  return { channel, target: null, failed_target: null, last_safe: {} };
}

export function observeShowcaseStaleDiagnostic(diagnostic, values) {
  for (const [key, value] of Object.entries(values ?? {})) {
    if (FLAGS.has(key) && typeof value === 'boolean') diagnostic.last_safe[key] = value;
    if (COUNTS.has(key) && Number.isSafeInteger(value) && value >= 0 && value <= 10000)
      diagnostic.last_safe[key] = value;
  }
}

// Never copy a browser/transport error into the receipt. The caller supplies
// only fixed labels and bounded observations, including after a failed wait.
export async function runShowcaseStaleDiagnosticStep(diagnostic, target, sample, action) {
  if (!TARGETS.has(target)) throw new Error('invalid_stale_target');
  diagnostic.target = target;
  observeShowcaseStaleDiagnostic(diagnostic, await sample());
  try {
    return await action();
  } catch (error) {
    diagnostic.failed_target = target;
    observeShowcaseStaleDiagnostic(diagnostic, await sample());
    throw error;
  }
}
