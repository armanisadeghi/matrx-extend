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
    cleanupAlsoFailed: error.safeCleanupFailed === true,
  };
}
