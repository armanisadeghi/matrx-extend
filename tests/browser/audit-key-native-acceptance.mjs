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
  await reloadAuditPrelude(panel, source, { evaluate, waitFor });
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
function partial(name, before, after, boundary, missing) {
  report.cases.push({ name, status: 'partial', before, after, boundary, missing });
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
        const beforeLoadRetry = await snapshot(panel);
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
      await inject(panel, 'clipboard-once');
      await click(panel, 'button-text', 'Export public key');
      const failedExport = await expectCard(
        panel,
        'audit_export_failure',
        (value) => value?.exportFailed && value.retryExport && !value.copied,
      );
      const exportFault = await fault(panel);
      assert.equal(exportFault.clipboardWrites, 1);
      assert.equal(exportFault.clipboardSucceeded, 0);
      await evaluate(panel, '(() => { window.__auditNativeFault.disarm(); return true; })()');
      await click(panel, 'button-text', 'Retry export');
      const retriedExport = await expectCard(
        panel,
        'audit_export_recovered',
        (value) => value?.copied && !value.exportFailed && !value.retryExport,
      );
      assert.equal((await fault(panel)).clipboardSucceeded, 1);
      assert.equal(
        await evaluate(panel, 'window.__auditNativeFault.copiedPublicJwk()'),
        true,
        'audit_copied_public_jwk_mismatch',
      );
      await restore(panel);
      assert.deepEqual(await snapshot(panel), beforeLoadRetry);
      pass('T60 export failure and retry', failedExport, retriedExport, exportFault);

      stage = 'rotation_failure';
      await inject(panel, 'reject-history');
      const beforeFailure = await snapshot(panel);
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
      partial(
        'T87 failed pre-mutation rotation needs fresh confirmation',
        failedRotation,
        success,
        failureFault,
        'product-signed prior receipt verification after rotation',
      );

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
      await inject(panel, 'unknown-write');
      const beforeUnknown = await snapshot(panel);
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
      partial(
        'T89 uncertain active write blocks mutation until read',
        uncertain,
        known,
        unknownFault,
        'product-signed prior receipt verification after recovery',
      );

      stage = 'lock_unavailable';
      await reloadWithPrelude(panel, lockUnavailableSource);
      await openSection(panel, 'Advanced agent capabilities');
      const unavailableLoad = await expectCard(
        panel,
        'audit_lock_unavailable_load',
        (value) =>
          value?.lockUnavailable &&
          value.retryDetails &&
          value.rekeyDisabled &&
          value.exportDisabled,
      );
      const beforeLockRecovery = await snapshot(panel);
      await evaluate(panel, '(() => { window.__auditNativeLockRestore(); return true; })()');
      await click(panel, 'button-text', 'Retry audit details');
      const recoveredLock = await expectCard(
        panel,
        'audit_lock_recovered',
        (value) =>
          value?.keyId === beforeLockRecovery.activeId &&
          !value.lockUnavailable &&
          !value.rekeyDisabled,
      );
      assert.deepEqual(await snapshot(panel), beforeLockRecovery);
      await evaluate(panel, lockUnavailableSource);
      await click(panel, 'button-text', 'Export public key');
      await expectCard(
        panel,
        'audit_lock_unavailable_export',
        (value) => value?.lockUnavailable && value.exportDisabled && value.rekeyDisabled,
      );
      assert.deepEqual(await snapshot(panel), beforeLockRecovery);
      await evaluate(panel, '(() => { window.__auditNativeLockRestore(); return true; })()');
      await click(panel, 'button-text', 'Retry audit details');
      await expectCard(
        panel,
        'audit_lock_export_recovered',
        (value) => value?.keyId === beforeLockRecovery.activeId && !value.lockUnavailable,
      );
      await evaluate(panel, lockUnavailableSource);
      await rotate(panel);
      const unavailableRotate = await expectCard(
        panel,
        'audit_lock_unavailable_rotate',
        (value) => value?.lockUnavailable && value.rekeyDisabled && value.retryDetails,
      );
      assert.deepEqual(await snapshot(panel), beforeLockRecovery);
      await evaluate(panel, '(() => { window.__auditNativeLockRestore(); return true; })()');
      await click(panel, 'button-text', 'Retry audit details');
      await expectCard(
        panel,
        'audit_lock_rotation_recovered',
        (value) => value?.keyId === beforeLockRecovery.activeId && !value.lockUnavailable,
      );
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

      // A second extension document shares the real origin, storage and Web
      // Lock manager. Hold the first active write; the second confirmation
      // must queue and both activated public IDs must survive in history.
      stage = 'cross_context';
      const sibling = await page.context().newPage();
      try {
        await sibling.goto('chrome-extension://cihdmkcdjjckfhjpgoedmgfpoljebaml/sidepanel.html');
        await sibling.getByRole('button', { name: 'Settings' }).click();
        await sibling.getByRole('button', { name: 'Advanced agent capabilities' }).click();
        await sibling.getByText('Audit key', { exact: true }).waitFor();
        assert.equal(await sibling.evaluate(auditFaultSource('hold-active')), true);
        await activatePanel();
        await waitFor(
          'audit_panel_foreground_before_rotation',
          () => evaluate(panel, 'document.visibilityState === "visible"'),
          Boolean,
        );
        await inject(panel, 'hold-active');
        await rotate(panel);
        await waitFor(
          'audit_first_write_held',
          () => fault(panel),
          (value) => value?.held && value.activeWrites === 1,
        );
        const firstBeforeRelease = await snapshot(sibling);
        await sibling.bringToFront();
        await waitFor(
          'audit_sibling_foreground_before_rotation',
          () => sibling.evaluate('document.visibilityState === "visible"'),
          Boolean,
        );
        await sibling.getByRole('button', { name: 'Re-key', exact: true }).click();
        await sibling.getByRole('button', { name: 'Rotate key', exact: true }).click();
        await waitFor(
          'audit_second_lock_queued',
          () =>
            sibling.evaluate(async () =>
              (await navigator.locks.query()).pending.some(
                (request) =>
                  request.name === 'matrx:audit:device-key' && request.mode === 'exclusive',
              ),
            ),
          Boolean,
        );
        const queued = await snapshot(sibling);
        assert.deepEqual(queued, firstBeforeRelease);
        await evaluate(panel, '(() => { window.__auditNativeFault.release(); return true; })()');
        await expectCard(panel, 'audit_first_context_rotated', (value) => value?.rotated);
        await waitFor(
          'audit_second_write_held',
          () => sibling.evaluate('window.__auditNativeFault?.state() ?? null'),
          (value) => value?.held && value.activeWrites === 1,
        );
        const firstActivated = await snapshot(panel);
        assert.notEqual(firstActivated.activeId, firstBeforeRelease.activeId);
        await sibling.evaluate('window.__auditNativeFault.release()');
        await sibling.getByText('Key rotated.', { exact: true }).waitFor();
        const final = await snapshot(panel);
        assert.notEqual(final.activeId, firstActivated.activeId);
        assert.equal(final.historyIds.length, firstBeforeRelease.historyIds.length + 2);
        assert.ok(final.historyIds.includes(firstBeforeRelease.activeId));
        assert.ok(final.historyIds.includes(firstActivated.activeId));
        report.cases.push({
          name: 'T90 two same-origin activations retain key history',
          status: 'partial',
          before: firstBeforeRelease,
          first_activated_id: firstActivated.activeId,
          after: final,
          boundary: { first_write_held: true, second_lock_queued: true, second_write_held: true },
          missing:
            'product-signed receipts from both keys, post-reload verification and tamper rejection',
        });
      } finally {
        await restore(panel);
        await sibling.evaluate('window.__auditNativeFault?.restore()').catch(() => {});
        await sibling.close();
      }
    },
  });
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256, 'audit_tree_changed');
  report.artifacts = run.artifacts;
  report.status = 'partial';
  report.failure_stage = 'T90_product_receipt_verification_unavailable';
  report.failure_code = 'audit_T90_incomplete';
  process.exitCode = 2;
} catch (error) {
  report.status = 'fail';
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
