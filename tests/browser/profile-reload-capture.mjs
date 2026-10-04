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

export function captureContextBoundary(value) {
  if (!value || typeof value !== 'object') return null;
  const snapshot = (item) => ({
    side_panel_count: safeCount(item?.side_panel_count),
    exact_expected_count: safeCount(item?.exact_expected_count),
    elapsed_ms: safeCount(item?.elapsed_ms),
  });
  return {
    first: snapshot(value.first),
    last: snapshot(value.last),
    attempts: safeCount(value.attempts),
    exact_expected_appeared: value.exact_expected_appeared === true,
    query_failed: value.query_failed === true,
  };
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
  if (value.timeline && typeof value.timeline === 'object') {
    const safeId = (id) => (typeof id === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(id) ? id : null);
    const safeTarget = (target) => {
      if (!target || !['worker', 'panel', 'extension_other'].includes(target.kind)) return null;
      const target_id = safeId(target.target_id);
      if (!target_id || typeof target.type !== 'string' || !/^[a-z_]{1,40}$/.test(target.type))
        return null;
      return { target_id, type: target.type, kind: target.kind };
    };
    const safeTime = (at) =>
      typeof at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at) ? at : null;
    const safeEntry = (entry) => {
      if (
        !entry ||
        ![
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
        ].includes(entry.phase)
      )
        return null;
      const at = safeTime(entry.at);
      if (!at) return null;
      if (Array.isArray(entry.targets))
        return {
          at,
          phase: entry.phase,
          targets: entry.targets.slice(0, 16).map(safeTarget).filter(Boolean),
        };
      if (entry.target) return { at, phase: entry.phase, target: safeTarget(entry.target) };
      return { at, phase: entry.phase };
    };
    const timeline = value.timeline;
    evidence.timeline = {
      old_worker_id: safeId(timeline.old_worker_id),
      old_panel_id: safeId(timeline.old_panel_id),
      replacement_worker_id: safeId(timeline.replacement_worker_id),
      pre_click_old_worker_present: timeline.pre_click_old_worker_present === true,
      entries: Array.isArray(timeline.entries)
        ? timeline.entries.slice(0, 80).map(safeEntry).filter(Boolean)
        : [],
      dropped_entries: safeCount(timeline.dropped_entries),
      final_snapshot: Array.isArray(timeline.final_snapshot)
        ? timeline.final_snapshot.slice(0, 16).map(safeTarget).filter(Boolean)
        : [],
      final_predicate: timeline.final_predicate === true,
    };
  }
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
    context_boundary: captureContextBoundary(error?.contextBoundary),
  };
}
