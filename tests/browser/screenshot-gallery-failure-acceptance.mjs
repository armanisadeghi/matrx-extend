#!/usr/bin/env node
/** EXT-F-1009-T08: a real gallery list failure stays visible until Refresh recovers. */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3-dev');
const RECEIPT = resolve(REPO, process.env.SCREENSHOT_GALLERY_DEV_BUILD_RECEIPT ?? '');
const OUTPUT = join(REPO, 'test-results', `screenshot-gallery-failure-${randomUUID()}.json`);
const PRIVATE_CONFIG = join(REPO, 'test-results', 'd22-private-config.json');
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const report = {
  schema_version: 1,
  feature: 'EXT-F-1009-T08',
  scope: 'warm admin; one failed real list GET; visible error; Refresh to owned empty page',
  status: 'unverified',
};
let stage = 'build_identity';
function fail(code) {
  report.failure = { stage, code };
  throw new Error(code);
}
function canonical(url) {
  const parsed = new URL(url);
  return `${parsed.host.toLowerCase().replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`;
}
function safeFailure(error) {
  return {
    timeout: error?.name === 'TimeoutError',
    assertion: error?.code === 'ERR_ASSERTION',
    pointerCode: /^pointer_[a-z_]+$/.test(error?.driverFailure?.code ?? '')
      ? error.driverFailure.code
      : null,
  };
}
async function buildIdentity() {
  if (
    !process.env.SCREENSHOT_GALLERY_DEV_BUILD_RECEIPT ||
    dirname(RECEIPT) !== join(REPO, 'test-results')
  )
    fail('explicit_receipt_path_required');
  const [receipt, manifest, pkg] = await Promise.all([
    readFile(RECEIPT, 'utf8').then(JSON.parse),
    readFile(join(EXTENSION_DIR, 'manifest.json'), 'utf8').then(JSON.parse),
    readFile(join(REPO, 'package.json'), 'utf8').then(JSON.parse),
  ]);
  requireLocalDevReceipt(receipt, EXTENSION_DIR);
  if (
    !manifest.key ||
    manifest.version !== pkg.version ||
    manifest.version !== receipt.version ||
    hashReleaseTree(EXTENSION_DIR) !== receipt.treeSha256
  )
    fail('dev_build_identity_mismatch');
  return { kind: receipt.kind, version: receipt.version, treeSha256: receipt.treeSha256 };
}
async function approvedOrganization() {
  const stat = await lstat(PRIVATE_CONFIG).catch(() => fail('approved_config_missing'));
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) fail('approved_config_not_private');
  const name = JSON.parse(await readFile(PRIVATE_CONFIG, 'utf8'))?.approved_organization_name;
  if (typeof name !== 'string' || !name.trim() || name !== name.trim())
    fail('approved_organization_missing');
  return name;
}
async function signIn(page, panel) {
  stage = 'admin_signin';
  await click(panel, 'title', 'Settings');
  await openSection(panel, 'Account');
  const web = await page.context().newPage();
  try {
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (new URL(web.url()).origin !== WEB_ORIGIN || new URL(web.url()).pathname !== '/login')
      fail('login_route_unverified');
    const values = {};
    for (const line of (await readFile(ADMIN_ENV, 'utf8')).split(/\r?\n/)) {
      const match = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    if (values.AI_ADMIN_USERNAME !== 'admin@admin.com' || !values.AI_ADMIN_PASSWORD)
      fail('admin_credentials_unavailable');
    await web.locator('input[name="email"]').fill('admin@admin.com');
    await web.locator('input[name="password"]').fill(values.AI_ADMIN_PASSWORD);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    await click(panel, 'button', 'Sign in');
    await waitFor(
      'admin_identity',
      () =>
        evaluate(
          panel,
          `(() => document.querySelectorAll('button[title="admin@admin.com"]').length)()`,
        ),
      (count) => count === 1,
      90_000,
    );
  } finally {
    await web.close();
  }
}
async function selectOrganization(panel, approved) {
  stage = 'select_approved_organization';
  await click(panel, 'title', 'Settings');
  const states = await evaluate(
    panel,
    `(() => [...document.querySelectorAll('button[aria-expanded]')]
    .filter(el => el.textContent.trim()==='Account').map(el => el.getAttribute('aria-expanded')))()`,
  );
  if (states?.length !== 1) fail('account_section_not_unique');
  if (states[0] === 'true') await click(panel, 'section', 'Account');
  await waitFor(
    'account_collapsed',
    () =>
      evaluate(
        panel,
        `(() => [...document.querySelectorAll('button[aria-expanded]')]
    .find(el => el.textContent.trim()==='Account')?.getAttribute('aria-expanded'))()`,
      ),
    (value) => value === 'false',
  );
  await openSection(panel, 'Organization');
  await click(panel, 'organization', 'Acting as');
  const count = await evaluate(
    panel,
    `(() => [...document.querySelectorAll('[role="option"]')]
    .filter(el => el.textContent.trim()===${JSON.stringify(approved)}).length)()`,
  );
  if (count !== 1) fail('approved_option_not_unique');
  await click(panel, 'option', approved);
  await waitFor(
    'approved_organization_selected',
    () =>
      evaluate(
        panel,
        `(async () => {
    const row=[...document.querySelectorAll('span')].find(el => el.textContent.trim()==='Acting as');
    const controls=[...(row?.parentElement?.parentElement?.querySelectorAll('button[role="combobox"]')??[])];
    const active=(await chrome.storage.local.get('matrx.org.active'))['matrx.org.active'];
    return controls.length===1 && controls[0].textContent.trim()===${JSON.stringify(approved)} &&
      active?.name===${JSON.stringify(approved)} && typeof active?.id==='string';
  })()`,
      ),
    (value) => value === true,
    30_000,
  );
}
function listRequest(request, expected) {
  try {
    const url = new URL(request?.url);
    return (
      request?.method === 'GET' &&
      url.pathname.endsWith('/wbx_screenshot') &&
      url.searchParams.get('page_url_canonical') === `eq.${expected}`
    );
  } catch {
    return false;
  }
}
async function watchReads(panel, expected) {
  await panel.send('Network.enable');
  const reads = new Map();
  let screenshotWrites = 0;
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    try {
      const url = new URL(request?.url);
      if (url.pathname.endsWith('/wbx_screenshot') && request?.method !== 'GET') screenshotWrites++;
    } catch {
      /* Other browser traffic carries no proof. */
    }
    if (listRequest(request, expected))
      reads.set(requestId, { requestId, status: null, failed: false, rows: null });
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const entry = reads.get(requestId);
    if (entry) entry.status = response?.status ?? null;
  });
  const offFailed = panel.on('Network.loadingFailed', ({ requestId }) => {
    const entry = reads.get(requestId);
    if (entry) entry.failed = true;
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    const entry = reads.get(requestId);
    if (!entry || entry.status !== 200) return;
    void panel
      .send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) => {
        const rows = JSON.parse(
          base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body,
        );
        if (Array.isArray(rows) && rows.every((row) => row.page_url_canonical === expected))
          entry.rows = rows;
      })
      .catch(() => {
        /* An unreadable response cannot establish recovery. */
      });
  });
  return {
    marker: () => reads.size,
    after: (marker) => [...reads.values()].slice(marker),
    writeCount: () => screenshotWrites,
    stop: () => {
      offRequest();
      offResponse();
      offFailed();
      offFinished();
    },
  };
}
async function gallery(panel, expected) {
  return evaluate(
    panel,
    `(() => {
    const tabs=[...document.querySelectorAll('button[role="tab"][title="Screenshots"]')];
    const tab=tabs.length===1?tabs[0]:null;
    const pane=tab?.getAttribute('aria-controls')?document.getElementById(tab.getAttribute('aria-controls')):null;
    const active=!!pane && pane.matches('[role="tabpanel"][data-state="active"]') && pane.getBoundingClientRect().height>0;
    const text=pane?.innerText??'';
    const refresh=pane?.querySelector('button[title="Refresh"]');
    const cards=pane?.querySelectorAll('button[title="Open in Files"]').length??0;
    const canonical=[...(pane?.querySelectorAll('span[title]')??[])].filter(el => el.title===${JSON.stringify(expected)}).length;
    return {active,selected:tab?.getAttribute('aria-selected')==='true',linked:pane?.getAttribute('aria-labelledby')===tab?.id,
      canonical:canonical===1,refresh:!!refresh&&!refresh.disabled,error:text.includes("Couldn't load screenshots"),
      empty:text.includes('No screenshots yet'),loading:!!pane?.querySelector('svg.animate-spin'),cards};
  })()`,
  );
}
async function exercise({ page, panel }) {
  let server;
  let journal;
  let offPaused;
  let fetchEnabled = false;
  try {
    const approved = await approvedOrganization();
    await signIn(page, panel);
    await selectOrganization(panel, approved);
    server = createServer((_request, response) =>
      response
        .writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        })
        .end(
          '<!doctype html><title>Harbor Dental appointment guide</title><h1>Appointment guide</h1>',
        ),
    );
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', done);
    });
    const fixtureUrl = `http://127.0.0.1:${server.address().port}/harbor-dental/appointment-guide/${randomUUID()}`;
    const expected = canonical(fixtureUrl);
    stage = 'owned_fixture_navigation';
    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
    if (page.url() !== fixtureUrl || (await page.title()) !== 'Harbor Dental appointment guide')
      fail('owned_fixture_unverified');
    journal = await watchReads(panel, expected);
    stage = 'initial_real_empty_read';
    const initialMarker = journal.marker();
    await click(panel, 'title', 'Screenshots');
    await waitFor(
      'initial_real_zero_rows',
      () => journal.after(initialMarker),
      (reads) =>
        reads.length === 1 &&
        reads[0].status === 200 &&
        Array.isArray(reads[0].rows) &&
        reads[0].rows.length === 0,
      30_000,
    );
    await waitFor(
      'initial_owned_empty_ui',
      () => gallery(panel, expected),
      (state) =>
        state.active &&
        state.selected &&
        state.linked &&
        state.canonical &&
        state.refresh &&
        state.empty &&
        !state.error &&
        state.cards === 0,
      30_000,
    );

    // Fail only the exact gallery GET once. Every other paused request continues unchanged.
    stage = 'targeted_list_failure';
    let injected = 0;
    let injectedNetworkId = null;
    let interceptError = false;
    offPaused = panel.on('Fetch.requestPaused', (event) => {
      const targeted = listRequest(event.request, expected) && injected === 0;
      if (targeted) {
        injected++;
        injectedNetworkId = event.networkId ?? null;
      }
      void panel
        .send(
          targeted ? 'Fetch.failRequest' : 'Fetch.continueRequest',
          targeted
            ? { requestId: event.requestId, errorReason: 'Failed' }
            : { requestId: event.requestId },
        )
        .catch(() => {
          interceptError = true;
        });
    });
    await panel.send('Fetch.enable', {
      patterns: [{ urlPattern: '*://*/wbx_screenshot*', requestStage: 'Request' }],
    });
    fetchEnabled = true;
    const failureMarker = journal.marker();
    await click(panel, 'title', 'Refresh');
    await waitFor(
      'failed_real_list_get',
      () => ({ reads: journal.after(failureMarker), injected, interceptError }),
      (state) =>
        !state.interceptError &&
        state.injected === 1 &&
        state.reads.length === 1 &&
        state.reads[0].failed &&
        state.reads[0].requestId === injectedNetworkId,
      30_000,
    );
    if (!injectedNetworkId || interceptError) fail('targeted_failure_unverified');
    stage = 'visible_gallery_error';
    await waitFor(
      'real_failure_visible_in_gallery',
      () => gallery(panel, expected),
      (state) =>
        state.active &&
        state.selected &&
        state.linked &&
        state.canonical &&
        state.refresh &&
        state.error &&
        !state.empty &&
        state.cards === 0,
      30_000,
    );
    offPaused();
    offPaused = null;
    await panel.send('Fetch.disable');
    fetchEnabled = false;

    stage = 'refresh_retry_real_empty_read';
    const recoveryMarker = journal.marker();
    await click(panel, 'title', 'Refresh');
    await waitFor(
      'recovery_real_zero_rows',
      () => journal.after(recoveryMarker),
      (reads) =>
        reads.length === 1 &&
        reads[0].status === 200 &&
        Array.isArray(reads[0].rows) &&
        reads[0].rows.length === 0,
      30_000,
    );
    stage = 'refresh_recovered_empty_ui';
    await waitFor(
      'recovery_owned_empty_ui',
      () => gallery(panel, expected),
      (state) =>
        state.active &&
        state.selected &&
        state.linked &&
        state.canonical &&
        state.refresh &&
        state.empty &&
        !state.error &&
        !state.loading &&
        state.cards === 0,
      30_000,
    );
    if (journal.writeCount() !== 0 || injected !== 1)
      fail('unexpected_screenshot_write_or_extra_injection');
    report.evidence = {
      ownedFixtureRealEmptyRead: true,
      oneMatchingListGetFailedAtNetwork: true,
      galleryErrorVisible: true,
      trustedRefreshIssuedNewRealGet: true,
      recoveryStatus: 200,
      recoveredZeroRows: true,
      recoveredEmptyUi: true,
      screenshotWrites: 0,
    };
    report.status = 'pass';
  } finally {
    offPaused?.();
    if (fetchEnabled) await panel.send('Fetch.disable').catch(() => {});
    journal?.stop();
    if (server) await new Promise((done) => server.close(done));
  }
}

try {
  const before = await buildIdentity();
  report.build = { version: before.version, treeSha256: before.treeSha256 };
  stage = 'owned_native_profile';
  const run = await runNativeSidepanelQa({
    extensionDir: EXTENSION_DIR,
    expectedRelease: before,
    localDevReceiptPath: RECEIPT,
    exercisePanel: exercise,
  });
  assert.equal(run.verified, true);
  stage = 'build_end';
  const after = await buildIdentity();
  if (after.version !== before.version || after.treeSha256 !== before.treeSha256)
    fail('dev_build_changed_during_run');
  report.profileOwned = true;
} catch (error) {
  report.status = 'unverified';
  report.failure ??= { stage, code: 'owned_harness_or_ui_stage_failed' };
  report.failure.diagnostic ??= safeFailure(error);
}
await mkdir(dirname(OUTPUT), { recursive: true, mode: 0o700 });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
process.stdout.write(`${report.status.toUpperCase()} screenshot_gallery_failure\n`);
if (report.status !== 'pass') process.exitCode = 1;
