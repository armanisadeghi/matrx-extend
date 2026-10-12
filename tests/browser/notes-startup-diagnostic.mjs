// Only fixed labels leave the startup boundary; exception text is never serialized.
const NATIVE_STAGES = new Set([
  'receipt',
  'artifact_verify',
  'browser_runtime',
  'profile_prepare',
  'browser_spawn',
  'cdp_connect',
  'endpoint_read',
  'command_line_query',
  'command_line_verify',
  'extension_worker',
  'spawn_owner',
  'local_server',
  'playwright_connect',
  'page_create',
  'local_page_navigation',
  'panel_open',
  'panel_reply',
  'panel_target',
  'panel_context',
  'panel_settle',
  'demo_navigation',
  'screenshot',
  'exercise_panel',
]);

export function notesNativeStartupOperation(value) {
  return NATIVE_STAGES.has(value) ? `native_${value}` : 'native_operation_unknown';
}

export function notesStartupErrorCategory(error) {
  if (error?.code === 'ENOENT') return 'filesystem_missing';
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'filesystem_denied';
  if (error?.code === 'ERR_ASSERTION') return 'assertion_failed';
  if (error instanceof SyntaxError) return 'syntax_error';
  if (error?.name === 'TimeoutError') return 'timeout_error';
  return 'operation_failed';
}

export function notesEndpointObservationEnabled(env) {
  return (
    env.NOTES_HOSTED_FIND === '1' &&
    env.MATRX_HOSTED_ACCEPTANCE_LANE === 'A' &&
    env.MATRX_CDP_STARTUP_DIAGNOSTIC === '1'
  );
}

export function safeNotesEndpointObservation(value) {
  if (!['cdp_timeout', 'post_timeout'].includes(value?.phase))
    throw new Error('notes_endpoint_observation_phase_refused');
  for (const key of ['endpointPresent', 'inspectionFailed', 'exitObserved'])
    if (typeof value[key] !== 'boolean')
      throw new Error('notes_endpoint_observation_shape_refused');
  for (const key of ['elapsedMs', 'polls'])
    if (!Number.isSafeInteger(value[key]) || value[key] < 0)
      throw new Error('notes_endpoint_observation_shape_refused');
  const outcome =
    value.phase === 'cdp_timeout'
      ? 'timed_out'
      : value.inspectionFailed
        ? 'inspection_failed'
        : value.endpointPresent
          ? 'late_endpoint'
          : value.exitObserved
            ? 'child_exited'
            : 'still_absent';
  return {
    phase: value.phase,
    outcome,
    endpointPresent: value.endpointPresent,
    inspectionFailed: value.inspectionFailed,
    exitObserved: value.exitObserved,
    elapsedMs: value.elapsedMs,
    polls: value.polls,
  };
}
