import assert from 'node:assert/strict';
import { refuseDiagnosticAcceptance } from './scrape-reload-open-diagnostic.mjs';

export function requireSettingsSenderDocumentReceipt(evidence) {
  assert.ok(
    evidence?.refresh_requested === true &&
      evidence.refresh_completed === true &&
      evidence.new_document_observed === true &&
      evidence.same_url_observed === true,
    'native_reload_sender_document_refresh_unverified',
  );
  return {
    refresh_requested: true,
    refresh_completed: true,
    new_document_observed: true,
    same_url_observed: true,
  };
}

export function finalizeSettingsSenderDocumentDiagnostic(report, enabled) {
  if (!enabled) return false;
  try {
    requireSettingsSenderDocumentReceipt(report.reload_sender_document_diagnostic?.receipt);
  } catch {
    report.reload_sender_document_diagnostic.receipt_failure =
      'native_reload_sender_document_refresh_unverified';
    report.failure ??= {
      stage: 'sender_document_prepare',
      code: 'native_reload_sender_document_refresh_unverified',
    };
  }
  for (const c of report.cases) {
    c.evidence_class = 'diagnostic_only';
    if (c.status === 'pass') c.status = 'unverified';
  }
  return refuseDiagnosticAcceptance(report, true);
}
