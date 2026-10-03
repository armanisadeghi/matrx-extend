#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import {
  auditFaultSource,
  awaitAuditNewDocument,
  classifyAuditNativeFailure,
  reloadAuditPrelude,
} from './audit-key-native-faults.mjs';
import {
  assertSignedReadResponse,
  completedReceiptSource,
  productVerificationSource,
  startSignedRead,
} from './audit-key-native-receipts.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { signInSettings, verifyCurrentSettingsIdentity } from './settings-native-auth-driver.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

// EXT-D-0093: actual admin Settings UI, native Chrome storage, two same-origin
// extension documents, and one owned disposable browser profile. No key bytes
// or credentials are transported into the receipt.
const REPO = resolve(import.meta.dirname, '..', '..');
const SOURCE = '991385d9';
const RUN_ID = 37129518563;
const ARTIFACT_ID = 11275878549;
const EXTENSION_DIR = process.env.MATRX_AUDIT_EXTENSION_DIR;
const RECEIPT_PATH = process.env.MATRX_AUDIT_RECEIPT;
const OUTPUT = join(REPO, 'test-results', `audit-key-native-${randomUUID()}.json`);
const report = {
  schema_version: 1,
  defect: 'EXT-D-0093',
  status: 'unverified',
  source: null,
  artifact_id: ARTIFACT_ID,
  run_id: RUN_ID,
  cases: [],
  failure_stage: null,
  failure_code: null,
};
let stage = 'input';
let detailStep = null;

function auditSnapshotSource() {
  return `chrome.storage.local.get(['matrx.audit.deviceKey', 'matrx.audit.publicKeyHistory'])
    .then((value) => ({
      activeId: value['matrx.audit.deviceKey']?.publicKeyId ?? null,
      historyIds: (value['matrx.audit.publicKeyHistory'] ?? [])
        .filter((entry) => !entry.pending || entry.publicKeyId === value['matrx.audit.deviceKey']?.publicKeyId)
        .map((entry) => entry.publicKeyId),
    }))`;
}

function cardSource() {
  return `(() => {
    const heading = [...document.querySelectorAll('div')]
      .find((element) => element.textContent.trim() === 'Audit key' && element.querySelector('svg'));
    const card = heading?.parentElement;
    if (!card) return null;
    const body = card.textContent;
    const button = (name) => [...card.querySelectorAll('button')]
      .find((element) => element.textContent.trim() === name);
    const row = (name) => [...card.querySelectorAll('span')]
      .find((element) => element.textContent.trim() === name)?.parentElement?.textContent.trim() ?? null;
    return {
      keyId: row('Public key ID')?.slice('Public key ID'.length) ?? null,
      detailsUnavailable: body.includes('Audit details unavailable'),
      exportFailed: body.includes('Public key copy failed'),
      rotationFailed: body.includes('Key rotation failed'),
      rotated: body.includes('Key rotated.'),
      unknown: body.includes('Key status unknown'),
      lockUnavailable: body.includes('Audit key needs Web Locks here'),
      retryDetails: !!button('Retry audit details'),
      retryExport: !!button('Retry export'),
      copied: !!button('Export public key')?.querySelector('svg.lucide-check'),
      rekeyDisabled: button('Re-key')?.disabled ?? null,
      exportDisabled: button('Export public key')?.disabled ?? null,
    };
  })()`;
}

