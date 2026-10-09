import { GUEST_EXTENSION_RECHECK_FAILURE_STAGES } from './settings-guest-extension-rechecks.mjs';

const TRANSPORT_CLASSES = new Set([
  'none',
  'protocol_shape',
  'unknown_response',
  'protocol_error',
  'response_shape',
  'listener',
  'socket_error',
  'unexpected_close',
  'command_timeout',
  'send_after_close',
  'send_exception',
  'close_failure',
]);
const FAILURE_CODES = new Set([
  'not_applicable',
  'unclassified',
  'pointer_initial_evaluation_failed',
  'pointer_page_sample_failed',
  'pointer_target_not_unique',
  'pointer_followup_evaluation_failed',
  'pointer_stable_hit_not_observed',
  'pointer_press_dispatch_failed',
  'pointer_release_dispatch_failed',
  'native_extension_management_reload_unavailable',
  'native_extension_developer_mode_unverified',
  'native_extension_reload_disabled',
  'native_extension_current_worker_unverified',
  'native_extension_current_panel_unverified',
  'native_extension_old_worker_retired_before_reload',
  'native_extension_worker_retirement_unverified',
  'native_extension_replacement_panel_unverified',
  'native_extension_replacement_open_refused',
  'native_sidepanel_runtime_context_missing',
  'owned_cdp_transport_failed',
]);

export async function preserveFailureDuringCleanup(operation, cleanup) {
  let value;
  let primaryError;
  try {
    value = await operation();
  } catch (error) {
    primaryError = error;
  }

  let cleanupFailed = false;
  try {
    await cleanup();
  } catch {
    cleanupFailed = true;
  }

  if (primaryError) {
    if (cleanupFailed && typeof primaryError === 'object') {
      primaryError.safeCleanupFailed = true;
    }
    throw primaryError;
  }
  if (cleanupFailed) throw new Error('settings_probe_cleanup_failed');
  return value;
}

export function serializeGuestReloadFailure(error) {
  if (error?.safeCategory !== 'full_extension_preference_or_restore_failed') return null;
  const stage = (value) =>
    value === 'not_failed' || GUEST_EXTENSION_RECHECK_FAILURE_STAGES.includes(value)
      ? value
      : 'unavailable';
  const transport = (value) => (TRANSPORT_CLASSES.has(value) ? value : 'unavailable');
  return {
    category: error.safeCategory,
    firstChoiceFailureStage: stage(error.safeFirstChoiceFailureStage),
    restorationFailureStage: stage(error.safeRestorationFailureStage),
    firstChoiceTransportClass: transport(error.safeFirstChoiceTransportClass),
    restorationTransportClass: transport(error.safeRestorationTransportClass),
    firstChoiceFailureCode: FAILURE_CODES.has(error.safeFirstChoiceFailureCode)
      ? error.safeFirstChoiceFailureCode
      : 'unavailable',
    restorationFailureCode: FAILURE_CODES.has(error.safeRestorationFailureCode)
      ? error.safeRestorationFailureCode
      : 'unavailable',
    cleanupAlsoFailed: error.safeCleanupFailed === true,
  };
}
