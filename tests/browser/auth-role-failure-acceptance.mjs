#!/usr/bin/env node
/** Native Chrome D29 role-read failure and same-account recovery. Root owns the guarded launch. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const EXTENSION = join(REPO, '.output/chrome-mv3-dev');
const RECEIPT = process.env.AUTH_FAILURE_DEV_BUILD_RECEIPT;
const OUTPUT = join(REPO, 'test-results/auth-role-failure-acceptance.json');
const ADMIN_ENV = join(homedir(), 'code/aidream/.env');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const EMAIL = 'admin@admin.com';
const ROLE_KEY = 'matrx.user.isAdmin';
const PROFILE_KEY = 'matrx.user.profile';
const DEV_ENV = join(REPO, '.env.development');
let stage = 'receipt';
const report = {
  schema_version: 1,
  case_id: 'EXT-F-1015-T35',
  defect_id: 'EXT-D-0029',
  status: 'unverified',
  scope:
    'real admin login; panel role-read network failure; worker-readable gate; same-account retry',
  build: null,
  observations: {},
  limits: [
    'Chrome role-read transport failure only; Safari callback/cancellation is separate.',
    'Does not exercise simultaneous storage set/remove failure or cross-context write races (T39).',
    'Does not prove a real member-role transition or server-side role revocation.',
  ],
};

function fail(code) {
  report.failure_code = code;
  throw new Error('auth_role_failure_unverified');
}

async function buildIdentity() {
  if (!RECEIPT) fail('dev_receipt_required');
  const [receipt, manifest, pkg] = await Promise.all([
    readFile(RECEIPT, 'utf8').then(JSON.parse),
    readFile(join(EXTENSION, 'manifest.json'), 'utf8').then(JSON.parse),
    readFile(join(REPO, 'package.json'), 'utf8').then(JSON.parse),
  ]);
  requireLocalDevReceipt(receipt, EXTENSION);
  assert.equal(receipt.version, pkg.version);
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.key, 'stable development extension identity');
  assert.equal(hashReleaseTree(EXTENSION), receipt.treeSha256);
  return { kind: receipt.kind, version: receipt.version, treeSha256: receipt.treeSha256 };
}

async function adminCredentials() {
  const source = await readFile(ADMIN_ENV, 'utf8').catch(() => fail('credential_file_unreadable'));
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const found = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
    if (!found) continue;
    const value = found[2];
    values[found[1]] = /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
  if (values.AI_ADMIN_USERNAME !== EMAIL || !values.AI_ADMIN_PASSWORD)
    fail('admin_credentials_unavailable');
  return values;
}

async function supabaseOrigin() {
  const source = await readFile(DEV_ENV, 'utf8').catch(() => fail('development_env_unreadable'));
  const line = source.split(/\r?\n/).find((entry) => /^WXT_SUPABASE_URL=/.test(entry));
  if (!line) fail('supabase_origin_unavailable');
  let url;
  try {
    url = new URL(line.slice('WXT_SUPABASE_URL='.length).replace(/^['"]|['"]$/g, ''));
  } catch {
    fail('supabase_origin_invalid');
  }
  if (url.protocol !== 'https:' || url.pathname !== '/') fail('supabase_origin_invalid');
  return url.origin;
}

async function realAdminLogin(page, panel) {
  const web = await page.context().newPage();
  try {
    stage = 'web_login';
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const location = new URL(web.url());
    if (location.origin !== WEB_ORIGIN || location.pathname !== '/login') fail('web_login_origin');
    const credentials = await adminCredentials();
    await web.locator('input[name="email"]').fill(credentials.AI_ADMIN_USERNAME);
    await web.locator('input[name="password"]').fill(credentials.AI_ADMIN_PASSWORD);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    report.observations.web_dashboard = true;
    stage = 'extension_login';
    await click(panel, 'title', 'Settings');
    await openSection(panel, 'Account');
    await click(panel, 'button', 'Sign in');
    await waitFor(
      'real_admin_role',
      () => accountState(panel),
      (s) => s.admin,
      90_000,
    );
  } finally {
    await web.close();
  }
}

async function accountState(panel) {
  return evaluate(
    panel,
    `(() => {
    const section = [...document.querySelectorAll('button[aria-expanded]')]
      .find((button) => button.textContent.trim() === 'Account');
    const content = section?.parentElement?.nextElementSibling;
    const row = (label) => [...(content?.querySelectorAll('span') ?? [])]
      .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
    const buttons = [...document.querySelectorAll('button')];
    const labels = buttons.map((button) => button.textContent.trim());
    const roleAlert = [...document.querySelectorAll('[role="alert"]')].find((alert) =>
      [...alert.querySelectorAll('span')].some((span) => span.textContent.trim() ===
        'Could not check admin access. Try again to retry this account check.'));
    const roleRetryCount = [...(roleAlert?.querySelectorAll('button') ?? [])]
      .filter((button) => button.textContent.trim() === 'Try again' && !button.disabled).length;
    const email = row('Email') === 'Email${EMAIL}';
    const role = row('Role')?.toLowerCase() === 'roleadmin';
    return { email, role, admin: email && role && labels.includes('Sign out') &&
      labels.includes('Advanced agent capabilities'),
      advanced: labels.includes('Advanced agent capabilities'),
      roleAlert: !!roleAlert,
      roleRetryCount,
      allRetryCount: buttons.filter((button) => button.textContent.trim() === 'Try again').length };
  })()`,
  );
}

async function workerGate(attachWorker) {
  const worker = await attachWorker();
  try {
    const response = await worker.send('Runtime.evaluate', {
      expression: `(async () => (await chrome.storage.local.get(${JSON.stringify(ROLE_KEY)}))[${JSON.stringify(ROLE_KEY)}] === true)()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails || typeof response.result?.value !== 'boolean')
      fail('worker_gate_read_failed');
    return response.result.value;
  } finally {
    await worker.detach();
  }
}

async function verifiedAccountId(panel) {
  const id = await evaluate(
    panel,
    `(async () => {
    const profile = (await chrome.storage.local.get(${JSON.stringify(PROFILE_KEY)}))[${JSON.stringify(PROFILE_KEY)}];
    return profile?.id ?? null;
  })()`,
  );
  if (
    typeof id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  )
    fail('verified_account_id_unavailable');
  return id;
}

async function armRoleFailure(panel, origin, accountId) {
  let failed = 0;
  let unrelated = 0;
  let interceptionFailed = false;
  const off = panel.on('Fetch.requestPaused', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    const roleRead =
      request.method === 'GET' &&
      url.origin === origin &&
      url.pathname === '/rest/v1/admins' &&
      url.searchParams.get('select') === 'user_id' &&
      url.searchParams.get('user_id') === `eq.${accountId}` &&
      Object.entries(request.headers).some(
        ([name, value]) => name.toLowerCase() === 'accept-profile' && value === 'admin',
      );
    void panel
      .send(
        roleRead ? 'Fetch.failRequest' : 'Fetch.continueRequest',
        roleRead
          ? { requestId: event.requestId, errorReason: 'Failed' }
          : { requestId: event.requestId },
      )
      .then(() => {
        if (roleRead) failed += 1;
        else unrelated += 1;
      })
      .catch(() => {
        interceptionFailed = true;
      });
  });
  await panel.send('Fetch.enable', {
    patterns: [{ urlPattern: `${origin}/rest/v1/admins*`, requestStage: 'Request' }],
  });
  return {
    state: () => ({ failed, unrelated, interceptionFailed }),
    stop: async () => {
      try {
        await panel.send('Fetch.disable');
      } finally {
        off();
      }
    },
  };
}

try {
  const before = await buildIdentity();
  report.build = { before, after: null };
  stage = 'owned_profile';
  const native = await runNativeSidepanelQa({
    extensionDir: EXTENSION,
    expectedRelease: before,
    localDevReceiptPath: RECEIPT,
    exercisePanel: async ({ page, panel, attachWorker }) => {
      await realAdminLogin(page, panel);
      const initial = await accountState(panel);
      const initialGate = await workerGate(attachWorker);
      assert.equal(initial.admin, true, 'real account has visible admin role');
      assert.equal(initialGate, true, 'background gate starts from verified admin');
      report.observations.initial = { admin: initial.admin, worker_gate: initialGate };

      stage = 'role_read_failure';
      const fault = await armRoleFailure(
        panel,
        await supabaseOrigin(),
        await verifiedAccountId(panel),
      );
      try {
        await panel.send('Page.reload', { ignoreCache: true });
        await waitFor(
          'actual_role_request_failed',
          fault.state,
          (s) => s.failed > 0 && !s.interceptionFailed,
          30_000,
        );
        await waitFor(
          'auth_error_after_role_failure',
          () => accountState(panel),
          (s) => s.roleAlert && s.roleRetryCount === 1 && s.allRetryCount === 1 && !s.advanced,
          30_000,
        );
        await click(panel, 'title', 'Settings');
        await openSection(panel, 'Account');
        const failedUi = await accountState(panel);
        const failedGate = await workerGate(attachWorker);
        assert.equal(failedUi.email, true, 'same signed-in account survives role read failure');
        assert.equal(failedUi.role, false, 'unverified role is absent from UI');
        assert.equal(failedUi.advanced, false, 'admin controls are absent');
        assert.equal(
          failedUi.roleAlert && failedUi.roleRetryCount === 1 && failedUi.allRetryCount === 1,
          true,
          'failure is visible and retryable',
        );
        assert.equal(failedGate, false, 'background gate closes after failed role read');
        report.observations.failure = {
          injected_role_requests: fault.state().failed,
          unrelated_role_requests_continued: fault.state().unrelated,
          same_account: failedUi.email,
          admin_role_visible: failedUi.role,
          admin_controls_visible: failedUi.advanced,
          role_retry_visible: failedUi.roleRetryCount === 1,
          role_error_visible: failedUi.roleAlert,
          worker_gate: failedGate,
        };
      } finally {
        await fault.stop();
      }

      stage = 'same_account_recovery';
      await click(panel, 'button', 'Try again');
      await waitFor(
        'admin_recovered_after_real_retry',
        () => accountState(panel),
        (s) => s.admin && !s.roleAlert,
        60_000,
      );
      const recovered = await accountState(panel);
      const recoveredGate = await workerGate(attachWorker);
      assert.equal(recovered.email && recovered.role && recovered.advanced, true);
      assert.equal(recoveredGate, true, 'verified admin restores worker gate');
      report.observations.recovery = {
        same_account: recovered.email,
        admin_role_visible: recovered.role,
        worker_gate: recoveredGate,
      };
    },
  });
  report.extension_id = native.extensionId;
  report.build.after = await buildIdentity();
  assert.deepEqual(report.build.after, before, 'build artifact unchanged through native test');
  report.status = 'pass';
  stage = 'complete';
} catch {
  report.status = 'unverified';
  report.failure_stage = stage;
  report.failure_code ??= 'stage_operation_failed';
  process.exitCode = 1;
} finally {
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `${report.status === 'pass' ? 'PASS' : 'UNVERIFIED'} auth_role_failure_native\n`,
  );
}
