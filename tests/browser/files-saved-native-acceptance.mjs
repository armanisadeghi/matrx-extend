#!/usr/bin/env node
/**
 * Bounded native Files / Saved captures acceptance for EXT-D-0064 and EXT-D-0065.
 * The root resource guard owns execution. No auth state is injected into Chrome.
 * Two already test-owned Sources must be named in the private config; this runner
 * reads them but never deletes or mutates pre-existing rows.
 *
 * FILES_SAVED_RELEASE_RECEIPT=/absolute/frozen-receipt.json \
 * FILES_SAVED_EXPECTED_TREE_SHA256=<root-provided-sha256> \
 * FILES_SAVED_PRIVATE_CONFIG=/absolute/private-config.json \
 * node tests/browser/files-saved-native-acceptance.mjs
 * Set FILES_SAVED_FIXTURE_MODE=create with the same receipt/config to save two
 * owned demo Sources first. After D65, set FILES_SAVED_FIXTURE_MODE=cleanup to
 * delete only that pair, checking each detail's Source link against its ID.
 */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const LOCAL_DEV_RECEIPT = process.env.FILES_SAVED_DEV_BUILD_RECEIPT;
const RELEASE_RECEIPT = process.env.FILES_SAVED_RELEASE_RECEIPT;
const RECEIPT = RELEASE_RECEIPT ?? LOCAL_DEV_RECEIPT;
const EXPECTED_TREE_SHA256 = process.env.FILES_SAVED_EXPECTED_TREE_SHA256;
const CONFIG = process.env.FILES_SAVED_PRIVATE_CONFIG;
const ROLE = process.env.FILES_SAVED_ROLE ?? 'admin';
const FIXTURE_MODE = process.env.FILES_SAVED_FIXTURE_MODE ?? null;
const ADMIN_ENV = join(homedir(), 'code/aidream/.env');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const LANDING_ORIGIN = 'https://server.app.matrxserver.com';
const DEMO_PAGES = {
  A: 'https://example.com/',
  B: 'https://www.iana.org/domains/reserved',
};
const OUTPUT = join(REPO, 'test-results/files-saved-native-acceptance.json');
const FIXTURE_OUTPUT = join(REPO, 'docs/stabilization/reports/saved-capture-fixture-20261001.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let stage = 'preflight';
let fixtureStep = null;
const report = {
  schema_version: 1,
  status: 'unverified',
  role: ROLE,
  build: null,
  cases: { guest: 'unverified', D64: 'unverified', D65: 'unverified' },
  observations: {},
  source_scope: 'two configured, already test-owned Sources; read-only; no cleanup needed',
  failure_stage: null,
  failure_code: null,
};

function fail(code) {
  report.failure_stage = stage;
  report.failure_code = code;
  throw new Error(`files_saved_native_${code}`);
}

// Content-free diagnostics only: never retain exception messages, remote URLs,
// DOM text, credentials, or arbitrary browser stack frames.
function safeFixtureFailure(error) {
  const names = [
    'Error',
    'TypeError',
    'ReferenceError',
    'SyntaxError',
    'RangeError',
    'TimeoutError',
  ];
  const codes = [
    'pointer_initial_evaluation_failed',
    'pointer_page_sample_failed',
    'pointer_target_not_unique',
    'pointer_followup_evaluation_failed',
    'pointer_stable_hit_not_observed',
    'pointer_press_dispatch_failed',
    'pointer_release_dispatch_failed',
  ];
  const driver = error?.driverFailure;
  const driverFailure = driver
    ? {
        code: codes.includes(driver.code) ? driver.code : 'unknown',
        matchedTargetCount: Number.isInteger(driver.matchedTargetCount)
          ? driver.matchedTargetCount
          : null,
        visibleMatchCount: Number.isInteger(driver.visibleMatchCount)
          ? driver.visibleMatchCount
          : null,
        hitTarget: driver.hitTarget === true,
        targetDisabled: typeof driver.targetDisabled === 'boolean' ? driver.targetDisabled : null,
        animating: driver.animating === true,
        stableSamples: Number.isInteger(driver.stableSamples) ? driver.stableSamples : null,
      }
    : null;
  const frames = [];
  for (const line of String(error?.stack ?? '')
    .split('\n')
    .slice(1)) {
    // Only known local runner/driver/harness locations, excluding function names.
    const match =
      /\/(files-saved-native-acceptance|settings-panel-driver|native-sidepanel-qa-harness)\.mjs:(\d+):(\d+)\)?$/.exec(
        line,
      );
    if (match)
      frames.push({
        file: `tests/browser/${match[1]}.mjs`,
        line: Number(match[2]),
        column: Number(match[3]),
      });
  }
  return {
    step: fixtureStep,
    error_name: names.includes(error?.name) ? error.name : 'unknown',
    stack_frames: frames,
    driverFailure,
  };
}

async function scrapeCaptureReadiness(panel) {
  return evaluate(
    panel,
    `(() => {
    const tab = document.querySelector('button[role="tab"][title="Scrape"][data-state="active"]');
    const root = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
    const buttons = [...(root?.querySelectorAll('button[title="Capture the page exactly as it is right now"]') ?? [])];
    const visible = (el) => {
      const r = el.getBoundingClientRect(), style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && !el.closest('[inert]');
    };
    const visibleButtons = buttons.filter(visible);
    return {
      active: Boolean(tab && root?.matches('[role="tabpanel"][data-state="active"]')),
      captureTargetCount: buttons.length,
      visibleCaptureTargetCount: visibleButtons.length,
      enabled: visibleButtons.length === 1 && !visibleButtons[0].disabled,
      globalCaptureTextCount: [...document.querySelectorAll('button')]
        .filter(el => el.textContent.trim() === 'Capture').length,
      globalVisibleCaptureTextCount: [...document.querySelectorAll('button')]
        .filter(el => el.textContent.trim() === 'Capture' && visible(el)).length,
    };
  })()`,
  );
}

