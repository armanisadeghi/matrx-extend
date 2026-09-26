#!/usr/bin/env node
/**
 * EXT-F-1003-T51: a signed-in admin cancels, then confirms the Settings reset
 * in an owned disposable Chrome profile. A reset that preserves extension
 * auth, skips local/session clearing, or signs out on Cancel must fail.
 * Root alone admits this browser run through the campaign resource guard.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'isolated-admin-reset-acceptance.json');
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const EXPECTED_ADMIN = 'admin@admin.com';
const LOCAL_KEY = 'matrx.qa.adminReset.local';
const LOCAL_VALUE = 'disposable-admin-reset-local-fixture';
const SESSION_KEY = 'matrx.qa.adminReset.session';
const SESSION_VALUE = 'disposable-admin-reset-fixture';
// These keys can be created by a fresh guest panel or live desktop discovery
// after the reset. Their names alone cannot distinguish new state from a
// restored old value; immediate post-Confirm absence still covers every key.
const REGENERATED_LOCAL_KEYS = new Set([
  'matrx.guest.signature',
  'matrx.guest.nonce',
  'matrx.guest.createdAt',
  'matrxLocalEnginePort',
  'matrxLocalEngineLastGoodPort',
]);
const REGENERATED_SESSION_KEYS = new Set(['matrx.crossComponent.instanceId']);
let stage = 'not_started';
const evidence = {
  schema_version: 1,
  case_id: 'EXT-F-1003-T51',
  scope: 'real native Settings side panel in an owned disposable Chrome profile',
  status: 'unverified',
  login_method: 'real web form followed by extension Settings Sign in',
  response_interception: false,
  injected_auth_session: false,
  fixture: 'Dark theme through Settings and inert local/session values',
  steps: [],
};

function fail(category) {
  evidence.failure_category = category;
  throw new Error('isolated_admin_reset_unverified');
}

// Credentials are read only when the real web form is ready. They never enter
// reports, URLs, logs, browser storage fixtures, or thrown diagnostic text.
async function readAdminCredentials() {
  let source;
  try {
    source = await readFile(ADMIN_ENV, 'utf8');
  } catch (error) {
    fail(
      error?.code === 'ENOENT'
        ? 'credential_file_missing'
        : error?.code === 'EACCES'
          ? 'credential_file_denied'
          : 'credential_file_unreadable',
    );
  }
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    values[match[1]] = value;
  }
  if (values.AI_ADMIN_USERNAME !== EXPECTED_ADMIN || !values.AI_ADMIN_PASSWORD)
    fail('credential_variables_unavailable');
  return { email: values.AI_ADMIN_USERNAME, password: values.AI_ADMIN_PASSWORD };
}

async function signInOnRealWebPage(page) {
  const web = await page.context().newPage();
  try {
    stage = 'web_navigation';
    try {
      await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch {
      fail('web_navigation_failed');
    }
    stage = 'web_login_path';
    const location = new URL(web.url());
    if (location.origin !== WEB_ORIGIN || location.pathname !== '/login')
      fail('web_login_path_mismatch');
    stage = 'web_form';
    const { email, password } = await readAdminCredentials();
    try {
      await web.locator('input[name="email"]').fill(email);
      await web.locator('input[name="password"]').fill(password);
      await Promise.all([
        web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
          timeout: 90_000,
        }),
        web.getByRole('button', { name: 'Sign in', exact: true }).click(),
      ]);
    } catch {
      fail('real_web_login_failed');
    }
    evidence.steps.push('Real web login reached the dashboard');
    return web;
  } catch {
    await web.close();
    throw new Error('real_web_login_unverified');
  }
}

async function panelState(panel) {
  return evaluate(
    panel,
    `(() => {
    const account = [...document.querySelectorAll('button[aria-expanded]')]
      .find((button) => button.textContent.trim() === 'Account');
    const section = account?.parentElement?.nextElementSibling;
    const row = (label) => [...(section?.querySelectorAll('span') ?? [])]
      .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
    const buttons = [...document.querySelectorAll('button')];
    const themeRow = [...document.querySelectorAll('span')]
      .find((span) => span.textContent.trim() === 'Theme');
    const dialog = [...document.querySelectorAll('[role="alertdialog"]')]
      .find((el) => el.querySelector('[data-slot="alert-dialog-title"]')
        ?.textContent.trim() === 'Clear local data?');
    return {
      settings: Boolean(document.querySelector('button[title="Settings"][data-state="active"]')),
      emailIsAdmin: row('Email') === 'Email${EXPECTED_ADMIN}',
      roleIsAdmin: row('Role')?.toLowerCase() === 'roleadmin',
      signIn: buttons.some((button) => button.textContent.trim() === 'Sign in'),
      signOut: buttons.some((button) => button.textContent.trim() === 'Sign out'),
      advanced: buttons.some((button) => button.textContent.trim() === 'Advanced agent capabilities'),
      theme: themeRow?.parentElement?.parentElement
        ?.querySelector('button[role="combobox"]')?.textContent.trim() ?? null,
      dialog: Boolean(dialog),
    };
  })()`,
  );
}

async function storageState(panel) {
  // Return booleans only for auth keys. No credential, token, profile, or
  // arbitrary storage value crosses CDP into the test process.
  return evaluate(
    panel,
    `(async () => {
    const local = await chrome.storage.local.get(null);
    const session = await chrome.storage.session.get(null);
    let theme = null;
    if (typeof local['matrx.settings.v1'] === 'string') {
      try { theme = JSON.parse(local['matrx.settings.v1']).state?.theme ?? null; } catch {}
    }
    return {
      theme,
      hasSettings: Object.hasOwn(local, 'matrx.settings.v1'),
      hasAccessToken: Object.hasOwn(local, 'matrx.auth.accessToken'),
      hasUserProfile: Object.hasOwn(local, 'matrx.user.profile'),
      hasAdminFlag: local['matrx.user.isAdmin'] === true,
      localFixtureMatches: local[${JSON.stringify(LOCAL_KEY)}] === ${JSON.stringify(LOCAL_VALUE)},
      hasLocalFixture: Object.hasOwn(local, ${JSON.stringify(LOCAL_KEY)}),
      sessionFixtureMatches: session[${JSON.stringify(SESSION_KEY)}] === ${JSON.stringify(SESSION_VALUE)},
      hasSessionFixture: Object.hasOwn(session, ${JSON.stringify(SESSION_KEY)}),
      localKeys: Object.keys(local).sort(), sessionKeys: Object.keys(session).sort(),
    };
  })()`,
  );
}

function isAdmin(state) {
  return (
    state?.emailIsAdmin && state.roleIsAdmin && state.signOut && state.advanced && !state.signIn
  );
}

// Keep a failed native click diagnosable without recording browser exceptions,
// page text, storage values, auth URLs, or credentials in the durable receipt.
async function resetOpenClickDiagnostic(panel, error) {
  const message = String(error?.message ?? '');
  const category = message.startsWith('unique visible button ')
    ? 'target_count'
    : message.startsWith('stable hit target for button ')
      ? 'unstable_or_blocked_hit'
      : message.startsWith('pointer_sample_failed for button ')
        ? 'pointer_sample_failed'
        : 'native_input_failed';
  try {
    const state = await evaluate(
      panel,
      `(() => {
      const rawTargets = [...document.querySelectorAll('button')]
        .filter((button) => button.textContent.trim() === 'Clear local data on this device');
      const targets = rawTargets.filter((button) => {
        const style = getComputedStyle(button), rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
          style.display !== 'none' && !button.closest('[inert]');
      });
      const target = targets[0];
      const rect = target?.getBoundingClientRect();
      const x = rect ? rect.x + rect.width / 2 : null;
      const y = rect ? rect.y + rect.height / 2 : null;
      const hit = rect ? document.elementFromPoint(x, y) : null;
      const dialogs = [...document.querySelectorAll('[role="alertdialog"]')];
      const section = [...document.querySelectorAll('button[aria-expanded]')]
        .find((button) => button.textContent.trim() === 'Data & reset');
      return {
        target_count: targets.length,
        raw_target_count: rawTargets.length,
        target_has_layout: Boolean(rect && rect.width > 0 && rect.height > 0),
        target_in_viewport: Boolean(rect && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight),
        target_hit: Boolean(target && hit && (hit === target || target.contains(hit))),
        hit_is_dialog: Boolean(hit?.closest('[role="alertdialog"]')),
        raw_target_in_inert_tree: rawTargets.some((button) => Boolean(button.closest('[inert]'))),
        target_animating: Boolean(target?.getAnimations({ subtree: true })
          .some((animation) => animation.playState === 'running')),
        dialog_count: dialogs.length,
        dialog_animating: dialogs.some((dialog) => dialog.getAnimations({ subtree: true })
          .some((animation) => animation.playState === 'running')),
        section_expanded: section?.getAttribute('aria-expanded') === 'true',
        body_pointer_events_none: getComputedStyle(document.body).pointerEvents === 'none',
        body_scroll_locked: document.body.hasAttribute('data-scroll-locked'),
      };
    })()`,
    );
    return { category, ...state };
  } catch {
    return { category, snapshot_available: false };
  }
}

try {
  stage = 'release_receipt';
  const receipt = JSON.parse(await readFile(join(REPO, '.output', 'release-receipt.json'), 'utf8'));
  evidence.build = {
    version: receipt.version,
    source_sha: receipt.sourceSha,
    tree_sha256: receipt.treeSha256,
  };
  stage = 'owned_profile';
  const result = await runNativeSidepanelQa({
    exercisePanel: async ({ page, panel }) => {
      stage = 'guest_settings';
      await click(panel, 'title', 'Settings');
      await openSection(panel, 'Account');
      const guest = await panelState(panel);
      assert.equal(guest.signIn && !guest.signOut && !guest.advanced, true);

      const web = await signInOnRealWebPage(page);
      try {
        stage = 'extension_signin';
        await click(panel, 'button', 'Sign in');
        await waitFor('admin_settings_after_real_signin', () => panelState(panel), isAdmin, 90_000);
        await openSection(panel, 'Appearance');
        await click(panel, 'theme', 'Theme');
        await click(panel, 'option', 'Dark');
        await waitFor(
          'dark_theme_visible',
          () => panelState(panel),
          (s) => s?.theme === 'Dark',
        );
        await waitFor(
          'dark_theme_persisted',
          () => storageState(panel),
          (s) => s?.theme === 'dark',
        );
        await evaluate(
          panel,
          `(async () => {
        await chrome.storage.local.set({ [${JSON.stringify(LOCAL_KEY)}]: ${JSON.stringify(LOCAL_VALUE)} });
        await chrome.storage.session.set({ [${JSON.stringify(SESSION_KEY)}]: ${JSON.stringify(SESSION_VALUE)} });
      })()`,
        );
        stage = 'admin_fixture_ready';
        const before = await waitFor(
          'admin_storage_ready',
          () => storageState(panel),
          (s) =>
            s?.hasAccessToken &&
            s.hasUserProfile &&
            s.hasAdminFlag &&
            s.hasSettings &&
            s.theme === 'dark' &&
            s.localFixtureMatches &&
            s.sessionFixtureMatches,
        );
        evidence.steps.push(
          'Real admin identity, Dark preference, and disposable local/session fixtures observed',
        );

        stage = 'reset_cancel';
        await openSection(panel, 'Data & reset');
        await click(panel, 'button', 'Clear local data on this device');
        await waitFor(
          'admin_reset_dialog',
          () => panelState(panel),
          (s) => s?.dialog,
        );
        await click(panel, 'dialog', 'Cancel');
        await waitFor(
          'admin_cancel_closed_dialog',
          () => panelState(panel),
          (s) => !s?.dialog,
        );
        assert.equal(
          isAdmin(await panelState(panel)),
          true,
          'Cancel must preserve signed-in admin',
        );
        const afterCancel = await storageState(panel);
        assert.equal(
          afterCancel.hasAccessToken &&
            afterCancel.hasUserProfile &&
            afterCancel.hasAdminFlag &&
            afterCancel.theme === 'dark' &&
            afterCancel.localFixtureMatches &&
            afterCancel.sessionFixtureMatches,
          true,
          'Cancel must preserve auth and fixture values',
        );
        assert.deepEqual(
          before.localKeys.filter((key) => !afterCancel.localKeys.includes(key)),
          [],
          'Cancel must not remove any preexisting local key',
        );
        assert.deepEqual(
          before.sessionKeys.filter((key) => !afterCancel.sessionKeys.includes(key)),
          [],
          'Cancel must not remove any preexisting session key',
        );
        evidence.steps.push(
          'Cancel preserved admin UI, auth, preference, fixture, and prior storage keys',
        );

        evidence.reset_confirm = {
          dialog_reopened: false,
          confirm_click_completed: false,
          storage_read_attempts: 0,
          storage_read_successes: 0,
        };
        stage = 'reset_confirm_open_action';
        try {
          await click(panel, 'button', 'Clear local data on this device');
        } catch (error) {
          evidence.reset_confirm.open_click_diagnostic = await resetOpenClickDiagnostic(
            panel,
            error,
          );
          throw error;
        }
        stage = 'reset_confirm_dialog_wait';
        await waitFor(
          'admin_reset_dialog_reopened',
          () => panelState(panel),
          (s) => s?.dialog,
        );
        evidence.reset_confirm.dialog_reopened = true;
        stage = 'reset_confirm_click';
        await click(panel, 'dialog', 'Clear & sign out');
        evidence.reset_confirm.confirm_click_completed = true;
        stage = 'reset_confirm_storage_wait';
        await waitFor(
          'admin_extension_storage_cleared',
          async () => {
            evidence.reset_confirm.storage_read_attempts += 1;
            const observed = await storageState(panel);
            evidence.reset_confirm.storage_read_successes += 1;
            evidence.reset_confirm.last_storage = {
              local_count: observed.localKeys.length,
              session_count: observed.sessionKeys.length,
              prior_local_overlap_count: before.localKeys.filter((key) =>
                observed.localKeys.includes(key),
              ).length,
              prior_session_overlap_count: before.sessionKeys.filter((key) =>
                observed.sessionKeys.includes(key),
              ).length,
              auth_present:
                observed.hasAccessToken || observed.hasUserProfile || observed.hasAdminFlag,
              settings_present: observed.hasSettings,
              local_fixture_present: observed.hasLocalFixture,
              session_fixture_present: observed.hasSessionFixture,
            };
            return observed;
          },
          (s) =>
            !s?.hasSettings &&
            !s.hasAccessToken &&
            !s.hasUserProfile &&
            !s.hasAdminFlag &&
            !s.hasLocalFixture &&
            !s.hasSessionFixture,
        );
        stage = 'reset_confirm_storage_snapshot';
        const after = await storageState(panel);
        evidence.reset_confirm.last_storage = {
          local_count: after.localKeys.length,
          session_count: after.sessionKeys.length,
          prior_local_overlap_count: before.localKeys.filter((key) => after.localKeys.includes(key))
            .length,
          prior_session_overlap_count: before.sessionKeys.filter((key) =>
            after.sessionKeys.includes(key),
          ).length,
          auth_present: after.hasAccessToken || after.hasUserProfile || after.hasAdminFlag,
          settings_present: after.hasSettings,
          local_fixture_present: after.hasLocalFixture,
          session_fixture_present: after.hasSessionFixture,
        };
        stage = 'reset_confirm_prior_key_check';
        assert.deepEqual(
          before.localKeys.filter((key) => after.localKeys.includes(key)),
          [],
          'Confirm must clear every preexisting local key',
        );
        assert.deepEqual(
          before.sessionKeys.filter((key) => after.sessionKeys.includes(key)),
          [],
          'Confirm must clear every preexisting session key',
        );
        stage = 'reset_confirm_signout_wait';
        await waitFor(
          'admin_signed_out',
          async () => {
            const observed = await panelState(panel);
            evidence.reset_confirm.last_panel = {
              sign_in_visible: observed.signIn,
              sign_out_visible: observed.signOut,
              advanced_visible: observed.advanced,
              admin_email_visible: observed.emailIsAdmin,
              admin_role_visible: observed.roleIsAdmin,
            };
            return observed;
          },
          (s) => s?.signIn && !s.signOut && !s.advanced && !s.emailIsAdmin && !s.roleIsAdmin,
        );
        evidence.steps.push(
          'Confirm removed prior extension local/session keys and signed out in Settings',
        );

        stage = 'reset_reload';
        await panel.send('Page.reload', { ignoreCache: true });
        await waitFor(
          'guest_after_reload',
          () => panelState(panel),
          (s) => s?.signIn && !s.signOut,
        );
        await click(panel, 'title', 'Settings');
        await openSection(panel, 'Account');
        await openSection(panel, 'Appearance');
        await waitFor(
          'guest_defaults_after_reload',
          () => panelState(panel),
          (s) =>
            s?.settings &&
            s.signIn &&
            !s.signOut &&
            !s.advanced &&
            !s.emailIsAdmin &&
            s.theme === 'System',
        );
        const reloaded = await storageState(panel);
        assert.equal(
          reloaded.hasAccessToken ||
            reloaded.hasUserProfile ||
            reloaded.hasAdminFlag ||
            reloaded.hasSettings ||
            reloaded.hasLocalFixture ||
            reloaded.hasSessionFixture,
          false,
        );
        assert.deepEqual(
          before.localKeys.filter(
            (key) => !REGENERATED_LOCAL_KEYS.has(key) && reloaded.localKeys.includes(key),
          ),
          [],
          'Reload must not restore any prior non-regenerated local key',
        );
        assert.deepEqual(
          before.sessionKeys.filter(
            (key) => !REGENERATED_SESSION_KEYS.has(key) && reloaded.sessionKeys.includes(key),
          ),
          [],
          'Reload must not restore any prior non-regenerated session key',
        );
        evidence.steps.push(
          'Panel reload remained guest and showed System theme; prior non-regenerated keys stayed absent',
        );
      } finally {
        await web.close();
      }
    },
  });
  assert.equal(result.verified, true);
  evidence.build.extension_id = result.extensionId;
  evidence.status = 'pass';
  stage = 'complete';
  await writeFile(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write('PASS isolated_admin_reset_real_ui\n');
} catch {
  // Raw browser/auth exceptions may contain callback URLs, tokens, or entered
  // form values. Only a fixed stage/category can leave this process.
  evidence.status = 'unverified';
  evidence.failure_stage = stage;
  evidence.failure_category ??= 'stage_operation_failed';
  await writeFile(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stderr.write(`UNVERIFIED isolated_admin_reset at ${stage}\n`);
  process.exitCode = 1;
}
