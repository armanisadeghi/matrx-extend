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
