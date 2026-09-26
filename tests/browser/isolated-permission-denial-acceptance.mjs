#!/usr/bin/env node
/**
 * EXT-F-1003-T56–T59: fresh Chrome optional-permission denial in the real admin
 * Settings side panel. Root admits this headed, disposable-profile run.
 *
 * On PAUSED, an independent UI operator clicks the real Settings switch,
 * observes Chrome's native permission prompt, clicks Deny through CUA, then
 * writes only "denied" to the ack file named in stdout. The ACK only resumes
 * the runner; it is not native UI proof.
 * Root must combine separate CUA evidence with this runner's postconditions.
 */
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'isolated-permission-denial-acceptance.json');
const ACK = join(REPO, 'test-results', 'isolated-permission-denial-native-ack.txt');
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const WEB = 'https://www.aimatrx.com';
const EMAIL = 'admin@admin.com';
const TARGETS = Object.freeze({
  cookies: { title: 'Cookies', caseId: 'EXT-F-1003-T56' },
  pageCapture: { title: 'Page archive (MHTML)', caseId: 'EXT-F-1003-T57' },
  clipboardRead: { title: 'Clipboard read', caseId: 'EXT-F-1003-T58' },
  tabCapture: { title: 'Tab video capture', caseId: 'EXT-F-1003-T59' },
});
const PERMISSION = process.env.MATRX_PERMISSION_DENIAL_TARGET ?? 'pageCapture';
const TARGET = Object.hasOwn(TARGETS, PERMISSION) ? TARGETS[PERMISSION] : null;
const TITLE = TARGET?.title;
let stage = 'not_started';
const evidence = {
  schema_version: 1,
  case_id: TARGET?.caseId ?? null,
  permission: TARGET ? PERMISSION : null,
  status: 'unverified',
  profile: 'new owned disposable headed Chrome profile',
  login: 'real web form and extension Settings Sign in',
  native_choice: 'independent CUA operator must observe and click Deny',
  evidence_boundary: 'ACK is coordination only; native UI evidence is recorded separately',
  response_interception: false,
  injected_auth_session: false,
  auth_readiness: {
    stage: 'not_started',
    guest: null,
    before_click: null,
    click_completed: false,
    last_observed: null,
    observation_read_failed: false,
  },
};

function advance(next) {
  stage = next;
  evidence.auth_readiness.stage = next;
}

function fail(category) {
  evidence.failure_category = category;
  throw new Error('permission_denial_unverified');
}

async function credentials() {
  let raw;
  try {
    raw = await readFile(ADMIN_ENV, 'utf8');
  } catch {
    fail('credential_source_unavailable');
  }
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const found = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
    if (!found) continue;
    let value = found[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    values[found[1]] = value;
  }
  if (values.AI_ADMIN_USERNAME !== EMAIL || !values.AI_ADMIN_PASSWORD)
    fail('credential_variables_unavailable');
  return values;
}

async function signInOnWeb(page) {
  const web = await page.context().newPage();
  try {
    advance('web_login_navigation');
    await web.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    advance('web_login_location');
    const location = new URL(web.url());
    evidence.auth_readiness.web_origin_match = location.origin === WEB;
    evidence.auth_readiness.web_login_path_match = location.pathname === '/login';
    if (location.origin !== WEB || location.pathname !== '/login')
      fail('web_login_route_unavailable');
    advance('credential_file_read');
    const secret = await credentials();
    evidence.auth_readiness.credentials_available = true;
    advance('web_form_fill');
    await web.locator('input[name="email"]').fill(secret.AI_ADMIN_USERNAME);
    await web.locator('input[name="password"]').fill(secret.AI_ADMIN_PASSWORD);
    advance('web_dashboard_wait');
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    evidence.web_login_reached_dashboard = true;
    advance('web_dashboard_reached');
    return web;
  } catch {
    await web.close();
    fail(evidence.failure_category ?? 'real_web_login_failed');
  }
}

async function authState(panel) {
  return evaluate(
    panel,
    `(() => {
      const account = [...document.querySelectorAll('button[aria-expanded]')]
        .find((el) => el.textContent.trim() === 'Account');
      const content = account?.parentElement?.nextElementSibling;
      const row = (label) => [...(content?.querySelectorAll('span') ?? [])]
        .find((el) => el.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
      const buttons = [...document.querySelectorAll('button')];
      const signIn = buttons.find((el) => el.textContent.trim() === 'Sign in');
      return {
        account_present: !!account,
        account_expanded: account?.getAttribute('aria-expanded') === 'true',
        email_row_present: row('Email') !== null,
        expected_email_match: row('Email') === 'Email${EMAIL}',
        role_row_present: row('Role') !== null,
        admin_role_match: row('Role')?.toLowerCase() === 'roleadmin',
        sign_in_present: !!signIn,
        sign_in_disabled: signIn?.disabled ?? false,
        sign_out_present: buttons.some((el) => el.textContent.trim() === 'Sign out'),
        advanced_present: buttons.some((el) => el.textContent.trim() === 'Advanced agent capabilities'),
        auth_alert_present: !!document.querySelector('[role="alert"]'),
        retry_present: buttons.some((el) => el.textContent.trim() === 'Try again'),
        loading_present: !!document.querySelector('[role="progressbar"], [aria-busy="true"]'),
      };
    })()`,
  );
}

