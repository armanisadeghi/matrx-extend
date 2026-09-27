#!/usr/bin/env node
/** EXT-F-1009 owned localhost visible capture; source review required before browser use. */
import assert from 'node:assert/strict';
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
const OUTPUT = join(REPO, 'test-results', `screenshot-capture-${randomUUID()}.json`);
const EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3-dev');
const RECEIPT = resolve(
  REPO,
  process.env.SCREENSHOT_CAPTURE_DEV_BUILD_RECEIPT ??
    join(REPO, 'test-results', 'source-dev-build-093-contained-20260927.json'),
);
if (dirname(RECEIPT) !== join(REPO, 'test-results'))
  throw new Error('screenshot_capture_receipt_path_refused');
const MANIFEST = join(EXTENSION_DIR, 'manifest.json');
const PRIVATE_CONFIG = join(REPO, 'test-results', 'd22-private-config.json');
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const ADMIN_EMAIL = 'admin@admin.com';
const WEB_ORIGIN = 'https://www.aimatrx.com';
const FIXTURE_HTML = `<!doctype html><meta charset="utf-8"><title>Harbor Dental appointment guide</title><style>html,body{margin:0;min-height:100%;height:100%}body{background:linear-gradient(90deg,#183f67 0 33%,#ef476f 33% 66%,#36c58b 66% 100%);color:#fff;font:20px system-ui}main{padding:18px;text-shadow:0 1px 3px #000}body::after{content:"";position:fixed;left:0;right:0;bottom:0;height:24px;background:linear-gradient(90deg,#183f67 0 33%,#ef476f 33% 66%,#36c58b 66% 100%);pointer-events:none}</style><main><h1>Harbor Dental appointment guide</h1><p>Bring your insurance card and a list of current medicines to your first appointment.</p></main>`;
let stage = 'build_start';
const report = {
  schema_version: 1,
  feature: 'EXT-F-1009',
  scope: 'admin Visible capture on owned localhost fixture; preview, gallery, owned-row cleanup',
  status: 'unverified',
  build: null,
  cases: [],
};

function fail(code) {
  report.failure = { stage, code };
  throw new Error('screenshot_capture_unverified');
}

// Fixed UI/count diagnostics only. Never persist exception messages, URLs,
// credentials, request IDs, file IDs, response rows or visible private text.
function safeObservation(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string')
    return [
      'true',
      'false',
      'pending',
      'complete',
      'http_failure',
      'network_failure',
      'body_invalid',
      'body_unavailable',
    ].includes(value)
      ? value
      : { valuePresent: value.length > 0 };
  if (Array.isArray(value)) return value.map(safeObservation);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, safeObservation(item)]),
    );
  return null;
}

function safeFailure(error) {
  const pointer = error?.driverFailure;
  const codes = new Set([
    'pointer_initial_evaluation_failed',
    'pointer_page_sample_failed',
    'pointer_target_not_unique',
    'pointer_followup_evaluation_failed',
    'pointer_stable_hit_not_observed',
    'pointer_press_dispatch_failed',
    'pointer_release_dispatch_failed',
  ]);
  return {
    timeout: error?.name === 'TimeoutError',
    assertion: error?.code === 'ERR_ASSERTION',
    driverCode: codes.has(pointer?.code) ? pointer.code : null,
    hitTarget: pointer?.hitTarget === true,
    matchedTargetCount: Number.isInteger(pointer?.matchedTargetCount)
      ? pointer.matchedTargetCount
      : null,
    visibleMatchCount: Number.isInteger(pointer?.visibleMatchCount)
      ? pointer.visibleMatchCount
      : null,
  };
}

async function observedWait(label, read, accept, timeoutMs) {
  report.operation = label;
  return waitFor(
    label,
    async () => {
      try {
        const state = await read();
        report.observations ??= {};
        report.observations[label] = safeObservation(state);
        return state;
      } catch (error) {
        report.observations ??= {};
        report.observations[label] = { readFailed: true, ...safeFailure(error) };
        throw error;
      }
    },
    accept,
    timeoutMs,
  );
}

