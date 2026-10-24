#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signInAdminSettings } from './admin-settings-signin.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const CONFIG_PATH = join(HERE, 'auth-navigation-park-only.config.json');
const SOURCE_SHA = '4f8416948fe41fd95fb99cca39085f8ba8edeaba';
const RUN_ID = 40077251065;
const RUN_ATTEMPT = 1;
const ARTIFACT_ID = 12553484865;
const TREE_SHA256 = 'b61496f051a09f3f1852ae1dcb58768ac846ac90576160520af3d90cca7d66cc';
const VERSION = '0.2.605';
const PROVENANCE_SHA256 = 'f7f162f47465849b166de37cb7dc2ea4f79ac0f1532d167067ad0420678d2103';
const EXTENSION_ID = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const WEB_ORIGIN = 'https://www.aimatrx.com';
const EXPECTED_ADMIN = 'admin@admin.com';

const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
const expectedConfig = {
  schema_version: 1,
  provenance_receipt:
    'test-results/ci-artifacts/4f8416948fe41fd95fb99cca39085f8ba8edeaba/40077251065-1/provenance-receipt.json',
};
assert.deepEqual(config, expectedConfig, 'auth_navigation_config_unexpected');
assert.equal(process.argv.length, 2, 'auth_navigation_arguments_refused');
assert.equal(process.cwd(), REPO, 'auth_navigation_cwd_refused');

const artifactParent = join(
  REPO,
  'test-results',
  'ci-artifacts',
  SOURCE_SHA,
  `${RUN_ID}-${RUN_ATTEMPT}`,
);
const extensionDir = join(artifactParent, 'chrome-mv3');
const localDevReceiptPath = join(artifactParent, 'local-dev-receipt.json');
const provenancePath = resolve(REPO, config.provenance_receipt);
assert.equal(provenancePath, join(artifactParent, 'provenance-receipt.json'));
assert.ok(process.env.MATRX_RESOURCE_OWNER, 'auth_navigation_resource_permit_required');
execFileSync(
  process.execPath,
  [join(REPO, 'scripts/current-test-artifact.mjs'), 'import', String(RUN_ID), String(ARTIFACT_ID)],
  { cwd: REPO, stdio: 'ignore' },
);
await copyFile(
  join(REPO, 'tests/fixtures/auth-navigation-605-provenance.json'),
  provenancePath,
  constants.COPYFILE_EXCL,
);
const provenanceBytes = await readFile(provenancePath);
assert.equal(createHash('sha256').update(provenanceBytes).digest('hex'), PROVENANCE_SHA256);
const provenance = JSON.parse(provenanceBytes.toString('utf8'));
assert.equal(provenance.run?.repository, 'armanisadeghi/matrx-extend');
assert.equal(provenance.run?.head_sha, SOURCE_SHA);
assert.equal(provenance.run?.run_id, RUN_ID);
assert.equal(provenance.run?.conclusion, 'success');
assert.equal(provenance.artifact?.id, ARTIFACT_ID);
assert.equal(provenance.artifact?.api_run_id, RUN_ID);
assert.equal(provenance.artifact?.api_head_sha, SOURCE_SHA);
assert.equal(provenance.artifact?.tree_sha256, TREE_SHA256);
assert.equal(provenance.artifact?.tree_file_count, 2721);
assert.equal(provenance.build_receipts?.ci_build_provenance?.source_sha, SOURCE_SHA);
assert.equal(provenance.build_receipts?.ci_build_provenance?.run_attempt, RUN_ATTEMPT);
assert.equal(provenance.build_receipts?.ci_build_provenance?.version, VERSION);
assert.equal(provenance.build_receipts?.ci_build_provenance?.tree_sha256, TREE_SHA256);

const localDevReceipt = JSON.parse(await readFile(localDevReceiptPath, 'utf8'));
assert.equal(localDevReceipt.kind, 'local_dev_unpacked');
assert.equal(localDevReceipt.publish_state, 'not_published');
assert.equal(resolve(localDevReceipt.extensionDir), extensionDir);
assert.equal(localDevReceipt.version, VERSION);
assert.equal(localDevReceipt.treeSha256, TREE_SHA256);

const outputPath = join(REPO, 'test-results', 'auth-navigation-park-only.json');
const artifactRoot = join(REPO, 'test-results', 'auth-navigation-park-only-artifacts');
const report = {
  schema_version: 1,
  scope: 'auth navigation diagnostic only; extension sign-in is intentionally not attempted',
  status: 'unverified',
  outcome: 'not_started',
  stage: 'not_started',
  stage_history: [],
  signin_observations: {},
  navigation: [],
  artifact: {
    source_sha: SOURCE_SHA,
    run_id: RUN_ID,
    run_attempt: RUN_ATTEMPT,
    artifact_id: ARTIFACT_ID,
    version: VERSION,
    tree_sha256: TREE_SHA256,
  },
  diagnostic: {
    settings_click_intercepted: false,
    extension_auth_not_entered: false,
    raw_urls_recorded: false,
    response_bodies_recorded: false,
    credentials_recorded: false,
  },
};
const startedAt = Date.now();
const routeLabel = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== WEB_ORIGIN) return 'other_origin';
    if (url.pathname === '/login') return 'login';
    if (url.pathname === '/dashboard') return 'dashboard';
    if (url.pathname === '/api/whoami') return 'whoami';
    return 'other_path';
  } catch {
    return 'invalid_url';
  }
};
const requestFailureLabel = (value) => {
  const text = String(value ?? '');
  if (/ERR_ABORTED/.test(text)) return 'aborted';
  if (/ERR_TIMED_OUT|TIMED_OUT/.test(text)) return 'timeout';
  if (
    /ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION_RESET|CONNECTION_REFUSED)/.test(text)
  )
    return 'network';
  return text ? 'other' : 'unknown';
};
const event = (fields) => {
  if (report.navigation.length < 32)
    report.navigation.push({ elapsed_ms: Date.now() - startedAt, ...fields });
};
const observePage = (page) => {
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) event({ event: 'main_frame', route: routeLabel(frame.url()) });
  });
  page.on('requestfailed', (request) => {
    const route = routeLabel(request.url());
    if (['login', 'dashboard', 'whoami'].includes(route))
      event({
        event: 'request_failed',
        route,
        failure: requestFailureLabel(request.failure()?.errorText),
      });
  });
  page.on('response', (response) => {
    const route = routeLabel(response.url());
    if (route === 'whoami') {
      const contentType = String(response.headers()['content-type'] ?? '').toLowerCase();
      event({
        event: 'whoami_response',
        status: response.status(),
        json_content_type: contentType.includes('application/json'),
      });
    }
  });
};