async function state(panel) {
  return evaluate(
    panel,
    `(async () => {
    const permission = ${JSON.stringify(PERMISSION)};
    const title = ${JSON.stringify(TITLE)};
    const account = [...document.querySelectorAll('button[aria-expanded]')]
      .find((el) => el.textContent.trim() === 'Account');
    const accountBody = account?.parentElement?.nextElementSibling?.textContent ?? '';
    const row = [...document.querySelectorAll('label')]
      .find((el) => el.textContent.includes(title) && el.textContent.includes(permission));
    const sw = row?.querySelector('[role="switch"]');
    const manifest = chrome.runtime.getManifest();
    const contains = await chrome.permissions.contains({ permissions: [permission] });
    const granted = (await chrome.permissions.getAll()).permissions ?? [];
    const alert = [...document.querySelectorAll('[role="alert"]')]
      .some((el) => el.textContent.includes('Chrome did not grant ' + title));
    return {
      admin: accountBody.includes(${JSON.stringify(EMAIL)}) &&
        /Role\\s*admin/i.test(accountBody) &&
        [...document.querySelectorAll('button')].some((el) => el.textContent.trim() === 'Sign out'),
      declared: manifest.optional_permissions?.includes(permission) === true,
      row_count: [...document.querySelectorAll('label')]
        .filter((el) => el.textContent.includes(title) && el.textContent.includes(permission)).length,
      switch_on: sw?.getAttribute('data-state') === 'checked' ||
        sw?.getAttribute('aria-checked') === 'true',
      contains, get_all: granted.includes(permission), refusal_alert: alert,
    };
  })()`,
  );
}

async function waitForNativeDeny() {
  stage = 'native_deny';
  process.stdout.write(
    `PAUSED at real admin Settings: CUA operator clicks ${TITLE} switch, records native prompt and Deny evidence, then writes denied to ${ACK}\n`,
  );
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    let acknowledged;
    try {
      acknowledged = (await readFile(ACK, 'utf8')).trim();
    } catch {}
    if (acknowledged === 'denied') {
      await rm(ACK, { force: true });
      evidence.native_decision_ack_received = true;
      return;
    }
    if (acknowledged) fail('native_ack_invalid');
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  fail('native_deny_not_acknowledged');
}

try {
  advance('prepare');
  if (!TARGET) fail('target_not_allowlisted');
  await rm(ACK, { force: true });
  const receipt = JSON.parse(await readFile(join(REPO, '.output', 'release-receipt.json'), 'utf8'));
  evidence.build = {
    version: receipt.version,
    source_sha: receipt.sourceSha,
    tree_sha256: receipt.treeSha256,
  };
  const result = await runNativeSidepanelQa({
    headed: true,
    exercisePanel: async ({ page, panel }) => {
      advance('guest_settings');
      await click(panel, 'title', 'Settings');
      await openSection(panel, 'Account');
      evidence.auth_readiness.guest = await authState(panel);
      const web = await signInOnWeb(page);
      try {
        advance('extension_signin_ready');
        evidence.auth_readiness.before_click = await authState(panel);
        if (!evidence.auth_readiness.before_click?.sign_in_present)
          fail('extension_signin_control_unavailable');
        advance('extension_signin_click');
        await click(panel, 'button', 'Sign in');
        evidence.auth_readiness.click_completed = true;
        advance('extension_admin_wait');
        await waitFor(
          'real_admin_settings',
          async () => {
            try {
              const observed = await authState(panel);
              evidence.auth_readiness.last_observed = observed;
              return observed;
            } catch {
              evidence.auth_readiness.observation_read_failed = true;
              throw new Error('safe_auth_observation_failed');
            }
          },
          (s) =>
            s?.expected_email_match &&
            s.admin_role_match &&
            s.sign_out_present &&
            s.advanced_present,
          90_000,
        );
        advance('extension_admin_observed');
        await openSection(panel, 'Advanced agent capabilities');
        const before = await state(panel);
        evidence.before = before;
        assert.equal(
          before.admin &&
            before.declared &&
            before.row_count === 1 &&
            !before.switch_on &&
            !before.contains &&
            !before.get_all &&
            !before.refusal_alert,
          true,
        );
        await waitForNativeDeny();
        advance('denial_result');
        const after = await waitFor(
          'native_refusal_ui',
          () => state(panel),
          (s) => s?.refusal_alert && !s.switch_on && !s.contains && !s.get_all,
          10_000,
        );
        evidence.after = after;
        assert.equal(after.admin && after.declared && after.row_count === 1, true);
        advance('sidepanel_reload');
        await panel.send('Page.reload', { ignoreCache: true });
        await waitFor(
          'sidepanel_ready_after_reload',
          () =>
            evaluate(
              panel,
              `(() => ({ ready: document.readyState === 'complete',
                settings: [...document.querySelectorAll('button[title]')]
                  .some((el) => el.title === 'Settings') }))()`,
            ),
          (s) => s?.ready && s.settings,
          30_000,
        );
        advance('settings_after_reload');
        await click(panel, 'title', 'Settings');
        await openSection(panel, 'Account');
        await openSection(panel, 'Advanced agent capabilities');
        const reloaded = await waitFor(
          'permission_absent_after_reload',
          () => state(panel),
          (s) =>
            s?.admin &&
            s.declared &&
            s.row_count === 1 &&
            !s.switch_on &&
            !s.contains &&
            !s.get_all,
          30_000,
        );
        evidence.after_reload = reloaded;
      } finally {
        await web.close();
      }
    },
  });
  evidence.extension_id = result.extensionId;
  evidence.status = 'postconditions_verified_requires_operator_evidence';
  advance('complete');
  process.stdout.write(
    'POSTCONDITIONS_VERIFIED_REQUIRES_OPERATOR_EVIDENCE isolated_native_permission_denial\n',
  );
} catch {
  evidence.status = 'unverified';
  evidence.failure_stage = stage;
  evidence.failure_category ??= 'stage_operation_failed';
  process.stderr.write(`UNVERIFIED isolated_native_permission_denial at ${stage}\n`);
  process.exitCode = 1;
} finally {
  await rm(ACK, { force: true });
  await writeFile(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}
