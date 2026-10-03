#!/usr/bin/env node
/** Receipt-bound native acceptance for EXT-D-0058/0059 Prepare ordering. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { faultState, installFault, releaseFault } from './prepare-fault-driver.mjs';
import {
  activeTabPanelExpression,
  click,
  evaluate,
  openSection,
  waitFor,
} from './settings-panel-driver.mjs';

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

async function extensionAuthState(panel) {
  return evaluate(
    panel,
    `(() => {
      const settings = ${activeTabPanelExpression('Settings')};
      const account = [...(settings?.querySelectorAll('button[aria-expanded]') ?? [])]
        .find((button) => button.textContent.trim() === 'Account');
      const section = account?.parentElement?.nextElementSibling;
      const row = (label) => [...(section?.querySelectorAll('span') ?? [])]
        .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
      const email = row('Email');
      const role = row('Role');
      const buttons = [...(settings?.querySelectorAll('button') ?? [])];
      const signIn = buttons.filter((button) => button.textContent.trim() === 'Sign in');
      const retry = buttons.find((button) => button.textContent.trim() === 'Try again');
      return {
        settings_panel_active: Boolean(settings),
        account_present: Boolean(account),
        account_expanded: account?.getAttribute('aria-expanded') === 'true',
        email_row_present: email !== null,
        expected_admin_email: email === 'Emailadmin@admin.com',
        admin_role: role?.toLowerCase() === 'roleadmin',
        sign_in_count: signIn.length,
        sign_in_enabled: signIn.length === 1 && !signIn[0].disabled,
        sign_out_present: buttons.some((button) => button.textContent.trim() === 'Sign out'),
        auth_error_present: Boolean(document.querySelector('[role="alert"]')),
        auth_retry_present: Boolean(retry),
        auth_retry_disabled: retry?.disabled ?? false,
        loading_present: Boolean(document.querySelector('[role="progressbar"], [aria-busy="true"]')),
      };
    })()`,
  );
}

async function signIn(page, panel) {
  const web = await page.context().newPage();
  try {
    stage('admin_web_navigation');
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    stage('admin_web_route');
    assert.equal(new URL(web.url()).pathname, '/login', 'prepare_web_login_path');
    stage('admin_credentials_read');
    const secret = await credentials();
    stage('admin_web_form_fill');
    await web.locator('input[name="email"]').fill(secret.email);
    await web.locator('input[name="password"]').fill(secret.password);
    stage('admin_web_submit');
    try {
      await Promise.all([
        web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
          timeout: 90_000,
        }),
        web.getByRole('button', { name: 'Sign in', exact: true }).click(),
      ]);
    } catch {
      report.signin_observations.web_after_submit = {
        route:
          new URL(web.url()).origin !== WEB_ORIGIN
            ? 'other_origin'
            : new URL(web.url()).pathname === '/login'
              ? 'login'
              : new URL(web.url()).pathname === '/dashboard'
                ? 'dashboard'
                : 'other_path',
        alert_present: await web
          .locator('[role="alert"]')
          .count()
          .then((count) => count > 0)
          .catch(() => null),
      };
      throw new Error('admin_web_submit_unverified');
    }
    report.signin_observations.web_dashboard_reached = true;
    stage('admin_extension_settings_click');
    await click(panel, 'title', 'Settings');
    stage('admin_extension_account_open');
    await openSection(panel, 'Account');
    report.signin_observations.extension_after_account_open = await extensionAuthState(panel);
    stage('admin_extension_signin_ready');
    try {
      report.signin_observations.extension_guest_ready = await waitFor(
        'prepare_extension_signin_ready',
        () => extensionAuthState(panel),
        (value) => value?.sign_in_count === 1 && value.sign_in_enabled,
      );
    } catch {
      report.signin_observations.extension_signin_last = await extensionAuthState(panel).catch(
        () => null,
      );
      throw new Error('prepare_extension_signin_not_ready');
    }
    stage('admin_extension_click');
    try {
      await click(panel, 'settings-button', 'Sign in');
    } catch (error) {
      const failure = error?.driverFailure;
      const knownCodes = new Set([
        'pointer_initial_evaluation_failed',
        'pointer_page_sample_failed',
        'pointer_target_not_unique',
        'pointer_followup_evaluation_failed',
        'pointer_stable_hit_not_observed',
        'pointer_press_dispatch_failed',
        'pointer_release_dispatch_failed',
      ]);
      report.signin_observations.extension_click_failure = {
        code: knownCodes.has(failure?.code) ? failure.code : 'other',
        matched_target_count: Number.isInteger(failure?.matchedTargetCount)
          ? failure.matchedTargetCount
          : null,
        visible_match_count: Number.isInteger(failure?.visibleMatchCount)
          ? failure.visibleMatchCount
          : null,
        hit_target: failure?.hitTarget === true,
        target_disabled: failure?.targetDisabled === true,
        center_hit_category: [
          'none',
          'target',
          'dialog',
          'listbox',
          'modal_overlay',
          'target_ancestor',
          'header_or_tabs',
          'other_element',
        ].includes(failure?.centerHitCategory)
          ? failure.centerHitCategory
          : 'unknown',
      };
      throw error;
    }
    stage('admin_extension_auth_completion');
    await waitFor(
      'prepare_admin_ready',
      async () => {
        const observed = await extensionAuthState(panel);
        report.signin_observations.extension_last = observed;
        return observed;
      },
      (value) => value?.expected_admin_email && value.admin_role,
      90_000,
    );
  } catch {
    if (report.stage.startsWith('admin_extension_')) {
      report.signin_observations.extension_failure = await extensionAuthState(panel).catch(
        () => null,
      );
    }
    throw new Error(`${report.stage}_failed`);
  } finally {
    await web.close();
    await page.bringToFront();
  }
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

      for (const mode of ['hold_success', 'hold_reject']) {
        stage(mode);
        await installFault(panel, mode);
        await click(panel, 'button-text', 'Prepare page');
        await waitFor(
          `prepare_${mode}_held`,
          () => faultState(panel),
          (value) => value?.calls === 1 && value.held,
          30_000,
        );
        assert.equal(
          (await prepareState(panel)).preparing,
          true,
          'prepare_not_pending_before_reload',
        );
        const before = await page.evaluate(() => performance.timeOrigin);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitFor(
          `prepare_${mode}_new_document`,
          () => page.evaluate(() => performance.timeOrigin),
          (value) => value !== before,
        );
        await waitFor(
          `prepare_${mode}_cleared`,
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
          `prepare_${mode}_late_ignored`,
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
          case: `old_document_late_${mode === 'hold_success' ? 'success' : 'rejection'}`,
          status: 'pass',
        });
      }
      stage('fresh_document_success');
      await click(panel, 'button-text', 'Prepare page');
      await waitFor(
        'prepare_fresh_document_success',
        () => prepareState(panel),
        (value) => value?.success && value.buttonReady,
        30_000,
      );
      report.cases.push({ case: 'fresh_document_prepare', status: 'pass' });
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
