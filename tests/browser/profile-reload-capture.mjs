const FAILURE_CODES = new Set([
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
  'old_worker_execution_retired',
  'old_worker_absent',
  'old_panel_absent',
  'replacement_worker_present',
  'replacement_worker_created_event',
];

function captureOpenPanelFixture(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.availability !== 'ready') return { availability: 'unavailable' };
  return {
    availability: 'ready',
    click_received: value.click_received === true,
    send_invoked: value.send_invoked === true,
    send_returned: value.send_returned === true,
    callback_entered: value.callback_entered === true,
    callback_has_reply: value.callback_has_reply === true,
    callback_last_error: value.callback_last_error === true,
    send_threw: value.send_threw === true,
  };
}

function captureOpenPanelDiagnostic(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    availability: ['ready', 'unavailable', 'sample_failed', 'cleanup_unconfirmed'].includes(
      value.availability,
    )
      ? value.availability
      : 'unavailable',
    perturbation: 'cdp_worker_attach_and_synchronous_open_wrapper',
    ingress: value.ingress === true,
    open_invoked: value.open_invoked === true,
    open_settlement: ['unobserved', 'resolved', 'rejected', 'threw'].includes(value.open_settlement)
      ? value.open_settlement
      : 'unobserved',
    send_response: 'unobservable_without_instrumented_build',
  };
}

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
  if (value.replacement_panel_created_event !== undefined)
    evidence.replacement_panel_created_event =
      typeof value.replacement_panel_created_event === 'boolean'
        ? value.replacement_panel_created_event
        : null;
  evidence.observed_worker_count = safeCount(value.observed_worker_count);
  evidence.management = captureManagement(value.management);
  if (value.open_panel_request && typeof value.open_panel_request === 'object') {
    const request = value.open_panel_request;
    const worker = request.worker_at_click;
    evidence.open_panel_request = {
      click_monotonic_ms: safeCount(request.click_monotonic_ms),
      worker_at_click: {
        status: ['new', 'installing', 'installed', 'activating', 'activated', 'redundant'].includes(
          worker?.status,
        )
          ? worker.status
          : null,
        running_status: ['stopped', 'starting', 'running', 'stopping'].includes(
          worker?.running_status,
        )
          ? worker.running_status
          : null,
      },
      received: request.received === true,
      ok: typeof request.ok === 'boolean' ? request.ok : null,
      opened: typeof request.opened === 'boolean' ? request.opened : null,
      category: [
        'click_pending',
        'click_failed',
        'opened',
        'open_refused',
        'rpc_refused',
        'transport_error',
        'unexpected_reply',
        'malformed_reply',
        'reply_not_observed',
        'reply_wait_failed',
        'reply_read_failed',
      ].includes(request.category)
        ? request.category
        : 'unexpected_reply',
      ...(request.fixture !== undefined && { fixture: captureOpenPanelFixture(request.fixture) }),
    };
  }
  if (value.open_panel_diagnostic !== undefined)
    evidence.open_panel_diagnostic = captureOpenPanelDiagnostic(value.open_panel_diagnostic);
  if (value.timeline && typeof value.timeline === 'object') {
    const safeId = (id) => (typeof id === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(id) ? id : null);
    const safeTarget = (target) => {
      if (!target || !['worker', 'panel', 'extension_other'].includes(target.kind)) return null;
      const target_id = safeId(target.target_id);
      if (!target_id || typeof target.type !== 'string' || !/^[a-z_]{1,40}$/.test(target.type))
        return null;
      return {
        target_id,
        type: target.type,
        kind: target.kind,
        attached: typeof target.attached === 'boolean' ? target.attached : null,
      };
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
  if (value.reload_lifetime !== undefined)
    evidence.reload_lifetime = captureReloadLifetime(value.reload_lifetime);
  return evidence;
}

export function captureReloadLifetime(value) {
  if (!value || typeof value !== 'object') return null;
  const id = (item) =>
    typeof item === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(item) ? item : null;
  const at = (item) =>
    typeof item === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(item) ? item : null;
  const target = (item) =>
    item && ['worker', 'panel', 'extension_other'].includes(item.kind) && id(item.target_id)
      ? {
          target_id: id(item.target_id),
          type: ['service_worker', 'page', 'other'].includes(item.type) ? item.type : 'other',
          kind: item.kind,
          attached: typeof item.attached === 'boolean' ? item.attached : null,
        }
      : null;
  const probe = (item) => {
    if (!item || !['present', 'target_absent', 'probe_failed', 'unmeasured'].includes(item.outcome))
      return null;
    return {
      outcome: item.outcome,
      ...(item.outcome === 'present' && target(item.target) ? { target: target(item.target) } : {}),
    };
  };
  const version = (item) =>
    item && id(item.version_id) && id(item.registration_id) && at(item.at)
      ? {
          at: at(item.at),
          version_id: id(item.version_id),
          registration_id: id(item.registration_id),
          target_id: id(item.target_id),
          running_status: ['stopped', 'starting', 'running', 'stopping'].includes(
            item.running_status,
          )
            ? item.running_status
            : null,
          status: [
            'new',
            'installing',
            'installed',
            'activating',
            'activated',
            'redundant',
          ].includes(item.status)
            ? item.status
            : null,
        }
      : null;
  return {
    availability: value.availability === 'ready' ? 'ready' : 'unavailable',
    browser_version:
      value.browser_version && typeof value.browser_version === 'object'
        ? {
            protocol_version: /^[0-9.]{1,40}$/.test(value.browser_version.protocol_version ?? '')
              ? value.browser_version.protocol_version
              : null,
            product: /^Chrome\/[0-9.]+$/.test(value.browser_version.product ?? '')
              ? value.browser_version.product
              : null,
            revision: /^[A-Za-z0-9.@_-]{1,100}$/.test(value.browser_version.revision ?? '')
              ? value.browser_version.revision
              : null,
          }
        : null,
    independent_targets: Array.isArray(value.independent_targets)
      ? value.independent_targets
          .slice(0, 80)
          .map((item) =>
            item &&
            at(item.at) &&
            ['initial', 'created', 'changed', 'destroyed'].includes(item.phase) &&
            target(item.target)
              ? { at: at(item.at), phase: item.phase, target: target(item.target) }
              : null,
          )
          .filter(Boolean)
      : [],
    versions: Array.isArray(value.versions)
      ? value.versions.slice(0, 80).map(version).filter(Boolean)
      : [],
    registrations: Array.isArray(value.registrations)
      ? value.registrations
          .slice(0, 80)
          .map((item) =>
            item && at(item.at) && id(item.registration_id)
              ? {
                  at: at(item.at),
                  registration_id: id(item.registration_id),
                  is_deleted: item.is_deleted === true,
                }
              : null,
          )
          .filter(Boolean)
      : [],
    pre_click_version_count: safeCount(value.pre_click_version_count),
    version_events_dropped: safeCount(value.version_events_dropped),
    old_version_id: id(value.old_version_id),
    old_version_mapping:
      value.old_version_mapping === 'correlated' && id(value.old_version_id)
        ? 'correlated'
        : 'unmeasured',
    version_observation: value.version_observation === 'visible' ? 'visible' : 'unavailable',
    old_host_probe: probe(value.old_host_probe),
    replacement_host_probe: probe(value.replacement_host_probe),
    fresh_replacement:
      value.fresh_replacement &&
      ['activated', 'not_activated', 'identity_mismatch', 'unavailable', 'unmeasured'].includes(
        value.fresh_replacement.outcome,
      )
        ? {
            outcome: value.fresh_replacement.outcome,
            version_id: id(value.fresh_replacement.version_id),
            registration_id: id(value.fresh_replacement.registration_id),
            target_id: id(value.fresh_replacement.target_id),
            running_status: ['stopped', 'starting', 'running', 'stopping'].includes(
              value.fresh_replacement.running_status,
            )
              ? value.fresh_replacement.running_status
              : null,
            status: [
              'new',
              'installing',
              'installed',
              'activating',
              'activated',
              'redundant',
            ].includes(value.fresh_replacement.status)
              ? value.fresh_replacement.status
              : null,
            observations: safeCount(value.fresh_replacement.observations),
            cleanup: ['confirmed', 'unconfirmed', 'not_acquired'].includes(
              value.fresh_replacement.cleanup,
            )
              ? value.fresh_replacement.cleanup
              : 'unconfirmed',
          }
        : null,
  };
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
