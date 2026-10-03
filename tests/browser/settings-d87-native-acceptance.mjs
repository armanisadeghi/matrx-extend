#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { storageFaultInstallerSource } from './d87-storage-fault-injector.mjs';
import {
  firstPartyWebIdentity,
  observeCanonicalAdminCheck,
  supabaseOrigin,
} from './member-native-auth-proof.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import {
  panelIdentity,
  signInSettings,
  verifyCurrentSettingsIdentity,
} from './settings-native-auth-driver.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

// EXT-D-0087: trusted Settings choices, real Chrome storage reads, and one
// controlled rejection/hold at the browser API boundary in an owned profile.
const REPO = resolve(import.meta.dirname, '..', '..');
const EXTENSION_DIR = process.env.MATRX_D87_EXTENSION_DIR;
const RECEIPT_PATH = process.env.MATRX_D87_RECEIPT;
const AUTH_MODE = process.env.MATRX_D87_AUTH_MODE ?? 'guest';
const OUTPUT = join(REPO, 'test-results', `settings-d87-native-${randomUUID()}.json`);
const KEY = 'matrx.settings.v1';
const LABELS = { system: 'System', light: 'Light', dark: 'Dark' };
const REPAIR_SHA = 'c3aece612cdcd9536cba548902a9bb517f1d8bfa';
const SAFE_CODES = new Set([
  'd87_artifact_inputs_required',
  'd87_source_before_repair',
  'd87_receipt_tree_mismatch',
  'd87_injection_not_installed',
  'native_sidepanel_release_receipt_missing',
  'native_sidepanel_release_receipt_refused',
  'native_sidepanel_override_provenance_refused',
  'native_sidepanel_release_tree_refused',
  'native_sidepanel_local_build_receipt_missing',
  'native_sidepanel_local_build_provenance_refused',
]);
const OBSERVATION_CODES = new Set([
  'd87_settings_ready',
  'Appearance_section_ready',
  'Appearance_expanded',
  'd87_system_visible',
  'd87_system_saved',
  'd87_dark_visible',
  'd87_dark_saved',
  'd87_light_visible',
  'd87_rejection_visible',
  'd87_first_write_held',
  'd87_both_writes_finished',
  'd87_reloaded_identity',
  'd87_extension_identity',
  'd87_member_organization',
  'd87_member_organization_selected',
  'd87_canonical_nonadmin',
  'd87_web_identity',
  'd87_extension_signin_ready',
  'd87_expected_identity',
  'd87_rendered_identity',
  'd87_reload_first_party',
  'd87_panel_foreground',
]);
const POINTER_CODES = new Set([
  'pointer_initial_evaluation_failed',
  'pointer_page_sample_failed',
  'pointer_target_not_unique',
  'pointer_followup_evaluation_failed',
  'pointer_stable_hit_not_observed',
  'pointer_press_dispatch_failed',
  'pointer_release_dispatch_failed',
]);
const report = {
  schema_version: 1,
  defect: 'EXT-D-0087',
  scope: `receipt-bound owned Chrome-for-Testing native Settings panel; ${AUTH_MODE}`,
  auth_mode: AUTH_MODE,
  authentication: null,
  reload_auth_checks: [],
  pointer_boundary: null,
  status: 'unverified',
  build: null,
  cases: [],
  failure_stage: null,
  failure_code: null,
};
let stage = 'receipt';
let operation = 'receipt_validation';
let expectedProfileId = null;
let expectedEmail = null;
let expectedOrganizationId = null;

function failureCode(error) {
  if (SAFE_CODES.has(error?.message)) return error.message;
  if (POINTER_CODES.has(error?.driverFailure?.code)) return error.driverFailure.code;
  const waitLabel = String(error?.message ?? '').split('_not_observed:', 1)[0];
  if (OBSERVATION_CODES.has(waitLabel)) return `${waitLabel}_not_observed`;
  if (error?.code === 'ERR_ASSERTION') return 'd87_assertion_failed';
  return 'd87_acceptance_failed';
}