async function safeSurface(page, panel, expectedCanonical) {
  const result = { pageClosed: page.isClosed() };
  if (!result.pageClosed) {
    try {
      result.publicPageMatchesExpected = canonical(page.url()) === expectedCanonical;
    } catch {
      result.publicPageMatchesExpected = false;
    }
    try {
      result.publicDocument = await page.evaluate(() => ({
        domReady: document.readyState === 'interactive' || document.readyState === 'complete',
        bodyPresent: !!document.body,
      }));
    } catch {
      result.publicDocument = { available: false };
    }
  }
  try {
    result.panel = await evaluate(
      panel,
      `(async()=>{
      const tabs=await chrome.tabs.query({active:true,currentWindow:true});
      const expected=${JSON.stringify(expectedCanonical)};
      const canonical=url=>{try{
        const parsed=new URL(url),host=parsed.host.toLowerCase().replace(/^www[.]/,'');
        const path=parsed.pathname.length>1?parsed.pathname.replace(/[/]$/,''):parsed.pathname;
        return host+path+parsed.search;
      }catch{return null}};
      const screen=document.querySelector('button[role="tab"][title="Screenshots"]');
      return {activeTabCount:tabs.length,
        activeTabMatchesExpected:tabs.length===1&&canonical(tabs[0].url)===expected,
        screenshotTabPresent:!!screen,screenshotTabSelected:screen?.getAttribute('aria-selected')==='true',
        settingsTabSelected:document.querySelector('button[role="tab"][title="Settings"]')?.getAttribute('aria-selected')==='true',
        adminAvatarCount:document.querySelectorAll('button[title="${ADMIN_EMAIL}"]').length,
        dialogCount:document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length};
    })()`,
    );
    result.gallery = await gallery(panel, expectedCanonical);
  } catch {
    result.panelObservationUnavailable = true;
  }
  return result;
}

