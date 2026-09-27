#!/usr/bin/env node
/** Real read-only D22 recognition. No save/checkpoint imports or access. */
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';
const REPO = resolve(import.meta.dirname, '../..');
const PRIVATE_CONFIG = join(REPO, 'test-results/d22-private-config.json');
const ADMIN_ENV = join(homedir(), 'code/aidream/.env');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const SOURCE_ORIGINS = new Set([WEB_ORIGIN, 'https://aimatrx.com']);
const EMAIL = 'admin@admin.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXTENSION = join(REPO, '.output/chrome-mv3-dev');
const OUTPUT = join(REPO, 'test-results/source-recognition-readonly-acceptance.json');
// Only public reference pages; discovery never navigates arbitrary private Source URLs.
const PUBLIC_HOSTS = new Set(['example.com', 'www.iana.org', 'en.wikipedia.org']);
let stage = 'build_identity';
const report = {
  schema_version: 1,
  defect_id: 'EXT-D-0022',
  status: 'unverified',
  scope:
    'Existing Source recognition, workspace switching, authentic delayed lookup; no Source writes',
  observations: { lateInflightSave: 'unverified', realAdminUi: false },
  build: null,
};
const fail = (code) => {
  report.failureCode = code;
  throw new Error('recognition_unverified');
};

async function privateApprovedOrganization() {
  const stat = await lstat(PRIVATE_CONFIG).catch(() => fail('private_config_unavailable'));
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) fail('private_config_not_private');
  const parsed = JSON.parse(await readFile(PRIVATE_CONFIG, 'utf8'));
  const name = parsed?.approved_organization_name;
  if (typeof name !== 'string' || !name.trim() || name !== name.trim())
    fail('approved_organization_missing');
  return name;
}

// Credentials are read only when the real web form is ready. Neither values
// nor raw login errors enter the result or a thrown error.

