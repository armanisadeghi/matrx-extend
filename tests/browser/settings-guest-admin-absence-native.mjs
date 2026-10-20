#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyImportedNativeEvidence } from '../../scripts/current-test-artifact.mjs';
import { verifyFrozenArtifactIdentity } from '../../scripts/frozen-artifact-identity.mjs';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { recordGuestAdminAbsence } from './settings-guest-absence.mjs';
import {
  guestSettingsChecks,
  guestSettingsState,
  openGuestSettings,
  openSection,
} from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'settings-guest-admin-absence-native.json');
const CASE_IDS = ['EXT-F-1003-T22', 'EXT-F-1003-T63'];
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function criterion(record, name, status, evidence) {
  record.criteria.push({ name, status, evidence });
}

export function newReport() {
  return {
    schema_version: 1,
    acceptance_case: 'settings-guest-admin-absence',
    role: 'guest',
    scope: 'focused guest Settings admin absence before and after a real extension reload',
    excluded_scope: ['ordinary-member denial', 'T04 preference restoration', 'full Settings batch'],
    status: 'unverified',
    cases: CASE_IDS.map((id) => ({
      id,
      role: 'guest',
      scope: id.endsWith('T63')
        ? 'guest-only subtarget; ordinary-member clause unverified'
        : 'complete guest case',
      status: 'unverified',
      steps: [],
      criteria: [],
    })),
  };
}

export function requireFocusedImportedEvidence(
  evidence,
  { expectedSourceSha, expectedRunId, expectedArtifactId, expectedVersion, expectedTreeSha256 },
) {
  assert.equal(evidence?.kind, 'ci_development_test');
  assert.equal(evidence.eligibleStore, false);
  assert.equal(evidence.schema_version, 1);
  assert.equal(evidence.publish_state, 'not_published');
  assert.equal(evidence.repository, 'armanisadeghi/matrx-extend');
  assert.equal(evidence.workflow, '.github/workflows/ci.yml');
  assert.match(evidence.sourceSha, SHA);
  assert.match(evidence.githubArtifactDigest, DIGEST);
  assert.match(evidence.treeSha256, /^[a-f0-9]{64}$/);
  for (const field of ['runId', 'runAttempt', 'artifactId'])
    assert.ok(Number.isSafeInteger(evidence[field]) && evidence[field] > 0, `${field} missing`);
  assert.equal(
    evidence.sourceSha,
    expectedSourceSha,
    'development artifact is not exact hosted source',
  );
  assert.equal(evidence.runId, Number(expectedRunId), 'development run mismatch');
  assert.equal(evidence.artifactId, Number(expectedArtifactId), 'development artifact mismatch');
  assert.equal(evidence.version, expectedVersion);
  assert.equal(evidence.treeSha256, expectedTreeSha256);
  return {
    schema_version: evidence.schema_version,
    kind: evidence.kind,
    eligibleStore: evidence.eligibleStore,
    publish_state: evidence.publish_state,
    repository: evidence.repository,
    workflow: evidence.workflow,
    sourceSha: evidence.sourceSha,
    runId: evidence.runId,
    runAttempt: evidence.runAttempt,
    artifactId: evidence.artifactId,
    githubArtifactDigest: evidence.githubArtifactDigest,
    version: evidence.version,
    treeSha256: evidence.treeSha256,
  };
}

export function recordFocusedBuildProvenance(report, evidence, expected) {
  report.build = requireFocusedImportedEvidence(evidence, expected);
  return report.build;
}

async function originalPageTarget(browserSession, page) {
  const url = page.url();
  const targets = (await browserSession.send('Target.getTargets')).targetInfos.filter(
    (target) => target.type === 'page' && target.url === url,
  );
  assert.equal(targets.length, 1, 'original normal page target must remain unique');
  return targets[0].targetId;
}

async function prepareFocusedGuestSettings(panel) {
  await openGuestSettings(panel);
  await openSection(panel, 'Account');
  await openSection(panel, 'Organization');
}

export async function observeFocusedGuestPhase({
  panel,
  phase,
  report,
  prepareSettings = prepareFocusedGuestSettings,
}) {
  await prepareSettings(panel);
  const identity = await guestSettingsState(panel);
  const signedOut = guestSettingsChecks(identity).signedOut;
  const identityEvidence = {
    active: identity?.active === true,
    accessTokenPresent: identity?.accessTokenPresent === true,
    profilePresent: identity?.profilePresent === true,
    organizationChoicePresent: identity?.organizationChoicePresent === true,
    accountSectionCount: identity?.accountSectionCount ?? null,
    emailUnavailable: identity?.emailUnavailable === true,
    footerSignInCount: identity?.footerSignInCount ?? null,
    footerSignOutCount: identity?.footerSignOutCount ?? null,
    signedOut,
  };
  const absenceResults = [];
  for (const record of report.cases) {
    record.steps.push({
      phase,
      action: 'Observe active guest Settings identity',
      observation: identityEvidence,
    });
    criterion(
      record,
      `${phase}: signed-out Settings identity`,
      signedOut ? 'pass' : 'fail',
      identityEvidence,
    );
    absenceResults.push(
      await recordGuestAdminAbsence({
        panel,
        caseRecord: record,
        phase,
        signedOut,
        criterion,
        action: 'Inspect active guest Settings anchors and admin controls',
        criterionName: `${phase}: admin section and controls absent in active guest Settings`,
      }),
    );
  }
  return (
    signedOut &&
    absenceResults.length === 2 &&
    absenceResults.every(Boolean) &&
    report.cases.every(
      (record) =>
        record.criteria.filter((entry) => entry.name.startsWith(`${phase}:`)).length === 2 &&
        record.criteria
          .filter((entry) => entry.name.startsWith(`${phase}:`))
          .every((entry) => entry.status === 'pass'),
    )
  );
}

