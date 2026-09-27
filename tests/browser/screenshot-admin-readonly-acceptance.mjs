#!/usr/bin/env node
/** Bounded EXT-F-1009 admin gallery read path. Never captures, copies, or deletes. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = join(REPO, 'test-results', `screenshot-admin-readonly-${randomUUID()}.json`);
const EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3-dev');
const RECEIPT = join(REPO, '.output', 'release-receipt.json');
const MANIFEST = join(EXTENSION_DIR, 'manifest.json');
const PRIVATE_CONFIG = join(REPO, 'test-results', 'd22-private-config.json');
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const ADMIN_EMAIL = 'admin@admin.com';
const WEB_ORIGIN = 'https://www.aimatrx.com';
const PAGES = ['https://example.com/', 'https://www.iana.org/domains/reserved'];
let stage = 'build_start';
const report = {
  schema_version: 1,
  feature: 'EXT-F-1009',
  scope: 'admin gallery read path; no capture, clipboard, delete, or induced failure',
  status: 'unverified',
  build: null,
  cases: [],
};

function fail(code) {
  report.failure = { stage, code };
  throw new Error('screenshot_admin_readonly_unverified');
}

async function buildIdentity() {
  const [receipt, manifest] = await Promise.all([
    readFile(RECEIPT, 'utf8').then(JSON.parse),
    readFile(MANIFEST, 'utf8').then(JSON.parse),
  ]);
  if (receipt.version !== manifest.version || !/^[a-f0-9]{64}$/.test(receipt.treeSha256 ?? ''))
    fail('release_manifest_mismatch');
  return { version: manifest.version, treeSha256: receipt.treeSha256 };
}

async function approvedOrganization() {
  const stat = await lstat(PRIVATE_CONFIG).catch(() => fail('approved_config_missing'));
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) fail('approved_config_not_private');
  const parsed = JSON.parse(await readFile(PRIVATE_CONFIG, 'utf8'));
  const name = parsed?.approved_organization_name;
  if (typeof name !== 'string' || !name.trim() || name !== name.trim())
    fail('approved_organization_missing');
  return name;
}

async function signIn(page, panel) {
  stage = 'real_admin_signin';
  await click(panel, 'title', 'Settings');
  await openSection(panel, 'Account');
  const web = await page.context().newPage();
  try {
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const route = new URL(web.url());
    if (route.origin !== WEB_ORIGIN || route.pathname !== '/login') fail('login_route_unverified');
    // Mirrors the real web-form/extension flow in screenshot-guest-acceptance.mjs.
    // Credentials are read only after the login form is present.
    const variables = {};
    for (const line of (await readFile(ADMIN_ENV, 'utf8')).split(/\r?\n/)) {
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
    if (variables.AI_ADMIN_USERNAME !== ADMIN_EMAIL || !variables.AI_ADMIN_PASSWORD)
      fail('admin_credentials_unavailable');
    await web.locator('input[name="email"]').fill(ADMIN_EMAIL);
    await web.locator('input[name="password"]').fill(variables.AI_ADMIN_PASSWORD);
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
          `(() => {
            const account=[...document.querySelectorAll('button[aria-expanded]')]
              .find(button=>button.textContent.trim()==='Account');
            const section=account?.parentElement?.nextElementSibling;
            const row=label=>[...(section?.querySelectorAll('span')??[])]
              .find(span=>span.textContent.trim()===label)?.parentElement?.textContent.trim()??null;
            return {email:row('Email')==='Email${ADMIN_EMAIL}',
              role:row('Role')?.toLowerCase()==='roleadmin',
              avatar:document.querySelectorAll('button[title="${ADMIN_EMAIL}"]').length};
          })()`,
        ),
      (state) => state?.email && state.role && state.avatar === 1,
      90_000,
    );
  } finally {
    await web.close();
  }
}

async function selectApprovedOrganization(panel, approved) {
  stage = 'select_approved_organization';
  let step = 'settings_tab';
  try {
    await click(panel, 'title', 'Settings');
    step = 'account_section_state';
    const account = await evaluate(
      panel,
      `(() => [...document.querySelectorAll('button[aria-expanded]')]
        .filter(button=>button.textContent.trim()==='Account')
        .map(button=>button.getAttribute('aria-expanded')))()`,
    );
    if (account?.length !== 1 || !['true', 'false'].includes(account[0]))
      fail('account_section_not_unique');
    step = 'account_section_collapse';
    if (account[0] === 'true') await click(panel, 'section', 'Account');
    // The proven Source selection path waits for the actual collapsed state
    // before preparing the Organization combobox in this narrow panel.
    await waitFor(
      'account_collapsed_before_organization',
      () =>
        evaluate(
          panel,
          `(() => [...document.querySelectorAll('button[aria-expanded]')]
            .filter(button=>button.textContent.trim()==='Account')
            .map(button=>button.getAttribute('aria-expanded')))()`,
        ),
      (states) => states?.length === 1 && states[0] === 'false',
    );
    step = 'organization_section';
    await openSection(panel, 'Organization');
    step = 'organization_control_ready';
    await waitFor(
      'organization_control',
      () =>
        evaluate(
          panel,
          `(() => [...document.querySelectorAll('span')]
            .filter(span=>span.textContent.trim()==='Acting as')
            .flatMap(span=>[...span.parentElement.parentElement.querySelectorAll(
              'button[role="combobox"]')]).length)()`,
        ),
      (count) => count === 1,
    );
    step = 'organization_control_click';
    await click(panel, 'organization', 'Acting as');
    step = 'approved_option_ready';
    const offered = await evaluate(
      panel,
      `(() => [...document.querySelectorAll('[role="option"]')]
        .filter(option=>option.textContent.trim()===${JSON.stringify(approved)}).length)()`,
    );
    if (offered !== 1) fail('approved_option_not_unique');
    step = 'approved_option_click';
    await click(panel, 'option', approved);
    step = 'approved_organization_selected';
    await waitFor(
      'approved_organization_selected',
      () =>
        evaluate(
          panel,
          `(async () => {
            const row=[...document.querySelectorAll('span')]
              .find(span=>span.textContent.trim()==='Acting as');
            const controls=[...(row?.parentElement?.parentElement?.querySelectorAll(
              'button[role="combobox"]')??[])];
            const stored=(await chrome.storage.local.get('matrx.org.active'))['matrx.org.active'];
            return {count:controls.length,displayed:controls[0]?.textContent.trim()===
              ${JSON.stringify(approved)},stored:stored?.name===${JSON.stringify(approved)}&&
              typeof stored?.id==='string'};
          })()`,
        ),
      (state) => state?.count === 1 && state.displayed && state.stored,
    );
  } catch (error) {
    const pointer = error?.driverFailure;
    report.failure ??= {
      stage,
      code: 'approved_organization_selection_failed',
      step,
      driverCode: pointer?.code ?? 'non_pointer_failure',
      pointerHitTarget: pointer?.hitTarget === true,
      matchedTargetCount: Number.isInteger(pointer?.matchedTargetCount)
        ? pointer.matchedTargetCount
        : null,
      visibleMatchCount: Number.isInteger(pointer?.visibleMatchCount)
        ? pointer.visibleMatchCount
        : null,
    };
    try {
      report.failure.surface = await evaluate(
        panel,
        `(() => {
          const settings=document.querySelector('button[role="tab"][title="Settings"]');
          const account=[...document.querySelectorAll('button[aria-expanded]')]
            .filter(button=>button.textContent.trim()==='Account');
          const organization=[...document.querySelectorAll('button[aria-expanded]')]
            .filter(button=>button.textContent.trim()==='Organization');
          const rows=[...document.querySelectorAll('span')]
            .filter(span=>span.textContent.trim()==='Acting as');
          const controls=rows.flatMap(row=>[...row.parentElement.parentElement.querySelectorAll(
            'button[role="combobox"]')]);
          return {settingsTabActive:settings?.getAttribute('data-state')==='active',
            accountSectionCount:account.length,accountExpanded:account[0]?.getAttribute('aria-expanded')??null,
            organizationSectionCount:organization.length,
            organizationExpanded:organization[0]?.getAttribute('aria-expanded')??null,
            actingAsRowCount:rows.length,organizationControlCount:controls.length,
            approvedOptionCount:[...document.querySelectorAll('[role="option"]')]
              .filter(option=>option.textContent.trim()===${JSON.stringify(approved)}).length};
        })()`,
      );
    } catch {
      report.failure.surface = { available: false };
    }
    throw new Error('screenshot_admin_org_selection_unverified');
  }
}

function canonical(url) {
  const parsed = new URL(url);
  const host = parsed.host.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/, '') : parsed.pathname;
  return `${host}${path}${parsed.search}`;
}

async function gallery(panel, expectedCanonical) {
  return evaluate(
    panel,
    `(() => {
      const expected=${JSON.stringify(expectedCanonical)};
      const tabs=[...document.querySelectorAll('button[role="tab"][title="Screenshots"]')];
      const tab=tabs.length===1?tabs[0]:null;
      const pane=tab?.getAttribute('aria-controls')?
        document.getElementById(tab.getAttribute('aria-controls')):null;
      const active=!!pane&&pane.matches('[role="tabpanel"][data-state="active"]');
      const visible=active&&pane.getBoundingClientRect().height>0;
      const text=pane?.innerText??'';
      const refresh=pane?.querySelector('button[title="Refresh"]');
      const buttons=[...(pane?.querySelectorAll('button[title="Open in Files"]')??[])];
      const cards=buttons.length%2===0?buttons.length/2:null;
      const displayed=[...(pane?.querySelectorAll('span[title]')??[])]
        .filter(span=>span.title===expected);
      return {tabCount:tabs.length,selected:tab?.getAttribute('aria-selected')==='true',
        linked:pane?.getAttribute('aria-labelledby')===tab?.id,active,visible,
        heading:text.includes('Screenshots'),canonicalCount:displayed.length,
        refreshCount:refresh?1:0,refreshDisabled:refresh?.disabled??null,
        loading:!!pane?.querySelector('svg.animate-spin')&&buttons.length===0,
        empty:text.includes('No screenshots yet'),noPage:text.includes('No active page'),
        error:text.includes("Couldn't load screenshots"),cardCount:cards,
        filesButtonCount:buttons.length,
        adminAvatar:document.querySelectorAll('button[title="${ADMIN_EMAIL}"]').length};
    })()`,
  );
}

async function selectedGallery(panel, expectedCanonical) {
  return waitFor(
    'mounted_admin_gallery',
    () => gallery(panel, expectedCanonical),
    (state) =>
      state?.tabCount === 1 &&
      state.selected &&
      state.linked &&
      state.active &&
      state.visible &&
      state.heading &&
      state.canonicalCount === 1 &&
      state.refreshCount === 1 &&
      state.refreshDisabled === false &&
      !state.loading &&
      state.adminAvatar === 1,
    30_000,
  );
}

// Compare every rendered card with metadata from the completed real GET,
// including its order. All private row values stay inside this read-only
// evaluation; only booleans leave the panel, and IDs are never serialized.
async function galleryResponseAgreement(panel, rows, previousRows = []) {
  const identity = (row) => ({
    captured_at: row.captured_at,
    width: row.width,
    height: row.height,
    source: row.source,
    page_title: row.page_title,
  });
  return evaluate(
    panel,
    `(() => {
      const expected=${JSON.stringify(rows.map(identity))};
      const prior=${JSON.stringify(previousRows.map(identity))};
      const signature=row=>{
        const date=new Date(row.captured_at);
        const full=Number.isNaN(date.getTime())?row.captured_at:date.toLocaleString();
        const dimension=row.width&&row.height?String(row.width)+'×'+String(row.height):'';
        const source=row.source==='agent'?'Agent':row.source==='user'?'You':'Unknown';
        return JSON.stringify([full,dimension,source]);
      };
      const tab=document.querySelector('button[role="tab"][title="Screenshots"][data-state="active"]');
      const pane=tab?document.getElementById(tab.getAttribute('aria-controls')):null;
      const cards=[...(pane?.querySelectorAll('div.group')??[])]
        .filter(card=>card.querySelectorAll('button[title="Open in Files"]').length===2);
      const observed=cards.map(card=>{
        const full=card.querySelector('span.ml-auto[title]')?.title??null;
        const dimension=card.querySelector('div.border-t span[title]')?.title??null;
        const source=card.querySelector('span[title="Source"]')?.textContent.trim()??null;
        const title=card.querySelector('img')?.alt??null;
        return {signature:JSON.stringify([full,dimension,source]),title};
      });
      const currentKeys=expected.map(signature),priorKeys=prior.map(signature);
      const distinct=new Set(currentKeys).size===currentKeys.length;
      const crossUrlDistinct=currentKeys.every(key=>!priorKeys.includes(key));
      const ordered=observed.length===expected.length&&observed.every((card,index)=>
        card.signature===currentKeys[index]&&
        (card.title===null||card.title===(expected[index].page_title??'screenshot')));
      return {cardCount:cards.length,ordered,distinct,crossUrlDistinct};
    })()`,
  );
}

async function requireGalleryAgreement(panel, state, rows, previousRows = []) {
  if (
    state.cardCount !== rows.length ||
    state.empty !== (rows.length === 0) ||
    state.error ||
    state.noPage
  )
    fail('gallery_empty_or_count_disagrees_with_real_read');
  const identity = await galleryResponseAgreement(panel, rows, previousRows);
  if (
    identity.cardCount !== rows.length ||
    !identity.ordered ||
    !identity.distinct ||
    !identity.crossUrlDistinct
  )
    fail('gallery_identity_unverified_or_mismatched');
  return {
    responseToUiIdentityMatched: rows.length > 0 ? true : 'not_applicable_empty',
    emptyStateMatchesResponse: true,
  };
}

async function watchGalleryReads(panel) {
  await panel.send('Network.enable');
  const requests = new Map();
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    try {
      const url = new URL(request?.url);
      if (request?.method !== 'GET' || !url.pathname.endsWith('/wbx_screenshot')) return;
      const identity = url.searchParams.get('page_url_canonical');
      if (!identity?.startsWith('eq.')) return;
      requests.set(requestId, {
        canonical: identity.slice(3),
        status: null,
        finished: false,
        rows: null,
        outcome: 'pending',
      });
    } catch {
      // Unrelated traffic cannot establish a gallery read.
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const request = requests.get(requestId);
    if (request) request.status = response?.status ?? null;
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    const request = requests.get(requestId);
    if (!request) return;
    request.finished = true;
    if (request.status !== 200) {
      request.outcome = 'http_failure';
      return;
    }
    void panel
      .send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) => {
        const raw = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
        const rows = JSON.parse(raw);
        if (
          !Array.isArray(rows) ||
          !rows.every(
            (row) =>
              row.page_url_canonical === request.canonical &&
              typeof row.file_id === 'string' &&
              row.file_id.length > 0,
          )
        ) {
          request.outcome = 'body_invalid';
          return;
        }
        request.rows = rows;
        request.outcome = 'complete';
      })
      .catch(() => {
        request.outcome = 'body_unavailable';
      });
  });
  const offFailed = panel.on('Network.loadingFailed', ({ requestId }) => {
    const request = requests.get(requestId);
    if (request) request.outcome = 'network_failure';
  });
  return {
    marker: () => requests.size,
    completedAfter: (index, expected) =>
      [...requests.values()]
        .slice(index)
        .filter((request) => request.canonical === expected && request.outcome === 'complete'),
    summaryAfter: (index, expected) =>
      [...requests.values()]
        .slice(index)
        .filter((request) => request.canonical === expected)
        .map((request) => ({ status: request.status, outcome: request.outcome })),
    pendingAt: (index, expected) =>
      [...requests.values()]
        .slice(index)
        .some((request) => request.canonical === expected && request.outcome === 'pending'),
    stop: () => {
      offRequest();
      offResponse();
      offFinished();
      offFailed();
    },
  };
}

async function completedRead(journal, marker, expected) {
  const requests = await waitFor(
    'completed_real_gallery_read',
    () => journal.completedAfter(marker, expected),
    (value) => value.length >= 1,
    30_000,
  );
  if (requests.length !== 1) fail('gallery_read_not_unique');
  return requests[0];
}

async function openFirstExistingRow(page, panel, row) {
  stage = 'open_existing_row';
  const position = await evaluate(
    panel,
    `(() => {
      const tab=document.querySelector('button[role="tab"][title="Screenshots"][data-state="active"]');
      const pane=tab?document.getElementById(tab.getAttribute('aria-controls')):null;
      const cards=[...(pane?.querySelectorAll('button[title="Open in Files"]')??[])];
      const button=cards[0],rect=button?.getBoundingClientRect();
      const x=rect?rect.left+rect.width/2:null,y=rect?rect.top+rect.height/2:null;
      const hit=rect?document.elementFromPoint(x,y):null;
      return {count:cards.length,x,y,
        visible:!!rect&&rect.width>0&&rect.height>0,
        hit:!!button&&(hit===button||button.contains(hit))};
    })()`,
  );
  if (!position.visible || !position.hit || position.count < 2 || position.count % 2 !== 0)
    fail('existing_row_open_target_unverified');
  const opened = page.context().waitForEvent('page', { timeout: 15_000 });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: position.x,
    y: position.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: position.x,
    y: position.y,
    button: 'left',
    clickCount: 1,
  });
  const tab = await opened;
  try {
    await tab.waitForURL((url) => url.pathname.startsWith('/files/f/'), { timeout: 30_000 });
    const target = new URL(tab.url());
    const expectedPath = `/files/f/${encodeURIComponent(row.file_id)}`;
    if (
      !['https://aimatrx.com', WEB_ORIGIN].includes(target.origin) ||
      target.pathname !== expectedPath
    )
      fail('files_target_mismatch');
  } finally {
    await tab.close();
  }
}

async function exercise({ page, panel }) {
  const approved = await approvedOrganization();
  await signIn(page, panel);
  await selectApprovedOrganization(panel, approved);
  const journal = await watchGalleryReads(panel);
  try {
    stage = 'first_public_page';
    await page.goto(PAGES[0], { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const firstCanonical = canonical(page.url());
    if (firstCanonical !== canonical(PAGES[0])) fail('first_public_page_redirected');
    const firstMarker = journal.marker();
    await click(panel, 'title', 'Screenshots');
    const initialRead = await completedRead(journal, firstMarker, firstCanonical);
    const initial = await selectedGallery(panel, firstCanonical);
    const initialAgreement = await requireGalleryAgreement(panel, initial, initialRead.rows);
    report.cases.push({
      id: 'EXT-F-1009-T08',
      subcase: 'admin_initial_settled_gallery',
      status: 'pass',
      actual: {
        rowCount: initial.cardCount,
        empty: initial.empty,
        readStatus: initialRead.status,
        ...initialAgreement,
      },
    });

    stage = 'refresh_first_page';
    const refreshMarker = journal.marker();
    await click(panel, 'title', 'Refresh');
    const refreshedRead = await completedRead(journal, refreshMarker, firstCanonical);
    const refreshed = await selectedGallery(panel, firstCanonical);
    const refreshAgreement = await requireGalleryAgreement(panel, refreshed, refreshedRead.rows);
    report.cases.push({
      id: 'EXT-F-1009-T01',
      subcase: 'current_url_refresh',
      status: 'pass',
      actual: {
        realReadStatus: refreshedRead.status,
        rowCount: refreshed.cardCount,
        ...refreshAgreement,
      },
    });

    stage = 'switch_public_page';
    const switchMarker = journal.marker();
    const firstReadPendingAtSwitch = journal.pendingAt(0, firstCanonical);
    await page.goto(PAGES[1], { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const secondCanonical = canonical(page.url());
    if (secondCanonical !== canonical(PAGES[1])) fail('second_public_page_redirected');
    const secondRead = await completedRead(journal, switchMarker, secondCanonical);
    const second = await selectedGallery(panel, secondCanonical);
    const secondAgreement = await requireGalleryAgreement(
      panel,
      second,
      secondRead.rows,
      refreshedRead.rows,
    );
    report.cases.push({
      id: 'EXT-F-1009-T01',
      subcase: 'page_switch_settled',
      status: secondRead.rows.length > 0 ? 'pass' : 'unverified',
      actual: {
        realReadStatus: secondRead.status,
        rowCount: second.cardCount,
        ...secondAgreement,
        emptyToEmptyRowCorrespondence:
          secondRead.rows.length === 0 ? 'unverified' : 'not_applicable',
        stale_response_race: firstReadPendingAtSwitch ? 'observed_pending_only' : 'unverified',
      },
    });

    stage = 'real_panel_reload';
    const loaderBefore = (await panel.send('Page.getFrameTree'))?.frameTree?.frame?.loaderId;
    if (!loaderBefore) fail('loader_before_reload_missing');
    const reloadMarker = journal.marker();
    await panel.send('Page.reload', { ignoreCache: false });
    await waitFor(
      'new_panel_document',
      async () => (await panel.send('Page.getFrameTree'))?.frameTree?.frame?.loaderId,
      (loader) => Boolean(loader && loader !== loaderBefore),
      30_000,
    );
    const reloadRead = await completedRead(journal, reloadMarker, secondCanonical);
    const reloaded = await selectedGallery(panel, secondCanonical);
    const reloadAgreement = await requireGalleryAgreement(
      panel,
      reloaded,
      reloadRead.rows,
      refreshedRead.rows,
    );
    report.cases.push({
      id: 'EXT-F-1009-T01',
      subcase: 'real_panel_reload',
      status: 'pass',
      actual: {
        newDocument: true,
        realReadStatus: reloadRead.status,
        rowCount: reloaded.cardCount,
        ...reloadAgreement,
      },
    });

    stage = 'refresh_reloaded_page';
    const afterReloadMarker = journal.marker();
    await click(panel, 'title', 'Refresh');
    const afterReloadRead = await completedRead(journal, afterReloadMarker, secondCanonical);
    const afterReload = await selectedGallery(panel, secondCanonical);
    const afterReloadAgreement = await requireGalleryAgreement(
      panel,
      afterReload,
      afterReloadRead.rows,
      refreshedRead.rows,
    );
    report.cases.push({
      id: 'EXT-F-1009-T01',
      subcase: 'refresh_after_real_reload',
      status: 'pass',
      actual: {
        realReadStatus: afterReloadRead.status,
        rowCount: afterReload.cardCount,
        ...afterReloadAgreement,
      },
    });

    const firstRow = afterReloadRead.rows[0];
    if (firstRow) {
      await openFirstExistingRow(page, panel, firstRow);
      report.cases.push({
        id: 'EXT-F-1009-T04',
        subcase: 'existing_row_thumbnail',
        status: 'pass',
        actual: { newTabCanonicalFilesTargetMatched: true },
      });
    } else {
      report.cases.push({
        id: 'EXT-F-1009-T04',
        subcase: 'existing_row_thumbnail',
        status: 'unverified',
        actual: 'No pre-existing public-page screenshot row; no capture was created.',
      });
    }
    report.status = 'partial';
  } finally {
    journal.stop();
  }
}

try {
  const before = await buildIdentity();
  report.build = { version: before.version, treeSha256: before.treeSha256, before, after: null };
  stage = 'owned_native_profile';
  const run = await runNativeSidepanelQa({ exercisePanel: exercise });
  assert.equal(run.verified, true);
  stage = 'build_end';
  const after = await buildIdentity();
  if (
    after.version !== before.version ||
    after.treeSha256 !== before.treeSha256 ||
    hashReleaseTree(EXTENSION_DIR) !== before.treeSha256
  )
    fail('release_changed_during_run');
  report.build.after = { ...after, extensionId: run.extensionId };
  report.build.artifactTreeMatchedAfter = true;
  report.profileOwned = true;
} catch {
  report.status = 'unverified';
  report.failure ??= { stage, code: 'owned_harness_or_ui_stage_failed' };
}
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} screenshot_admin_readonly\n`);
if (report.status === 'unverified') process.exitCode = 1;