async function realWebSignIn(page) {
  const web = await page.context().newPage();
  try {
    stage = 'web_login';
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const login = new URL(web.url());
    if (login.origin !== WEB_ORIGIN || login.pathname !== '/login') fail('web_login_route');
    const source = await readFile(ADMIN_ENV, 'utf8');
    const variables = {};
    for (const line of source.split(/\r?\n/)) {
      const found = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
      if (!found) continue;
      let value = found[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      variables[found[1]] = value;
    }
    if (variables.AI_ADMIN_USERNAME !== EMAIL || !variables.AI_ADMIN_PASSWORD)
      fail('admin_credentials_unavailable');
    await web.locator('input[name="email"]').fill(EMAIL);
    await web.locator('input[name="password"]').fill(variables.AI_ADMIN_PASSWORD);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    return web;
  } catch {
    await web.close();
    fail('real_web_login_unverified');
  }
}

async function adminState(panel) {
  return evaluate(
    panel,
    `(() => {
      const account = [...document.querySelectorAll('button[aria-expanded]')]
        .find((button) => button.textContent.trim() === 'Account');
      const section = account?.parentElement?.nextElementSibling;
      const row = (label) => [...(section?.querySelectorAll('span') ?? [])]
        .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
      return {
        emailMatch: row('Email') === 'Email${EMAIL}',
        adminRole: row('Role')?.toLowerCase() === 'roleadmin',
        signOutVisible: [...document.querySelectorAll('button')]
          .some((button) => button.textContent.trim() === 'Sign out'),
      };
    })()`,
  );
}

async function organizationState(panel, approvedName) {
  return evaluate(
    panel,
    `(async () => {
      const approved = ${JSON.stringify(approvedName)};
      const rows = [...document.querySelectorAll('span')]
        .filter((span) => span.textContent.trim() === 'Acting as');
      const controls = rows.flatMap((span) =>
        [...span.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
      const options = [...document.querySelectorAll('[role="option"]')]
        .map((option) => option.textContent.trim());
      const stored = (await chrome.storage.local.get('matrx.org.active'))['matrx.org.active'];
      return {
        controlCount: controls.length,
        displayed: controls.length === 1 ? controls[0].textContent.trim() : null,
        approvedOptionCount: options.filter((option) => option === approved).length,
        otherOptions: options.filter((option) => option !== approved),
        storedId: typeof stored?.id === 'string' ? stored.id : null,
        storedApproved: stored?.name === approved,
      };
    })()`,
  );
}

async function chooseOrganization(panel, name, approvedName) {
  let step = 'settings_tab';
  try {
    await click(panel, 'title', 'Settings');
    // The no-workspace notice occupies the bottom of this narrow panel.
    // Collapse the real Account section to bring the Organization controls
    // above it, without dismissing the notice whose retirement we must test.
    step = 'account_section_collapse';
    const account = await evaluate(
      panel,
      `(() => {
        const buttons = [...document.querySelectorAll('button[aria-expanded]')]
          .filter((button) => button.textContent.trim() === 'Account');
        return { count: buttons.length, expanded: buttons[0]?.getAttribute('aria-expanded') ?? null };
      })()`,
    );
    if (account.count !== 1 || !['true', 'false'].includes(account.expanded))
      fail('account_section_not_unique_or_absent');
    if (account.expanded === 'true') await click(panel, 'section', 'Account');
    await waitFor(
      'account_section_collapsed_for_organization',
      () =>
        evaluate(
          panel,
          `(() => [...document.querySelectorAll('button[aria-expanded]')]
            .filter((button) => button.textContent.trim() === 'Account')
            .map((button) => button.getAttribute('aria-expanded')))()`,
        ),
      (states) => states?.length === 1 && states[0] === 'false',
    );
    step = 'organization_section';
    await openSection(panel, 'Organization');
    step = 'organization_control_ready';
    await waitFor(
      'organization_control',
      () => organizationState(panel, approvedName),
      (state) => state?.controlCount === 1,
    );
    step = 'organization_control_click';
    await click(panel, 'organization', 'Acting as');
    step = 'approved_option_ready';
    const offered = await organizationState(panel, approvedName);
    if (offered.approvedOptionCount !== 1) fail('approved_org_not_unique_or_absent');
    if (
      offered.otherOptions.filter((option) => option === name).length !==
      (name === approvedName ? 0 : 1)
    )
      fail('comparison_org_not_unique_or_absent');
    step = 'organization_option_click';
    await click(panel, 'option', name);
    step = 'organization_selected';
    return await waitFor(
      'organization_selected',
      () => organizationState(panel, approvedName),
      (state) =>
        state?.displayed === name &&
        Boolean(state.storedId) &&
        state.storedApproved === (name === approvedName),
    );
  } catch {
    report.observations.organizationSelectionFailure = { step };
    fail('organization_selection_failed');
  }
}

async function scrapeState(panel) {
  return evaluate(
    panel,
    `(() => {
    const tab = document.querySelector('button[role="tab"][title="Scrape"]');
    const pane = tab?.getAttribute('aria-controls')
      ? document.getElementById(tab.getAttribute('aria-controls')) : null;
    const linked = tab?.getAttribute('aria-selected') === 'true' &&
      pane?.getAttribute('aria-labelledby') === tab.id &&
      pane?.getAttribute('data-state') === 'active';
    if (!linked) return { linked: false };
    const text = pane.innerText ?? '';
    const buttons = [...pane.querySelectorAll('button')].map((button) => ({
      text: button.textContent.trim(), disabled: button.disabled,
    }));
    const has = (label) => buttons.some((button) => button.text === label && !button.disabled);
    const sourceBanner = [...pane.querySelectorAll('span')]
      .some((node) => node.textContent.trim().startsWith('This page is a Source · saved'));
    return {
      linked: true,
      notSaved: !!pane.querySelector('[data-testid="not-yet-a-source"]'),
      savedBanner: sourceBanner,
      checkUnknown: text.includes("Couldn't check whether this page is already a Source") ||
        text.includes('Choose your organization in the AI Matrx panel'),
      chooseWorkspace: text.includes('Choose your organization in the AI Matrx panel'),
      save: has('Save'), saved: has('Saved'),
      captureAction: has('Capture this page'),
      openSource: has('Open this Source (opens in the web app)'),
      openRecognized: has('Open (web app)'),
      captureBusy: text.includes('Capturing…'),
      saveBusy: buttons.some((button) => button.text === 'Save' && button.disabled),
    };
  })()`,
  );
}

async function sourceIdFromRealUi(panel, page, label) {
  const openedPromise = page.context().waitForEvent('page', { timeout: 30_000 });
  await click(panel, 'button', label);
  const opened = await openedPromise;
  try {
    await opened.waitForURL(
      (url) =>
        SOURCE_ORIGINS.has(url.origin) &&
        url.pathname.startsWith('/knowledge/sources/') &&
        UUID.test(url.pathname.split('/').at(-1) ?? ''),
      { timeout: 30_000 },
    );
    const url = new URL(opened.url());
    if (!url.pathname.startsWith('/knowledge/sources/')) fail('source_link_wrong_path');
    const id = url.pathname.split('/').at(-1);
    if (!UUID.test(id ?? '')) fail('source_link_missing_id');
    return id;
  } finally {
    await opened.close();
  }
}

async function buildIdentity() {
  const receiptPath = process.env.SOURCE_DEV_BUILD_RECEIPT;
  if (!receiptPath) fail('development_receipt_required');
  const receipt = requireLocalDevReceipt(
    JSON.parse(await readFile(receiptPath, 'utf8')),
    EXTENSION,
  );
  const manifest = JSON.parse(await readFile(join(EXTENSION, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8'));
  if (
    !manifest.key ||
    manifest.version !== pkg.version ||
    manifest.version !== receipt.version ||
    hashReleaseTree(EXTENSION) !== receipt.treeSha256
  )
    fail('development_build_mismatch');
  return {
    kind: receipt.kind,
    publishState: receipt.publish_state,
    version: receipt.version,
    treeSha256: receipt.treeSha256,
  };
}

function sourceQuery(request) {
  try {
    const url = new URL(request.url);
    if (
      request.method !== 'GET' ||
      url.protocol !== 'https:' ||
      url.pathname !== '/rest/v1/processed_documents'
    )
      return null;
    const q = url.searchParams;
    if (
      q.get('origin_client') !== 'eq.extension' ||
      q.get('derivation_kind') !== 'in.(initial_extract,recapture)' ||
      q.get('deleted_at') !== 'is.null'
    )
      return null;
    return {
      origin: url.origin,
      org: q.get('organization_id'),
      identity: q.get('canonical_identity'),
    };
  } catch {
    return null;
  }
}

async function observeReads(panel) {
  await panel.send('Network.enable');
  const records = [];
  const byId = new Map();
  const off = [
    panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
      const query = sourceQuery(request);
      if (!query) return;
      const record = { ...query, requestId, status: null, done: false, rows: null };
      records.push(record);
      byId.set(requestId, record);
    }),
    panel.on('Network.responseReceived', ({ requestId, response }) => {
      const record = byId.get(requestId);
      if (record) record.status = response.status;
    }),
    panel.on('Network.loadingFailed', ({ requestId }) => {
      const record = byId.get(requestId);
      if (record) {
        record.done = true;
        record.failed = true;
      }
    }),
    panel.on('Network.loadingFinished', ({ requestId }) => {
      const record = byId.get(requestId);
      if (!record) return;
      void panel
        .send('Network.getResponseBody', { requestId })
        .then(({ body, base64Encoded }) => {
          const rows = JSON.parse(
            base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body,
          );
          if (Array.isArray(rows)) record.rows = rows;
        })
        .catch(() => {
          record.failed = true;
        })
        .finally(() => {
          record.done = true;
        });
    }),
  ];
  return {
    records,
    stop: () => {
      for (const unsubscribe of off) unsubscribe();
    },
  };
}

async function completedLookup(reads, since, origin, org, identity) {
  const record = await waitFor(
    'scoped_read_completed',
    () =>
      reads.records
        .slice(since)
        .find(
          (r) =>
            r.origin === origin &&
            r.org === `eq.${org}` &&
            r.identity === `eq.${identity}` &&
            r.done,
        ),
    (r) => r?.done === true,
    30_000,
  );
  if (
    record.failed ||
    record.status !== 200 ||
    !Array.isArray(record.rows) ||
    record.rows.length > 1
  )
    fail('scoped_read_not_valid_200');
  const row = record.rows[0];
  if (row && (!UUID.test(row.id ?? '') || row.canonical_identity !== identity))
    fail('scoped_read_invalid_identity');
  return row?.id ?? null;
}

async function assertRecognition(panel, page, expectedId) {
  await click(panel, 'title', 'Scrape');
  await waitFor(
    'recognition_ui_matches_response',
    () => scrapeState(panel),
    (s) =>
      s?.linked &&
      !s.checkUnknown &&
      !s.openSource &&
      (expectedId
        ? s.savedBanner && s.openRecognized
        : s.notSaved && !s.savedBanner && !s.openRecognized),
    30_000,
  );
  if (expectedId && (await sourceIdFromRealUi(panel, page, 'Open (web app)')) !== expectedId)
    fail('open_source_target_mismatch');
}

// CDP Fetch.requestPaused documentation permits continueRequest at response stage.
// Only requestId is supplied: status, body, URL and headers are never replaced.
async function holdResponses(panel, origin, org, identity) {
  const paused = [];
  let failed = false;
  const off = panel.on('Fetch.requestPaused', (event) => {
    const q = sourceQuery(event.request);
    if (q?.origin === origin && q.org === `eq.${org}` && q.identity === `eq.${identity}`) {
      paused.push(event);
    } else {
      void panel.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => {
        failed = true;
      });
    }
  });
  await panel.send('Fetch.enable', {
    patterns: [{ urlPattern: `${origin}/rest/v1/processed_documents*`, requestStage: 'Response' }],
  });
  let released = false;
  return {
    wait: async () => {
      await waitFor(
        'authentic_response_paused',
        () => ({ count: paused.length, failed }),
        (s) => s.count > 0 && !s.failed,
        30_000,
      );
      if (paused.some((event) => event.responseStatusCode !== 200 || !event.networkId))
        fail('paused_response_not_real_200');
    },
    release: async () => {
      if (released) return;
      released = true;
      try {
        for (const event of paused)
          await panel.send('Fetch.continueRequest', { requestId: event.requestId });
      } finally {
        await panel.send('Fetch.disable');
        off();
      }
      if (failed) fail('unrelated_response_continue_failed');
    },
  };
}

try {
  report.build = await buildIdentity();
  const startBuild = report.build;
  await runNativeSidepanelQa({
    extensionDir: EXTENSION,
    expectedRelease: startBuild,
    localDevReceiptPath: process.env.SOURCE_DEV_BUILD_RECEIPT,
    exercisePanel: async ({ page, panel }) => {
      stage = 'real_admin_login';
      await click(panel, 'title', 'Settings');
      await openSection(panel, 'Account');
      const web = await realWebSignIn(page);
      try {
        await click(panel, 'button', 'Sign in');
        await waitFor(
          'admin_identity',
          () => adminState(panel),
          (s) => s?.emailMatch && s.adminRole && s.signOutVisible,
          90_000,
        );
        report.observations.realAdminUi = true;
      } finally {
        await web.close();
      }
      const approvedName = await privateApprovedOrganization();
      stage = 'approved_workspace';
      const approved = await chooseOrganization(panel, approvedName, approvedName);
      const reads = await observeReads(panel);
      let hold;
      try {
        stage = 'discover_existing_public_source';
        await click(panel, 'title', 'Saved captures');
        const list = await waitFor(
          'existing_sources_read',
          () =>
            reads.records.find((r) => r.org === `eq.${approved.storedId}` && !r.identity && r.done),
          (r) => r?.done === true,
          30_000,
        );
        if (list.failed || list.status !== 200 || !Array.isArray(list.rows))
          fail('source_list_read_failed');
        const fixture = list.rows.find((row) => {
          try {
            // listSavedCaptures selects url:canonical_identity; point lookups do not alias it.
            const url = new URL(row.url);
            return (
              UUID.test(row.id ?? '') &&
              url.protocol === 'https:' &&
              PUBLIC_HOSTS.has(url.hostname) &&
              !url.username &&
              !url.password &&
              !url.search &&
              !url.hash
            );
          } catch {
            return false;
          }
        });
        if (!fixture) fail('no_existing_public_positive_fixture_in_visible_page');
        report.observations.existingFixtureFound = true;
        const identity = fixture.url;
        const origin = list.origin;
        stage = 'approved_positive_recognition';
        let since = reads.records.length;
        await page.goto(identity, { waitUntil: 'load', timeout: 60_000 });
        if (page.url() !== identity) fail('existing_fixture_redirected');
        await click(panel, 'title', 'Scrape');
        const sourceId = await completedLookup(reads, since, origin, approved.storedId, identity);
        if (!sourceId) fail('existing_fixture_not_recognized');
        await assertRecognition(panel, page, sourceId);
        report.observations.positiveRecognitionAndOpen = 'pass';

        stage = 'comparison_workspace_discovery';
        await click(panel, 'title', 'Settings');
        await openSection(panel, 'Organization');
        await click(panel, 'organization', 'Acting as');
        const offered = await organizationState(panel, approvedName);
        const otherName = offered.otherOptions.find(
          (name) => name && offered.otherOptions.filter((n) => n === name).length === 1,
        );
        if (!otherName) fail('no_distinct_accessible_workspace');
        await click(panel, 'option', otherName);
        const other = await waitFor(
          'comparison_selected',
          () => organizationState(panel, approvedName),
          (s) => s?.displayed === otherName && s.storedId && s.storedId !== approved.storedId,
        );
        report.observations.comparisonSelectedByUi = true;
        // Return to A before forcing a fresh A lookup to complete after B.
        await chooseOrganization(panel, approvedName, approvedName);
        await assertRecognition(panel, page, sourceId);
        stage = 'delay_authentic_approved_lookup';
        // Leave the fixture first so re-entry necessarily causes a new real lookup.
        await page.goto('about:blank');
        await waitFor(
          'fixture_left_before_new_lookup',
          () => scrapeState(panel),
          (state) => state?.linked && !state.savedBanner && !state.openRecognized,
          30_000,
        );
        hold = await holdResponses(panel, origin, approved.storedId, identity);
        const lateStart = reads.records.length;
        await page.goto(identity, { waitUntil: 'load', timeout: 60_000 });
        await click(panel, 'title', 'Scrape');
        await hold.wait();
        stage = 'switch_while_approved_lookup_pending';
        since = reads.records.length;
        await chooseOrganization(panel, otherName, approvedName);
        await click(panel, 'title', 'Scrape');
        const otherId = await completedLookup(reads, since, origin, other.storedId, identity);
        if (otherId === sourceId) fail('same_source_visible_across_workspaces');
        await assertRecognition(panel, page, otherId);
        report.observations.comparisonRecognition = otherId ? 'different_source' : 'not_saved';
        stage = 'release_old_workspace_lookup';
        await hold.release();
        hold = null;
        const lateId = await completedLookup(reads, lateStart, origin, approved.storedId, identity);
        if (lateId !== sourceId) fail('late_lookup_not_positive_control');
        // The behavior is absence of stale state after delivery: observe a bounded
        // interval, not a sleep used to guess whether the network completed.
        const until = Date.now() + 1500;
        do {
          const state = await scrapeState(panel);
          if (
            !state.linked ||
            state.checkUnknown ||
            state.openSource ||
            (otherId
              ? !state.savedBanner || !state.openRecognized
              : !state.notSaved || state.savedBanner || state.openRecognized)
          )
            fail('late_lookup_changed_current_ui');
          await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        } while (Date.now() < until);
        await assertRecognition(panel, page, otherId);
        report.observations.lateLookupIgnored = 'pass';
        stage = 'restore_approved_recognition';
        since = reads.records.length;
        await chooseOrganization(panel, approvedName, approvedName);
        await click(panel, 'title', 'Scrape');
        if ((await completedLookup(reads, since, origin, approved.storedId, identity)) !== sourceId)
          fail('restored_lookup_changed_source');
        await assertRecognition(panel, page, sourceId);
        report.observations.approvedRecognitionRestored = 'pass';
        report.status = 'bounded_pass';
      } finally {
        const precedingStage = stage;
        try {
          if (hold) await hold.release();
        } finally {
          reads.stop();
          stage = 'restore_workspace_cleanup';
          const restored = await chooseOrganization(panel, approvedName, approvedName);
          if (restored.storedId !== approved.storedId) fail('workspace_cleanup_failed');
          report.observations.workspaceCleanup = 'pass';
          stage = precedingStage;
        }
      }
    },
  });
  const end = await buildIdentity();
  if (end.treeSha256 !== startBuild.treeSha256) fail('build_changed_during_run');
} catch {
  report.status = 'unverified';
  report.failureStage = stage;
  report.failureCode ??= 'stage_not_observed';
} finally {
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== 'bounded_pass') process.exitCode = 1;
}
