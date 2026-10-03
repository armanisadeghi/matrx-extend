#!/usr/bin/env node
/** Receipt-bound native Snapshot document acceptance for EXT-D-0059. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { signInAdminSettings } from './admin-settings-signin.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { faultState, installSnapshotFault, releaseFault } from './prepare-fault-driver.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const EXTENSION_DIR = process.env.MATRX_SNAPSHOT_EXTENSION_DIR;
const RECEIPT = process.env.MATRX_SNAPSHOT_RECEIPT;
const CREDENTIALS = process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE;
const OUTPUT = join(REPO, 'test-results', `snapshot-document-native-${randomUUID()}.json`);
const DEMO = 'https://www.aimatrx.com/matrx-extend-demo';
let transportFailureClass;
const report = {
  schema_version: 1,
  defect: 'EXT-D-0059',
  case_id: 'EXT-F-1012-T09',
  status: 'unverified',
  artifact: null,
  cases: [],
  stage: 'inputs',
  failure_code: null,
  native_stage: null,
  release_stage: null,
  transport_failure_class: null,
  last_safe_observation: null,
  signin_observations: {},
};
const stage = (value) => {
  report.stage = value;
};

async function credentials() {
  assert.ok(CREDENTIALS, 'snapshot_private_credentials_required');
  const metadata = await stat(CREDENTIALS);
  assert.equal(metadata.mode & 0o077, 0, 'snapshot_private_credentials_permissions');
  const value = JSON.parse(await readFile(CREDENTIALS, 'utf8'));
  assert.equal(value.email, 'admin@admin.com', 'snapshot_admin_identity_required');
  assert.ok(
    typeof value.password === 'string' && value.password,
    'snapshot_admin_password_required',
  );
  return value;
}

async function snapshotState(panel) {
  const state = await evaluate(
    panel,
    `(() => {
    const trigger = [...document.querySelectorAll('button[role="tab"][data-state="active"]')]
      .find((button) => button.textContent.trim() === 'Snapshot');
    const active = trigger?.getAttribute('aria-controls')
      ? document.getElementById(trigger.getAttribute('aria-controls')) : null;
    if (active?.getAttribute('data-state') !== 'active') return { ready: false };
    const text = active.innerText ?? '';
    const table = active.querySelector('table');
    const headers = [...(table?.querySelectorAll('thead th') ?? [])];
    const titleIndex = headers.findIndex((cell) => cell.textContent.trim() === 'title');
    const titleCell = titleIndex < 0 ? null : table?.querySelectorAll('tbody tr:first-child td')[titleIndex];
    return {
      ready: true,
      capturing: text.includes('Capturing…'),
      rowCount: /\\b1 row\\b/.test(text) ? 1 : 0,
      titlePresent: Boolean(titleCell?.textContent.trim()),
      error: text.includes('Controlled Snapshot rejection'),
      buttonReady: [...active.querySelectorAll('button')]
        .some((button) => button.textContent.trim() === 'Capture snapshot' && !button.disabled),
    };
  })()`,
  );
  report.last_safe_observation = state;
  return state;
}

async function observedDocument(panel, expectedUrl) {
  return evaluate(
    panel,
    `(async () => {
    const matching = (await chrome.tabs.query({})).filter((tab) => tab.url === ${JSON.stringify(expectedUrl)});
    if (matching.length !== 1) return null;
    const frame = await chrome.webNavigation.getFrame({ tabId: matching[0].id, frameId: 0 });
    return frame?.url === ${JSON.stringify(expectedUrl)} && frame.documentId
      ? { urlMatched: true, documentId: frame.documentId } : null;
  })()`,
  );
}

try {
  assert.ok(EXTENSION_DIR && RECEIPT && CREDENTIALS, 'snapshot_inputs_required');
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  assert.equal(
    hashReleaseTree(EXTENSION_DIR),
    receipt.treeSha256,
    'snapshot_receipt_tree_mismatch',
  );
  const manifest = JSON.parse(await readFile(join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, receipt.version, 'snapshot_receipt_version_mismatch');
  report.artifact = {
    version: receipt.version,
    source_sha: receipt.sourceSha ?? null,
    tree_sha256: receipt.treeSha256,
    kind: receipt.kind ?? 'release',
  };
  stage('native_panel');
  await runNativeSidepanelQa({
    extensionDir: EXTENSION_DIR,
    expectedRelease: receipt,
    releaseReceiptPath: RECEIPT,
    ...(receipt.kind === 'local_dev_unpacked' && { localDevReceiptPath: RECEIPT }),
    publicDemoUrl: DEMO,
    onStage: (value) => {
      report.native_stage = value;
    },
    exercisePanel: async ({ page, panel, transportFailureClass: readFailureClass }) => {
      transportFailureClass = readFailureClass;
      stage('admin_signin');
      await signInAdminSettings({ page, panel, report, stage, readCredentials: credentials });
      stage('snapshot_ready');
      await click(panel, 'title', 'Showcase (admin only)');
      await click(panel, 'button-text', 'Snapshot');
      await waitFor(
        'snapshot_ready',
        () => snapshotState(panel),
        (s) => s?.ready && s.buttonReady,
      );

      stage('initial_success');
      await click(panel, 'button-text', 'Capture snapshot');
      await waitFor(
        'snapshot_initial_success',
        () => snapshotState(panel),
        (s) => s?.rowCount === 1 && s.titlePresent && s.buttonReady && !s.capturing,
        30_000,
      );
      report.cases.push({ case: 'current_document_snapshot', status: 'pass' });

      stage('completed_same_url_reload');
      const first = await waitFor(
        'snapshot_first_document',
        () => observedDocument(panel, page.url()),
        (d) => Boolean(d?.documentId),
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('main article').waitFor({ state: 'visible' });
      const second = await waitFor(
        'snapshot_second_document',
        () => observedDocument(panel, page.url()),
        (d) => Boolean(d?.documentId && d.documentId !== first.documentId),
      );
      assert.equal(second.urlMatched, true, 'snapshot_reload_url_changed');
      await waitFor(
        'snapshot_completed_cleared',
        () => snapshotState(panel),
        (s) => s?.ready && s.buttonReady && s.rowCount === 0 && !s.capturing && !s.error,
      );
      report.cases.push({
        case: 'completed_same_url_reload',
        status: 'pass',
        document_id_changed: true,
      });

      for (const mode of ['hold_success', 'hold_reject']) {
        stage(`${mode}_install`);
        await installSnapshotFault(panel, mode);
        stage(`${mode}_click`);
        await click(panel, 'button-text', 'Capture snapshot');
        stage(`${mode}_held`);
        await waitFor(
          `snapshot_${mode}_held`,
          () => faultState(panel),
          (s) => s?.calls === 1 && s.held,
          30_000,
        );
        assert.equal(
          (await snapshotState(panel)).capturing,
          true,
          'snapshot_not_pending_before_reload',
        );
        const source = await waitFor(
          `${mode}_source_document`,
          () => observedDocument(panel, page.url()),
          (d) => Boolean(d?.documentId),
        );
        stage(`${mode}_reload`);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('main article').waitFor({ state: 'visible' });
        const destination = await waitFor(
          `${mode}_destination_document`,
          () => observedDocument(panel, page.url()),
          (d) => Boolean(d?.documentId && d.documentId !== source.documentId),
        );
        assert.equal(destination.urlMatched, true, 'snapshot_pending_reload_url_changed');
        stage(`${mode}_cleared`);
        await waitFor(
          `snapshot_${mode}_cleared`,
          () => snapshotState(panel),
          (s) => s?.ready && s.buttonReady && s.rowCount === 0 && !s.capturing && !s.error,
        );
        stage(`${mode}_release`);
        await releaseFault(
          panel,
          () => snapshotState(panel),
          (value) => {
            report.release_stage = value;
          },
        );
        stage(`${mode}_late_ignored`);
        await waitFor(
          `snapshot_${mode}_late_ignored`,
          () => snapshotState(panel),
          (s) => s?.ready && s.buttonReady && s.rowCount === 0 && !s.capturing && !s.error,
        );
        report.cases.push({
          case: `old_document_late_${mode === 'hold_success' ? 'success' : 'rejection'}`,
          status: 'pass',
          document_id_changed: true,
        });
      }

      stage('fresh_document_success');
      await click(panel, 'button-text', 'Capture snapshot');
      await waitFor(
        'snapshot_fresh_success',
        () => snapshotState(panel),
        (s) => s?.ready && s.rowCount === 1 && s.titlePresent && s.buttonReady && !s.capturing,
        30_000,
      );
      report.cases.push({ case: 'fresh_document_snapshot', status: 'pass' });
    },
  });
  report.status = 'pass_bounded';
  stage('complete');
  process.stdout.write('PASS snapshot_document_native\n');
} catch {
  const category = transportFailureClass?.();
  report.transport_failure_class = [
    'none',
    'protocol_shape',
    'unknown_response',
    'protocol_error',
    'response_shape',
    'listener',
    'socket_error',
    'unexpected_close',
    'send_after_close',
    'command_timeout',
    'send_exception',
    'close_failure',
  ].includes(category)
    ? category
    : 'unclassified';
  report.failure_code = `${report.stage}_failed`;
  process.exitCode = 1;
  process.stderr.write(
    `UNVERIFIED snapshot_document_native stage=${report.stage} native_stage=${report.native_stage}\n`,
  );
} finally {
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
