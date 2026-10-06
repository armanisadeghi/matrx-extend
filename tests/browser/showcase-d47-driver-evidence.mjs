import assert from 'node:assert/strict';

export function discoveryTerminal(state) {
  return state?.discovering === false && state.responses === true && state.error === false;
}

export function sanitizeD47Failure(error, stage) {
  const rawCode = String(error?.message ?? '').split(':')[0];
  return {
    name: error instanceof Error ? error.name : 'UnknownError',
    stage,
    message_code:
      /^[a-z][a-z0-9_]{2,79}_(?:not_observed|missing|failed|mismatch|ambiguous|observed|unavailable)$/.test(
        rawCode,
      )
        ? rawCode
        : 'unclassified_error',
  };
}

export async function cleanupD47Probe(worker, installed, remove) {
  if (!worker) return null;
  const failures = [];
  try {
    if (installed) await remove(worker);
  } catch {
    failures.push('remove_failed');
  }
  try {
    await worker.detach();
  } catch {
    failures.push('detach_failed');
  }
  return failures.length ? failures : null;
}

export function assessD47Trace(observed, { origin, oldPageContext, expectedBodySha256 }) {
  assert.ok(Array.isArray(observed), 'trace_missing');
  const fail = (reason) => ({ ok: false, reason });
  const contexts = observed.filter((event) => event.kind === 'context_created');
  const old = contexts.find(
    (event) =>
      event.unique_id === oldPageContext.unique_id && event.frame_id === oldPageContext.frame_id,
  );
  if (!old) return fail('old_context_identity_missing');
  const packets = observed.filter((event) => event.kind === 'binding' && event.target_packet);
  if (packets.some((event) => event.old_payload)) return fail('old_binding_payload_observed');
  const currentPackets = packets.filter((event) => event.current_payload);
  if (currentPackets.length !== 1) return fail('current_binding_positive_control_missing');
  const current = currentPackets[0];
  const context = contexts.find(
    (event) => event.id === current.context_id && event.tab_id === current.tab_id,
  );
  if (
    !context?.unique_id ||
    !context.frame_id ||
    context.unique_id === old.unique_id ||
    context.frame_id !== old.frame_id ||
    context.order >= current.order
  )
    return fail('current_context_identity_missing');
  if (
    current.url !== `${origin}/api/document-race` ||
    current.method !== 'GET' ||
    current.source !== 'fetch' ||
    current.request_body_key !== 'none' ||
    current.status !== 200 ||
    current.body_sha256 !== expectedBodySha256 ||
    current.request_sequence !== 1
  )
    return fail('current_request_identity_mismatch');
  const handshake = observed.find(
    (event) =>
      event.kind === 'binding' &&
      event.handshake &&
      event.context_id === current.context_id &&
      event.binding_name === current.binding_name &&
      event.tab_id === current.tab_id &&
      event.order > context.order &&
      event.order < current.order,
  );
  if (!handshake) return fail('current_binding_handshake_missing');
  const commit = observed.find(
    (event) =>
      event.kind === 'frame_navigated' &&
      event.frame_id === context.frame_id &&
      event.tab_id === current.tab_id &&
      event.current_fixture &&
      event.order > old.order,
  );
  if (!commit) return fail('current_frame_commit_missing');
  const oldTerminal = observed.find(
    (event) =>
      event.tab_id === old.tab_id &&
      event.order > old.order &&
      event.order < current.order &&
      ((event.kind === 'context_destroyed' && event.id === old.id) ||
        event.kind === 'contexts_cleared'),
  );
  if (!oldTerminal) return fail('old_context_terminal_missing');
  return {
    ok: true,
    reason: null,
    current_packet_before_commit: current.order < commit.order,
    context_order: context.order,
    handshake_order: handshake.order,
    packet_order: current.order,
    commit_order: commit.order,
    old_terminal_kind: oldTerminal.kind,
  };
}
