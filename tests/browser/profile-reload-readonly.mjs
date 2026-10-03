#!/usr/bin/env node
/** Read-only reproduction of the Profile runner's Chrome extension reload boundary. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyImportedNativeEvidence } from '../../scripts/current-test-artifact.mjs';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';

const OUTPUT_DIR = process.env.PROFILE_OUTPUT_DIR;
const RUN_ID = process.env.PROFILE_RUN_ID;
const RECEIPT_PATH = process.env.PROFILE_DEV_BUILD_RECEIPT;
const SOURCE_SHA = process.env.PROFILE_EXPECTED_SOURCE_SHA;
const CI_RUN_ID = Number(process.env.PROFILE_EXPECTED_CI_RUN_ID);
const ARTIFACT_ID = Number(process.env.PROFILE_EXPECTED_ARTIFACT_ID);
const report = {
  schema_version: 1,
  kind: 'profile_reload_readonly_diagnostic',
  run_id: RUN_ID,
  status: 'unverified',
  stage: 'preflight',
  artifact: null,
  lifecycle: null,
};

const SAFE_ERRORS = new Set([
  'native_extension_management_reload_unavailable',
  'native_extension_current_worker_unverified',
  'native_extension_current_panel_unverified',
  'native_extension_old_worker_retired_before_reload',
  'native_extension_worker_retirement_unverified',
  'native_extension_replacement_panel_unverified',
  'native_sidepanel_runtime_context_missing',
  'owned_cdp_transport_failed',
]);
const SAFE_TRANSPORT_CLASSES = new Set([
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

function safeFailureCode(error) {
  const code = String(error?.message ?? '').split(':', 1)[0];
  return SAFE_ERRORS.has(code) ? code : 'unclassified';
}

function safeTransportClass(readClass) {
  try {
    const value = readClass();
    return SAFE_TRANSPORT_CLASSES.has(value) ? value : 'other';
  } catch {
    return 'unavailable';
  }
}

try {
  if (!RUN_ID || !/^[A-Za-z0-9_-]+$/.test(RUN_ID)) throw new Error('run_id_required');
  if (!OUTPUT_DIR?.startsWith('/')) throw new Error('output_directory_required');
  if (!RECEIPT_PATH?.startsWith('/')) throw new Error('receipt_path_required');
  if (!/^[a-f0-9]{40}$/.test(SOURCE_SHA ?? '')) throw new Error('source_sha_required');
  if (!Number.isSafeInteger(CI_RUN_ID) || CI_RUN_ID <= 0) throw new Error('ci_run_id_required');
  if (!Number.isSafeInteger(ARTIFACT_ID) || ARTIFACT_ID <= 0)
    throw new Error('artifact_id_required');

  const receipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'));
  requireLocalDevReceipt(receipt, receipt.extensionDir);
  const imported = await verifyImportedNativeEvidence(receipt.extensionDir, RECEIPT_PATH);
  if (
    imported.sourceSha !== SOURCE_SHA ||
    imported.runId !== CI_RUN_ID ||
    imported.artifactId !== ARTIFACT_ID
  )
    throw new Error('artifact_identity_mismatch');
  report.artifact = {
    source_sha: imported.sourceSha,
    ci_run_id: imported.runId,
    artifact_id: imported.artifactId,
    version: receipt.version,
    tree_sha256: receipt.treeSha256,
  };

  report.stage = 'native_sidepanel_startup';
  const native = await runNativeSidepanelQa({
    extensionDir: receipt.extensionDir,
    expectedRelease: receipt,
    localDevReceiptPath: RECEIPT_PATH,
    artifactRoot: OUTPUT_DIR,
    onStage: (stage) => {
      report.stage = stage;
    },
    exercisePanel: async ({ panel, panelTarget, reloadExtension, transportFailureClass }) => {
      report.stage = 'extension_reload';
      const lifecycle = {
        reload_attempted: true,
        before_panel_target_observed: Boolean(panelTarget?.targetId),
        reload_returned: false,
        old_targets_retired: null,
        worker_replaced: null,
        panel_replaced: null,
        failure_code: null,
        failure_stage: null,
        transport_failure_class: null,
      };
      try {
        const result = await reloadExtension();
        lifecycle.reload_returned = true;
        lifecycle.old_targets_retired = result.old_targets_retired === true;
        lifecycle.worker_replaced = result.worker_replaced === true;
        lifecycle.panel_replaced = result.panel_replaced === true;
        await result.panel.detach();
      } catch (error) {
        lifecycle.failure_code = safeFailureCode(error);
        lifecycle.failure_stage = report.stage;
        lifecycle.transport_failure_class = safeTransportClass(transportFailureClass);
        if (lifecycle.failure_code === 'native_extension_worker_retirement_unverified')
          lifecycle.retirement_evidence = error.lifecycleEvidence ?? null;
      }
      report.lifecycle = lifecycle;
      report.status = lifecycle.reload_returned ? 'reload_observed' : 'reload_failed_observed';
      // Keep this callback read-only: no Profile navigation, saves, or database requests.
      void panel;
    },
  });
  report.native = {
    extension_id: native.extensionId,
    verified: native.verified,
    panel_target_observed: Boolean(native.panelTargetId),
    screenshots_captured: native.artifacts.length > 0,
  };
} catch (error) {
  report.status = 'probe_failed';
  report.failure_code = safeFailureCode(error);
} finally {
  report.finished_at = new Date().toISOString();
  await mkdir(OUTPUT_DIR ?? resolve('.'), { recursive: true, mode: 0o700 });
  const path = resolve(OUTPUT_DIR ?? '.', `profile-reload-readonly-${RUN_ID ?? 'unknown'}.json`);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`PROFILE_RELOAD_READONLY_REPORT ${path} ${report.status}\n`);
  if (!['reload_observed', 'reload_failed_observed'].includes(report.status)) process.exitCode = 1;
}