async function observation(panel) {
  return evaluate(
    panel,
    `(async () => {
    const row = [...document.querySelectorAll('span')]
      .find((element) => element.textContent.trim() === 'Theme');
    const control = row?.parentElement?.parentElement?.querySelector('button[role="combobox"]');
    const raw = (await chrome.storage.local.get(${JSON.stringify(KEY)}))[${JSON.stringify(KEY)}];
    let storedTheme = null;
    if (typeof raw === 'string') {
      try { storedTheme = JSON.parse(raw)?.state?.theme ?? null; } catch {}
    }
    const error = [...document.querySelectorAll('[role="alert"]')]
      .some((element) => element.textContent.includes('Could not save preferences'));
    const retry = [...document.querySelectorAll('button')]
      .some((element) => element.textContent.trim() === 'Retry save');
    const theme = control?.textContent.trim() ?? null;
    return {
      settingsActive: !!document.querySelector('button[title="Settings"][data-state="active"]'),
      theme: ['System', 'Light', 'Dark'].includes(theme) ? theme : null,
      storedTheme: ['system', 'light', 'dark'].includes(storedTheme) ? storedTheme : null,
      error,
      retry,
      guest: (document.body?.innerText ?? '').includes('Sign in to choose'),
    };
  })()`,
  );
}

async function pointerBoundary(panel) {
  return evaluate(
    panel,
    `(() => {
    const listboxes = [...document.querySelectorAll('[role="listbox"]')];
    const animations = listboxes.flatMap((node) => node.getAnimations({ subtree: false }));
    const theme = [...document.querySelectorAll('span')]
      .find((node) => node.textContent.trim() === 'Theme')
      ?.parentElement?.parentElement?.querySelector('button[role="combobox"]');
    return {
      visibility: ['visible', 'hidden', 'prerender'].includes(document.visibilityState)
        ? document.visibilityState : 'other',
      body_inline_pointer_events_none: document.body.style.pointerEvents === 'none',
      body_computed_pointer_events_none: getComputedStyle(document.body).pointerEvents === 'none',
      theme_computed_pointer_events_none: theme ? getComputedStyle(theme).pointerEvents === 'none' : null,
      listbox_count: listboxes.length,
      listbox_open_count: listboxes.filter((node) => node.getAttribute('data-state') === 'open').length,
      listbox_closed_count: listboxes.filter((node) => node.getAttribute('data-state') === 'closed').length,
      listbox_running_animation_count: animations.filter((animation) => animation.playState === 'running').length,
      listbox_paused_animation_count: animations.filter((animation) => animation.playState === 'paused').length,
      listbox_finished_animation_count: animations.filter((animation) => animation.playState === 'finished').length,
      dialog_count: document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length,
    };
  })()`,
  );
}

async function assertExpectedIdentity(panel) {
  if (AUTH_MODE === 'guest') {
    return waitFor(
      'd87_expected_identity',
      () => panelIdentity(panel),
      (identity) => identity?.accessTokenPresent === false,
      30_000,
    );
  }
  return verifyCurrentSettingsIdentity({
    panel,
    mode: AUTH_MODE,
    email: expectedEmail,
    profileId: expectedProfileId,
    organizationId: expectedOrganizationId,
  });
}

async function openSettings(panel) {
  operation = 'settings_click';
  await click(panel, 'title', 'Settings');
  operation = 'settings_ready';
  await waitFor(
    'd87_settings_ready',
    () => observation(panel),
    (state) => state?.settingsActive && state.guest === (AUTH_MODE === 'guest'),
  );
  const identity = await assertExpectedIdentity(panel);
  operation = 'appearance_open';
  await openSection(panel, 'Appearance');
  return identity;
}

async function chooseTheme(panel, theme) {
  operation = 'theme_menu_open';
  await click(panel, 'theme', 'Theme');
  operation = 'theme_option_click';
  await click(panel, 'option', LABELS[theme]);
  operation = 'theme_visible';
  await waitFor(
    `d87_${theme}_visible`,
    () => observation(panel),
    (state) => state?.theme === LABELS[theme],
  );
}

async function settledTheme(panel, theme) {
  operation = 'theme_persisted';
  return waitFor(
    `d87_${theme}_saved`,
    () => observation(panel),
    (state) => state?.theme === LABELS[theme] && state.storedTheme === theme && !state.error,
  );
}

