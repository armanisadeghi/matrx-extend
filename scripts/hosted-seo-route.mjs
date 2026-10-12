import assert from 'node:assert/strict';
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { safeSeoClickEvidence } from '../tests/browser/guest-seo-click-diagnostic.mjs';
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
  const { stacked_notice_fixture_diagnostic, ...rest } = report;
  const classified = classifySeoResourceDiagnosticReport(
    { ...rest, ...safeStackedNoticeEvidence(stacked_notice_fixture_diagnostic) },
    diagnosticEnabled,
  );
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
    ...safeSeoClickEvidence(report),
    ...safeStackedNoticeEvidence(report.stacked_notice_fixture_diagnostic),
    boundary_sample: safeBoundarySample(report.boundary_sample),
    operation_start_sample: safeBoundarySample(report.operation_start_sample),
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

// Receipt schema: accept only fixture-owned codes/stages and at most two owned notices.
function safeStackedGeometry(value) {
  const predicates = [
    'viewport_width',
    'title_counts',
    'target_count',
    'target_enabled',
    'hit_point_count',
    'notice_hit_point_count',
    'notice_visible_0',
    'notice_visible_1',
    'dismiss_count_0',
    'dismiss_count_1',
    'message_length_0',
    'message_length_1',
  ];
  if (!value || !predicates.includes(value.failed_predicate)) return null;
  const sample = value.native_sample;
  const count = (n) => Number.isInteger(n) && n >= 0 && n <= 99;
  const length = (n) => Number.isInteger(n) && n >= 0 && n <= 4096;
  const pair = (items, valid) => Array.isArray(items) && items.length === 2 && items.every(valid);
  if (
    !sample ||
    !length(sample.width) ||
    !pair(sample.title_counts, count) ||
    !pair(sample.message_lengths, length) ||
    !pair(sample.dismiss_counts, count) ||
    !pair(sample.notice_visible, (v) => typeof v === 'boolean') ||
    !count(sample.target_count) ||
    typeof sample.target_enabled !== 'boolean' ||
    !count(sample.hit_point_count) ||
    !count(sample.notice_hit_point_count)
  )
    return null;
  const nativeSample = {
    width: sample.width,
    title_counts: [...sample.title_counts],
    message_lengths: [...sample.message_lengths],
    dismiss_counts: [...sample.dismiss_counts],
    notice_visible: [...sample.notice_visible],
    target_count: sample.target_count,
    target_enabled: sample.target_enabled,
    hit_point_count: sample.hit_point_count,
    notice_hit_point_count: sample.notice_hit_point_count,
  };
  const name = value.failed_predicate;
  const index = Number(name.at(-1));
  const expected =
    name === 'viewport_width'
      ? 360
      : name === 'title_counts'
        ? value.expected
        : name === 'target_count'
          ? 1
          : name === 'target_enabled' || name.startsWith('notice_visible_')
            ? true
            : name === 'hit_point_count'
              ? 9
              : name.startsWith('dismiss_count_')
                ? 1
                : name.startsWith('message_length_')
                  ? value.expected
                  : 0;
  const observed =
    name === 'viewport_width'
      ? nativeSample.width
      : name === 'title_counts'
        ? nativeSample.title_counts
        : name === 'target_count'
          ? nativeSample.target_count
          : name === 'target_enabled'
            ? nativeSample.target_enabled
            : name === 'hit_point_count'
              ? nativeSample.hit_point_count
              : name === 'notice_hit_point_count'
                ? nativeSample.notice_hit_point_count
                : name.startsWith('notice_visible_')
                  ? nativeSample.notice_visible[index]
                  : name.startsWith('dismiss_count_')
                    ? nativeSample.dismiss_counts[index]
                    : nativeSample.message_lengths[index];
  if (
    (name === 'title_counts' && !pair(expected, count)) ||
    (name.startsWith('message_length_') && !length(expected)) ||
    JSON.stringify(value.observed) !== JSON.stringify(observed) ||
    JSON.stringify(expected) === JSON.stringify(observed)
  )
    return null;
  return { failed_predicate: name, expected, observed, native_sample: nativeSample };
}

