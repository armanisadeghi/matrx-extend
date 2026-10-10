import assert from 'node:assert/strict';
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { safeStartupEndpointObservation } from './hosted-startup-interval-diagnostic.mjs';

export async function seoStartupObservationOptions(report, enabled) {
  if (!enabled) return {};
  const policy = JSON.parse(
    await readFile(new URL('../docs/stabilization/resource-policy.json', import.meta.url)),
  );
  report.startup_endpoint_observations = [];
  return {
    startupEndpointObservationMs: policy.watchIntervalSeconds * 1000,
    onStartupEndpointObservation: (observation) => {
      report.startup_endpoint_observations.push(safeStartupEndpointObservation(observation));
    },
  };
}

export async function writeSeoGuestReport(path, report, diagnosticEnabled) {
  const classified = classifySeoResourceDiagnosticReport(report, diagnosticEnabled);
  const finalReport = report.interruption_test_target
    ? {
        ...classified,
        evidence_classification: 'DIAGNOSTIC_ONLY_NO_ACCEPTANCE_CREDIT',
        diagnostic_source_status: classified.status,
        diagnostic_targets: classified.targets,
        targets: [],
        status: 'unverified',
      }
    : classified;
  persistSeoReceipt(path, finalReport);
  return finalReport;
}

// The resource watchdog can terminate Node without running the driver's catch
// or final writer. Persist only bounded, public-free progress at each completed
// boundary. Rename keeps the previous receipt intact if termination hits a write.
export function writeSeoGuestProgress(path, report, diagnosticEnabled) {
  const progress = {
    schema_version: report.schema_version,
    feature_id: report.feature_id,
    mode: report.mode,
    status: 'unverified',
    receipt_state: 'in_progress',
    scope: report.scope,
    case_selection: report.case_selection,
    resource_diagnostic_enabled: diagnosticEnabled,
    ...(report.interruption_test_target && {
      interruption_test_target: report.interruption_test_target,
      evidence_classification: 'DIAGNOSTIC_ONLY_NO_ACCEPTANCE_CREDIT',
    }),
    build: report.build,
    last_safe_stage: report.last_safe_stage,
    current_operation: report.current_operation,
    targets: report.targets.map(({ case_id, subtarget, status }) => ({
      case_id,
      subtarget,
      status,
    })),
  };
  const classified = classifySeoResourceDiagnosticReport(progress, diagnosticEnabled);
  persistSeoReceipt(path, classified);
  return classified;
}

function persistSeoReceipt(path, report) {
  const temporary = `${path}.progress-${process.pid}`;
  let fd;
  try {
    fd = openSync(temporary, 'w', 0o600);
    writeFileSync(fd, `${JSON.stringify(report, null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(temporary);
    } catch {
      /* preserve the original failure */
    }
    throw error;
  }
}

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

// This is a diagnostic of receipt durability, never a product acceptance result.
export function hostedSeoInterruptTarget(
  acceptanceCase,
  scope,
  fixture,
  resourceDiagnostic = '0',
  selector = 'none',
) {
  if (selector === 'none') return undefined;
  assert.equal(selector, 'manual_button_returns_to_current_page', 'unknown_seo_interrupt_target');
  assert.equal(acceptanceCase, 'guest-seo', 'seo_interrupt_requires_guest_seo');
  assert.equal(scope, 'controlled', 'seo_interrupt_requires_controlled_scope');
  assert.equal(fixture, 'none', 'seo_interrupt_requires_no_fixture');
  assert.equal(resourceDiagnostic, '0', 'seo_interrupt_refuses_resource_diagnostic');
  return selector;
}

export function interruptSeoAfterCheckpoint(selector, subtarget) {
  if (selector === subtarget) process.kill(process.pid, 'SIGTERM');
}

export function classifySeoResourceDiagnosticReport(report, enabled) {
  if (!enabled) return report;
  return {
    ...report,
    evidence_classification: 'DIAGNOSTIC_ONLY_NO_ACCEPTANCE_CREDIT',
    diagnostic_source_status: report.status,
    diagnostic_targets: report.targets,
    targets: [],
    status:
      report.status === 'unverified' || report.status === 'fail'
        ? report.status
        : 'diagnostic_only',
  };
}

export function hostedGuestSeoRoute(
  acceptanceCase,
  artifactMode,
  prepared,
  scope = 'full',
  fixture = 'none',
  interruptTarget = 'none',
  resourceDiagnostic = '0',
) {
  assert.ok(
    scope === 'full' || scope === 'controlled' || scope === 'readability',
    'unknown_seo_case_scope',
  );
  assert.ok(scope === 'full' || acceptanceCase === 'guest-seo', 'seo_scope_requires_guest_seo');
  const metadataFixture = hostedSeoMetadataFixture(acceptanceCase, scope, fixture);
  const selectedInterruptTarget = hostedSeoInterruptTarget(
    acceptanceCase,
    scope,
    fixture,
    resourceDiagnostic,
    interruptTarget,
  );
  if (acceptanceCase !== 'guest-seo') return null;
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
      SEO_GUEST_INTERRUPT_AFTER_TARGET: selectedInterruptTarget,
    },
  };
}
