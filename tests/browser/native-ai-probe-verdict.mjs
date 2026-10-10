const API_KEYS = [
  'LanguageModel',
  'Summarizer',
  'Translator',
  'LanguageDetector',
  'Proofreader',
  'Writer',
  'Rewriter',
];
const AVAILABILITY = new Set([
  'available',
  'downloadable',
  'downloading',
  'unavailable',
  'requires-language-pair',
  'probe-error',
  'method-missing',
]);

/** Project untrusted native API observations into a bounded, secret-free receipt. */
export function safeRealmProbe(value) {
  if (!value || typeof value !== 'object') return null;
  const capabilities = {};
  for (const key of API_KEYS) {
    const observed = value.capabilities?.[key];
    capabilities[key] = {
      present: observed?.present === true,
      availability: AVAILABILITY.has(observed?.availability)
        ? observed.availability
        : 'probe-error',
    };
  }
  return {
    is_document: value.is_document === true,
    user_activation_active: value.user_activation_active === true,
    user_activation_has_been_active: value.user_activation_has_been_active === true,
    capabilities,
  };
}

export function nativeAiAttribution(panel, worker, manual, delegated) {
  if (!panel || !worker) return 'realm_probe_incomplete';
  if (!manual?.observed) return 'manual_result_missing';
  if (!delegated?.posted) return 'delegated_result_missing';
  if (!delegated?.canonical_ai_tool) return 'delegated_tool_identity_missing';
  if (delegated.http_status !== 200) return 'delegated_transport_failure';
  const panelAvailable =
    panel.capabilities.Summarizer.present &&
    panel.capabilities.Summarizer.availability === 'available';
  const workerAvailable =
    worker.capabilities.Summarizer.present &&
    worker.capabilities.Summarizer.availability === 'available';
  if (!panelAvailable && !workerAvailable) {
    return manual.unavailable && delegated.output_unavailable
      ? 'native_api_unavailable_in_both_realms'
      : 'unavailable_api_result_not_attributed';
  }
  if (panelAvailable && !workerAvailable) {
    return manual.ok && delegated.output_unavailable
      ? 'document_succeeded_worker_unavailable'
      : 'document_worker_operation_mismatch_unclassified';
  }
  return manual.ok && delegated.output_ok
    ? 'capability_and_tool_results_observed'
    : 'available_api_operation_failed';
}

/** Diagnostic completeness only; this never grants EXT-D-0147 product credit. */
export function requireNativeAiProbeEvidence(report) {
  if (!report?.artifact?.tree_sha256 || report.product_acceptance_credit !== false)
    throw new Error('native_ai_probe_artifact_or_scope_missing');
  if (
    report.authentication?.member_signed_in !== true ||
    report.authentication?.non_admin_identity !== true ||
    report.authentication?.organization_selected !== true
  )
    throw new Error('native_ai_probe_member_auth_missing');
  if (
    report.reload?.management_reload_clicked !== true ||
    report.reload?.worker_replaced !== true ||
    report.reload?.panel_replaced !== true
  )
    throw new Error('native_ai_probe_full_reload_missing');
  if (
    report.cycles?.length !== 2 ||
    report.cycles[0]?.label !== 'warm' ||
    report.cycles[1]?.label !== 'post_reload'
  )
    throw new Error('native_ai_probe_two_cycles_missing');
  for (const cycle of report.cycles) {
    if (!cycle.realms?.panel?.is_document || cycle.realms?.worker?.is_document)
      throw new Error('native_ai_probe_realm_identity_missing');
    if (!cycle.manual?.availability?.observed || !cycle.manual?.summarize?.observed)
      throw new Error('native_ai_probe_manual_result_missing');
    if (
      cycle.delegated?.posted !== true ||
      cycle.delegated?.canonical_ai_tool !== true ||
      cycle.delegated?.controlled_action_observed !== true ||
      cycle.delegated?.http_status !== 200 ||
      cycle.delegated?.completed_reply_observed !== true
    )
      throw new Error('native_ai_probe_delegated_result_missing');
  }
  return 'measured_no_product_credit';
}