export async function runFocusedGuestSequence({
  panel,
  browserSession,
  page,
  reloadExtension,
  report,
  prepareSettings,
}) {
  const originalTargetId = await originalPageTarget(browserSession, page);
  const warmPassed = await observeFocusedGuestPhase({
    panel,
    phase: 'fresh',
    report,
    prepareSettings,
  });
  if (!warmPassed) throw new Error('focused_guest_fresh_observation_failed');
  const replacement = await reloadExtension();
  assert.equal(replacement.management_reload_clicked, true, 'real extension reload required');
  assert.equal(replacement.old_targets_retired, true, 'old extension targets must retire');
  assert.equal(replacement.worker_replaced, true, 'extension worker must be replaced');
  assert.equal(replacement.panel_replaced, true, 'side panel must be replaced');
  assert.equal(
    replacement.retirement_evidence?.timeline?.final_predicate,
    true,
    'reload timeline incomplete',
  );
  assert.notEqual(
    replacement.panel?.targetId,
    panel.targetId,
    'replacement panel target must differ',
  );
  assert.equal(replacement.replacement_panel_target_id, replacement.panel.targetId);
  assert.equal(
    await originalPageTarget(browserSession, page),
    originalTargetId,
    'original normal page target changed',
  );
  report.reload = {
    managementReloadClicked: true,
    oldTargetsRetired: true,
    workerReplaced: true,
    panelReplaced: true,
    originalPageTargetPreserved: true,
    originalPanelTargetId: panel.targetId,
    replacementPanelTargetId: replacement.panel.targetId,
  };
  const reloadedPassed = await observeFocusedGuestPhase({
    panel: replacement.panel,
    phase: 'extension_reload',
    report,
    prepareSettings,
  });
  if (!reloadedPassed) throw new Error('focused_guest_reloaded_observation_failed');
  const t22 = report.cases.find((record) => record.id.endsWith('T22'));
  const t63 = report.cases.find((record) => record.id.endsWith('T63'));
  t22.status =
    t22.criteria.length === 4 && t22.criteria.every((entry) => entry.status === 'pass')
      ? 'pass'
      : 'fail';
  criterion(
    t63,
    'ordinary-member denial before and after reload',
    'unverified',
    'This guest-only runner has no ordinary-member principal.',
  );
  t63.status = t63.criteria.some((entry) => entry.status === 'fail') ? 'fail' : 'unverified';
  report.focused_guest_subtargets_status =
    t22.status === 'pass' && t63.criteria.slice(0, 4).every((entry) => entry.status === 'pass')
      ? 'pass'
      : 'fail';
  report.status = report.focused_guest_subtargets_status === 'pass' ? 'partial' : 'fail';
}

async function main() {
  const report = newReport();
  let receipt;
  try {
    assert.equal(process.env.MATRX_HOSTED_ACCEPTANCE_CASE, 'settings-guest-admin-absence');
    const extensionDir = resolve(process.env.SETTINGS_DEV_EXTENSION_DIR ?? '');
    const receiptPath = process.env.SETTINGS_DEV_BUILD_RECEIPT;
    assert.ok(receiptPath, 'focused Settings requires CI development receipt');
    receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
    requireLocalDevReceipt(receipt, extensionDir);
    verifyFrozenArtifactIdentity({ extensionDir, manifest, receipt });
    assert.ok(manifest.key, 'development manifest must carry its stable key');
    recordFocusedBuildProvenance(
      report,
      await verifyImportedNativeEvidence(extensionDir, receiptPath),
      {
        expectedSourceSha: process.env.GITHUB_SHA,
        expectedRunId: process.env.MATRX_HOSTED_DEV_RUN_ID,
        expectedArtifactId: process.env.MATRX_HOSTED_DEV_ARTIFACT_ID,
        expectedVersion: receipt.version,
        expectedTreeSha256: receipt.treeSha256,
      },
    );
    const result = await runNativeSidepanelQa({
      extensionDir,
      expectedRelease: { version: receipt.version, treeSha256: receipt.treeSha256 },
      localDevReceiptPath: receiptPath,
      exercisePanel: (input) => runFocusedGuestSequence({ ...input, report }),
    });
    assert.equal(result.verified, true);
    const after = JSON.parse(await readFile(receiptPath, 'utf8'));
    requireLocalDevReceipt(after, extensionDir);
    assert.equal(after.version, receipt.version);
    assert.equal(after.treeSha256, receipt.treeSha256);
    assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256);
    report.build.verified = true;
    report.artifacts = result.artifacts;
  } catch (error) {
    report.failure = String(error?.message ?? error);
    report.status = report.cases.some((record) =>
      record.criteria.some((entry) => entry.status === 'fail'),
    )
      ? 'fail'
      : 'unverified';
    for (const record of report.cases)
      if (record.criteria.some((entry) => entry.status === 'fail')) record.status = 'fail';
    process.exitCode = 1;
  } finally {
    await mkdir(join(REPO, 'test-results'), { recursive: true });
    await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`${report.status.toUpperCase()} settings-guest-admin-absence: ${OUTPUT}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