async function reload(page, panel, expectedTheme) {
  const canonical =
    AUTH_MODE === 'member' ? observeCanonicalAdminCheck(panel, await supabaseOrigin(REPO)) : null;
  await canonical?.start();
  try {
    operation = 'panel_reload';
    await panel.send('Page.reload', { ignoreCache: true });
    operation = 'reloaded_identity';
    await waitFor(
      'd87_reloaded_identity',
      () => observation(panel),
      (state) => state?.guest === (AUTH_MODE === 'guest'),
    );
    const rendered = await openSettings(panel);
    if (AUTH_MODE !== 'guest') {
      operation = 'reloaded_first_party_identity';
      const web = await page.context().newPage();
      try {
        await web.goto('https://www.aimatrx.com/matrx-extend-demo', {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        const firstParty = await waitFor(
          'd87_reload_first_party',
          () => firstPartyWebIdentity(web),
          (identity) =>
            identity?.userId === expectedProfileId &&
            identity.email?.toLowerCase() === expectedEmail.toLowerCase(),
          30_000,
        );
        report.reload_auth_checks.push({
          first_party_user_matches_extension:
            firstParty.userId === expectedProfileId &&
            firstParty.email.toLowerCase() === expectedEmail.toLowerCase(),
          rendered_account_and_role_match:
            rendered.rendered_email_matches_first_party && rendered.rendered_role_matches_mode,
          selected_organization_matches_stored_uuid_and_name:
            rendered.selected_organization_matches_stored_uuid_and_name,
          canonical_nonadmin_check: null,
        });
      } finally {
        await web.close();
        await page.bringToFront();
      }
      operation = 'reloaded_canonical_role';
      const role = AUTH_MODE === 'member' ? await canonical.verify(expectedProfileId) : null;
      report.reload_auth_checks.at(-1).canonical_nonadmin_check = role;
    }
    operation = 'reloaded_theme';
    return waitFor(
      `d87_${expectedTheme}_saved`,
      () => observation(panel),
      (state) =>
        state?.settingsActive &&
        state.guest === (AUTH_MODE === 'guest') &&
        state.theme === LABELS[expectedTheme] &&
        state.storedTheme === expectedTheme &&
        !state.error,
    );
  } finally {
    await canonical?.stop();
  }
}

async function installStorageFault(panel, mode) {
  const installed = await evaluate(panel, storageFaultInstallerSource(KEY, mode));
  assert.equal(installed, true, 'd87_injection_not_installed');
}

async function faultState(panel) {
  return evaluate(panel, '(() => window.__d87StorageFault?.state() ?? null)()');
}

async function restoreFault(panel) {
  await evaluate(
    panel,
    `(() => {
    window.__d87StorageFault?.release();
    window.__d87StorageFault?.restore();
    return true;
  })()`,
  );
}

try {
  assert.ok(['guest', 'admin', 'member'].includes(AUTH_MODE), 'd87_auth_mode_invalid');
  assert.ok(EXTENSION_DIR && RECEIPT_PATH, 'd87_artifact_inputs_required');
  const extensionDir = resolve(EXTENSION_DIR);
  const receiptPath = resolve(RECEIPT_PATH);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const imported = extensionDir.match(/\/ci-artifacts\/([a-f0-9]{40})\/(\d+)-(\d+)\/chrome-mv3$/);
  const importedSha = imported?.[1];
  const sourceSha = receipt.sourceSha ?? importedSha;
  assert.match(sourceSha ?? '', /^[a-f0-9]{40}$/, 'd87_source_before_repair');
  let artifactId = null;
  if (receipt.kind === 'local_dev_unpacked') {
    assert.ok(imported, 'd87_artifact_inputs_required');
    const status = JSON.parse(
      await readFile(join(extensionDir, '..', 'import-status.json'), 'utf8'),
    );
    assert.equal(status.sourceSha, sourceSha, 'd87_artifact_inputs_required');
    assert.equal(String(status.runId), imported[2], 'd87_artifact_inputs_required');
    assert.equal(String(status.runAttempt), imported[3], 'd87_artifact_inputs_required');
    assert.equal(status.treeSha256, receipt.treeSha256, 'd87_receipt_tree_mismatch');
    assert.ok(Number.isInteger(status.artifactId), 'd87_artifact_inputs_required');
    artifactId = status.artifactId;
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', REPAIR_SHA, sourceSha], { cwd: REPO });
  } catch {
    throw new Error('d87_source_before_repair');
  }
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256, 'd87_receipt_tree_mismatch');
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, receipt.version);
  report.build = {
    version: receipt.version,
    source_sha: sourceSha,
    tree_sha256: receipt.treeSha256,
    receipt_kind: receipt.kind ?? 'release',
    artifact_id: artifactId,
  };
  stage = 'native_panel';
  const run = await runNativeSidepanelQa({
    extensionDir,
    expectedRelease: receipt,
    releaseReceiptPath: receiptPath,
    ...(receipt.kind === 'local_dev_unpacked' && { localDevReceiptPath: receiptPath }),
    exercisePanel: async ({ page, panel, activatePanel }) => {
      try {
        if (AUTH_MODE !== 'guest') {
          stage = 'authentication';
          const authentication = await signInSettings({
            mode: AUTH_MODE,
            page,
            panel,
            repo: REPO,
            adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
            memberLinkFile: process.env.MATRX_REVIEWER_MAGIC_LINK_FILE,
            onStage: (value) => {
              operation = value;
            },
          });
          const { profileId, email, organizationId, ...safeAuthentication } = authentication;
          expectedProfileId = profileId;
          expectedEmail = email;
          expectedOrganizationId = organizationId;
          report.authentication = safeAuthentication;
          await activatePanel();
          await waitFor(
            'd87_panel_foreground',
            () => evaluate(panel, 'document.visibilityState === "visible"'),
            (visible) => visible === true,
          );
        }
        stage = 'baseline';
        await openSettings(panel);
        await chooseTheme(panel, 'light');
        const initialSave = await settledTheme(panel, 'light');
        report.cases.push({
          name: 'first changed choice saved through UI',
          status: 'pass',
          observation: initialSave,
        });
        await chooseTheme(panel, 'system');
        const baseline = await settledTheme(panel, 'system');
        report.cases.push({
          name: 'system choice saved through UI',
          status: 'pass',
          observation: baseline,
        });

        stage = 'rejected_write';
        await installStorageFault(panel, 'reject');
        try {
          await chooseTheme(panel, 'dark');
          const failed = await waitFor(
            'd87_rejection_visible',
            () => observation(panel),
            (state) =>
              state?.theme === 'Dark' &&
              state.storedTheme === 'system' &&
              state.error &&
              state.retry,
          );
          assert.equal((await faultState(panel)).calls, 1);
          report.cases.push({
            name: 'rejected write visible with retry',
            status: 'pass',
            observation: failed,
          });
        } finally {
          await restoreFault(panel);
        }
        stage = 'retry';
        await click(panel, 'button-text', 'Retry save');
        const retried = await settledTheme(panel, 'dark');
        const reloaded = await reload(page, panel, 'dark');
        report.cases.push({
          name: 'retry persisted after reload',
          status: 'pass',
          before_reload: retried,
          observation: reloaded,
        });

        stage = 'overlap';
        await installStorageFault(panel, 'hold');
        try {
          await chooseTheme(panel, 'light');
          await waitFor(
            'd87_first_write_held',
            () => faultState(panel),
            (state) => state?.calls === 1 && state.held,
          );
          await chooseTheme(panel, 'system');
          const beforeRelease = await observation(panel);
          assert.equal(beforeRelease.theme, 'System');
          assert.equal(beforeRelease.storedTheme, 'dark');
          assert.equal(
            (await faultState(panel)).calls,
            1,
            'later Chrome write must wait for the first write',
          );
          await evaluate(panel, '(() => { window.__d87StorageFault.release(); return true; })()');
          await waitFor(
            'd87_both_writes_finished',
            () => faultState(panel),
            (state) => state?.calls === 2 && state.released,
          );
          const latest = await settledTheme(panel, 'system');
          report.cases.push({
            name: 'latest rapid choice persisted',
            status: 'pass',
            before_release: beforeRelease,
            observation: latest,
          });
        } finally {
          await restoreFault(panel);
        }
        stage = 'overlap_reload';
        const reloadedLatest = await reload(page, panel, 'system');
        report.cases.push({
          name: 'latest rapid choice survives reload',
          status: 'pass',
          observation: reloadedLatest,
        });
      } catch (error) {
        report.failure_operation = operation;
        if (error?.driverFailure) report.driver_failure = error.driverFailure;
        if (
          operation === 'theme_menu_open' &&
          error?.driverFailure?.code === 'pointer_stable_hit_not_observed'
        ) {
          report.pointer_boundary = await pointerBoundary(panel).catch(() => null);
        }
        // Only the fixed Settings predicates below cross from the panel. A
        // destroyed execution context is recorded as unavailable.
        report.failure_observation = await observation(panel).catch(() => null);
        throw error;
      }
    },
  });
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256, 'd87_receipt_tree_mismatch');
  report.artifacts = run.artifacts;
  report.status = 'pass';
} catch (error) {
  report.failure_stage = stage;
  report.failure_code = failureCode(error);
  report.status = 'fail';
  process.exitCode = 1;
} finally {
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`${report.status.toUpperCase()} D87 native acceptance: ${OUTPUT}`);
}
