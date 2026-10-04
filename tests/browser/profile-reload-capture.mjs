const FAILURE_CODES = new Set([
  'native_extension_management_reload_unavailable',
  'native_extension_developer_mode_unverified',
  'native_extension_reload_disabled',
  'native_extension_current_worker_unverified',
  'native_extension_current_panel_unverified',
  'native_extension_old_worker_retired_before_reload',
  'native_extension_worker_retirement_unverified',
  'native_extension_replacement_panel_unverified',
  'native_sidepanel_runtime_context_missing',
  'owned_cdp_transport_failed',
]);

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
const MANAGEMENT_STATES = new Set(['ENABLED', 'DISABLED', 'TERMINATED', 'ABSENT']);
const BOOL_KEYS = [
  'old_worker_destroyed_event',
  'old_worker_absent',
  'old_panel_absent',
  'replacement_worker_present',
  'replacement_worker_created_event',
];

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function captureManagement(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    state: MANAGEMENT_STATES.has(value.state) ? value.state : 'OTHER',
    developer_mode: value.developer_mode === true,
    unsupported_developer_extension: value.unsupported_developer_extension === true,
    runtime_error_count: safeCount(value.runtime_error_count),
    manifest_error_count: safeCount(value.manifest_error_count),
  };
}

export function captureLifecycleEvidence(value) {
  if (!value || typeof value !== 'object') return null;
  const evidence = {};
  for (const key of BOOL_KEYS) evidence[key] = typeof value[key] === 'boolean' ? value[key] : null;
  evidence.observed_worker_count = safeCount(value.observed_worker_count);
  evidence.management = captureManagement(value.management);
  return evidence;
}

export function captureFailure(error, readTransportClass) {
  const candidate = typeof error?.message === 'string' ? error.message.split(':', 1)[0] : '';
  let transport = 'unavailable';
  try {
    const observed = readTransportClass();
    transport = TRANSPORT_CLASSES.has(observed) ? observed : 'other';
  } catch {
    /* The transport observer itself failed. */
  }
  return {
    failure_code: FAILURE_CODES.has(candidate) ? candidate : 'unclassified',
    transport_failure_class: transport,
    retirement_evidence: captureLifecycleEvidence(error?.lifecycleEvidence),
  };
}