async function privateConfig() {
  if (!CONFIG) fail('private_config_required');
  const stat = await lstat(CONFIG).catch(() => fail('private_config_missing'));
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) fail('private_config_mode');
  const value = JSON.parse(await readFile(CONFIG, 'utf8'));
  if (
    typeof value.approved_organization_name !== 'string' ||
    !value.approved_organization_name.trim() ||
    !UUID.test(value.approved_organization_id)
  )
    fail('approved_organization_identity_missing');
  if (value.source_a || value.source_b) {
    for (const key of ['source_a', 'source_b']) {
      const source = value[key];
      if (
        !source ||
        !UUID.test(source.id) ||
        typeof source.title !== 'string' ||
        !source.title.trim()
      )
        fail(`${key}_not_configured`);
      if (
        source.test_owned !== true ||
        source.landing_proof?.processed_document_id !== source.id ||
        source.landing_proof?.reused_existing !== false ||
        source.landing_proof?.new_version_of !== null ||
        source.landing_proof?.pre_save_matching_rows !== 0 ||
        source.landing_proof?.requested_identity !== source.url ||
        source.landing_proof?.requested_organization_id !== value.approved_organization_id
      )
        fail(`${key}_ownership_unproven`);
    }
    if (value.source_a.id === value.source_b.id || value.source_a.title === value.source_b.title)
      fail('source_pair_not_distinct');
  }
  return value;
}

async function existingSourceCount(panel, origin, publishableKey, organizationId, identity) {
  const result = await evaluate(
    panel,
    `(async () => {
    const token = (await chrome.storage.local.get('matrx.auth.accessToken'))['matrx.auth.accessToken'];
    if (!token) return { error: 'no_session' };
    const query = new URL(${JSON.stringify(`${origin}/rest/v1/processed_documents`)});
    query.searchParams.set('select', 'id');
    query.searchParams.set('organization_id', ${JSON.stringify(`eq.${organizationId}`)});
    query.searchParams.set('canonical_identity', ${JSON.stringify(`eq.${identity}`)});
    const response = await fetch(query, { headers: {
      apikey: ${JSON.stringify(publishableKey)}, Authorization: 'Bearer ' + token,
      'Accept-Profile': 'docproc',
    }, cache: 'no-store' });
    if (!response.ok) return { error: 'read_refused', status: response.status };
    const rows = await response.json();
    return { count: Array.isArray(rows) ? rows.length : null };
  })()`,
  );
  if (result?.count !== 0) fail('fixture_identity_not_proven_absent');
  return result.count;
}

function captureLandingReceipt(panel, origin, identity, organizationId) {
  let receipt = null;
  let error = null;
  let seen = 0;
  let settled = false;
  const off = panel.on('Fetch.requestPaused', (event) => {
    const url = new URL(event.request.url);
    if (
      url.origin !== origin ||
      url.pathname !== '/sources/land' ||
      event.request.method !== 'POST'
    ) {
      void panel.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => {
        error = 'unrelated_request_resume_failed';
      });
      return;
    }
    seen++;
    void (async () => {
      try {
        const postData =
          event.request.postData ??
          (event.networkId
            ? (await panel.send('Network.getRequestPostData', { requestId: event.networkId }))
                .postData
            : null);
        const request = JSON.parse(postData ?? '{}');
        const { body, base64Encoded } = await panel.send('Fetch.getResponseBody', {
          requestId: event.requestId,
        });
        const landed = JSON.parse(
          base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body,
        );
        receipt = {
          http_status: event.responseStatusCode,
          requested_identity: request.canonical_identity,
          requested_organization_id: request.organization_id,
          processed_document_id: landed.processed_document_id ?? null,
          reused_existing: landed.reused_existing,
          new_version_of: landed.new_version_of ?? null,
          pre_save_matching_rows: 0,
          captured_at: new Date().toISOString(),
        };
        if (
          seen !== 1 ||
          receipt.http_status < 200 ||
          receipt.http_status >= 300 ||
          receipt.requested_identity !== identity ||
          receipt.requested_organization_id !== organizationId ||
          !UUID.test(receipt.processed_document_id) ||
          receipt.reused_existing !== false ||
          landed.new_version_of != null
        )
          error = 'landing_not_new_exact_source';
      } catch {
        error = 'landing_receipt_unreadable';
      } finally {
        await panel.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => {
          error = 'landing_response_resume_failed';
        });
        settled = true;
      }
    })();
  });
  return {
    start: async () => {
      await panel.send('Network.enable');
      await panel.send('Fetch.enable', {
        patterns: [{ urlPattern: `${origin}/sources/land`, requestStage: 'Response' }],
      });
    },
    read: () => ({ receipt, error, seen, settled }),
    stop: async () => {
      await panel.send('Fetch.disable').catch(() => {});
      off();
    },
  };
}

