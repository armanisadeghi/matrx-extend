#!/usr/bin/env node
/** EXT-F-1009-T03: real full-page capture on an owned, three-screen page. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyImportedNativeEvidence } from '../../scripts/current-test-artifact.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { matchesFullPageAspect } from './full-page-aspect.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXTENSION_DIR = resolve(
  REPO,
  process.env.SCREENSHOT_CAPTURE_EXTENSION_DIR ?? 'missing-artifact',
);
const RECEIPT = resolve(
  REPO,
  process.env.SCREENSHOT_CAPTURE_DEV_BUILD_RECEIPT ?? 'missing-receipt',
);
const OUTPUT = join(REPO, 'test-results', `screenshot-full-page-${randomUUID()}.json`);
const RECOVERY = OUTPUT.replace(/\.json$/, '.private-recovery.json');
const PRIVATE_CONFIG = join(REPO, 'test-results', 'd22-private-config.json');
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const ADMIN_EMAIL = 'admin@admin.com';
const WEB_ORIGIN = 'https://www.aimatrx.com';
const HTML = `<!doctype html><meta charset="utf-8"><title>Harbor Dental appointment guide</title>
<style>*{box-sizing:border-box}html,body{margin:0}body{font:22px system-ui;color:#fff}
section{height:100vh;width:100%;padding:32px}section:nth-child(1){background:#18436b}
section:nth-child(2){background:#ed567b}section:nth-child(3){background:#39c78e}</style>
<section><h1>Harbor Dental appointment guide</h1><p>Bring your insurance card.</p></section>
<section><h2>At the clinic</h2><p>Tell the care team about current medicines.</p></section>
<section><h2>Before leaving</h2><p>Confirm your follow-up appointment.</p></section>`;
const report = {
  schema_version: 1,
  feature: 'EXT-F-1009-T03',
  status: 'unverified',
  scope:
    'root and nested scrolling capture, persisted image, local viewer, reload, and canonical public sharing',
  cases: {
    rootPersistence: 'unverified',
    nestedPersistence: 'unverified',
    localViewer: 'unverified',
    reloadPersistence: 'unverified',
    canonicalShare: 'unverified',
    unsupportedPage: 'unverified',
    persistenceFailure: 'unverified',
    tileCap: 'unverified',
  },
};
let stage = 'build_identity';
let capturePhase = null;
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
  const evidence = await verifyImportedNativeEvidence(EXTENSION_DIR, RECEIPT);
  if (
    evidence.sourceSha !== process.env.SCREENSHOT_CAPTURE_SOURCE_SHA ||
    String(evidence.runId) !== process.env.SCREENSHOT_CAPTURE_RUN_ID ||
    String(evidence.artifactId) !== process.env.SCREENSHOT_CAPTURE_ARTIFACT_ID
  )
    fail('selected_ci_artifact_mismatch');
  // These two fixes must be in the artifact, not only in the current checkout.
  for (const sha of ['59617c92', '854323c7'])
    execFileSync('git', ['merge-base', '--is-ancestor', sha, evidence.sourceSha], { cwd: REPO });
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  if (hashReleaseTree(EXTENSION_DIR) !== evidence.treeSha256) fail('dev_build_identity_mismatch');
  return { ...receipt, provenance: evidence };
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
    if (new URL(web.url()).pathname !== '/login') fail('login_route_unverified');
    const values = {};
    for (const line of (await readFile(ADMIN_ENV, 'utf8')).split(/\r?\n/)) {
      const match = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    if (values.AI_ADMIN_USERNAME !== ADMIN_EMAIL || !values.AI_ADMIN_PASSWORD)
      fail('admin_credentials_unavailable');
    await web.locator('input[name="email"]').fill(ADMIN_EMAIL);
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
          `(() =>
      document.querySelectorAll('button[title="${ADMIN_EMAIL}"]').length)()`,
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
  const account = await evaluate(
    panel,
    `(() => [...document.querySelectorAll('button[aria-expanded]')]
    .filter(el => el.textContent.trim()==='Account').map(el => el.getAttribute('aria-expanded')))()`,
  );
  if (account?.length !== 1) fail('account_section_not_unique');
  if (account[0] === 'true') await click(panel, 'section', 'Account');
  await waitFor(
    'account_collapsed',
    () =>
      evaluate(
        panel,
        `(() => [...document.querySelectorAll(
    'button[aria-expanded]')].find(el => el.textContent.trim()==='Account')
    ?.getAttribute('aria-expanded'))()`,
      ),
    (value) => value === 'false',
  );
  await openSection(panel, 'Organization');
  await click(panel, 'organization', 'Acting as');
  const choices = await evaluate(
    panel,
    `(() => [...document.querySelectorAll('[role="option"]')]
    .filter(el => el.textContent.trim()===${JSON.stringify(approved)}).length)()`,
  );
  if (choices !== 1) fail('approved_option_not_unique');
  await click(panel, 'option', approved);
  await waitFor(
    'approved_organization_selected',
    () =>
      evaluate(
        panel,
        `(async () => {
    const row=[...document.querySelectorAll('span')].find(el => el.textContent.trim()==='Acting as');
    const buttons=[...(row?.parentElement?.parentElement?.querySelectorAll('button[role="combobox"]')??[])];
    const active=(await chrome.storage.local.get('matrx.org.active'))['matrx.org.active'];
    return buttons.length===1 && buttons[0].textContent.trim()===${JSON.stringify(approved)} &&
      active?.name===${JSON.stringify(approved)} && typeof active?.id==='string';
  })()`,
      ),
    (value) => value === true,
    30_000,
  );
}
function watchRows(panel, expectedCanonical) {
  const requests = new Map();
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    try {
      const url = new URL(request?.url);
      if (
        request?.method !== 'GET' ||
        !url.pathname.endsWith('/wbx_screenshot') ||
        url.searchParams.get('page_url_canonical') !== `eq.${expectedCanonical}`
      )
        return;
      requests.set(requestId, { status: null, rows: null });
    } catch {
      /* unrelated traffic */
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const entry = requests.get(requestId);
    if (entry) entry.status = response?.status;
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    const entry = requests.get(requestId);
    if (!entry || entry.status !== 200) return;
    void panel
      .send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) => {
        const rows = JSON.parse(
          base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body,
        );
        if (
          Array.isArray(rows) &&
          rows.every((row) => row.page_url_canonical === expectedCanonical)
        )
          entry.rows = rows;
      })
      .catch(() => {});
  });
  return {
    marker: () => requests.size,
    rowsAfter: (index) => [...requests.values()].slice(index).filter((entry) => entry.rows),
    allRows: () => [...requests.values()].filter((entry) => entry.rows),
    stop: () => {
      offRequest();
      offResponse();
      offFinished();
    },
  };
}
async function nextRead(journal, marker, length) {
  const result = await waitFor(
    'real_gallery_read',
    () => journal.rowsAfter(marker),
    (reads) => reads.some((read) => read.status === 200 && read.rows.length === length),
    45_000,
  );
  return result.find((read) => read.status === 200 && read.rows.length === length).rows;
}
async function cardState(panel) {
  return evaluate(
    panel,
    `(() => {
    const tab=document.querySelector('button[role="tab"][title="Screenshots"][data-state="active"]');
    const pane=tab&&document.getElementById(tab.getAttribute('aria-controls'));
    const cards=[...(pane?.querySelectorAll('div.group')??[])]
      .filter(card => card.querySelectorAll('button[aria-label="View screenshot"]').length===1 &&
        card.querySelectorAll('button[title="Open in Files"],button[data-matrx-title="Open in Files"]').length===1);
    const image=cards[0]?.querySelector('img');
    if (cards.length!==1 || !image?.complete || !image.src.startsWith('blob:') ||
        image.naturalWidth<10 || image.naturalHeight<10)
      return { cardCount: cards.length, decoded:false };
    const canvas=document.createElement('canvas'); canvas.width=1; canvas.height=1;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const sample=(fraction) => {
      ctx.drawImage(image, Math.floor(image.naturalWidth/2),
        Math.floor(image.naturalHeight*fraction), 1,1,0,0,1,1);
      return [...ctx.getImageData(0,0,1,1).data];
    };
    const near=(actual,expected) => expected.every((channel,i)=>Math.abs(actual[i]-channel)<=32)
      && actual[3]===255;
    return {cardCount:cards.length, decoded:true, width:image.naturalWidth,
      height:image.naturalHeight, first:near(sample(.16),[24,67,107]),
      middle:near(sample(.50),[237,86,123]), last:near(sample(.84),[57,199,142]),
      sourceYou:cards[0]?.querySelector('span[title="Source"]')?.textContent.trim()==='You',
      warning:!!pane?.innerText.includes('Captured, but failed to save')};
  })()`,
  );
}
// A thumbnail click must expose the already downloaded image, including its pixels.
async function verifyLocalViewer(panel, expected) {
  stage = 'local_image_viewer';
  const loadedSource = await evaluate(
    panel,
    `document.querySelector('button[aria-label="View screenshot"] img')?.src`,
  );
  if (typeof loadedSource !== 'string' || !loadedSource.startsWith('blob:'))
    fail('viewer_thumbnail_not_loaded');
  let downloads = 0;
  const offDownload = panel.on('Network.requestWillBeSent', ({ request }) => {
    if (request.method === 'GET' && /\/(?:files|assets)\//.test(new URL(request.url).pathname))
      downloads++;
  });
  try {
    await click(panel, 'title', 'View screenshot');
    await waitFor(
      'loaded_local_viewer',
      () =>
        evaluate(
          panel,
          `(() => {
    const dialogs=[...document.querySelectorAll('[role="dialog"]')];
    const image=dialogs.length===1 ? dialogs[0].querySelector('img') : null;
    if (!image?.complete || image.src!==${JSON.stringify(loadedSource)} ||
        image.naturalWidth!==${expected.width} || image.naturalHeight!==${expected.height}) return false;
    const canvas=document.createElement('canvas'); canvas.width=1; canvas.height=1;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    return [[.16,[24,67,107]],[.50,[237,86,123]],[.84,[57,199,142]]].every(([fraction,rgb])=>{
      ctx.drawImage(image,Math.floor(image.naturalWidth/2),Math.floor(image.naturalHeight*fraction),1,1,0,0,1,1);
      const pixel=ctx.getImageData(0,0,1,1).data;
      return rgb.every((channel,i)=>Math.abs(pixel[i]-channel)<=32)&&pixel[3]===255;
    });
  })()`,
        ),
      (value) => value === true,
      30_000,
    );
    if (downloads !== 0) fail('viewer_downloaded_image_again');
  } finally {
    offDownload();
  }
  await click(panel, 'button-text', 'Close');
  await waitFor(
    'viewer_closed',
    () => evaluate(panel, `document.querySelectorAll('[role="dialog"]').length`),
    (count) => count === 0,
  );
}
function watchShareRpcs(panel) {
  const entries = new Map();
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    try {
      const operation = new URL(request.url).pathname.split('/').pop();
      if (
        request.method !== 'POST' ||
        !['create_share_link', 'list_share_links', 'revoke_share_link'].includes(operation)
      )
        return;
      entries.set(requestId, {
        operation,
        request: JSON.parse(request.postData),
        organization: Object.entries(request.headers ?? {}).find(
          ([key]) => key.toLowerCase() === 'x-organization-id',
        )?.[1],
        status: null,
        response: null,
      });
    } catch {
      /* unrelated requests */
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const entry = entries.get(requestId);
    if (entry) entry.status = response.status;
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    const entry = entries.get(requestId);
    if (!entry) return;
    void panel
      .send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) => {
        entry.response = JSON.parse(
          base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body,
        );
      })
      .catch(() => {});
  });
  return {
    entries: () => [...entries.values()],
    stop: () => {
      offRequest();
      offResponse();
      offFinished();
    },
  };
}
// No session/store injection: create and revoke through the UI, observe real RPCs,
// then open the actual public URL in a fresh, unauthenticated browser context.
async function verifyCanonicalShare(page, panel, row, recovery) {
  stage = 'canonical_public_share';
  const expectedOrganization = await evaluate(
    panel,
    `(async () => (await chrome.storage.local.get('matrx.org.active'))['matrx.org.active']?.id)()`,
  );
  if (typeof expectedOrganization !== 'string') fail('share_active_organization_unverified');
  const originalImageSha = await evaluate(
    panel,
    `(async () => {
    const image=document.querySelector('button[aria-label="View screenshot"] img');
    if (!image?.complete || !image.src.startsWith('blob:')) return null;
    const bytes=await (await fetch(image.src)).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
      .map(byte=>byte.toString(16).padStart(2,'0')).join('');
  })()`,
  );
  if (!/^[a-f0-9]{64}$/.test(originalImageSha ?? '')) fail('original_image_digest_unverified');
  const journal = watchShareRpcs(panel);
  let created;
  let anonymous;
  let revoked = false;
  let createAttempted = false;
  try {
    await click(panel, 'title', 'Share');
    await waitFor(
      'canonical_share_body',
      () =>
        evaluate(
          panel,
          `document.body.innerText.includes('Public links use Matrx sharing') &&
       [...document.querySelectorAll('button')].some(el=>el.textContent.includes('Manage all links'))`,
        ),
      (value) => value === true,
    );
    const manageLabel = await evaluate(
      panel,
      `(() => {
      const buttons=[...document.querySelectorAll('button')].filter(el=>el.textContent.includes('Manage all links'));
      return buttons.length===1 ? buttons[0].textContent.trim() : null;
    })()`,
    );
    if (!manageLabel) fail('canonical_share_manager_not_unique');
    await click(panel, 'button-text', manageLabel);
    await waitFor(
      'real_share_list',
      () => journal.entries(),
      (entries) =>
        entries.some(
          (entry) =>
            entry.operation === 'list_share_links' &&
            entry.status === 200 &&
            Array.isArray(entry.response) &&
            entry.request.p_resource_id === row.file_id &&
            entry.response.length === 0,
        ),
      30_000,
    );
    createAttempted = true;
    await click(panel, 'button-text', 'Create public link');
    created = await waitFor(
      'real_owned_share_created',
      () =>
        journal
          .entries()
          .find(
            (entry) =>
              entry.operation === 'create_share_link' &&
              entry.status === 200 &&
              entry.response?.success === true,
          ),
      (entry) => !!entry,
      30_000,
    );
    if (
      created.request.p_resource_type !== 'file' ||
      created.request.p_resource_id !== row.file_id ||
      created.request.p_permission_level !== 'viewer' ||
      created.organization !== expectedOrganization ||
      typeof created.response.token !== 'string'
    )
      fail('share_write_contract_failed');
    const link = await waitFor(
      'owned_share_listed',
      () =>
        journal
          .entries()
          .flatMap((entry) =>
            entry.operation === 'list_share_links' && Array.isArray(entry.response)
              ? entry.response
              : [],
          )
          .find((link) => link.token === created.response.token && link.is_active === true),
      (value) => !!value,
      30_000,
    );
    // Retain recovery privately before opening a public surface or making assertions.
    const prior = JSON.parse(await readFile(recovery, 'utf8'));
    await writeFile(recovery, JSON.stringify({ ...prior, shareLinkId: link.id }), { mode: 0o600 });
    const url = await waitFor(
      'new_public_url',
      () => evaluate(panel, `document.querySelector('input[aria-label="New public link"]')?.value`),
      (value) => typeof value === 'string',
      30_000,
    );
    const parsed = new URL(url);
    if (
      !['aimatrx.com', 'www.aimatrx.com'].includes(parsed.hostname) ||
      parsed.protocol !== 'https:' ||
      parsed.search ||
      !/^\/(?:r|s)\/[^/]+$/.test(parsed.pathname)
    )
      fail('canonical_public_url_failed');
    if (
      parsed.pathname !==
      (link.short_token ? `/r/${link.short_token}` : `/s/${encodeURIComponent(link.token)}`)
    )
      fail('public_url_not_owned_grant');
    anonymous = await page.context().browser().newContext();
    const publicPage = await anonymous.newPage();
    await publicPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitFor(
      'anonymous_shared_image_loaded',
      () =>
        publicPage.evaluate(
          ({ width, height }) =>
            [...document.querySelectorAll('img')].filter(
              (image) =>
                image.complete && image.naturalWidth === width && image.naturalHeight === height,
            ).length,
          { width: row.width, height: row.height },
        ),
      (count) => count === 1,
      60_000,
    );
    const publicImageUrl = await publicPage.evaluate(
      ({ width, height }) =>
        [...document.querySelectorAll('img')].find(
          (image) =>
            image.complete && image.naturalWidth === width && image.naturalHeight === height,
        )?.src,
      { width: row.width, height: row.height },
    );
    if (!publicImageUrl || !/^https:\/\//.test(publicImageUrl))
      fail('anonymous_image_source_unverified');
    const publicImageResponse = await publicPage.request.get(publicImageUrl);
    if (
      !publicImageResponse.ok() ||
      createHash('sha256')
        .update(await publicImageResponse.body())
        .digest('hex') !== originalImageSha
    )
      fail('anonymous_shared_image_bytes_differ');
    report.evidence.publicShare = {
      canonicalBody: true,
      realOwnerGrant: true,
      anonymousImageLoaded: true,
      anonymousBytesMatchOwnedImage: true,
    };
  } finally {
    await anonymous?.close();
    // Revoke even when the anonymous surface fails; never leave a test grant active.
    const candidate =
      created ?? journal.entries().find((entry) => entry.operation === 'create_share_link');
    try {
      if (createAttempted || candidate) {
        report.shareCleanup = 'unverified';
        // A committed POST can lose its response. Recover using this new file's
        // real grant list rather than assuming no write happened.
        await click(panel, 'button-text', 'Refresh');
        const grant = await waitFor(
          'owned_grant_recovery_read',
          () =>
            journal
              .entries()
              .toReversed()
              .find(
                (entry) =>
                  entry.operation === 'list_share_links' &&
                  entry.request.p_resource_id === row.file_id &&
                  entry.status === 200 &&
                  Array.isArray(entry.response) &&
                  entry.response.some((link) => link.is_active === true),
              )
              ?.response.find((link) => link.is_active === true),
          (value) => !!value,
          30_000,
        );
        const prior = JSON.parse(await readFile(recovery, 'utf8'));
        await writeFile(recovery, JSON.stringify({ ...prior, shareLinkId: grant.id }), {
          mode: 0o600,
        });
        try {
          await waitFor(
            'revoke_owned_share_ready',
            () =>
              evaluate(
                panel,
                `[...document.querySelectorAll('[role="dialog"] button')].filter(el=>el.textContent.trim()==='Revoke'&&!el.disabled).length`,
              ),
            (count) => count === 1,
            30_000,
          );
          await click(panel, 'button-text', 'Revoke');
          const write = await waitFor(
            'real_owned_share_revoked',
            () =>
              journal
                .entries()
                .find(
                  (entry) =>
                    entry.operation === 'revoke_share_link' &&
                    entry.status === 200 &&
                    entry.response?.success === true,
                ),
            (entry) => !!entry,
            30_000,
          );
          await waitFor(
            'real_revoked_grant_read',
            () => journal.entries(),
            (entries) =>
              entries.some(
                (entry) =>
                  entry.operation === 'list_share_links' &&
                  Array.isArray(entry.response) &&
                  entry.response.some(
                    (link) =>
                      link.id === write.request.p_link_id &&
                      link.id === grant.id &&
                      link.is_active === false,
                  ),
              ),
            30_000,
          );
          revoked = true;
        } finally {
          report.shareCleanup = revoked ? 'pass' : 'unverified';
        }
      }
      if ((createAttempted || candidate) && !revoked) fail('owned_share_cleanup_unverified');
    } finally {
      journal.stop();
      if (await evaluate(panel, `document.querySelectorAll('[role="dialog"]').length`))
        await click(panel, 'button-text', 'Close');
    }
  }
}
async function cleanup(panel, journal, row, fixtureUrl, fixtureCanonical, page) {
  stage = 'exact_owned_row_cleanup';
  if (page.url() !== fixtureUrl) await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  if (canonical(page.url()) !== fixtureCanonical) fail('cleanup_page_identity_lost');
  await click(panel, 'title', 'Screenshots');
  const present = await waitFor(
    'owned_card_ready',
    () => cardState(panel),
    (state) => state.cardCount === 1 && state.decoded,
    30_000,
  );
  if (present.cardCount !== 1) fail('cleanup_card_not_unique');
  const prior = journal
    .allRows()
    .find(
      (read) =>
        read.rows.length === 1 &&
        read.rows[0].id === row.id &&
        read.rows[0].file_id === row.file_id,
    );
  if (!prior) fail('cleanup_row_identity_missing');
  await click(panel, 'title', 'Delete');
  const confirmation = await waitFor(
    'owned_delete_confirmation',
    () =>
      evaluate(
        panel,
        `(() => {
    const dialog=document.querySelector('[role="alertdialog"],[role="dialog"]');
    return !!dialog?.innerText.includes('The image file itself stays in your Files') &&
      [...dialog.querySelectorAll('button')].some(button => button.textContent.trim()==='Delete'
        && !button.disabled);
  })()`,
      ),
    (value) => value === true,
  );
  if (!confirmation) fail('delete_consequence_missing');
  const marker = journal.marker();
  await click(panel, 'button-text', 'Delete');
  const rows = await nextRead(journal, marker, 0);
  if (rows.some((entry) => entry.id === row.id)) fail('owned_row_still_present');
  return true;
}
async function exerciseCase({ page, panel }, mode) {
  let server;
  let journal;
  let fixtureUrl;
  let fixtureCanonical;
  let ownedRow;
  let captureClicked = false;
  let cleaned = false;
  try {
    server = createServer((_request, response) =>
      response
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        .end(
          mode === 'nested'
            ? `${HTML.replace(
                '<section>',
                '<style>html,body{height:100%;overflow:hidden}main{height:100vh;overflow-y:auto}</style><main id="appointment-pane"><section>',
              )}</main>`
            : HTML,
        ),
    );
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    fixtureUrl = `http://127.0.0.1:${server.address().port}/harbor-dental/appointment-guide/${mode}/${randomUUID()}`;
    stage = `owned_${mode}_page`;
    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
    if (page.url() !== fixtureUrl || (await page.title()) !== 'Harbor Dental appointment guide')
      fail('fixture_identity_unverified');
    const metrics = await page.evaluate((layout) => {
      const pane = document.getElementById('appointment-pane');
      const scroller = layout === 'nested' ? pane : document.documentElement;
      if (!scroller) throw new Error('owned_scroller_missing');
      if (layout === 'nested') pane.scrollTop = 37;
      else window.scrollTo(0, 37);
      return {
        innerWidth: layout === 'nested' ? pane.clientWidth : innerWidth,
        innerHeight: layout === 'nested' ? pane.clientHeight : innerHeight,
        scrollHeight: scroller.scrollHeight,
        scrollY: layout === 'nested' ? pane.scrollTop : scrollY,
        rootScrollY: scrollY,
        rootHeight: document.documentElement.scrollHeight,
        viewportHeight: innerHeight,
      };
    }, mode);
    if (mode === 'nested' && metrics.rootHeight > metrics.viewportHeight + 1)
      fail('nested_fixture_document_scrolls');
    if (
      metrics.innerWidth < 100 ||
      metrics.innerHeight < 100 ||
      metrics.scrollHeight < metrics.innerHeight * 2.9
    )
      fail('fixture_not_three_viewports');
    fixtureCanonical = canonical(fixtureUrl);
    await mkdir(dirname(RECOVERY), { recursive: true });
    await writeFile(RECOVERY, JSON.stringify({ fixtureUrl, fixtureCanonical }), {
      mode: 0o600,
      flag: 'wx',
    });
    await panel.send('Network.enable');
    journal = watchRows(panel, fixtureCanonical);
    const beforeMarker = journal.marker();
    stage = 'empty_gallery_baseline';
    await click(panel, 'title', 'Screenshots');
    const before = await nextRead(journal, beforeMarker, 0);
    if (before.length !== 0) fail('fresh_fixture_not_empty');
    stage = 'real_full_page_capture';
    capturePhase = 'trusted_click';
    const captureMarker = journal.marker();
    captureClicked = true;
    await click(panel, 'button-text', 'Full page');
    capturePhase = 'persisted_gallery_read';
    const after = await nextRead(journal, captureMarker, 1);
    if (
      after.length === 1 &&
      typeof after[0]?.id === 'string' &&
      typeof after[0]?.file_id === 'string'
    )
      ownedRow = after[0];
    if (ownedRow)
      await writeFile(
        RECOVERY,
        JSON.stringify({
          ...JSON.parse(await readFile(RECOVERY, 'utf8')),
          fixtureUrl,
          fixtureCanonical,
          screenshotId: ownedRow.id,
          fileId: ownedRow.file_id,
        }),
        { mode: 0o600 },
      );
    capturePhase = 'persisted_row_contract';
    if (!ownedRow || ownedRow.source !== 'user' || !matchesFullPageAspect(ownedRow, metrics))
      fail('persisted_full_page_dimensions_wrong');
    capturePhase = 'persisted_image_pixels';
    const image = await waitFor(
      'fresh_persisted_full_page_thumbnail',
      () => cardState(panel),
      (state) =>
        state.decoded &&
        state.first &&
        state.middle &&
        state.last &&
        state.sourceYou &&
        !state.warning,
      45_000,
    );
    if (image.height <= image.width || image.cardCount !== 1) fail('persisted_image_not_tall');
    capturePhase = 'scroll_restoration';
    const finalScroll = await page.evaluate(() => ({
      root: scrollY,
      pane: document.getElementById('appointment-pane')?.scrollTop,
    }));
    if (
      Math.abs((mode === 'nested' ? finalScroll.pane : finalScroll.root) - metrics.scrollY) > 2 ||
      Math.abs(finalScroll.root - metrics.rootScrollY) > 2
    )
      fail('original_scroll_not_restored');
    report.cases[`${mode}Persistence`] = 'pass';
    report.evidence ??= {};
    report.evidence[mode] = {
      realZeroRowBaseline: true,
      persistedOwnedRow: true,
      imageLoadedFromGallery: true,
      topMiddleBottomPixelsMatched: true,
      tallImage: true,
      originalScrollRestored: true,
    };
    await verifyLocalViewer(panel, image);
    report.cases.localViewer = 'pass';
    const reloadMarker = journal.marker();
    await panel.send('Page.reload');
    await click(panel, 'title', 'Screenshots');
    const reloadedRows = await nextRead(journal, reloadMarker, 1);
    if (reloadedRows[0].id !== ownedRow.id || reloadedRows[0].file_id !== ownedRow.file_id)
      fail('reload_owned_row_identity_changed');
    await waitFor(
      'reload_persisted_pixels',
      () => cardState(panel),
      (state) =>
        state.decoded &&
        state.first &&
        state.middle &&
        state.last &&
        state.sourceYou &&
        !state.warning,
      45_000,
    );
    await verifyLocalViewer(panel, image);
    report.cases.reloadPersistence = 'pass';
    if (mode === 'root') {
      await verifyCanonicalShare(page, panel, ownedRow, RECOVERY);
      report.cases.canonicalShare = 'pass';
    }
    cleaned = await cleanup(panel, journal, ownedRow, fixtureUrl, fixtureCanonical, page);
    report.cleanup ??= {};
    report.cleanup[mode] = { exactOwnedRowAbsentAfterRealRead: cleaned };
    await rm(RECOVERY);
    report.status = 'partial';
  } catch (error) {
    report.failure ??= {
      stage,
      code:
        stage === 'real_full_page_capture' && capturePhase
          ? `full_page_${capturePhase}_failed`
          : 'full_page_stage_failed',
    };
    report.failure.diagnostic = safeFailure(error);
    if (!ownedRow && captureClicked) {
      // The capture may have saved even when its automatic gallery read failed.
      // Ask the real gallery for this run's unique URL before conceding cleanup.
      if (journal && fixtureUrl && fixtureCanonical) {
        try {
          if (page.url() !== fixtureUrl)
            await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
          if (canonical(page.url()) === fixtureCanonical) {
            await click(panel, 'title', 'Screenshots');
            const marker = journal.marker();
            await click(panel, 'title', 'Refresh');
            await waitFor(
              'recovery_gallery_read',
              () => journal.rowsAfter(marker),
              (reads) => reads.some((read) => read.status === 200),
              30_000,
            );
          }
        } catch {
          /* retain private URL for exact manual recovery */
        }
      }
      const candidates = journal?.allRows().flatMap((entry) => entry.rows) ?? [];
      const unique = [
        ...new Map(
          candidates.filter((row) => row?.id && row?.file_id).map((row) => [row.id, row]),
        ).values(),
      ];
      if (unique.length === 1) ownedRow = unique[0];
    }
    if (ownedRow)
      await writeFile(
        RECOVERY,
        JSON.stringify({
          ...JSON.parse(await readFile(RECOVERY, 'utf8')),
          fixtureUrl,
          fixtureCanonical,
          screenshotId: ownedRow.id,
          fileId: ownedRow.file_id,
        }),
        { mode: 0o600 },
      ).catch(() => {});
    if (ownedRow && !cleaned) {
      try {
        cleaned = await cleanup(panel, journal, ownedRow, fixtureUrl, fixtureCanonical, page);
      } catch {
        report.cleanup = { exactOwnedRowAbsentAfterRealRead: false };
      }
    }
    if (cleaned) report.cleanup = { exactOwnedRowAbsentAfterRealRead: true };
    if (cleaned && report.shareCleanup !== 'unverified') await rm(RECOVERY).catch(() => {});
    report.failure.createdRowMayNeedUiCleanup = captureClicked && !cleaned;
    throw error;
  } finally {
    journal?.stop();
    if (server) await new Promise((resolveClose) => server.close(resolveClose));
  }
}
async function exercise(context) {
  const approved = await approvedOrganization();
  await signIn(context.page, context.panel);
  await selectOrganization(context.panel, approved);
  for (const mode of ['nested', 'root']) await exerciseCase(context, mode);
}
try {
  const before = await buildIdentity();
  report.build = { version: before.version, treeSha256: before.treeSha256, ...before.provenance };
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
  if (after.treeSha256 !== before.treeSha256 || after.version !== before.version)
    fail('dev_build_changed_during_run');
  report.profileOwned = true;
  report.targetedVerdict = 'pass';
} catch (error) {
  report.status = 'unverified';
  report.failure ??= { stage, code: 'owned_harness_or_ui_stage_failed' };
  report.failure.diagnostic ??= safeFailure(error);
}
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
process.stdout.write(`${report.status.toUpperCase()} screenshot_full_page\n`);
if (report.status === 'unverified') process.exitCode = 1;
