import { waitFor } from './settings-panel-driver.mjs';

const hostCategory = (value) =>
  value === 'ON_CLICK' || value === 'ON_ALL_SITES' ? value : 'unknown';
const flag = (value) => (typeof value === 'boolean' ? value : null);

export async function observeRecoveryPreflight(context, read) {
  try {
    return await read();
  } catch (error) {
    let transport;
    try {
      transport = context.transportFailureClass();
    } catch {
      transport = 'unknown';
    }
    context.onFailure({
      phase: 'denial_preflight',
      operation: ['panel_readiness', 'effective_host_access'].includes(context.operation)
        ? context.operation
        : 'unknown',
      origin_transition_completed: flag(context.originTransitionCompleted),
      failure_code:
        error?.message === 'owned_cdp_transport_failed'
          ? 'owned_cdp_transport_failed'
          : 'scrape_recovery_preflight_failed',
      transport_failure_class: [
        'none',
        'protocol_shape',
        'unknown_response',
        'protocol_error',
        'response_shape',
        'listener',
        'send_after_close',
        'command_timeout',
        'send_exception',
        'socket_error',
        'unexpected_close',
        'close_failure',
      ].includes(transport)
        ? transport
        : 'unknown',
    });
    throw error;
  }
}

// Preserve the driver's existing finally ordering, including a failed preflight.
export async function withRecoveryHostAccessCleanup(action, cleanup) {
  try {
    return await action();
  } finally {
    await cleanup();
  }
}

export function safeRecoveryFailureSnapshot(state, expectedHostAccess, observedHostAccess) {
  const stage = state?.deepScrollProgressPresent
    ? 'deep_scroll_in_progress'
    : state?.deepScrollProgressFinished
      ? 'capture_after_deep_scroll'
      : state?.deepCaptureInProgress
        ? 'deep_scroll_progress_not_observed'
        : 'capture_not_active';
  return {
    phase: 'capture_outcome_wait',
    stage,
    elapsed_ms: boundedMs(state?.diagnosticElapsedMs),
    deep_mode_seen: flag(state?.deepModeSeen),
    deep_scroll_progress_seen: flag(state?.deepScrollProgressSeen),
    deep_scroll_progress_finished: flag(state?.deepScrollProgressFinished),
    deep_scroll_first_progress_ms: boundedMs(state?.deepScrollFirstProgressMs),
    deep_scroll_finished_ms: boundedMs(state?.deepScrollFinishedMs),
    capture_wait_ms:
      state?.deepScrollFinishedMs !== null && state?.deepScrollFinishedMs !== undefined
        ? boundedMs((state?.diagnosticElapsedMs ?? 0) - state.deepScrollFinishedMs)
        : null,
    scrape_tab_active: flag(state?.scrapeTabActive),
    scrape_pane_active: flag(state?.scrapePaneActive),
    error_present: flag(state?.error),
    permission_message_present: flag(state?.permissionMessage),
    try_again_present: Number.isInteger(state?.tryAgain) ? state.tryAgain > 0 : null,
    reload_page_present: Number.isInteger(state?.reloadPage) ? state.reloadPage > 0 : null,
    deep_control_present: Array.isArray(state?.deepTitles) ? state.deepTitles.length > 0 : null,
    deep_capture_in_progress: flag(state?.deepCaptureInProgress),
    result_present: flag(state?.resultPresent),
    expected_host_access: hostCategory(expectedHostAccess),
    observed_host_access: hostCategory(observedHostAccess),
  };
}

const boundedMs = (value) =>
  Number.isInteger(value) && value >= 0 ? Math.min(value, 60000) : null;

export function classifyEffectiveHostAccessProbe(result) {
  if (result === 'available' || result === 'denied') return result;
  return 'unknown';
}

export function requireEffectiveHostAccessDenied(result) {
  const access = classifyEffectiveHostAccessProbe(result);
  if (access !== 'denied') throw new Error(`scrape_recovery_effective_access_${access}`);
  return access;
}

export async function runAfterEffectiveHostDenial(probe, action) {
  const access = requireEffectiveHostAccessDenied(await probe());
  return { access, value: await action() };
}

export async function waitForRecoveryOutcome({
  readState,
  readObservedHostAccess,
  onFailure,
  wait = waitFor,
  now = () => Date.now(),
}) {
  let lastState = null;
  const startedAt = now();
  let deepModeSeen = false;
  let deepScrollProgressSeen = false;
  let deepScrollProgressFinished = false;
  let deepScrollFirstProgressMs = null;
  let deepScrollFinishedMs = null;
  let previousProgress = false;
  try {
    return await wait(
      'scrape_recovery_capture_outcome',
      async () => {
        lastState = await readState();
        const progress = lastState?.deepScrollProgressPresent === true;
        const elapsedMs = now() - startedAt;
        deepModeSeen ||= lastState?.deepCaptureInProgress === true;
        if (progress && deepScrollFirstProgressMs === null) deepScrollFirstProgressMs = elapsedMs;
        deepScrollProgressSeen ||= progress;
        if (previousProgress && !progress && lastState?.deepCaptureInProgress) {
          deepScrollProgressFinished = true;
          deepScrollFinishedMs = elapsedMs;
        }
        previousProgress = progress;
        lastState = {
          ...lastState,
          diagnosticElapsedMs: elapsedMs,
          deepModeSeen,
          deepScrollProgressSeen,
          deepScrollProgressFinished,
          deepScrollFirstProgressMs,
          deepScrollFinishedMs,
        };
        return lastState;
      },
      (value) => value?.ready && (value.error || value.resultPresent),
      10000,
      (value) => ({ phase: safeRecoveryFailureSnapshot(value, 'ON_CLICK', 'unknown').stage }),
    );
  } catch (error) {
    const observedHostAccess = await readObservedHostAccess().catch(() => 'unknown');
    onFailure(safeRecoveryFailureSnapshot(lastState, 'ON_CLICK', observedHostAccess));
    throw error;
  }
}