// These are public demo/reference pages; the runner never rewrites their content.
async function createDemoSource(
  page,
  panel,
  variant,
  runId,
  fixture,
  saveReceipt,
  origin,
  publishableKey,
) {
  stage = `fixture_${variant}`;
  const candidate = new URL(DEMO_PAGES[variant]);
  candidate.searchParams.set('matrx_fixture', `${runId}-${variant}`);
  const url = candidate.href;
  fixtureStep = 'public_page_navigation';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (page.url() !== url) fail('fixture_public_page_redirected');
  fixtureStep = 'public_page_identity';
  const title = await page.title();
  if (!title.trim()) fail('fixture_public_page_title_missing');
  const identity = url;
  fixtureStep = 'pre_save_identity_absent';
  await existingSourceCount(panel, origin, publishableKey, fixture.organization_id, identity);
  fixtureStep = 'public_page_foreground';
  await page.bringToFront();
  fixtureStep = 'open_scrape';
  await click(panel, 'title', 'Scrape');
  fixtureStep = 'capture_readiness_before';
  const readiness = { before: await scrapeCaptureReadiness(panel), after: null };
  report.observations[`fixture_${variant}_capture_readiness`] = readiness;
  fixture.capture_readiness ??= {};
  fixture.capture_readiness[variant] = readiness;
  fixtureStep = 'capture_control_ready';
  // Scrape is lazy-loaded behind Suspense. Observe its mounted, enabled
  // control before asking the trusted driver to resolve a pointer target.
  readiness.after = await waitFor(
    'fixture_capture_control_ready',
    () => scrapeCaptureReadiness(panel),
    (state) =>
      state?.active === true &&
      state.captureTargetCount === 1 &&
      state.visibleCaptureTargetCount === 1 &&
      state.enabled === true,
    45_000,
  );
  fixtureStep = 'capture_click';
  await click(panel, 'title', 'Capture the page exactly as it is right now');
  fixtureStep = 'capture_result_ready';
  await waitFor(
    'fixture_capture_ready',
    () =>
      evaluate(
        panel,
        `(() => {
      const tab = document.querySelector('button[role="tab"][title="Scrape"]');
      const root = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
      return [...(root?.querySelectorAll('button') ?? [])].some(b => b.textContent.trim() === 'Save');
    })()`,
      ),
    Boolean,
    45_000,
  );
  const landing = captureLandingReceipt(panel, LANDING_ORIGIN, identity, fixture.organization_id);
  fixtureStep = 'landing_receipt_listener';
  await landing.start();
  try {
    fixtureStep = 'save_click';
    await click(panel, 'button-text', 'Save');
    fixtureStep = 'landing_receipt_wait';
    const captured = await waitFor(
      'fixture_landing_receipt',
      landing.read,
      (state) => state.settled === true,
      60_000,
    );
    if (captured.receipt) {
      const source = {
        id: captured.receipt.processed_document_id,
        title,
        url,
        created_at: captured.receipt.captured_at,
        run_id: runId,
        test_owned: captured.error === null,
        landing_proof: captured.receipt,
        created_via: 'native Scrape Capture and Save UI',
      };
      fixture.sources.push(source);
      fixtureStep = 'landing_receipt_persist';
      await saveReceipt();
    }
    if (captured.error) fail(captured.error);
  } finally {
    await landing.stop();
  }
  fixtureStep = 'saved_source_ui_ready';
  await waitFor(
    'fixture_source_saved',
    () =>
      evaluate(
        panel,
        `(() => {
      const tab = document.querySelector('button[role="tab"][title="Scrape"]');
      const root = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
      return [...(root?.querySelectorAll('button') ?? [])].some(b =>
        b.textContent.trim() === 'Open this Source (opens in the web app)');
    })()`,
      ),
    Boolean,
    60_000,
  );
  fixtureStep = 'saved_source_link_open';
  const opened = page.context().waitForEvent('page', { timeout: 15_000 });
  await click(panel, 'button-text', 'Open this Source (opens in the web app)');
  const sourcePage = await opened;
  fixtureStep = 'saved_source_link_identity';
  await sourcePage.waitForURL((target) => target.pathname.startsWith('/knowledge/sources/'), {
    timeout: 15_000,
  });
  const sourceUrl = new URL(sourcePage.url());
  const id = /^\/knowledge\/sources\/([0-9a-f-]{36})$/i.exec(sourceUrl.pathname)?.[1];
  await sourcePage.close();
  if (
    sourceUrl.protocol !== 'https:' ||
    !['aimatrx.com', 'www.aimatrx.com'].includes(sourceUrl.hostname) ||
    !UUID.test(id)
  )
    fail('fixture_source_link_invalid');
  const source = fixture.sources.at(-1);
  if (source.id !== id) fail('fixture_ui_link_landing_id_mismatch');
  return source;
}

