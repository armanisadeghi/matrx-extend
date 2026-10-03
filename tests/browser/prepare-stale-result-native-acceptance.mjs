#!/usr/bin/env node
/** Receipt-bound native acceptance for EXT-D-0058/0059 Prepare ordering. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { signInAdminSettings } from './admin-settings-signin.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { faultState, installFault, releaseFault } from './prepare-fault-driver.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const EXTENSION_DIR = process.env.MATRX_PREPARE_EXTENSION_DIR;
const RECEIPT = process.env.MATRX_PREPARE_RECEIPT;
const CREDENTIALS = process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE;
const OUTPUT = join(REPO, 'test-results', `prepare-stale-result-native-${randomUUID()}.json`);
const WEB_ORIGIN = 'https://www.aimatrx.com';
const DEMO = `${WEB_ORIGIN}/matrx-extend-demo`;
let transportFailureClass;
const report = {
  schema_version: 1,
  defects: ['EXT-D-0058', 'EXT-D-0059'],
  status: 'unverified',
  artifact: null,
  cases: [],
  stage: 'inputs',
  failure_code: null,
  native_stage: null,
  release_stage: null,
  release_visibility: null,
  transport_failure_class: null,
  signin_observations: {},
};

function stage(value) {
  report.stage = value;
}

async function credentials() {
  assert.ok(CREDENTIALS, 'prepare_private_credentials_required');
  const metadata = await stat(CREDENTIALS);
  assert.equal(metadata.mode & 0o077, 0, 'prepare_private_credentials_permissions');
  const value = JSON.parse(await readFile(CREDENTIALS, 'utf8'));
  assert.equal(value.email, 'admin@admin.com', 'prepare_admin_identity_required');
  assert.ok(
    typeof value.password === 'string' && value.password,
    'prepare_admin_password_required',
  );
  return value;
}

async function signIn(page, panel) {
  await signInAdminSettings({ page, panel, report, stage, readCredentials: credentials });
}

async function prepareState(panel) {
  return evaluate(
    panel,
    `(() => {
    const trigger = [...document.querySelectorAll('button[role="tab"][data-state="active"]')]
      .find((button) => button.textContent.trim() === 'Prepare');
    const active = trigger?.getAttribute('aria-controls')
      ? document.getElementById(trigger.getAttribute('aria-controls')) : null;
    if (active?.getAttribute('data-state') !== 'active') return { ready: false };
    const text = active?.innerText ?? '';
    return {
      ready: Boolean(active),
      preparing: text.includes('Preparing…'),
      success: /Prepared in [0-9]+ms/.test(text),
      failed: text.includes('Controlled Prepare rejection'),
      buttonReady: [...(active?.querySelectorAll('button') ?? [])]
        .some((button) => button.textContent.trim() === 'Prepare page' && !button.disabled),
    };
  })()`,
  );
}

async function observedDocument(panel, expectedUrl) {
  return evaluate(
    panel,
    `(async () => {
      const matching = (await chrome.tabs.query({})).filter((tab) => tab.url === ${JSON.stringify(expectedUrl)});
      if (matching.length !== 1) return null;
      const frame = await chrome.webNavigation.getFrame({ tabId: matching[0].id, frameId: 0 });
      return frame?.url === ${JSON.stringify(expectedUrl)} && frame.documentId
        ? { url: frame.url, documentId: frame.documentId } : null;
    })()`,
  );
}

try {
  assert.ok(EXTENSION_DIR && RECEIPT && CREDENTIALS, 'prepare_inputs_required');
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  assert.equal(hashReleaseTree(EXTENSION_DIR), receipt.treeSha256, 'prepare_receipt_tree_mismatch');
  const manifest = JSON.parse(await readFile(join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, receipt.version, 'prepare_receipt_version_mismatch');
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
      await signIn(page, panel);
      stage('prepare_ready');
      await click(panel, 'title', 'Showcase (admin only)');
      await click(panel, 'button-text', 'Prepare');
      await waitFor(
        'prepare_ready',
        () => prepareState(panel),
        (value) => value?.ready && value.buttonReady,
      );

      stage('initial_success');
      await click(panel, 'button-text', 'Prepare page');
      await waitFor(
        'prepare_initial_success',
        () => prepareState(panel),
        (value) => value?.success && value.buttonReady,
        30_000,
      );

      stage('failed_retry_install_fault');
      await installFault(panel, 'hold_reject');
      stage('failed_retry_click');
      await click(panel, 'button-text', 'Prepare page');
      stage('failed_retry_wait_held');
      await waitFor(
        'prepare_failed_retry_held',
        () => faultState(panel),
        (value) => value?.calls === 1 && value.held,
        30_000,
      );
      stage('failed_retry_read_pending');
      const pendingRetry = await prepareState(panel);
      stage('failed_retry_assert_pending');
      assert.equal(pendingRetry.preparing, true, 'prepare_retry_not_pending');
      stage('failed_retry_assert_previous_success_absent');
      assert.equal(pendingRetry.success, false, 'prepare_previous_success_visible_during_retry');
      stage('failed_retry_release');
      await releaseFault(
        panel,
        () => prepareState(panel),
        (value) => {
          report.release_stage = value;
        },
      );
      stage('failed_retry_observe_rejection');
      const retry = await waitFor(
        'prepare_failed_retry',
        () => prepareState(panel),
        (value) => value?.failed && value.buttonReady,
      );
      stage('failed_retry_assert_stale_success_absent');
      assert.equal(retry.success, false, 'prepare_old_success_visible_after_failure');
      report.cases.push({ case: 'failed_retry_after_success', status: 'pass' });

      const runLateResultCase = async (mode, crossUrl) => {
        const label = crossUrl ? `cross_url_${mode}` : mode;
        if (crossUrl) {
          stage(`${label}_source_navigation`);
          await page.goto(DEMO, { waitUntil: 'domcontentloaded' });
          await page.locator('main article').waitFor({ state: 'visible' });
          await waitFor(
            `${label}_source_ready`,
            () => prepareState(panel),
            (value) => value?.ready && value.buttonReady && !value.preparing,
          );
        }
        stage(label);
        await installFault(panel, mode);
        await click(panel, 'button-text', 'Prepare page');
        await waitFor(
          `prepare_${label}_held`,
          () => faultState(panel),
          (value) => value?.calls === 1 && value.held,
          30_000,
        );
        assert.equal(
          (await prepareState(panel)).preparing,
          true,
          'prepare_not_pending_before_navigation',
        );
        let navigationEvidence;
        if (crossUrl) {
          const sourceUrl = page.url();
          const source = await waitFor(
            `${label}_source_document`,
            () => observedDocument(panel, sourceUrl),
            (value) => Boolean(value?.documentId),
          );
          const destinationUrl = new URL(sourceUrl);
          destinationUrl.searchParams.set('prepare-native-destination', mode);
          assert.notEqual(destinationUrl.href, source.url, 'prepare_destination_url_unchanged');
          await page.goto(destinationUrl.href, { waitUntil: 'domcontentloaded' });
          assert.equal(page.url(), destinationUrl.href, 'prepare_destination_url_refused');
          await page.locator('main article').waitFor({ state: 'visible' });
          const destination = await waitFor(
            `${label}_destination_document`,
            () => observedDocument(panel, destinationUrl.href),
            (value) => Boolean(value?.documentId && value.documentId !== source.documentId),
          );
          navigationEvidence = {
            source_url: source.url,
            destination_url: destination.url,
            url_changed: true,
            document_id_changed: true,
          };
        } else {
          const before = await page.evaluate(() => performance.timeOrigin);
          await page.reload({ waitUntil: 'domcontentloaded' });
          await waitFor(
            `prepare_${label}_new_document`,
            () => page.evaluate(() => performance.timeOrigin),
            (value) => value !== before,
          );
        }
        await waitFor(
          `prepare_${label}_cleared`,
          () => prepareState(panel),
          (value) =>
            value?.ready &&
            value.buttonReady &&
            !value.success &&
            !value.failed &&
            !value.preparing,
        );
        await releaseFault(
          panel,
          () => prepareState(panel),
          (value) => {
            report.release_stage = value;
          },
        );
        const after = await waitFor(
          `prepare_${label}_late_ignored`,
          () => prepareState(panel),
          (value) =>
            value?.ready &&
            value.buttonReady &&
            !value.success &&
            !value.failed &&
            !value.preparing,
        );
        assert.equal(after.success, false);
        report.cases.push({
          case: `${crossUrl ? 'cross_url_' : ''}old_document_late_${mode === 'hold_success' ? 'success' : 'rejection'}`,
          status: 'pass',
          ...(navigationEvidence && { navigation: navigationEvidence }),
        });
      };
      for (const mode of ['hold_success', 'hold_reject']) await runLateResultCase(mode, false);
      stage('fresh_document_success');
      await click(panel, 'button-text', 'Prepare page');
      await waitFor(
        'prepare_fresh_document_success',
        () => prepareState(panel),
        (value) => value?.success && value.buttonReady,
        30_000,
      );
      report.cases.push({ case: 'fresh_document_prepare', status: 'pass' });
      for (const mode of ['hold_success', 'hold_reject']) await runLateResultCase(mode, true);
    },
  });
  report.status = 'pass_bounded';
  stage('complete');
  process.stdout.write('PASS prepare_stale_result_native\n');
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
  report.status = 'unverified';
  report.failure_code = `${report.stage}_failed`;
  process.stderr.write(
    `UNVERIFIED prepare_stale_result_native stage=${report.stage} native_stage=${report.native_stage}\n`,
  );
  process.exitCode = 1;
} finally {
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
