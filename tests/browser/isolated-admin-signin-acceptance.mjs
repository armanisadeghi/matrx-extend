#!/usr/bin/env node
/**
 * Real web login followed by real extension Settings sign-in in one owned,
 * receipt-verified disposable Chrome profile. Never writes credentials,
 * auth URLs, network bodies, browser storage, or console output to evidence.
 * The root resource guard owns execution and the resulting native review.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'isolated-admin-signin-acceptance.json');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const EXPECTED_ADMIN = 'admin@admin.com';

let stage = 'not_started';
const evidence = {
  schema_version: 1,
  scope: 'fresh owned Chrome profile; real Matrx web login and extension Settings sign-in',
  status: 'unverified',
  web: null,
  extension: null,
  failureCategory: null,
  limitations: ['OAuth callback origin is not directly observed by this runner.'],
};

function fail(category) {
  evidence.failureCategory = category;
  throw new Error('isolated_admin_signin_unverified');
}

// Read only the two authorized test-account variables at the moment the real
// web form needs them. The values stay local to the login function.
async function readAdminCredentials() {
  let source;
  try {
    source = await readFile(ADMIN_ENV, 'utf8');
  } catch (error) {
    fail(error?.code === 'ENOENT' ? 'credential_file_missing' :
      error?.code === 'EACCES' ? 'credential_file_denied' : 'credential_file_unreadable');
  }
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  if (values.AI_ADMIN_USERNAME !== EXPECTED_ADMIN || !values.AI_ADMIN_PASSWORD)
    fail('credential_variables_unavailable');
  return { email: values.AI_ADMIN_USERNAME, password: values.AI_ADMIN_PASSWORD };
}

function safeLocation(rawUrl) {
  const url = new URL(rawUrl);
  return `${url.origin}${url.pathname}`;
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
    stage = 'web_url_check';
    const observed = new URL(web.url());
    evidence.web = { signedIn: false, location: safeLocation(web.url()) };
    if (observed.origin !== WEB_ORIGIN) fail('web_origin_mismatch');
    if (observed.pathname !== '/login') fail('web_login_path_mismatch');
    stage = 'credential_file_read';
    const { email, password } = await readAdminCredentials();
    stage = 'web_form_fill';
    try {
      await web.locator('input[name="email"]').fill(email);
      await web.locator('input[name="password"]').fill(password);
    } catch {
      fail('web_form_unavailable');
    }
    stage = 'web_login_submit';
    try {
      await Promise.all([
        web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard',
          { timeout: 90_000 }),
        web.getByRole('button', { name: 'Sign in', exact: true }).click(),
      ]);
    } catch {
      evidence.web = { signedIn: false, location: safeLocation(web.url()) };
      fail('web_login_did_not_reach_dashboard');
    }
    // The app login form performs a hard redirect after real server sign-in.
    // Preserve only origin/path; query or hash may contain sensitive material.
    evidence.web = { signedIn: true, location: safeLocation(web.url()) };
    return web;
  } catch {
    await web.close();
    throw new Error('real_web_login_unverified');
  }
}

async function accountState(panel) {
  return evaluate(panel, `(() => {
    const account = [...document.querySelectorAll('button[aria-expanded]')]
      .find((button) => button.textContent.trim() === 'Account');
    const section = account?.parentElement?.nextElementSibling;
    const row = (label) => [...(section?.querySelectorAll('span') ?? [])]
      .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
    const emailRow = row('Email'), roleRow = row('Role');
    const buttons = [...document.querySelectorAll('button')];
    const signIn = buttons.find((button) => button.textContent.trim() === 'Sign in');
    const retry = buttons.find((button) => button.textContent.trim() === 'Try again');
    return {
      accountPresent: Boolean(account),
      accountExpanded: account?.getAttribute('aria-expanded') ?? null,
      emailRowPresent: emailRow !== null,
      expectedEmailMatch: emailRow === 'Email${EXPECTED_ADMIN}',
      roleRowPresent: roleRow !== null,
      adminRoleMatch: roleRow?.toLowerCase() === 'roleadmin',
      signIn: Boolean(signIn),
      signInDisabled: signIn?.disabled ?? false,
      signOut: buttons.some((button) => button.textContent.trim() === 'Sign out'),
      advanced: buttons.some((button) => button.textContent.trim() === 'Advanced agent capabilities'),
      authErrorPresent: Boolean(document.querySelector('[role="alert"]')),
      authRetryPresent: Boolean(retry),
      authRetryDisabled: retry?.disabled ?? false,
      loadingIndicatorPresent: Boolean(document.querySelector('[role="progressbar"], [aria-busy="true"]')),
    };
  })()`);
}

try {
  stage = 'owned_profile';
  const result = await runNativeSidepanelQa({ exercisePanel: async ({ page, panel }) => {
    stage = 'guest_settings';
    await click(panel, 'title', 'Settings');
    await openSection(panel, 'Account');
    const guest = await accountState(panel);
    assert.equal(guest.signIn, true);
    assert.equal(guest.signOut, false);
    assert.equal(guest.advanced, false);

    const web = await signInOnRealWebPage(page);
    try {
      stage = 'extension_signin_click';
      await click(panel, 'button', 'Sign in');
      stage = 'extension_admin_wait';
      evidence.extension = { guestBefore: true, lastObserved: null };
      try {
        await waitFor('admin_settings_after_real_signin', async () => {
          try {
            const observed = await accountState(panel);
            evidence.extension.lastObserved = observed;
            return observed;
          } catch {
            evidence.extension.observationReadFailed = true;
            throw new Error('safe_account_observation_failed');
          }
        },
          (state) => state?.expectedEmailMatch && state.adminRoleMatch &&
            state.signOut && state.advanced,
          90_000);
      } catch {
        fail('extension_admin_state_not_observed');
      }
      const admin = await accountState(panel);
      evidence.extension = {
        guestBefore: true,
        signedInAs: EXPECTED_ADMIN,
        adminRoleVisible: admin.adminRoleMatch,
        advancedCapabilitiesVisible: admin.advanced,
        signOutVisible: admin.signOut,
      };
    } finally {
      await web.close();
    }
  } });
  evidence.extension.extensionId = result.extensionId;
  evidence.status = 'pass';
  stage = 'complete';
  await writeFile(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write('PASS isolated_admin_signin_real_ui\n');
} catch {
  // No raw exception: browser/auth errors can contain redirect URLs, tokens,
  // entered form values, request bodies, or console content.
  evidence.status = 'unverified';
  evidence.failureStage = stage;
  evidence.failureCategory ??= 'stage_operation_failed';
  await writeFile(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stderr.write(`UNVERIFIED isolated_admin_signin at ${stage}\n`);
  process.exitCode = 1;
}