async function createFixturePair(page, panel, config, build, origin, publishableKey) {
  if (ROLE !== 'admin' || config.source_a || config.source_b)
    fail('fixture_requires_empty_admin_pair');
  const backend = await evaluate(
    panel,
    `(async () => {
    const saved = await chrome.storage.local.get(['matrx.backend.env', 'matrx.backend.urlOverride']);
    return { env: saved['matrx.backend.env'] ?? null,
      override: saved['matrx.backend.urlOverride'] ?? null };
  })()`,
  );
  if (backend.env !== null && backend.env !== 'prod') fail('fixture_backend_not_production');
  if (backend.override !== null && backend.override !== '')
    fail('fixture_backend_override_present');
  const previous = JSON.parse(await readFile(FIXTURE_OUTPUT, 'utf8'));
  if (
    previous.sources?.length &&
    (previous.status !== 'cleaned' ||
      previous.sources.some((source) => !previous.deleted_source_ids?.includes(source.id)))
  )
    fail('fixture_prior_sources_require_review');
  const runId = `saved-capture-fixture-${randomUUID()}`;
  const fixture = {
    schema_version: 1,
    status: 'creating',
    build: { version: build.version, tree_sha256: build.treeSha256 },
    organization_id: config.approved_organization_id,
    run_id: runId,
    source_scope: 'two test-owned public demo/reference pages saved through native Scrape UI',
    sources: [],
    cleanup:
      'Delete only the exact Source IDs recorded here through Saved captures UI after D65 retest.',
  };
  const saveReceipt = async () =>
    writeFile(FIXTURE_OUTPUT, `${JSON.stringify(fixture, null, 2)}\n`);
  await saveReceipt();
  try {
    for (const variant of ['A', 'B']) {
      await createDemoSource(
        page,
        panel,
        variant,
        runId,
        fixture,
        saveReceipt,
        origin,
        publishableKey,
      );
    }
    if (fixture.sources[0].id === fixture.sources[1].id) fail('fixture_ids_not_distinct');
    await click(panel, 'title', 'Saved captures');
    await waitFor(
      'fixture_pair_visible_in_saved_captures',
      () => sourceListState(panel, fixture.sources[0], fixture.sources[1]),
      (state) => state.active && state.hasA && state.hasB,
      45_000,
    );
    fixture.saved_captures_list_visible = true;
    config.source_a = fixture.sources[0];
    config.source_b = fixture.sources[1];
    await writeFile(CONFIG, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    fixture.status = 'created';
    await saveReceipt();
    report.observations.fixture = 'created_via_native_scrape_ui';
  } catch (error) {
    fixture.status = 'partial_requires_exact_id_review';
    fixture.failure_stage = stage;
    fixture.failure_diagnostic = safeFixtureFailure(error);
    await saveReceipt();
    throw error;
  }
}

async function cleanupFixturePair(page, panel, config) {
  if (ROLE !== 'admin') fail('cleanup_requires_admin');
  const fixture = JSON.parse(await readFile(FIXTURE_OUTPUT, 'utf8'));
  if (
    !['created', 'partial_requires_exact_id_review'].includes(fixture.status) ||
    fixture.organization_id !== config.approved_organization_id ||
    ![1, 2].includes(fixture.sources?.length) ||
    (config.source_a && fixture.sources[0].id !== config.source_a.id) ||
    (config.source_b && fixture.sources[1]?.id !== config.source_b.id) ||
    (fixture.status === 'created' && (!config.source_a || !config.source_b)) ||
    fixture.sources.some(
      (source) =>
        source.test_owned !== true ||
        source.run_id !== fixture.run_id ||
        source.landing_proof?.processed_document_id !== source.id ||
        source.landing_proof?.pre_save_matching_rows !== 0 ||
        source.landing_proof?.reused_existing !== false ||
        source.landing_proof?.new_version_of !== null ||
        source.landing_proof?.requested_organization_id !== fixture.organization_id ||
        source.landing_proof?.requested_identity !== source.url,
    )
  )
    fail('cleanup_provenance_mismatch');
  fixture.deleted_source_ids ??= [];
  await click(panel, 'title', 'Saved captures');
  for (const source of fixture.sources) {
    if (fixture.deleted_source_ids.includes(source.id)) continue;
    stage = `cleanup_${source.id}`;
    await sourceRowClick(panel, source);
    await waitFor(
      'cleanup_source_detail_visible',
      () =>
        evaluate(
          panel,
          `(() => {
        const tab = document.querySelector('button[role="tab"][title="Saved captures"]');
        const root = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
        return root?.querySelector('header .font-semibold')?.textContent.trim();
      })()`,
        ),
      (title) => title === source.title,
      30_000,
    );
    const opened = page.context().waitForEvent('page', { timeout: 15_000 });
    await click(panel, 'title', 'Opens this Source in the AI Matrx web app');
    const sourcePage = await opened;
    await sourcePage.waitForURL((target) => target.pathname.startsWith('/knowledge/sources/'), {
      timeout: 15_000,
    });
    const actualId = /^\/knowledge\/sources\/([0-9a-f-]{36})$/i.exec(
      new URL(sourcePage.url()).pathname,
    )?.[1];
    await sourcePage.close();
    if (actualId !== source.id) fail('cleanup_detail_id_mismatch');
    await trustedFeatureClick(panel, 'Saved captures', 'button', 'Back to saved captures');
    await click(panel, 'button-text', `Delete ${source.title}`);
    await click(panel, 'button-text', 'Delete');
    await waitFor(
      'cleanup_exact_source_absent',
      () =>
        evaluate(
          panel,
          `(() => {
        const tab = document.querySelector('button[role="tab"][title="Saved captures"]');
        const root = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
        return [...(root?.querySelectorAll('article > button') ?? [])]
          .some(row => row.querySelector('.font-medium')?.textContent.trim() === ${JSON.stringify(source.title)});
      })()`,
        ),
      (visible) => visible === false,
      30_000,
    );
    fixture.deleted_source_ids.push(source.id);
    await writeFile(FIXTURE_OUTPUT, `${JSON.stringify(fixture, null, 2)}\n`);
  }
  fixture.status = 'cleaned';
  await writeFile(FIXTURE_OUTPUT, `${JSON.stringify(fixture, null, 2)}\n`);
  delete config.source_a;
  delete config.source_b;
  await writeFile(CONFIG, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  report.observations.fixture = 'exact_pair_deleted_via_native_saved_captures_ui';
}

async function buildIdentity() {
  if (!RECEIPT || Boolean(LOCAL_DEV_RECEIPT) === Boolean(RELEASE_RECEIPT))
    fail('one_receipt_required');
  if (!/^[a-f0-9]{64}$/.test(EXPECTED_TREE_SHA256 ?? '')) fail('expected_tree_hash_required');
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  let extensionDir;
  if (LOCAL_DEV_RECEIPT) {
    requireLocalDevReceipt(receipt, receipt.extensionDir);
    extensionDir = receipt.extensionDir;
  } else {
    extensionDir = receipt.destinationPath;
    if (
      receipt.publishState !== 'pushed' ||
      !Array.isArray(receipt.destinationPaths) ||
      !receipt.destinationPaths.includes(extensionDir) ||
      typeof receipt.storeZip?.path !== 'string'
    )
      fail('frozen_release_receipt_refused');
  }
  if (
    receipt.treeSha256 !== EXPECTED_TREE_SHA256 ||
    hashReleaseTree(extensionDir) !== EXPECTED_TREE_SHA256
  )
    fail('build_hash_mismatch');
  return { version: receipt.version, treeSha256: receipt.treeSha256, extensionDir };
}

async function adminCredentials() {
  const source = await readFile(ADMIN_ENV, 'utf8').catch(() => fail('admin_env_unavailable'));
  const entries = {};
  for (const line of source.split(/\r?\n/)) {
    const found = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
    if (!found) continue;
    const value = found[2];
    entries[found[1]] = /^(".*"|'.*')$/.test(value) ? value.slice(1, -1) : value;
  }
  if (entries.AI_ADMIN_USERNAME !== 'admin@admin.com' || !entries.AI_ADMIN_PASSWORD)
    fail('admin_credentials_unavailable');
  return { email: entries.AI_ADMIN_USERNAME, password: entries.AI_ADMIN_PASSWORD };
}

async function roleCredentials(config) {
  if (ROLE === 'admin') return adminCredentials();
  if (ROLE !== 'member') fail('unsupported_role');
  const path = config.member_credentials_file;
  if (typeof path !== 'string' || !path.startsWith('/')) fail('member_credentials_unavailable');
  const stat = await lstat(path).catch(() => fail('member_credentials_missing'));
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) fail('member_credentials_mode');
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (typeof value.email !== 'string' || typeof value.password !== 'string')
    fail('member_credentials_invalid');
  return value;
}

async function webSignIn(page, config) {
  const web = await page.context().newPage();
  try {
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const route = new URL(web.url());
    if (route.origin !== WEB_ORIGIN || route.pathname !== '/login') fail('web_login_route');
    const credentials = await roleCredentials(config);
    await web.locator('input[name="email"]').fill(credentials.email);
    await web.locator('input[name="password"]').fill(credentials.password);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname !== '/login', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    const email = await web.evaluate(async () => {
      const response = await fetch('/api/whoami', { credentials: 'include', cache: 'no-store' });
      const identity = response.ok ? await response.json() : null;
      return identity?.signed_in === true ? identity.email : null;
    });
    if (email !== credentials.email) fail('web_identity_mismatch');
    report.observations.real_web_signin = true;
  } finally {
    await web.close();
  }
}

async function selectOrganization(panel, name, expectedId) {
  await openSection(panel, 'Organization');
  const state = () =>
    evaluate(
      panel,
      `(() => {
    const section = [...document.querySelectorAll('button[aria-expanded]')]
      .find(b => b.textContent.trim() === 'Organization');
    const body = section?.parentElement?.nextElementSibling;
    const label = [...(body?.querySelectorAll('span') ?? [])].find(s => s.textContent.trim() === 'Acting as');
    const controls = [...(label?.parentElement?.parentElement?.querySelectorAll('button[role="combobox"]') ?? [])];
    return { count: controls.length, display: controls[0]?.textContent.trim() ?? null };
  })()`,
    );
  const selectedId = () =>
    evaluate(
      panel,
      `(async () => {
    const record = await chrome.storage.local.get('matrx.org.active');
    return record['matrx.org.active']?.id ?? null;
  })()`,
    );
  const before = await waitFor('organization_control', state, (s) => s?.count === 1, 60_000);
  if (before.display !== name) {
    if (before.display !== 'Choose…') fail('unexpected_preselected_organization');
    await click(panel, 'organization', 'Acting as');
    const matches = await evaluate(
      panel,
      `(() => [...document.querySelectorAll('[role="option"]')]
      .filter(o => o.textContent.trim() === ${JSON.stringify(name)}).length)()`,
    );
    if (matches !== 1) fail('approved_organization_option_missing');
    await click(panel, 'option', name);
  }
  await waitFor('organization_selected', state, (s) => s?.count === 1 && s.display === name);
  await waitFor('exact_organization_id_selected', selectedId, (id) => id === expectedId);
  report.observations.organization_selected_by_ui = true;
  report.observations.exact_active_organization_id_confirmed = true;
}

async function trustedFeatureClick(panel, featureTitle, selector, text) {
  const point = await evaluate(
    panel,
    `(() => {
    const tab = document.querySelector('button[role="tab"][title=${JSON.stringify(featureTitle)}]');
    const root = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
    const matches = [...(root?.querySelectorAll(${JSON.stringify(selector)}) ?? [])]
      .filter(el => ${JSON.stringify(selector)} === 'button[role="tab"]'
        ? el.textContent.trim().startsWith(${JSON.stringify(text)})
        : el.textContent.trim() === ${JSON.stringify(text)});
    if (matches.length !== 1) return { count: matches.length };
    const target = matches[0]; target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect(), x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2, hit = document.elementFromPoint(x,y);
    return { count: 1, x, y, hittable: !target.disabled && (hit === target || target.contains(hit)) };
  })()`,
  );
  if (point?.count !== 1 || !point.hittable) fail('target_not_unique_or_hittable');
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

async function filesState(panel) {
  return evaluate(
    panel,
    `(() => {
    const tab = document.querySelector('button[role="tab"][title="Files"]');
    const root = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
    const inner = [...(root?.querySelectorAll('button[role="tab"]') ?? [])];
    const selected = inner.find(b => b.getAttribute('data-state') === 'active');
    const refresh = [...(root?.querySelectorAll('button[title="Refresh files"]') ?? [])]
      .filter(b => b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().height > 0);
    const activePane = [...(root?.querySelectorAll('[role="tabpanel"]') ?? [])]
      .find(el => el.getAttribute('data-state') === 'active');
    const text = activePane?.textContent ?? '';
    return { active: tab?.getAttribute('data-state') === 'active', selected: selected?.textContent.trim() ?? null,
      viewReady: root?.querySelector('h1')?.textContent.trim() === 'Files' && refresh.length === 1,
      error: text.includes('Files could not be loaded'), retry: [...(activePane?.querySelectorAll('button') ?? [])]
        .some(b => b.textContent.trim() === 'Retry files'),
      falseEmpty: text.includes('No library files yet') || text.includes('No captures yet'),
      loading: Boolean(activePane?.querySelector('.animate-spin')),
      rowCount: activePane?.querySelectorAll('div.divide-y > *, div.grid > *').length ?? 0 };
  })()`,
  );
}

function interceptFiles(panel, origin) {
  let mode = 'none';
  let failed = 0;
  let continued = 0;
  let interceptionError = false;
  const requests = new Map();
  const succeeded = { library: 0, screenshots: 0 };
  const kindOf = (url) =>
    url.origin === origin
      ? url.pathname === '/rest/v1/rpc/get_user_file_tree'
        ? 'library'
        : url.pathname === '/rest/v1/wbx_screenshot'
          ? 'screenshots'
          : null
      : null;
  const offRequest = panel.on('Network.requestWillBeSent', (event) => {
    const kind = kindOf(new URL(event.request.url));
    if (kind) requests.set(event.requestId, kind);
  });
  const offResponse = panel.on('Network.responseReceived', (event) => {
    const kind = requests.get(event.requestId);
    if (kind && event.response.status >= 200 && event.response.status < 300) succeeded[kind]++;
    requests.delete(event.requestId);
  });
  const offFailed = panel.on('Network.loadingFailed', (event) => requests.delete(event.requestId));
  const off = panel.on('Fetch.requestPaused', (event) => {
    const url = new URL(event.request.url);
    const scoped = kindOf(url) === mode;
    const command = scoped
      ? panel.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' })
      : panel.send('Fetch.continueRequest', { requestId: event.requestId });
    void command
      .then(() => {
        if (scoped) failed++;
        else continued++;
      })
      .catch(() => {
        interceptionError = true;
      });
  });
  return {
    start: async () => {
      await panel.send('Network.enable');
      await panel.send('Fetch.enable', {
        patterns: [
          { urlPattern: `${origin}/rest/v1/rpc/get_user_file_tree*`, requestStage: 'Request' },
          { urlPattern: `${origin}/rest/v1/wbx_screenshot*`, requestStage: 'Request' },
        ],
      });
    },
    setMode: (value) => {
      mode = value;
    },
    read: () => ({ failed, continued, succeeded: { ...succeeded }, interceptionError }),
    stop: async () => {
      await panel.send('Fetch.disable').catch(() => {});
      off();
      offRequest();
      offResponse();
      offFailed();
    },
  };
}

async function proveFilesFailure(panel, transport, tab, mode) {
  stage = `D64_${mode}_failure`;
  const before = transport.read().failed;
  transport.setMode(mode);
  report.observations[`D64_${mode}_substage`] = 'switch_tab';
  if (mode === 'screenshots')
    await trustedFeatureClick(panel, 'Files', 'button[role="tab"]', 'Screenshots');
  report.observations[`D64_${mode}_substage`] = 'refresh_click';
  await click(panel, 'title', 'Refresh files');
  report.observations[`D64_${mode}_substage`] = 'scoped_read_failure';
  await waitFor(
    'scoped_files_request_failed',
    transport.read,
    (s) => s.failed > before && !s.interceptionError,
    30_000,
  );
  report.observations[`D64_${mode}_substage`] = 'visible_error';
  const failed = await waitFor(
    'visible_files_failure',
    () => filesState(panel),
    (s) => s.active && s.selected?.startsWith(tab) && s.error && s.retry && !s.falseEmpty,
    30_000,
  );
  transport.setMode('none');
  stage = `D64_${mode}_retry`;
  const successBefore = transport.read().succeeded[mode];
  report.observations[`D64_${mode}_substage`] = 'retry_click';
  await trustedFeatureClick(panel, 'Files', 'button', 'Retry files');
  report.observations[`D64_${mode}_substage`] = 'successful_retry_read';
  await waitFor(
    'files_real_read_succeeded',
    transport.read,
    (s) => s.succeeded[mode] > successBefore && !s.interceptionError,
    45_000,
  );
  report.observations[`D64_${mode}_substage`] = 'visible_recovery';
  const recovered = await waitFor(
    'files_retry_recovered',
    () => filesState(panel),
    (s) => s.active && s.selected?.startsWith(tab) && !s.error && !s.retry && !s.loading,
    45_000,
  );
  report.observations[`D64_${mode}_substage`] = 'complete';
  return {
    request_failure_observed: true,
    visible_error: failed.error,
    visible_retry: failed.retry,
    false_empty_claim: failed.falseEmpty,
    recovered_from_real_retry: !recovered.error,
    successful_read_observed: true,
  };
}

function interceptSourceDetail(panel, origin, sourceA, sourceB) {
  let pendingA = null;
  let aNetworkId = null;
  let aSettled = false;
  let aSuccess = false;
  let aFailed = false;
  let bNetworkId = null;
  let seenB = 0;
  let bSuccessfulResponse = false;
  let bCompleted = false;
  let interceptionError = false;
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    if (requestId === aNetworkId && response.status >= 200 && response.status < 300)
      aSuccess = true;
    if (requestId === bNetworkId && response.status >= 200 && response.status < 300)
      bSuccessfulResponse = true;
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    if (requestId === aNetworkId) aSettled = true;
    if (requestId === bNetworkId && bSuccessfulResponse) bCompleted = true;
  });
  const offFailed = panel.on('Network.loadingFailed', ({ requestId }) => {
    if (requestId === aNetworkId) {
      aSettled = true;
      aFailed = true;
    }
    if (requestId === bNetworkId) interceptionError = true;
  });
  const off = panel.on('Fetch.requestPaused', (event) => {
    const url = new URL(event.request.url);
    const id = /^eq\.([0-9a-f-]{36})$/i.exec(url.searchParams.get('id') ?? '')?.[1];
    const inScope =
      url.origin === origin &&
      url.pathname === '/rest/v1/processed_documents' &&
      event.request.method === 'GET';
    if (inScope && id === sourceA.id && !pendingA) {
      pendingA = event.requestId;
      aNetworkId = event.networkId ?? null;
      if (!aNetworkId) interceptionError = true;
      return;
    }
    if (inScope && id === sourceB.id) {
      bNetworkId = event.networkId ?? null;
      if (!bNetworkId) interceptionError = true;
    }
    const command = panel.send('Fetch.continueRequest', { requestId: event.requestId });
    void command
      .then(() => {
        if (inScope && id === sourceB.id) seenB++;
      })
      .catch(() => {
        interceptionError = true;
      });
  });
  return {
    start: async () => {
      await panel.send('Network.enable');
      await panel.send('Fetch.enable', {
        patterns: [
          { urlPattern: `${origin}/rest/v1/processed_documents*`, requestStage: 'Request' },
        ],
      });
    },
    read: () => ({
      pendingA: Boolean(pendingA),
      aSettled,
      aSuccess,
      aFailed,
      seenB,
      bSuccessfulResponse,
      bCompleted,
      interceptionError,
    }),
    releaseA: async (failRequest = false) => {
      if (!pendingA) fail('source_a_request_not_held');
      const id = pendingA;
      pendingA = null;
      await panel.send(
        failRequest ? 'Fetch.failRequest' : 'Fetch.continueRequest',
        failRequest ? { requestId: id, errorReason: 'Failed' } : { requestId: id },
      );
    },
    stop: async () => {
      if (pendingA)
        await panel.send('Fetch.continueRequest', { requestId: pendingA }).catch(() => {});
      await panel.send('Fetch.disable').catch(() => {});
      off();
      offResponse();
      offFinished();
      offFailed();
    },
  };
}