function safeStackedNoticeEvidence(value) {
  const stages = [
    'message_contract',
    'native_width',
    'worker_discovery',
    'worker_attach',
    'before_injection',
    'notice_injection',
    'stacked_visible',
    'stacked_geometry',
    'reaudit',
    'reaudit_settled',
    'settled_geometry',
    'independent_dismiss',
  ];
  const cleanup = value?.cleanup;
  if (
    !value ||
    !stages.includes(value.stage) ||
    ![null, 'stacked_notice_assertion_failed', 'stacked_notice_operation_failed'].includes(
      value.failure_code,
    ) ||
    !cleanup ||
    !['not_needed', 'cleared', 'failed'].includes(cleanup.status) ||
    ![null, 'stacked_notice_cleanup_failed'].includes(cleanup.failure_code) ||
    ![cleanup.attempted_count, cleanup.cleared_count, cleanup.failed_count].every(
      (count) => Number.isInteger(count) && count >= 0 && count <= 2,
    ) ||
    cleanup.cleared_count + cleanup.failed_count !== cleanup.attempted_count
  )
    return {};
  const geometry =
    ['stacked_geometry', 'settled_geometry', 'independent_dismiss'].includes(value.stage) &&
    value.failure_code === 'stacked_notice_assertion_failed'
      ? safeStackedGeometry(value.geometry)
      : null;
  return {
    stacked_notice_fixture_diagnostic: {
      failure_code: value.failure_code,
      stage: value.stage,
      ...(geometry && { geometry }),
      cleanup: {
        status: cleanup.status,
        attempted_count: cleanup.attempted_count,
        cleared_count: cleanup.cleared_count,
        failed_count: cleanup.failed_count,
        failure_code: cleanup.failure_code,
      },
    },
  };
}

function safeBoundarySample(sample) {
  if (!sample || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(sample.at)) return null;
  if (![sample.user, sample.system].every((value) => Number.isSafeInteger(value) && value >= 0))
    return null;
  return { at: sample.at, user: sample.user, system: sample.system };
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
  assert.ok(
    fixture === 'none' || fixture === 'airbnb' || fixture === 'owned',
    'unknown_seo_metadata_fixture',
  );
  if (fixture === 'airbnb') {
    assert.equal(acceptanceCase, 'guest-seo', 'seo_metadata_fixture_requires_guest_seo');
    assert.equal(scope, 'full', 'seo_metadata_fixture_requires_full_scope');
  }
  if (fixture === 'owned') {
    assert.equal(acceptanceCase, 'guest-seo', 'seo_metadata_fixture_requires_guest_seo');
    assert.ok(
      scope === 'metadata' || scope === 'narrow',
      'owned_metadata_fixture_requires_owned_scope',
    );
  }
  if (scope === 'metadata' || scope === 'narrow')
    assert.equal(fixture, 'owned', 'owned_metadata_fixture_requires_metadata_scope');
  return fixture === 'none' ? undefined : fixture;
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
    scope === 'full' ||
      scope === 'controlled' ||
      scope === 'notice' ||
      scope === 'notice-stacked' ||
      scope === 'readability' ||
      scope === 'metadata' ||
      scope === 'narrow',
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
  assert.ok(
    artifactMode === 'development' || artifactMode === 'release',
    'hosted_seo_artifact_mode_required',
  );
  if (artifactMode === 'development') {
    assert.equal(prepared?.kind, 'ci_development_test', 'hosted_seo_ci_receipt_required');
    assert.equal(prepared?.eligibleStore, false, 'hosted_seo_store_artifact_refused');
  } else {
    assert.equal(
      prepared?.kind,
      'published_store_zip_adapted',
      'hosted_seo_store_receipt_required',
    );
    assert.equal(selectedInterruptTarget, undefined, 'seo_interrupt_requires_development_artifact');
  }
  assert.ok(prepared.extensionDir?.startsWith('/'), 'hosted_seo_extension_dir_required');
  assert.ok(prepared.relocatedReceipt?.startsWith('/'), 'hosted_seo_receipt_path_required');
  assert.equal(
    dirname(prepared.extensionDir),
    dirname(prepared.relocatedReceipt),
    'hosted_seo_selected_artifact_mismatch',
  );
  assert.equal(
    prepared.extensionDir,
    join(
      dirname(prepared.relocatedReceipt),
      artifactMode === 'release' ? 'chrome-mv3-store' : 'chrome-mv3',
    ),
  );
  return {
    driver: 'tests/browser/seo-guest-acceptance.mjs',
    env: {
      SEO_GUEST_EXTENSION_DIR: prepared.extensionDir,
      ...(artifactMode === 'release'
        ? { SEO_GUEST_RELEASE_RECEIPT: prepared.relocatedReceipt }
        : { SEO_GUEST_DEV_BUILD_RECEIPT: prepared.relocatedReceipt }),
      SEO_GUEST_CASE_SCOPE: scope,
      SEO_GUEST_METADATA_FIXTURE: metadataFixture,
      SEO_GUEST_INTERRUPT_AFTER_TARGET: selectedInterruptTarget,
    },
  };
}
