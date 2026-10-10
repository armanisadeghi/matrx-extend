import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  nativeAiAttribution,
  requireNativeAiProbeEvidence,
  safeRealmProbe,
} from './native-ai-probe-verdict.mjs';

function realm(summarizerAvailability, present = true) {
  return safeRealmProbe({
    is_document: true,
    user_activation_active: false,
    capabilities: { Summarizer: { present, availability: summarizerAvailability } },
  });
}

const manual = { observed: true, ok: true, unavailable: false };
const delegated = {
  posted: true,
  canonical_ai_tool: true,
  http_status: 200,
  output_ok: true,
  output_unavailable: false,
};

test('native AI probe attributes document-only Summarizer exposure without treating unavailable APIs as product pass', () => {
  assert.equal(
    nativeAiAttribution(realm('available'), realm('unavailable', false), manual, {
      ...delegated,
      output_ok: false,
      output_unavailable: true,
    }),
    'document_succeeded_worker_unavailable',
  );
  assert.equal(
    nativeAiAttribution(
      realm('unavailable', false),
      realm('unavailable', false),
      { ...manual, ok: false, unavailable: true },
      { ...delegated, output_ok: false, output_unavailable: true },
    ),
    'native_api_unavailable_in_both_realms',
  );
  assert.equal(
    nativeAiAttribution(realm('available'), realm('available'), manual, delegated),
    'capability_and_tool_results_observed',
  );
  assert.equal(
    nativeAiAttribution(realm('available'), realm('unavailable', false), manual, delegated),
    'document_worker_operation_mismatch_unclassified',
  );
});

test('native AI probe refuses missing or misattributed manual and delegated observations', () => {
  const panel = realm('available');
  const worker = realm('unavailable', false);
  assert.equal(nativeAiAttribution(null, worker, manual, delegated), 'realm_probe_incomplete');
  assert.equal(
    nativeAiAttribution(panel, worker, { observed: false }, delegated),
    'manual_result_missing',
  );
  assert.equal(
    nativeAiAttribution(panel, worker, manual, { ...delegated, posted: false }),
    'delegated_result_missing',
  );
  assert.equal(
    nativeAiAttribution(panel, worker, manual, { ...delegated, canonical_ai_tool: false }),
    'delegated_tool_identity_missing',
  );
  assert.equal(
    nativeAiAttribution(panel, worker, manual, { ...delegated, http_status: 500 }),
    'delegated_transport_failure',
  );
});

test('native AI realm receipt drops unbounded API values and preserves only known states', () => {
  const sanitized = safeRealmProbe({
    capabilities: { Summarizer: { present: true, availability: 'secret-string' } },
    email: 'private@example.invalid',
  });
  assert.equal(sanitized.capabilities.Summarizer.availability, 'probe-error');
  assert.equal(JSON.stringify(sanitized).includes('private@example.invalid'), false);
  assert.equal(JSON.stringify(sanitized).includes('secret-string'), false);
});

test('native AI receipt requires real warm and post-reload panel, worker, manual and delegated observations', () => {
  const cycle = (label) => ({
    label,
    realms: { panel: { is_document: true }, worker: { is_document: false } },
    manual: { availability: { observed: true }, summarize: { observed: true } },
    delegated: {
      posted: true,
      canonical_ai_tool: true,
      controlled_action_observed: true,
      http_status: 200,
      completed_reply_observed: true,
    },
  });
  const measured = {
    artifact: { tree_sha256: 'a'.repeat(64) },
    product_acceptance_credit: false,
    authentication: {
      member_signed_in: true,
      non_admin_identity: true,
      organization_selected: true,
    },
    reload: { management_reload_clicked: true, worker_replaced: true, panel_replaced: true },
    cycles: [cycle('warm'), cycle('post_reload')],
  };
  assert.equal(requireNativeAiProbeEvidence(measured), 'measured_no_product_credit');
  for (const changed of [
    { cycles: [cycle('warm')] },
    { cycles: [cycle('warm'), cycle('warm')] },
    { reload: { ...measured.reload, worker_replaced: false } },
    { cycles: [cycle('warm'), { ...cycle('post_reload'), manual: null }] },
    { cycles: [cycle('warm'), { ...cycle('post_reload'), delegated: { posted: false } }] },
    {
      cycles: [
        cycle('warm'),
        {
          ...cycle('post_reload'),
          delegated: { ...cycle('post_reload').delegated, controlled_action_observed: false },
        },
      ],
    },
    {
      cycles: [
        cycle('warm'),
        {
          ...cycle('post_reload'),
          delegated: { ...cycle('post_reload').delegated, completed_reply_observed: false },
        },
      ],
    },
    { cycles: [cycle('warm'), { ...cycle('post_reload'), realms: { panel: null } }] },
    { product_acceptance_credit: true },
  ])
    assert.throws(
      () => requireNativeAiProbeEvidence({ ...measured, ...changed }),
      /native_ai_probe_/,
    );
});