async function sourceListState(panel, a, b) {
  return evaluate(
    panel,
    `(() => {
    const tab = document.querySelector('button[role="tab"][title="Saved captures"]');
    const root = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
    const rows = [...(root?.querySelectorAll('article > button') ?? [])];
    const names = rows.map(row => row.querySelector('.font-medium')?.textContent.trim());
    return { active: tab?.getAttribute('data-state') === 'active',
      hasA: names.filter(n => n === ${JSON.stringify(a.title)}).length === 1,
      hasB: names.filter(n => n === ${JSON.stringify(b.title)}).length === 1,
      detailB: root?.querySelector('header .font-semibold')?.textContent.trim() === ${JSON.stringify(b.title)},
      listVisible: rows.length > 0 };
  })()`,
  );
}

async function sourceRowClick(panel, source) {
  const selector = 'article > button';
  const point = await evaluate(
    panel,
    `(() => {
    const tab = document.querySelector('button[role="tab"][title="Saved captures"]');
    const root = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
    const rows = [...(root?.querySelectorAll(${JSON.stringify(selector)}) ?? [])]
      .filter(row => row.querySelector('.font-medium')?.textContent.trim() === ${JSON.stringify(source.title)});
    if (rows.length !== 1) return { count: rows.length };
    const row = rows[0]; row.scrollIntoView({ block: 'center' });
    const rect = row.getBoundingClientRect(), x = rect.x + rect.width / 2,
      y = rect.y + Math.min(14, rect.height / 2), hit = document.elementFromPoint(x,y);
    return { count: 1, x, y, hittable: hit === row || row.contains(hit) };
  })()`,
  );
  if (point?.count !== 1 || !point.hittable) fail('owned_source_row_not_hittable');
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

async function proveLastClick(panel, origin, a, b, lateFailure) {
  const beforeClick = await sourceListState(panel, a, b);
  if (
    !beforeClick.active ||
    !beforeClick.listVisible ||
    !beforeClick.hasA ||
    !beforeClick.hasB ||
    beforeClick.detailB
  )
    fail('fresh_source_list_not_ready');
  const transport = interceptSourceDetail(panel, origin, a, b);
  await transport.start();
  try {
    await sourceRowClick(panel, a);
    await waitFor(
      'source_a_request_held',
      transport.read,
      (s) => s.pendingA && !s.interceptionError,
      30_000,
    );
    const afterA = await sourceListState(panel, a, b);
    if (!afterA.listVisible || afterA.detailB) fail('source_a_hold_not_list_state');
    await sourceRowClick(panel, b);
    await waitFor(
      'source_b_request_completed',
      transport.read,
      (s) => s.seenB > 0 && s.bSuccessfulResponse && s.bCompleted && !s.interceptionError,
      30_000,
    );
    await waitFor(
      'source_b_detail_visible',
      () => sourceListState(panel, a, b),
      (s) => s.active && s.detailB,
      30_000,
    );
    await transport.releaseA(lateFailure);
    await waitFor(
      'source_a_request_settled',
      transport.read,
      (s) => s.aSettled && (lateFailure ? s.aFailed : s.aSuccess) && !s.interceptionError,
      30_000,
    );
    // After the real A network terminal event, observe B through a task turn
    // and two paints, so a queued fetch continuation cannot pass on one sample.
    const postSettlement = await evaluate(
      panel,
      `(async () => {
      const visible = () => {
        const tab = document.querySelector('button[role="tab"][title="Saved captures"]');
        const root = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
        return root?.querySelector('header .font-semibold')?.textContent.trim() === ${JSON.stringify(b.title)};
      };
      const samples = [visible()];
      await new Promise(resolve => setTimeout(resolve, 0));
      samples.push(visible());
      await new Promise(resolve => requestAnimationFrame(resolve));
      samples.push(visible());
      await new Promise(resolve => requestAnimationFrame(resolve));
      samples.push(visible());
      return samples;
    })()`,
    );
    if (!postSettlement?.every(Boolean)) fail('source_b_changed_after_a_settlement');
    const after = await waitFor(
      'source_b_stays_selected',
      () => sourceListState(panel, a, b),
      (s) => s.active && s.detailB,
      15_000,
    );
    if (!after.detailB) fail('last_clicked_source_replaced');
    return {
      fresh_list_before_click: true,
      a_held: true,
      b_detail_request_completed_2xx: true,
      b_visible_before_a: true,
      b_visible_after_a: true,
      a_late_failure: lateFailure,
    };
  } finally {
    await transport.stop();
  }
}

async function main() {
  if (FIXTURE_MODE !== null && !['create', 'cleanup'].includes(FIXTURE_MODE))
    fail('unsupported_fixture_mode');
  const config = await privateConfig();
  const build = await buildIdentity();
  report.build = { version: build.version, treeSha256: build.treeSha256 };
  const env = await readFile(join(REPO, '.env.development'), 'utf8');
  const match = /^WXT_SUPABASE_URL=(.*)$/m.exec(env);
  if (!match) fail('supabase_origin_missing');
  const origin = new URL(match[1].replace(/^['"]|['"]$/g, '')).origin;
  const key = /^WXT_SUPABASE_PUBLISHABLE_KEY=(.*)$/m.exec(env)?.[1]?.replace(/^['"]|['"]$/g, '');
  if (FIXTURE_MODE === 'create' && !key) fail('publishable_key_missing');
  await runNativeSidepanelQa({
    extensionDir: build.extensionDir,
    expectedRelease: build,
    ...(LOCAL_DEV_RECEIPT ? { localDevReceiptPath: RECEIPT } : { releaseReceiptPath: RECEIPT }),
    exercisePanel: async ({ page, panel }) => {
      stage = 'guest';
      const absent = await evaluate(
        panel,
        `(() => ({ files: !document.querySelector('button[role="tab"][title="Files"]'),
        saved: !document.querySelector('button[role="tab"][title="Saved captures"]') }))()`,
      );
      if (!absent.files || !absent.saved) fail('guest_tabs_present');
      await panel.send('Page.reload', { ignoreCache: true });
      await waitFor(
        'guest_tabs_still_absent',
        () =>
          evaluate(
            panel,
            `(() => ({
        ready: document.readyState === 'complete',
        files: !document.querySelector('button[role="tab"][title="Files"]'),
        saved: !document.querySelector('button[role="tab"][title="Saved captures"]') }))()`,
          ),
        (s) => s.ready && s.files && s.saved,
        30_000,
      );
      report.cases.guest = 'pass';
      stage = 'real_signin';
      await webSignIn(page, config);
      await click(panel, 'title', 'Settings');
      await openSection(panel, 'Account');
      await click(panel, 'button', 'Sign in');
      await waitFor(
        'extension_account_signed_in',
        () =>
          evaluate(
            panel,
            `(() =>
        [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Sign out'))()`,
          ),
        Boolean,
        90_000,
      );
      await selectOrganization(
        panel,
        config.approved_organization_name,
        config.approved_organization_id,
      );
      if (FIXTURE_MODE === 'create') {
        await createFixturePair(page, panel, config, build, origin, key);
        return;
      }
      if (FIXTURE_MODE === 'cleanup') {
        await cleanupFixturePair(page, panel, config);
        return;
      }
      stage = 'D64';
      const filesTransport = interceptFiles(panel, origin);
      await filesTransport.start();
      try {
        await click(panel, 'title', 'Files');
        await waitFor(
          'files_ready',
          () => filesState(panel),
          (s) => s.active && s.viewReady && s.selected?.startsWith('Library') && !s.loading,
          45_000,
        );
        report.observations.files_library = await proveFilesFailure(
          panel,
          filesTransport,
          'Library',
          'library',
        );
        report.observations.files_screenshots = await proveFilesFailure(
          panel,
          filesTransport,
          'Screenshots',
          'screenshots',
        );
        if (filesTransport.read().interceptionError) fail('files_interception_failed');
        report.cases.D64 = 'pass';
      } catch (error) {
        report.observations.D64_failure_diagnostic = {
          substage: stage.includes('screenshots')
            ? (report.observations.D64_screenshots_substage ?? null)
            : (report.observations.D64_library_substage ?? null),
          transport: filesTransport.read(),
          ui: await filesState(panel).catch(() => null),
          pointer_code: error?.driverFailure?.code ?? null,
          wait_code:
            /^(scoped_files_request_failed|visible_files_failure|files_real_read_succeeded|files_retry_recovered|files_ready)_not_observed/.exec(
              error?.message ?? '',
            )?.[1] ?? null,
        };
        throw error;
      } finally {
        await filesTransport.stop();
      }
      if (!config.source_a || !config.source_b) {
        report.observations.source_pair = 'test_owned_pair_not_configured';
        return;
      }
      stage = 'D65_list';
      await click(panel, 'title', 'Saved captures');
      await waitFor(
        'configured_test_sources_visible',
        () => sourceListState(panel, config.source_a, config.source_b),
        (s) => s.active && s.hasA && s.hasB,
        45_000,
      );
      report.observations.source_pair_visible = true;
      stage = 'D65_stale_success';
      report.observations.source_stale_success = await proveLastClick(
        panel,
        origin,
        config.source_a,
        config.source_b,
        false,
      );
      await trustedFeatureClick(panel, 'Saved captures', 'button', 'Back to saved captures');
      await waitFor(
        'source_list_returned',
        () => sourceListState(panel, config.source_a, config.source_b),
        (s) => s.listVisible && s.hasA && s.hasB,
        45_000,
      );
      stage = 'D65_stale_failure';
      report.observations.source_stale_failure = await proveLastClick(
        panel,
        origin,
        config.source_a,
        config.source_b,
        true,
      );
      report.cases.D65 = 'pass';
    },
  });
  if (hashReleaseTree(build.extensionDir) !== build.treeSha256) fail('build_changed_during_run');
  report.status = FIXTURE_MODE
    ? `fixture-${FIXTURE_MODE === 'create' ? 'created' : 'cleaned'}`
    : report.cases.D64 === 'pass' && report.cases.D65 === 'pass'
      ? 'bounded-pass'
      : 'partial';
}

try {
  await main();
} catch (error) {
  report.failure_code ??= error?.message?.startsWith('files_saved_native_')
    ? error.message.slice('files_saved_native_'.length)
    : 'unclassified_runtime_failure';
  report.failure_stage ??= stage;
  if (fixtureStep !== null) report.failure_diagnostic = safeFixtureFailure(error);
} finally {
  await mkdir(join(REPO, 'test-results'), { recursive: true, mode: 0o700 });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `${report.status.toUpperCase()} files_saved_native ${report.failure_code ?? ''}\n`,
  );
  if (!['bounded-pass', 'fixture-created', 'fixture-cleaned'].includes(report.status))
    process.exitCode = 1;
}
