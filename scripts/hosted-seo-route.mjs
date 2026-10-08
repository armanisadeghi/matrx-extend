import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';

export function hostedSeoMetadataFixture(acceptanceCase, scope, fixture = 'none') {
  assert.ok(fixture === 'none' || fixture === 'airbnb', 'unknown_seo_metadata_fixture');
  if (fixture === 'airbnb') {
    assert.equal(acceptanceCase, 'guest-seo', 'seo_metadata_fixture_requires_guest_seo');
    assert.equal(scope, 'full', 'seo_metadata_fixture_requires_full_scope');
  }
  return fixture === 'airbnb' ? fixture : undefined;
}

export function hostedSeoResourceDiagnostic(acceptanceCase, scope, fixture, enabled = '0') {
  assert.ok(enabled === '0' || enabled === '1', 'unknown_seo_resource_diagnostic');
  if (enabled === '1') {
    assert.equal(acceptanceCase, 'guest-seo', 'seo_resource_diagnostic_requires_guest_seo');
    assert.equal(scope, 'full', 'seo_resource_diagnostic_requires_full_scope');
    assert.equal(fixture, 'airbnb', 'seo_resource_diagnostic_requires_airbnb');
  }
  return enabled === '1';
}

export function classifySeoResourceDiagnosticReport(report, enabled) {
  if (!enabled) return report;
  return {
    ...report,
    evidence_classification: 'DIAGNOSTIC_ONLY_NO_ACCEPTANCE_CREDIT',
    diagnostic_targets: report.targets,
    targets: [],
    status: report.status === 'partial' ? 'diagnostic_only' : report.status,
  };
}

export function hostedGuestSeoRoute(
  acceptanceCase,
  artifactMode,
  prepared,
  scope = 'full',
  fixture = 'none',
) {
  const metadataFixture = hostedSeoMetadataFixture(acceptanceCase, scope, fixture);
  if (acceptanceCase !== 'guest-seo') return null;
  assert.ok(scope === 'full' || scope === 'controlled', 'unknown_seo_case_scope');
  assert.equal(artifactMode, 'development', 'hosted_seo_development_mode_required');
  assert.equal(prepared?.kind, 'ci_development_test', 'hosted_seo_ci_receipt_required');
  assert.equal(prepared?.eligibleStore, false, 'hosted_seo_store_artifact_refused');
  assert.ok(prepared.extensionDir?.startsWith('/'), 'hosted_seo_extension_dir_required');
  assert.ok(prepared.relocatedReceipt?.startsWith('/'), 'hosted_seo_receipt_path_required');
  assert.equal(
    dirname(prepared.extensionDir),
    dirname(prepared.relocatedReceipt),
    'hosted_seo_selected_artifact_mismatch',
  );
  assert.equal(prepared.extensionDir, join(dirname(prepared.relocatedReceipt), 'chrome-mv3'));
  return {
    driver: 'tests/browser/seo-guest-acceptance.mjs',
    env: {
      SEO_GUEST_EXTENSION_DIR: prepared.extensionDir,
      SEO_GUEST_DEV_BUILD_RECEIPT: prepared.relocatedReceipt,
      SEO_GUEST_CASE_SCOPE: scope,
      SEO_GUEST_METADATA_FIXTURE: metadataFixture,
    },
  };
}
