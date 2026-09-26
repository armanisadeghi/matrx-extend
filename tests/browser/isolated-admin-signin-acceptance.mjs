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
const WEB_ORIGIN = 'https://aimatrx.com';
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const EXPECTED_ADMIN = 'admin@admin.com';

let stage = 'not_started';
const evidence = {
  schema_version: 1,
  scope: 'fresh owned Chrome profile; real Matrx web login and extension Settings sign-in',
  status: 'unverified',
  web: null,
  extension: null,
  limitations: ['OAuth callback origin is not directly observed by this runner.'],
};

// Read only the two authorized test-account variables at the moment the real
// web form needs them. The values stay local to the login function.
async function readAdminCredentials() {
  const source = await readFile(ADMIN_ENV, 'utf8');
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
    throw new Error('isolated_admin_credentials_unavailable');
  return { email: values.AI_ADMIN_USERNAME, password: values.AI_ADMIN_PASSWORD };
}

function safeLocation(rawUrl) {
  const url = new URL(rawUrl);
  return `${url.origin}${url.pathname}`;
}

async function signInOnRealWebPage(page) {
  const web = await page.context().newPage();
  try {
    stage = 'web_login_page';
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    assert.equal(new URL(web.url()).origin, WEB_ORIGIN);
    assert.equal(new URL(web.url()).pathname, '/login');
    const { email, password } = await readAdminCredentials();
    stage = 'web_login_submit';
    await web.locator('input[name="email"]').fill(email);
    await web.locator('input[name="password"]').fill(password);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard',
        { timeout: 90_000 }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
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
    return { emailRow: row('Email'), roleRow: row('Role'),
      signIn: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Sign in'),
      signOut: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Sign out'),
      advanced: document.body?.innerText.includes('Advanced agent capabilities') ?? false };
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
      stage = 'extension_signin';
      await click(panel, 'button', 'Sign in');
      await waitFor('admin_settings_after_real_signin', () => accountState(panel),
        (state) => state?.emailRow === `Email${EXPECTED_ADMIN}` &&
          state.roleRow?.toLowerCase() === 'roleadmin' && state.signOut && state.advanced,
        90_000);
      const admin = await accountState(panel);
      evidence.extension = {
        guestBefore: true,
        signedInAs: EXPECTED_ADMIN,
        adminRoleVisible: admin.roleRow?.toLowerCase() === 'roleadmin',
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
  await writeFile(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stderr.write(`UNVERIFIED isolated_admin_signin at ${stage}\n`);
  process.exitCode = 1;
}
