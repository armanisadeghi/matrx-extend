#!/usr/bin/env node
/**
 * EXT-F-1003-T57: fresh Chrome optional-permission denial in the real admin
 * Settings side panel. Root admits this headed, disposable-profile run.
 *
 * On PAUSED, an independent UI operator observes Chrome's native permission
 * prompt, clicks Deny through CUA, then writes only "denied" to the ack file
 * named in stdout. The runner never simulates a permission decision.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
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
const PERMISSION = 'pageCapture';
const TITLE = 'Page archive (MHTML)';
let stage = 'not_started';
const evidence = {
  schema_version: 1,
  case_id: 'EXT-F-1003-T57',
  status: 'unverified',
  profile: 'new owned disposable headed Chrome profile',
  login: 'real web form and extension Settings Sign in',
  native_choice: 'independent CUA operator must observe and click Deny',
  response_interception: false,
  injected_auth_session: false,
};

function fail(category) {
  evidence.failure_category = category;
  throw new Error('permission_denial_unverified');
}

async function credentials() {
  let raw;
  try { raw = await readFile(ADMIN_ENV, 'utf8'); }
  catch { fail('credential_source_unavailable'); }
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const found = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
    if (!found) continue;
    let value = found[2];
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[found[1]] = value;
  }
  if (values.AI_ADMIN_USERNAME !== EMAIL || !values.AI_ADMIN_PASSWORD)
    fail('credential_variables_unavailable');
  return values;
}

async function signInOnWeb(page) {
  const web = await page.context().newPage();
  try {
    stage = 'web_login';
    await web.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const location = new URL(web.url());
    if (location.origin !== WEB || location.pathname !== '/login') fail('web_login_route_unavailable');
    const secret = await credentials();
    await web.locator('input[name="email"]').fill(secret.AI_ADMIN_USERNAME);
    await web.locator('input[name="password"]').fill(secret.AI_ADMIN_PASSWORD);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB && url.pathname === '/dashboard', { timeout: 90_000 }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    evidence.web_login_reached_dashboard = true;
    return web;
  } catch {
    await web.close();
    fail('real_web_login_failed');
  }
}

async function state(panel) {
  return evaluate(panel, `(async () => {
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
  })()`);
}

async function clickPermission(panel) {
  const target = await evaluate(panel, `(() => {
    const title = ${JSON.stringify(TITLE)};
    const rows = [...document.querySelectorAll('label')]
      .filter((el) => el.textContent.includes(title) && el.textContent.includes('pageCapture'));
    if (rows.length !== 1) return { count: rows.length };
    const sw = rows[0].querySelector('[role="switch"]');
    if (!sw || sw.disabled) return { count: rows.length, ready: false };
    sw.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = sw.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { count: rows.length, ready: rect.width > 0 && rect.height > 0 &&
      x >= 0 && x < innerWidth && y >= 0 && y < innerHeight &&
      (hit === sw || sw.contains(hit)), x, y };
  })()`);
  if (target?.count !== 1 || !target.ready) fail('permission_switch_not_hittable');
  await panel.send('Input.dispatchMouseEvent',
    { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  await panel.send('Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
}

async function waitForNativeDeny() {
  stage = 'native_deny';
  process.stdout.write(`PAUSED native Chrome prompt: CUA operator clicks Deny, then writes denied to ${ACK}\n`);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    let acknowledged;
    try { acknowledged = (await readFile(ACK, 'utf8')).trim(); } catch {}
    if (acknowledged === 'denied') {
      await rm(ACK, { force: true });
      evidence.native_deny_operator_acknowledged = true;
      return;
    }
    if (acknowledged) fail('native_ack_invalid');
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  fail('native_deny_not_acknowledged');
}

try {
  stage = 'prepare';
  await rm(ACK, { force: true });
  const receipt = JSON.parse(await readFile(join(REPO, '.output', 'release-receipt.json'), 'utf8'));
  evidence.build = { version: receipt.version, source_sha: receipt.sourceSha,
    tree_sha256: receipt.treeSha256 };
  const result = await runNativeSidepanelQa({
    headed: true,
    exercisePanel: async ({ page, panel }) => {
      stage = 'guest_settings';
      await click(panel, 'title', 'Settings');
      await openSection(panel, 'Account');
      const web = await signInOnWeb(page);
      try {
        stage = 'extension_signin';
        await click(panel, 'button', 'Sign in');
        await waitFor('real_admin_settings', () => state(panel), (s) => s?.admin, 90_000);
        await openSection(panel, 'Advanced agent capabilities');
        const before = await state(panel);
        evidence.before = before;
        assert.equal(before.admin && before.declared && before.row_count === 1 &&
          !before.switch_on && !before.contains && !before.get_all, true);
        stage = 'permission_request_click';
        await clickPermission(panel);
        await waitForNativeDeny();
        stage = 'denial_result';
        const after = await waitFor('native_refusal_ui', () => state(panel),
          (s) => s?.refusal_alert && !s.switch_on && !s.contains && !s.get_all, 10_000);
        evidence.after = after;
        assert.equal(after.admin && after.declared && after.row_count === 1, true);
      } finally { await web.close(); }
    },
  });
  evidence.extension_id = result.extensionId;
  evidence.status = 'pass';
  stage = 'complete';
  process.stdout.write('PASS isolated_native_permission_denial\n');
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