async function readAdminCredentials() {
  const credentialsPath = process.env.MATRX_AUTH_NAV_CREDENTIALS_FILE;
  if (process.env.GITHUB_ACTIONS === 'true' && !credentialsPath)
    throw new Error('authorized_admin_credentials_unavailable');
  if (credentialsPath) {
    try {
      const runnerTemp = resolve(process.env.RUNNER_TEMP ?? '');
      const path = resolve(credentialsPath);
      const info = await lstat(path);
      if (
        !process.env.RUNNER_TEMP ||
        !path.startsWith(`${runnerTemp}/`) ||
        info.isSymbolicLink() ||
        !info.isFile() ||
        (info.mode & 0o077) !== 0
      )
        throw new Error('authorized_admin_credentials_unavailable');
      const values = JSON.parse(await readFile(path, 'utf8'));
      if (
        values.email !== EXPECTED_ADMIN ||
        typeof values.password !== 'string' ||
        !values.password ||
        /[\r\n]/.test(values.password)
      )
        throw new Error('authorized_admin_credentials_unavailable');
      return { email: values.email, password: values.password };
    } catch {
      throw new Error('authorized_admin_credentials_unavailable');
    }
  }
  const source = await readFile(join(homedir(), 'code', 'aidream', '.env'), 'utf8');
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
    throw new Error('authorized_admin_credentials_unavailable');
  return { email: values.AI_ADMIN_USERNAME, password: values.AI_ADMIN_PASSWORD };
}

let stopIntercepted = false;
try {
  await runNativeSidepanelQa({
    extensionDir,
    localDevReceiptPath,
    expectedRelease: localDevReceipt,
    artifactRoot,
    onStage: (value) => {
      report.harness_stage = value;
    },
    exercisePanel: async ({ page, panel, resourceAction }) => {
      const context = page.context();
      const watched = new WeakSet();
      const watch = (candidate) => {
        if (watched.has(candidate)) return;
        watched.add(candidate);
        observePage(candidate);
      };
      for (const candidate of context.pages()) watch(candidate);
      context.on('page', watch);
      const stopBeforeAnyExtensionOperation = Object.create(panel);
      Object.defineProperty(stopBeforeAnyExtensionOperation, 'send', {
        configurable: false,
        enumerable: true,
        writable: false,
        value: (...args) => {
          if (report.stage === 'admin_extension_settings_click') {
            stopIntercepted = true;
            report.diagnostic.settings_click_intercepted = true;
            const stop = new Error('AUTH_NAVIGATION_DIAGNOSTIC_STOP_BEFORE_EXTENSION_OPERATION');
            stop.name = 'AuthNavigationDiagnosticStop';
            throw stop;
          }
          return panel.send(...args);
        },
      });
      const stage = (value) => {
        report.stage = value;
        report.stage_history.push(value);
      };
      try {
        await signInAdminSettings({
          page,
          panel: stopBeforeAnyExtensionOperation,
          report,
          stage,
          resourceAction,
          readCredentials: readAdminCredentials,
        });
        throw new Error('auth_navigation_diagnostic_unexpectedly_continued');
      } catch (error) {
        const expectedStop =
          stopIntercepted &&
          report.stage === 'admin_extension_settings_click' &&
          error?.message === 'admin_extension_settings_click_failed' &&
          report.signin_observations.web_dashboard_reached === true &&
          report.signin_observations.web_identity_parked === true &&
          !report.stage_history.some((value) =>
            [
              'admin_extension_account_open',
              'admin_extension_signin_ready',
              'admin_extension_click',
              'admin_extension_auth_completion',
            ].includes(value),
          );
        if (!expectedStop) throw error;
        report.diagnostic.extension_auth_not_entered = true;
        report.outcome = 'whoami_park_reached_controlled_stop_before_extension_operation';
      } finally {
        context.off('page', watch);
      }
    },
  });
  assert.equal(report.signin_observations.web_dashboard_reached, true);
  assert.equal(report.signin_observations.web_identity_parked, true);
  assert.equal(report.diagnostic.settings_click_intercepted, true);
  assert.equal(report.diagnostic.extension_auth_not_entered, true);
  report.status = 'diagnostic_observed';
} catch (error) {
  const safeMessage = String(error?.message ?? '');
  const navigationCategory =
    /^admin_web_identity_park_navigation_(timeout|interrupted|aborted|target_closed|network|other)_failed$/.exec(
      safeMessage,
    )?.[1];
  report.status = 'unverified';
  report.outcome = navigationCategory
    ? `whoami_park_navigation_${navigationCategory}`
    : 'runner_or_auth_step_unverified';
  report.failure_stage = report.stage;
}
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`AUTH_NAVIGATION_DIAGNOSTIC ${report.status} ${report.outcome}\n`);
if (report.status !== 'diagnostic_observed') process.exitCode = 1;