const card = (panel) => evaluate(panel, cardSource());
const snapshot = (panel) => evaluate(panel, auditSnapshotSource());
const fault = (panel) => evaluate(panel, 'window.__auditNativeFault?.state() ?? null');
async function signedRead(page, panel, expectedPublicKeyId) {
  const call = startSignedRead(page);
  await assertSignedReadResponse(call);
  return completedSignedReceipt(panel, call.callId, expectedPublicKeyId);
}
async function completedSignedReceipt(panel, callId, expectedPublicKeyId) {
  const row = await waitFor(
    'audit_completed_signed_receipt',
    () => evaluate(panel, completedReceiptSource(callId)),
    (value) => value?.completed && value.publicKeyId === expectedPublicKeyId,
    20_000,
  );
  assert.equal(row.origin, 'webmcp');
  return row;
}
async function verifySignedReceipt(panel, row, read = evaluate) {
  const result = await read(panel, productVerificationSource(row.callId));
  assert.equal(result?.code, 'verified', 'audit_product_verifier_unavailable');
  assert.equal(result.callId, row.callId);
  assert.equal(result.publicKeyId, row.publicKeyId);
  assert.equal(result.origin, 'webmcp');
  assert.equal(result.originalValid, true, 'audit_prior_receipt_verification_failed');
  assert.equal(result.tamperedRejected, true, 'audit_tampered_receipt_accepted');
  return { publicKeyId: result.publicKeyId, originalValid: true, tamperedRejected: true };
}
async function inject(panel, mode) {
  assert.equal(await evaluate(panel, auditFaultSource(mode)), true, `audit_${mode}_inject_failed`);
}
async function restore(panel) {
  await evaluate(panel, '(() => { window.__auditNativeFault?.restore(); return true; })()');
}
async function expectCard(panel, label, predicate) {
  return waitFor(label, () => card(panel), predicate, 15000);
}
async function rotate(panel) {
  await click(panel, 'button-text', 'Re-key');
  await waitFor(
    'audit_confirm_visible',
    () =>
      evaluate(
        panel,
        `(() => [...document.querySelectorAll('[role="alertdialog"]')]
      .some((dialog) => dialog.textContent.includes('Rotate the device audit key?')))()`,
      ),
    Boolean,
  );
  await click(panel, 'button-text', 'Rotate key');
}
async function reloadWithPrelude(panel, source) {
  report.reload_boundaries = [];
  await reloadAuditPrelude(panel, source, {
    evaluate,
    waitFor,
    onBoundary: (event) => report.reload_boundaries.push(event),
  });
  await click(panel, 'title', 'Settings');
}
async function reloadCard(panel, identity) {
  const previousOrigin = await evaluate(panel, 'performance.timeOrigin');
  await panel.send('Page.reload', { ignoreCache: true });
  await awaitAuditNewDocument(panel, previousOrigin, { evaluate, waitFor });
  await click(panel, 'title', 'Settings');
  await verifyCurrentSettingsIdentity({
    panel,
    mode: 'admin',
    email: identity.email,
    profileId: identity.profileId,
    organizationId: identity.organizationId,
  });
  await openSection(panel, 'Advanced agent capabilities');
}
const lockUnavailableSource = `(() => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  window.__auditNativeLockRestore = () => { delete navigator.locks; };
})()`;
function pass(name, before, after, boundary) {
  report.cases.push({ name, status: 'pass', before, after, boundary });
}
try {
  assert.ok(EXTENSION_DIR && RECEIPT_PATH, 'audit_artifact_inputs_required');
  const extensionDir = resolve(EXTENSION_DIR);
  const receiptPath = resolve(RECEIPT_PATH);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.kind, 'local_dev_unpacked', 'audit_development_receipt_required');
  const match = extensionDir.match(/\/ci-artifacts\/([a-f0-9]{40})\/(\d+)-(\d+)\/chrome-mv3$/);
  assert.ok(match, 'audit_artifact_path_refused');
  assert.equal(Number(match[2]), RUN_ID, 'audit_run_mismatch');
  const imported = JSON.parse(
    await readFile(join(extensionDir, '..', 'import-status.json'), 'utf8'),
  );
  assert.equal(imported.sourceSha, match[1], 'audit_source_mismatch');
  assert.equal(imported.artifactId, ARTIFACT_ID, 'audit_artifact_mismatch');
  assert.equal(imported.runId, RUN_ID, 'audit_run_mismatch');
  assert.equal(imported.treeSha256, receipt.treeSha256, 'audit_tree_mismatch');
  assert.ok(match[1].startsWith(SOURCE), 'audit_source_mismatch');
  execFileSync('git', ['merge-base', '--is-ancestor', match[1], 'HEAD'], { cwd: REPO });
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256, 'audit_tree_mismatch');
  report.source = { sha: match[1], version: receipt.version, tree_sha256: receipt.treeSha256 };

  const run = await runNativeSidepanelQa({
    headed: true,
    extensionDir,
    expectedRelease: receipt,
    releaseReceiptPath: receiptPath,
    localDevReceiptPath: receiptPath,
    onStage: (value) => {
      stage = `native:${value}`;
    },
    exercisePanel: async ({ page, panel, activatePanel }) => {
      stage = 'admin_auth';
      const identity = await signInSettings({
        mode: 'admin',
        page,
        panel,
        repo: REPO,
        adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
        onStage: (value) => {
          stage = `admin:${value}`;
        },
      });
      assert.equal(identity.admin_role, true);
      await activatePanel();
      await verifyCurrentSettingsIdentity({
        panel,
        mode: 'admin',
        email: identity.email,
        profileId: identity.profileId,
        organizationId: identity.organizationId,
      });

      // The card is mounted even inside a closed Collapsible, so install at
      // document creation before React mounts and reload the real panel.
      stage = 'details_failure';
      let beforeLoadRetry;
      try {
        detailStep = 'reload_with_prelude';
        await reloadWithPrelude(panel, auditFaultSource('read-once'));
        detailStep = 'verify_identity_after_reload';
        await verifyCurrentSettingsIdentity({
          panel,
          mode: 'admin',
          email: identity.email,
          profileId: identity.profileId,
          organizationId: identity.organizationId,
        });
        detailStep = 'open_advanced_section';
        await openSection(panel, 'Advanced agent capabilities');
        detailStep = 'card_failed_load';
        const failedLoad = await expectCard(
          panel,
          'audit_load_failure',
          (value) => value?.detailsUnavailable && value.retryDetails && value.keyId === '—',
        );
        detailStep = 'read_storage_after_failure';
        beforeLoadRetry = await snapshot(panel);
        assert.equal((await fault(panel)).activeWrites, 0);
        detailStep = 'restore_read_fault';
        await restore(panel);
        detailStep = 'click_details_retry';
        await click(panel, 'button-text', 'Retry audit details');
        detailStep = 'card_recovered';
        const recovered = await expectCard(
          panel,
          'audit_load_recovered',
          (value) => value?.keyId === beforeLoadRetry.activeId && !value.detailsUnavailable,
        );
        detailStep = 'compare_storage_after_retry';
        assert.deepEqual(await snapshot(panel), beforeLoadRetry);
        pass('T86 details read failure and read-only retry', failedLoad, recovered, {
          activeWrites: 0,
        });
      } catch (error) {
        report.failure_code = classifyAuditNativeFailure(stage, detailStep, error);
        report.detail_diagnostic = {
          step: detailStep,
          card: await card(panel).catch(() => null),
          fault: await fault(panel).catch(() => null),
          panel_visible: await evaluate(panel, 'document.visibilityState === "visible"').catch(
            () => null,
          ),
        };
        throw error;
      }

      stage = 'export_failure';
      detailStep = 'inject_clipboard_fault';
      await inject(panel, 'clipboard-once');
      detailStep = 'click_export';
      await click(panel, 'button-text', 'Export public key');
      detailStep = 'observe_export_failure';
      const failedExport = await expectCard(
        panel,
        'audit_export_failure',
        (value) => value?.exportFailed && value.retryExport && !value.copied,
      );
      detailStep = 'check_export_fault';
      const exportFault = await fault(panel);
      assert.equal(exportFault.clipboardWrites, 1);
      assert.equal(exportFault.clipboardSucceeded, 0);
      await evaluate(panel, '(() => { window.__auditNativeFault.disarm(); return true; })()');
      detailStep = 'retry_export';
      await click(panel, 'button-text', 'Retry export');
      detailStep = 'observe_export_recovery';
      const retriedExport = await expectCard(
        panel,
        'audit_export_recovered',
        (value) => value?.copied && !value.exportFailed && !value.retryExport,
      );
      detailStep = 'check_clipboard_success_count';
      assert.equal((await fault(panel)).clipboardSucceeded, 1);
      detailStep = 'verify_copied_public_jwk';
      assert.equal(
        await evaluate(panel, 'window.__auditNativeFault.copiedPublicJwk()'),
        true,
        'audit_copied_public_jwk_mismatch',
      );
      detailStep = 'restore_export_fault';
      await restore(panel);
      detailStep = 'compare_export_storage';
      assert.deepEqual(await snapshot(panel), beforeLoadRetry);
      pass('T60 export failure and retry', failedExport, retriedExport, exportFault);

      stage = 'rotation_failure';
      const beforeFailure = await snapshot(panel);
      stage = 'T87_prior_signed_receipt';
      const priorRotationReceipt = await signedRead(page, panel, beforeFailure.activeId);
      stage = 'rotation_failure';
      await inject(panel, 'reject-history');
      await rotate(panel);
      const failedRotation = await expectCard(
        panel,
        'audit_rotation_failure',
        (value) => value?.rotationFailed && !value.rotated,
      );
      const failureFault = await fault(panel);
      assert.equal(failureFault.activeWrites, 0);
      assert.deepEqual(await snapshot(panel), beforeFailure);
      await restore(panel);
      await rotate(panel);
      const success = await expectCard(
        panel,
        'audit_rotation_recovered',
        (value) => value?.rotated && value.keyId !== beforeFailure.activeId,
      );
      const afterSuccess = await snapshot(panel);
      assert.ok(afterSuccess.historyIds.includes(beforeFailure.activeId));
      await reloadCard(panel, identity);
      stage = 'T87_verify_prior_receipt';
      const rotationVerification = await verifySignedReceipt(panel, priorRotationReceipt);
      pass('T87 failed pre-mutation rotation needs fresh confirmation', failedRotation, success, {
        ...failureFault,
        prior_receipt: rotationVerification,
      });

      stage = 'rotation_refresh_failure';
      await inject(panel, 'after-active-read');
      const beforeRefresh = await snapshot(panel);
      await rotate(panel);
      const refreshFailure = await expectCard(
        panel,
        'audit_post_rotation_read_failure',
        (value) => value?.rotated && value.detailsUnavailable && value.retryDetails,
      );
      const refreshFault = await fault(panel);
      assert.equal(refreshFault.activeWrites, 1);
      await restore(panel);
      const newlyActive = await snapshot(panel);
      assert.notEqual(newlyActive.activeId, beforeRefresh.activeId);
      await click(panel, 'button-text', 'Retry audit details');
      const refreshRecovered = await expectCard(
        panel,
        'audit_refresh_recovered',
        (value) => value?.keyId === newlyActive.activeId && !value.detailsUnavailable,
      );
      assert.deepEqual(await snapshot(panel), newlyActive);
      await reloadCard(panel, identity);
      await expectCard(
        panel,
        'audit_refresh_reload_same_key',
        (value) => value?.keyId === newlyActive.activeId && !value.detailsUnavailable,
      );
      assert.deepEqual(await snapshot(panel), newlyActive);
      pass(
        'T88 successful rotation and failed refresh never re-rotates',
        refreshFailure,
        refreshRecovered,
        refreshFault,
      );

      stage = 'unknown_write';
      const beforeUnknown = await snapshot(panel);
      stage = 'T89_prior_signed_receipt';
      const priorUnknownReceipt = await signedRead(page, panel, beforeUnknown.activeId);
      stage = 'unknown_write';
      await inject(panel, 'unknown-write');
      await rotate(panel);
      const uncertain = await expectCard(
        panel,
        'audit_unknown_write_blocked',
        (value) => value?.unknown && value.rekeyDisabled && value.retryDetails,
      );
      const unknownFault = await fault(panel);
      assert.equal(unknownFault.activeWrites, 1);
      await restore(panel);
      const afterUnknown = await snapshot(panel);
      assert.notEqual(afterUnknown.activeId, beforeUnknown.activeId);
      assert.ok(afterUnknown.historyIds.includes(beforeUnknown.activeId));
      await click(panel, 'button-text', 'Retry audit details');
      const known = await expectCard(
        panel,
        'audit_unknown_recovered',
        (value) => value?.keyId === afterUnknown.activeId && !value.unknown && !value.rekeyDisabled,
      );
      assert.deepEqual(await snapshot(panel), afterUnknown);
      await reloadCard(panel, identity);
      await expectCard(
        panel,
        'audit_unknown_reload_same_key',
        (value) => value?.keyId === afterUnknown.activeId && !value.unknown,
      );
      assert.deepEqual(await snapshot(panel), afterUnknown);
      stage = 'T89_verify_prior_receipt';
      const unknownVerification = await verifySignedReceipt(panel, priorUnknownReceipt);
      pass('T89 uncertain active write blocks mutation until read', uncertain, known, {
        ...unknownFault,
        prior_receipt: unknownVerification,
      });

      stage = 'lock_unavailable';
      await verifyCurrentSettingsIdentity({
        panel,
        mode: 'admin',
        email: identity.email,
        profileId: identity.profileId,
        organizationId: identity.organizationId,
      });
      const beforeUnavailable = await snapshot(panel);
      await expectCard(
        panel,
        'audit_card_ready_before_missing_lock',
        (value) => value?.keyId === beforeUnavailable.activeId && !value.detailsUnavailable,
      );
      detailStep = 'leave_authenticated_settings';
      try {
        // The auth shell also requires Web Locks during document bootstrap.
        // Mount Settings after the authenticated shell is ready so this fault
        // reaches the audit card rather than preventing the entire app boot.
        await click(panel, 'title', 'Chat');
        detailStep = 'inject_lock_before_settings_mount';
        await evaluate(panel, lockUnavailableSource);
        detailStep = 'mount_settings_without_lock';
        await click(panel, 'title', 'Settings');
        detailStep = 'open_advanced_section';
        await openSection(panel, 'Advanced agent capabilities');
        detailStep = 'observe_unavailable_load';
        const unavailableLoad = await expectCard(
          panel,
          'audit_lock_unavailable_load',
          (value) =>
            value?.lockUnavailable &&
            value.retryDetails &&
            value.rekeyDisabled &&
            value.exportDisabled,
        );
        detailStep = 'read_storage_after_unavailable_load';
        const beforeLockRecovery = await snapshot(panel);
        detailStep = 'restore_lock_after_load';
        await evaluate(panel, '(() => { window.__auditNativeLockRestore(); return true; })()');
        detailStep = 'retry_details_after_load';
        await click(panel, 'button-text', 'Retry audit details');
        detailStep = 'observe_details_recovery';
        const recoveredLock = await expectCard(
          panel,
          'audit_lock_recovered',
          (value) =>
            value?.keyId === beforeLockRecovery.activeId &&
            !value.lockUnavailable &&
            !value.rekeyDisabled,
        );
        detailStep = 'compare_storage_after_details_recovery';
        assert.deepEqual(await snapshot(panel), beforeLockRecovery);
        detailStep = 'inject_lock_for_export';
        await evaluate(panel, lockUnavailableSource);
        detailStep = 'click_export_without_lock';
        await click(panel, 'button-text', 'Export public key');
        detailStep = 'observe_unavailable_export';
        await expectCard(
          panel,
          'audit_lock_unavailable_export',
          (value) => value?.lockUnavailable && value.exportDisabled && value.rekeyDisabled,
        );
        detailStep = 'compare_storage_after_unavailable_export';
        assert.deepEqual(await snapshot(panel), beforeLockRecovery);
        detailStep = 'restore_lock_after_export';
        await evaluate(panel, '(() => { window.__auditNativeLockRestore(); return true; })()');
        detailStep = 'retry_details_after_export';
        await click(panel, 'button-text', 'Retry audit details');
        detailStep = 'observe_export_recovery';
        await expectCard(
          panel,
          'audit_lock_export_recovered',
          (value) => value?.keyId === beforeLockRecovery.activeId && !value.lockUnavailable,
        );
        detailStep = 'inject_lock_for_rotation';
        await evaluate(panel, lockUnavailableSource);
        detailStep = 'rotate_without_lock';
        await rotate(panel);
        detailStep = 'observe_unavailable_rotation';
        const unavailableRotate = await expectCard(
          panel,
          'audit_lock_unavailable_rotate',
          (value) => value?.lockUnavailable && value.rekeyDisabled && value.retryDetails,
        );
        detailStep = 'compare_storage_after_unavailable_rotation';
        assert.deepEqual(await snapshot(panel), beforeLockRecovery);
        detailStep = 'restore_lock_after_rotation';
        await evaluate(panel, '(() => { window.__auditNativeLockRestore(); return true; })()');
        detailStep = 'retry_details_after_rotation';
        await click(panel, 'button-text', 'Retry audit details');
        detailStep = 'observe_rotation_recovery';
        await expectCard(
          panel,
          'audit_lock_rotation_recovered',
          (value) => value?.keyId === beforeLockRecovery.activeId && !value.lockUnavailable,
        );
        detailStep = 'compare_storage_after_rotation_recovery';
        assert.deepEqual(await snapshot(panel), beforeLockRecovery);
        pass(
          'T91 unsupported Web Locks blocks and read-only retry recovers',
          unavailableLoad,
          unavailableRotate,
          {
            details_recovered: recoveredLock.keyId === beforeLockRecovery.activeId,
            history_unchanged: true,
          },
        );
      } catch (error) {
        report.lock_diagnostic = {
          step: detailStep,
          card: await card(panel).catch(() => null),
          lock_missing: await evaluate(panel, 'navigator.locks === undefined').catch(() => null),
          prelude_installed: await evaluate(panel, 'window.__auditPreludeInstalled === true').catch(
            () => null,
          ),
        };
        report.failure_code = `audit_lock_${detailStep}_failed`;
        throw error;
      }

      // A second extension document shares the real origin, storage and Web
      // Lock manager. Hold the first active write; the second confirmation
      // must queue and both activated public IDs must survive in history.
      stage = 'cross_context';
      const preConcurrent = await snapshot(panel);
      const originalReceipt = await signedRead(page, panel, preConcurrent.activeId);
      detailStep = 'create_sibling';
      const sibling = await page.context().newPage();
      try {
        detailStep = 'navigate_sibling';
        await sibling.goto('chrome-extension://cihdmkcdjjckfhjpgoedmgfpoljebaml/sidepanel.html');
        detailStep = 'open_sibling_settings';
        await sibling.locator('button[role="tab"][title="Settings"]').click();
        detailStep = 'open_sibling_advanced';
        await sibling.getByRole('button', { name: 'Advanced agent capabilities' }).click();
        detailStep = 'observe_sibling_card';
        await sibling.getByText('Audit key', { exact: true }).waitFor();
        detailStep = 'inject_sibling_hold';
        assert.equal(await sibling.evaluate(auditFaultSource('hold-active')), true);
        detailStep = 'activate_first_panel';
        await activatePanel();
        detailStep = 'observe_first_foreground';
        await waitFor(
          'audit_panel_foreground_before_rotation',
          () => evaluate(panel, 'document.visibilityState === "visible"'),
          Boolean,
        );
        detailStep = 'inject_first_hold';
        await inject(panel, 'hold-active');
        detailStep = 'start_first_rotation';
        await rotate(panel);
        detailStep = 'observe_first_write_held';
        await waitFor(
          'audit_first_write_held',
          () => fault(panel),
          (value) => value?.held && value.activeWrites === 1,
        );
        detailStep = 'queue_signer_behind_first_write';
        const queuedSigner = startSignedRead(page);
        await waitFor(
          'audit_signer_lock_queued',
          () =>
            sibling.evaluate(
              async () =>
                (await navigator.locks.query()).pending.filter(
                  (request) =>
                    request.name === 'matrx:audit:device-key' && request.mode === 'exclusive',
                ).length,
            ),
          (count) => count >= 1,
        );
        detailStep = 'read_sibling_before_release';
        const firstBeforeRelease = await sibling.evaluate(auditSnapshotSource());
        detailStep = 'activate_sibling';
        await sibling.bringToFront();
        detailStep = 'observe_sibling_foreground';
        await waitFor(
          'audit_sibling_foreground_before_rotation',
          () => sibling.evaluate('document.visibilityState === "visible"'),
          Boolean,
        );
        detailStep = 'start_sibling_rotation';
        await sibling.getByRole('button', { name: 'Re-key', exact: true }).click();
        await sibling.getByRole('button', { name: 'Rotate key', exact: true }).click();
        detailStep = 'observe_second_lock_queued';
        await waitFor(
          'audit_second_lock_queued',
          () =>
            sibling.evaluate(
              async () =>
                (await navigator.locks.query()).pending.filter(
                  (request) =>
                    request.name === 'matrx:audit:device-key' && request.mode === 'exclusive',
                ).length,
            ),
          (count) => count >= 2,
        );
        detailStep = 'compare_queued_snapshot';
        const queued = await sibling.evaluate(auditSnapshotSource());
        assert.deepEqual(queued, firstBeforeRelease);
        detailStep = 'release_first_write';
        await evaluate(panel, '(() => { window.__auditNativeFault.release(); return true; })()');
        detailStep = 'observe_first_rotation';
        await expectCard(panel, 'audit_first_context_rotated', (value) => value?.rotated);
        detailStep = 'observe_second_write_held';
        await waitFor(
          'audit_second_write_held',
          () => sibling.evaluate('window.__auditNativeFault?.state() ?? null'),
          (value) => value?.held && value.activeWrites === 1,
        );
        detailStep = 'read_first_activated';
        const firstActivated = await snapshot(panel);
        assert.notEqual(firstActivated.activeId, firstBeforeRelease.activeId);
        detailStep = 'observe_queued_signed_receipt';
        await assertSignedReadResponse(queuedSigner);
        const firstActivatedReceipt = await completedSignedReceipt(
          panel,
          queuedSigner.callId,
          firstActivated.activeId,
        );
        detailStep = 'release_second_write';
        await sibling.evaluate('window.__auditNativeFault.release()');
        detailStep = 'observe_second_rotation';
        await sibling.getByText('Key rotated.', { exact: true }).waitFor();
        detailStep = 'read_final_history';
        const final = await snapshot(panel);
        assert.notEqual(final.activeId, firstActivated.activeId);
        assert.equal(final.historyIds.length, firstBeforeRelease.historyIds.length + 2);
        assert.ok(final.historyIds.includes(firstBeforeRelease.activeId));
        assert.ok(final.historyIds.includes(firstActivated.activeId));
        detailStep = 'sign_after_second_activation';
        const secondActivatedReceipt = await signedRead(page, panel, final.activeId);
        detailStep = 'restore_faults_before_reload';
        await restore(panel);
        await sibling.evaluate('window.__auditNativeFault?.restore()');
        detailStep = 'reload_first_context';
        await activatePanel();
        await reloadCard(panel, identity);
        detailStep = 'reload_sibling_context';
        await sibling.reload();
        const receipts = [originalReceipt, firstActivatedReceipt, secondActivatedReceipt];
        detailStep = 'verify_first_context_receipts';
        const firstVerifications = [];
        for (const row of receipts) firstVerifications.push(await verifySignedReceipt(panel, row));
        detailStep = 'verify_sibling_context_receipts';
        const siblingVerifications = [];
        for (const row of receipts)
          siblingVerifications.push(
            await verifySignedReceipt(sibling, row, (target, source) => target.evaluate(source)),
          );
        pass(
          'T90 two same-origin activations retain and verify signed key history',
          firstBeforeRelease,
          final,
          {
            first_write_held: true,
            signer_queued_before_second_rotation: true,
            second_lock_queued: true,
            second_write_held: true,
            first_activated_id: firstActivated.activeId,
            first_context_receipts: firstVerifications,
            sibling_context_receipts: siblingVerifications,
          },
        );
      } catch (error) {
        report.cross_context_diagnostic = {
          step: detailStep,
          first_card: await card(panel).catch(() => null),
          sibling_card: await sibling.evaluate(cardSource()).catch(() => null),
          first_fault: await fault(panel).catch(() => null),
          sibling_fault: await sibling
            .evaluate('window.__auditNativeFault?.state() ?? null')
            .catch(() => null),
        };
        report.failure_code = `audit_cross_context_${detailStep}_failed`;
        throw error;
      } finally {
        await restore(panel);
        await sibling.evaluate('window.__auditNativeFault?.restore()').catch(() => {});
        await sibling.close();
      }
    },
  });
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256, 'audit_tree_changed');
  report.artifacts = run.artifacts;
  report.status = 'pass';
} catch (error) {
  report.status = 'fail';
  if (stage === 'export_failure') {
    report.export_diagnostic = {
      step: detailStep,
      errorType: ['ReferenceError', 'AssertionError', 'TypeError', 'Error'].includes(error?.name)
        ? error.name
        : 'other',
    };
    report.failure_code = `audit_export_${detailStep}_failed`;
  }
  report.failure_stage = stage;
  report.failure_code ??= /^[a-z0-9_]+$/.test(error?.message ?? '')
    ? error.message
    : (error?.driverFailure?.code ?? 'audit_native_unverified');
  process.exitCode = 1;
} finally {
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`AUDIT_NATIVE_RESULT ${report.status} ${OUTPUT}\n`);
}