async function buildIdentity() {
  const [receipt, manifest, pkg] = await Promise.all([
    readFile(RECEIPT, 'utf8').then(JSON.parse),
    readFile(MANIFEST, 'utf8').then(JSON.parse),
    readFile(join(REPO, 'package.json'), 'utf8').then(JSON.parse),
  ]);
  requireLocalDevReceipt(receipt, EXTENSION_DIR);
  if (
    !manifest.key ||
    receipt.version !== manifest.version ||
    receipt.version !== pkg.version ||
    hashReleaseTree(EXTENSION_DIR) !== receipt.treeSha256
  )
    fail('dev_build_identity_mismatch');
  return {
    kind: receipt.kind,
    publishState: receipt.publish_state,
    version: manifest.version,
    treeSha256: receipt.treeSha256,
  };
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
  report.operation = stage;
  await click(panel, 'title', 'Settings');
  await openSection(panel, 'Account');
  const web = await page.context().newPage();
  try {
    stage = 'admin_web_login_navigation';
    report.operation = stage;
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const route = new URL(web.url());
    if (route.origin !== WEB_ORIGIN || route.pathname !== '/login') fail('login_route_unverified');
    // Mirrors the real web-form/extension flow in screenshot-guest-acceptance.mjs.
    // Credentials are read only after the login form is present.
    stage = 'admin_web_credentials';
    report.operation = stage;
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
    stage = 'admin_web_form_fill';
    report.operation = stage;
    await web.locator('input[name="email"]').fill(ADMIN_EMAIL);
    await web.locator('input[name="password"]').fill(variables.AI_ADMIN_PASSWORD);
    stage = 'admin_web_form_submit';
    report.operation = stage;
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    stage = 'admin_extension_signin_click';
    report.operation = stage;
    await click(panel, 'button', 'Sign in');
    stage = 'admin_extension_identity_wait';
    report.operation = stage;
    await observedWait(
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
  report.operation = stage;
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
    await observedWait(
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
    await observedWait(
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
    await observedWait(
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
        .filter(span=>span.textContent.trim()===expected);
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
  return observedWait(
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
  let panelRequestCount = 0;
  let screenshotGetCount = 0;
  let screenshotFilterMissingCount = 0;
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    panelRequestCount++;
    try {
      const url = new URL(request?.url);
      if (request?.method !== 'GET' || !url.pathname.endsWith('/wbx_screenshot')) return;
      screenshotGetCount++;
      const identity = url.searchParams.get('page_url_canonical');
      if (!identity?.startsWith('eq.')) {
        screenshotFilterMissingCount++;
        return;
      }
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
    diagnostic: (expected) => ({
      panelRequestCount,
      screenshotGetCount,
      screenshotFilterMissingCount,
      observedGalleryReadCount: requests.size,
      matchingPageCount: [...requests.values()].filter((request) => request.canonical === expected)
        .length,
      otherPageCount: [...requests.values()].filter((request) => request.canonical !== expected)
        .length,
      outcomes: [...requests.values()].map((request) => ({
        expectedPage: request.canonical === expected,
        status: request.status,
        finished: request.finished,
        outcome: request.outcome,
      })),
    }),
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
  await observedWait(
    'completed_real_gallery_read',
    () => ({
      completedCount: journal.completedAfter(marker, expected).length,
      requests: journal.summaryAfter(marker, expected),
      allReads: journal.diagnostic(expected),
    }),
    (value) => value.completedCount >= 1,
    30_000,
  );
  const requests = journal.completedAfter(marker, expected);
  if (requests.length !== 1) fail('gallery_read_not_unique');
  return requests[0];
}

// The fixture's three broad vertical bands are an oracle independent of the
// screenshot handler and gallery metadata. The fixed bottom strip keeps each
// sample clear of fixture text at every viewport height; JPEG conversion may
// slightly shift the channels.
async function fixturePixels(panel) {
  return evaluate(
    panel,
    `(() => {
    const tab=document.querySelector('button[role="tab"][title="Screenshots"][data-state="active"]');
    const pane=tab?document.getElementById(tab.getAttribute('aria-controls')):null;
    const image=pane?.querySelector('div.group img');
    if (!image?.complete || image.naturalWidth<30 || image.naturalHeight<30)
      return {decoded:false, fingerprint:false};
    const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if (!ctx) return {decoded:true,fingerprint:false};
    const expected=[[24,63,103],[239,71,111],[54,197,139]];
    const positions=[.16,.50,.84];
    const matches=positions.map((fraction,index)=>{
      ctx.clearRect(0,0,1,1);
      ctx.drawImage(image,Math.floor(image.naturalWidth*fraction),
        image.naturalHeight-8,1,1,0,0,1,1);
      const pixel=ctx.getImageData(0,0,1,1).data;
      return expected[index].every((channel,i)=>Math.abs(pixel[i]-channel)<=32)&&pixel[3]===255;
    });
    return {decoded:true,fingerprint:matches.every(Boolean),bandsMatched:matches.filter(Boolean).length,
      bandMatches:matches};
  })()`,
  );
}

async function preserveOwnedFixturePreview(page, panel, expectedCanonical) {
  // A failed pixel oracle may have captured the wrong surface. Keep bytes
  // locally private and only after both the page and Chrome's active tab
  // still identify this run's fresh fixture.
  if (canonical(page.url()) !== expectedCanonical) return false;
  const fixture = await page.evaluate(() => ({
    title: document.title,
    marker: document.body?.innerText.includes('Bring your insurance card'),
  }));
  if (fixture.title !== 'Harbor Dental appointment guide' || !fixture.marker) return false;
  const dataUrl = await evaluate(
    panel,
    `(() => {
    const tabs=chrome.tabs.query({active:true,currentWindow:true});
    return tabs.then(found=>{
      if(found.length!==1 || found[0].url!==${JSON.stringify(page.url())}) return null;
      const tab=document.querySelector('button[role="tab"][title="Screenshots"][data-state="active"]');
      const pane=tab?document.getElementById(tab.getAttribute('aria-controls')):null;
      const cards=[...(pane?.querySelectorAll('div.group')??[])]
        .filter(card=>card.querySelectorAll('button[title="Open in Files"]').length===2);
      const image=cards.length===1?cards[0].querySelector('img'):null;
      if(!image?.complete || !image.src.startsWith('blob:')) return null;
      const canvas=document.createElement('canvas');
      canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image,0,0);
      return canvas.toDataURL('image/png');
    });
  })()`,
  );
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return false;
  await writeFile(
    OUTPUT.replace(/\.json$/, '.fixture-failure.png'),
    Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'),
    { flag: 'wx', mode: 0o600 },
  );
  return true;
}

async function exercise({ page, panel }) {
  let journal;
  let server;
  let createdRow;
  let fixtureCanonical;
  let cleaned = false;
  let captureClicked = false;
  let fixtureViewport;
  try {
    const approved = await approvedOrganization();
    await signIn(page, panel);
    await selectApprovedOrganization(panel, approved);
    server = createServer((_request, response) =>
      response
        .writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        })
        .end(FIXTURE_HTML),
    );
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const fixtureUrl = `http://127.0.0.1:${server.address().port}/harbor-dental/appointment-guide/${randomUUID()}`;
    stage = 'owned_fixture_navigation';
    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
    assert.equal(page.url(), fixtureUrl);
    assert.equal(await page.title(), 'Harbor Dental appointment guide');
    fixtureViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    if (!(fixtureViewport.width > 30 && fixtureViewport.height > 30))
      fail('fixture_viewport_unavailable');
    fixtureCanonical = canonical(fixtureUrl);
    journal = await watchGalleryReads(panel);
    const beforeMarker = journal.marker();
    stage = 'gallery_before_capture';
    await click(panel, 'title', 'Screenshots');
    const beforeRead = await completedRead(journal, beforeMarker, fixtureCanonical);
    const before = await selectedGallery(panel, fixtureCanonical);
    await requireGalleryAgreement(panel, before, beforeRead.rows);
    if (beforeRead.rows.length !== 0 || !before.empty) fail('fixture_not_empty_before_capture');

    stage = 'visible_user_capture';
    const captureMarker = journal.marker();
    captureClicked = true;
    await click(panel, 'button-text', 'Visible');
    const afterRead = await completedRead(journal, captureMarker, fixtureCanonical);
    // Claim the only new row before any later UI/metadata assertion can fail.
    // The unique URL's completed zero-row baseline establishes its ownership.
    if (
      afterRead.rows.length === 1 &&
      typeof afterRead.rows[0]?.id === 'string' &&
      afterRead.rows[0].id.length > 0
    )
      createdRow = afterRead.rows[0];
    const after = await selectedGallery(panel, fixtureCanonical);
    await requireGalleryAgreement(panel, after, afterRead.rows);
    if (
      afterRead.rows.length !== 1 ||
      afterRead.rows[0].source !== 'user' ||
      !afterRead.rows[0].id ||
      !afterRead.rows[0].file_id ||
      !(afterRead.rows[0].width > 0) ||
      !(afterRead.rows[0].height > 0)
    )
      fail('real_user_capture_row_missing');
    if (
      Math.abs(
        afterRead.rows[0].width / afterRead.rows[0].height -
          fixtureViewport.width / fixtureViewport.height,
      ) > 0.08
    )
      fail('capture_aspect_disagrees_with_current_viewport');
    const preview = await observedWait(
      'owned_capture_preview',
      () =>
        evaluate(
          panel,
          `(() => {
      const pane=document.querySelector('button[role="tab"][title="Screenshots"][data-state="active"]')
        ?.getAttribute('aria-controls');
      const root=pane?document.getElementById(pane):null;
      const cards=[...(root?.querySelectorAll('div.group')??[])]
        .filter(card=>card.querySelectorAll('button[title="Open in Files"]').length===2);
      const image=cards[0]?.querySelector('img');
      return {cardCount:cards.length, sourceYou:cards[0]?.querySelector('span[title="Source"]')
        ?.textContent.trim()==='You', blobImage:!!image?.src.startsWith('blob:'),
        loaded:!!image?.complete&&image.naturalWidth>0&&image.naturalHeight>0,
        dimensions:cards[0]?.querySelector('div.border-t span[title]')?.title===
          ${JSON.stringify(`${createdRow.width}×${createdRow.height}`)},
        error:!!root?.innerText.includes('Captured, but failed to save')};
    })()`,
        ),
      (state) =>
        state?.cardCount === 1 &&
        state.sourceYou &&
        state.blobImage &&
        state.loaded &&
        state.dimensions &&
        !state.error,
      30000,
    );
    const pixels = await fixturePixels(panel);
    report.observations ??= {};
    report.observations.ownedFixturePixels = safeObservation(pixels);
    if (!pixels?.decoded || !pixels.fingerprint || pixels.bandsMatched !== 3) {
      try {
        report.observations.ownedFixtureFailureImagePreserved = await preserveOwnedFixturePreview(
          page,
          panel,
          fixtureCanonical,
        );
      } catch {
        report.observations.ownedFixtureFailureImagePreserved = false;
      }
      fail('captured_pixels_do_not_match_owned_fixture');
    }

    stage = 'owned_capture_delete_prompt';
    await click(panel, 'title', 'Delete');
    const confirmation = await observedWait(
      'owned_capture_confirmation',
      () =>
        evaluate(
          panel,
          `(() => {const dialog=document.querySelector('[role="alertdialog"],[role="dialog"]');
        return {visible:!!dialog, consequence:!!dialog?.innerText.includes(
          'The image file itself stays in your Files'), confirmButton:
          [...(dialog?.querySelectorAll('button')??[])].some(button=>button.textContent.trim()==='Delete')};})()`,
        ),
      (state) => state?.visible && state.consequence && state.confirmButton,
    );
    if (!confirmation.consequence) fail('delete_consequence_missing');
    stage = 'owned_capture_delete_confirm';
    const deleteMarker = journal.marker();
    await click(panel, 'button-text', 'Delete');
    const deletedRead = await completedRead(journal, deleteMarker, fixtureCanonical);
    const deleted = await selectedGallery(panel, fixtureCanonical);
    await requireGalleryAgreement(panel, deleted, deletedRead.rows);
    if (
      deletedRead.rows.some((row) => row.id === createdRow.id) ||
      deletedRead.rows.length !== 0 ||
      !deleted.empty
    )
      fail('owned_row_not_deleted');
    cleaned = true;
    report.cases.push({
      id: 'EXT-F-1009-T02',
      subcase: 'admin_visible_owned_fixture',
      status: 'pass',
      actual: {
        realGalleryRead: afterRead.status === 200,
        persistedUserRow: true,
        positiveDimensions: true,
        previewLoaded: preview.loaded,
        sourceLabelYou: true,
        capturedFixturePixelBandsMatched: true,
      },
    });
    report.cases.push({
      id: 'EXT-F-1009-T06',
      subcase: 'owned_capture_index_cleanup',
      status: 'pass',
      actual: {
        confirmedConsequence: true,
        createdRowAbsentAfterRealRead: true,
        fileRetentionByDesign: 'file remains in Files; index row removed',
      },
    });
    report.status = 'partial';
  } catch (error) {
    report.failure ??= { stage, code: 'owned_capture_stage_failed' };
    report.failure.driver = safeFailure(error);
    report.failure.fixtureOnly = !!fixtureCanonical;
    report.failure.createdRowMayNeedUiCleanup = captureClicked && !cleaned;
    if (createdRow && !cleaned) {
      const primaryFailure = report.failure;
      // Recovery may touch only the sole card observed for this run's fresh,
      // empty-before-capture URL. A row or page mismatch leaves it for review.
      try {
        report.failure.ownedUiCleanupStage = 'page_identity';
        if (canonical(page.url()) !== fixtureCanonical) throw new Error('page_changed');
        report.failure.ownedUiCleanupStage = 'card_identity';
        const identity = await galleryResponseAgreement(panel, [createdRow]);
        report.failure.ownedUiCleanupCardIdentity = safeObservation(identity);
        if (identity.cardCount === 1 && identity.ordered && identity.distinct) {
          report.failure.ownedUiCleanupStage = 'dialog';
          const dialog = await evaluate(
            panel,
            `(() => !!document.querySelector('[role="alertdialog"],[role="dialog"]'))()`,
          );
          if (!dialog) {
            report.failure.ownedUiCleanupStage = 'delete_prompt_click';
            await click(panel, 'title', 'Delete');
          }
          report.failure.ownedUiCleanupStage = 'delete_consequence';
          const confirmation = await observedWait(
            'owned_cleanup_confirmation',
            () => evaluate(
              panel,
              `(() => {const dialog=document.querySelector('[role="alertdialog"],[role="dialog"]');
                return {visible:!!dialog,consequence:dialog?.innerText.includes(
                  'The image file itself stays in your Files')===true,
                  confirmButton:[...(dialog?.querySelectorAll('button')??[])]
                    .some(button=>button.textContent.trim()==='Delete')};})()`,
            ),
            (state) => state?.visible && state.consequence && state.confirmButton,
          );
          if (!confirmation.consequence) throw new Error('consequence_not_visible');
          report.failure.ownedUiCleanupStage = 'delete_confirm_click';
          await click(panel, 'button-text', 'Delete');
          report.failure.ownedUiCleanupAttempted = true;
        } else if (identity.cardCount !== 0) {
          throw new Error('owned_card_not_unique');
        }
        // A click is not cleanup proof. Force a fresh real list read and
        // require the exact captured row absent before clearing the flag.
        const cleanupMarker = journal.marker();
        report.failure.ownedUiCleanupStage = 'refresh_click';
        await click(panel, 'title', 'Refresh');
        report.failure.ownedUiCleanupStage = 'verified_read';
        const cleanupRead = await completedRead(journal, cleanupMarker, fixtureCanonical);
        if (
          cleanupRead.rows.some((row) => row.id === createdRow.id) ||
          cleanupRead.rows.length !== 0
        )
          throw new Error('owned_row_still_present');
        cleaned = true;
        report.failure.createdRowMayNeedUiCleanup = false;
        report.failure.ownedUiCleanupVerified = true;
      } catch (cleanupError) {
        const cleanupCode =
          report.failure !== primaryFailure && report.failure?.code === 'gallery_read_not_unique'
            ? 'gallery_read_not_unique'
            : 'owned_ui_cleanup_failed';
        report.failure = primaryFailure;
        report.failure.ownedUiCleanupFailure = {
          stage: primaryFailure.ownedUiCleanupStage ?? 'unknown',
          code: cleanupCode,
          driver: safeFailure(cleanupError),
        };
        report.failure.ownedUiCleanupVerified = false;
      }
    }
    throw new Error('screenshot_capture_unverified');
  } finally {
    journal?.stop();
    await new Promise((resolve) => server?.close(resolve) ?? resolve());
  }
}

try {
  const before = await buildIdentity();
  report.build = { version: before.version, treeSha256: before.treeSha256, before, after: null };
  stage = 'owned_native_profile';
  report.operation = stage;
  const run = await runNativeSidepanelQa({
    extensionDir: EXTENSION_DIR,
    expectedRelease: before,
    localDevReceiptPath: RECEIPT,
    exercisePanel: exercise,
  });
  assert.equal(run.verified, true);
  stage = 'build_end';
  report.operation = stage;
  const after = await buildIdentity();
  if (
    after.version !== before.version ||
    after.treeSha256 !== before.treeSha256 ||
    hashReleaseTree(EXTENSION_DIR) !== before.treeSha256
  )
    fail('dev_build_changed_during_run');
  report.build.after = { ...after, extensionId: run.extensionId };
  report.build.artifactTreeMatchedAfter = true;
  report.profileOwned = true;
} catch (error) {
  report.status = 'unverified';
  report.failureDiagnostic = safeFailure(error);
  report.failure ??= { stage, code: 'owned_harness_or_ui_stage_failed' };
}
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} screenshot_capture\n`);
if (report.status === 'unverified') process.exitCode = 1;
