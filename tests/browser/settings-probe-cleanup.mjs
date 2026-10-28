import { safeReloadOperationFailure } from './native-reload-operation-boundary.mjs';
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
const RELOAD_PHASES = new Set([
  'unavailable',
  'discovery_enabled',
  'initial_snapshot',
  'listeners_registered',
  'pre_click_snapshot',
  'click_started',
  'click_resolved',
  'poll_transition',
  'target_created',
  'target_destroyed',
  'target_info_changed',
]);

function reloadBoundary(value) {
  if (!value || typeof value !== 'object') return null;
  const bool = (field) => (typeof value[field] === 'boolean' ? value[field] : null);
  return {
    helperFailure: safeReloadOperationFailure(value.helperFailure),
    lastCapturedPhase: RELOAD_PHASES.has(value.lastCapturedPhase)
      ? value.lastCapturedPhase
      : 'unavailable',
    timelineTruncated: bool('timelineTruncated'),
    clickStarted: bool('clickStarted'),
    clickResolved: bool('clickResolved'),
    preClickOldWorkerPresent: bool('preClickOldWorkerPresent'),
    oldWorkerAbsent: bool('oldWorkerAbsent'),
    oldPanelAbsent: bool('oldPanelAbsent'),
    replacementWorkerPresent: bool('replacementWorkerPresent'),
    finalPredicate: bool('finalPredicate'),
    contextExpectedAppeared: bool('contextExpectedAppeared'),
  };
}

const cleanupOriginals = new WeakMap();

// Only wrappers created here resolve to a primary; public flags/cause confer no identity.
export function originalSettingsCleanupFailure(failure) {
  return cleanupOriginals.has(failure) ? cleanupOriginals.get(failure) : failure;
}

class SettingsCleanupFailure extends Error {
  constructor(primary) {
    super('settings_probe_cleanup_failed', { cause: primary });
    this.safeCleanupFailed = true;
    cleanupOriginals.set(this, primary);
  }
}

export async function preserveFailureDuringCleanup(operation, cleanup) {
  let value;
  let failure;
  let cleanupFailure;
  try {
    value = await operation();
  } catch (error) {
    failure = { error };
  }
  try {
    await cleanup();
  } catch (error) {
    cleanupFailure = { error };
  }
  if (failure) {
    if (!cleanupFailure) throw failure.error;
    // Preserve existing Error identity when it can carry the safe flag. Frozen
    // objects and primitive rejections retain their exact original as cause.
    let marked = false;
    if (
      failure.error !== null &&
      (typeof failure.error === 'object' || typeof failure.error === 'function')
    ) {
      try {
        Object.defineProperty(failure.error, 'safeCleanupFailed', {
          value: true,
          configurable: true,
          writable: true,
        });
        marked = true;
      } catch {
        // An immutable rejection still needs an explicit cleanup-failure signal.
      }
    }
    if (marked) throw failure.error;
    throw new SettingsCleanupFailure(failure.error);
  }
  if (cleanupFailure) throw new SettingsCleanupFailure(cleanupFailure.error);
  return value;
}

export function serializeGuestReloadFailure(failure) {
  const cleanupAlsoFailed = failure?.safeCleanupFailed === true;
  const error = originalSettingsCleanupFailure(failure);
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
    firstChoiceReloadBoundary: reloadBoundary(error.safeFirstChoiceReloadBoundary),
    restorationReloadBoundary: reloadBoundary(error.safeRestorationReloadBoundary),
    cleanupAlsoFailed: cleanupAlsoFailed || error.safeCleanupFailed === true,
  };
}
