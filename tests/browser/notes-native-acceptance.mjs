#!/usr/bin/env node
/** Native Notes D61/D62/D63/D67/D68 acceptance. Launch only under the shared resource guard. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { verifyImportedNativeEvidence } from '../../scripts/current-test-artifact.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const RECEIPT = process.env.NOTES_DEV_BUILD_RECEIPT;
const EXPECTED_SOURCE_SHA = process.env.NOTES_EXPECTED_SOURCE_SHA;
const ROLE = process.env.NOTES_ROLE ?? 'admin';
const INTERACTIVE_MEMBER = process.env.NOTES_INTERACTIVE_MEMBER === '1';
const OUTPUT = join(REPO, 'test-results/notes-native-acceptance.json');
const FIXTURE_RECEIPT = join(REPO, `test-results/notes-owned-fixture-${randomUUID()}.json`);
const ADMIN_ENV = join(homedir(), 'code/aidream/.env');
const DEV_ENV = join(REPO, '.env.development');
const PRIVATE_CONFIG = process.env.NOTES_PRIVATE_CONFIG ?? join(REPO, 'test-results/notes-private-config.json');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const EMAIL = 'admin@admin.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noteTitle = `Harbor Dental — intake handoff ${randomUUID().slice(0, 8)}`;
const draftA = 'Confirm insurance eligibility before the patient arrives.';
const draftB = `${draftA}\nCall the patient if coverage needs an updated card.`;
const draftC = `${draftB}\nFlag the intake coordinator before check-in.`;
let stage = 'receipt';
const report = {
  schema_version: 1,
  cases: ['EXT-D-0061', 'EXT-D-0062', 'EXT-D-0063', 'EXT-D-0067', 'EXT-D-0068'],
  status: 'unverified',
  role: ROLE,
  build: null,
  observations: {},
  fault_scope:
    'owned panel, workbench.notes transport; detail/delete faults restricted to the owned note id',
  data_scope:
    'one newly created Harbor Dental intake handoff note; delete is verified only after live retry',
};
function fail(code) {
  report.failure_code = code;
  throw new Error('notes_native_unverified');
}
async function identity() {
  if (!RECEIPT) fail('dev_receipt_required');
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  const extensionDir = receipt.extensionDir;
  requireLocalDevReceipt(receipt, extensionDir);
  const [manifest, pkg] = await Promise.all([
    readFile(join(extensionDir, 'manifest.json'), 'utf8').then(JSON.parse),
    readFile(join(REPO, 'package.json'), 'utf8').then(JSON.parse),
  ]);
  if (receipt.version !== pkg.version || manifest.version !== pkg.version || !manifest.key)
    fail('build_version_mismatch');
  if (hashReleaseTree(extensionDir) !== receipt.treeSha256) fail('build_hash_mismatch');
  if (!/^[a-f0-9]{40}$/.test(EXPECTED_SOURCE_SHA ?? '')) fail('expected_source_sha_required');
  return {
    kind: receipt.kind,
    version: receipt.version,
    treeSha256: receipt.treeSha256,
    extensionDir,
  };
}
async function supabaseOrigin() {
  const source = await readFile(DEV_ENV, 'utf8').catch(() => fail('dev_env_unavailable'));
  const line = source.split(/\r?\n/).find((entry) => /^WXT_SUPABASE_URL=/.test(entry));
  if (!line) fail('supabase_origin_unavailable');
  const url = new URL(line.slice('WXT_SUPABASE_URL='.length).replace(/^['"]|['"]$/g, ''));
  if (url.protocol !== 'https:' || url.pathname !== '/') fail('supabase_origin_invalid');
  return url.origin;
}
async function privateConfig() {
  const stat = await lstat(PRIVATE_CONFIG).catch(() => fail('test_org_config_missing'));
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) fail('test_org_config_not_private');
  const config = JSON.parse(
    await readFile(PRIVATE_CONFIG, 'utf8').catch(() => fail('test_org_config_missing')),
  );
  if (ROLE === 'member' && INTERACTIVE_MEMBER) {
    if (config.reviewer_email_fingerprint !== '3d6137db6c081c07')
      fail('member_identity_fingerprint_missing');
  } else if (
    typeof config.approved_organization_name !== 'string' ||
    !config.approved_organization_name.trim()
  ) fail('test_org_name_missing');
  return config;
}
async function realLogin(page, panel, config) {
  const web = await page.context().newPage();
  try {
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const location = new URL(web.url());
    if (location.origin !== WEB_ORIGIN || location.pathname !== '/login') fail('web_login_origin');
    let expectedEmail;
    if (ROLE === 'member' && INTERACTIVE_MEMBER) {
      stage = 'ready_manual_member_login';
      process.stdout.write('STAGE ready_manual_member_login\n');
      expectedEmail = await waitFor(
        'member_web_session',
        () => web.evaluate(async () => {
          const response = await fetch('/api/whoami', { credentials: 'include', cache: 'no-store' });
          const identity = response.ok ? await response.json() : null;
          return identity?.signed_in === true ? identity.email : null;
        }),
        (value) => typeof value === 'string' && value.includes('@'),
        180_000,
      );
      const fingerprint = createHash('sha256').update(expectedEmail.toLowerCase()).digest('hex').slice(0, 16);
      if (fingerprint !== config.reviewer_email_fingerprint) fail('member_web_identity_mismatch');
      report.observations.reviewer_email_fingerprint = fingerprint;
    } else if (ROLE === 'admin') {
      const source = await readFile(ADMIN_ENV, 'utf8').catch(() => fail('credential_file_unavailable'));
      const values = {};
      for (const line of source.split(/\r?\n/)) {
        const match = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
        if (match)
          values[match[1]] = /^(['"]).*\1$/.test(match[2]) ? match[2].slice(1, -1) : match[2];
      }
      if (values.AI_ADMIN_USERNAME !== EMAIL || !values.AI_ADMIN_PASSWORD)
        fail('admin_credentials_unavailable');
      expectedEmail = EMAIL;
      await web.locator('input[name="email"]').fill(EMAIL);
      await web.locator('input[name="password"]').fill(values.AI_ADMIN_PASSWORD);
      await Promise.all([
        web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname !== '/login', { timeout: 90_000 }),
        web.getByRole('button', { name: 'Sign in', exact: true }).click(),
      ]);
      await web.waitForFunction(async (expected) => {
        const response = await fetch('/api/whoami', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) return false;
        const identity = await response.json();
        return identity?.signed_in === true && identity.email === expected;
      }, EMAIL, { timeout: 90_000 });
    } else fail('unsupported_role');
    await click(panel, 'title', 'Settings');
    await openSection(panel, 'Account');
    const adminCheck = ROLE === 'member' ? observeCanonicalAdminCheck(panel, await supabaseOrigin()) : null;
    if (adminCheck) await adminCheck.start();
    await click(panel, 'button', 'Sign in');
    try {
      const account = await waitFor('extension_account', () => memberPanelIdentity(panel, expectedEmail),
        (s) => s?.emailMatches && s.userProfilePresent && s.accessTokenPresent && s.signOutVisible,
        90_000);
      if (ROLE === 'member') {
        if (account.isAdmin === true) fail('member_identity_is_admin');
        await adminCheck.verify(account.userId);
      }
    } finally {
      if (adminCheck) await adminCheck.stop();
    }
    report.observations.real_ui_signin = true;
  } finally {
    await web.close();
  }
}
async function memberPanelIdentity(panel, expectedEmail) {
  return evaluate(panel, `(() => {
    const account = [...document.querySelectorAll('button[aria-expanded]')]
      .find(button => button.textContent.trim() === 'Account');
    const section = account?.parentElement?.nextElementSibling;
    const row = label => [...(section?.querySelectorAll('span') ?? [])]
      .find(span => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
    return chrome.storage.local.get(['matrx.auth.accessToken','matrx.user.profile','matrx.user.isAdmin'])
      .then(stored => ({
        emailMatches: row('Email') === ${JSON.stringify(`Email${expectedEmail}`)},
        userId: stored['matrx.user.profile']?.id ?? null,
        userProfilePresent: Boolean(stored['matrx.user.profile']?.id),
        accessTokenPresent: typeof stored['matrx.auth.accessToken'] === 'string',
        isAdmin: stored['matrx.user.isAdmin'] === true ? true : stored['matrx.user.isAdmin'] === false ? false : null,
        signOutVisible: [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Sign out'),
      }));
  })()`);
}
function observeCanonicalAdminCheck(panel, origin) {
  const requests = new Map();
  const offRequest = panel.on('Network.requestWillBeSent', event => {
    try {
      const url = new URL(event.request.url);
      const profile = Object.entries(event.request.headers ?? {}).find(([key]) => key.toLowerCase() === 'accept-profile')?.[1];
      const userId = /^eq\.([0-9a-f-]{36})$/i.exec(url.searchParams.get('user_id') ?? '')?.[1];
      if (url.origin === origin && url.pathname === '/rest/v1/admins' && event.request.method === 'GET' &&
        String(profile).toLowerCase() === 'admin' && url.searchParams.get('select') === 'user_id' && UUID.test(userId ?? ''))
        requests.set(event.requestId, { userId, status: null, rowCount: null, outcome: 'pending' });
    } catch { /* Unrelated request. */ }
  });
  const offResponse = panel.on('Network.responseReceived', event => {
    const request = requests.get(event.requestId);
    if (request) request.status = event.response.status;
  });
  const offFinished = panel.on('Network.loadingFinished', event => {
    const request = requests.get(event.requestId);
    if (!request) return;
    void panel.send('Network.getResponseBody', { requestId: event.requestId }).then(body => {
      try {
        const rows = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body);
        request.rowCount = Array.isArray(rows) ? rows.length : null;
        request.outcome = Array.isArray(rows) ? 'complete' : 'invalid_body_shape';
      } catch { request.outcome = 'invalid_body'; }
    }).catch(() => { request.outcome = 'body_unavailable'; });
  });
  const offFailed = panel.on('Network.loadingFailed', event => {
    const request = requests.get(event.requestId);
    if (request) request.outcome = 'request_failed';
  });
  return {
    async start() {
      await panel.send('Network.enable');
      await panel.send('Network.setCacheDisabled', { cacheDisabled: true });
    },
    async verify(expectedUserId) {
      if (!UUID.test(expectedUserId ?? '')) fail('member_extension_user_id_missing');
      const result = await waitFor('canonical_admin_assignment_read', () => {
        const matching = [...requests.values()].filter(request => request.userId === expectedUserId);
        return matching.find(request => request.status === 200 && request.outcome === 'complete' && request.rowCount === 0) ??
          matching.find(request => request.outcome !== 'pending') ?? null;
      }, Boolean, 60_000);
      if (result.status !== 200 || result.outcome !== 'complete' || result.rowCount !== 0)
        fail(result.rowCount > 0 ? 'member_identity_is_admin' : 'canonical_admin_assignment_read_not_proven');
      report.observations.canonical_extension_admin_check = { matched_current_extension_user: true, http_status: 200, returned_rows: 0 };
    },
    async stop() {
      offRequest(); offResponse(); offFinished(); offFailed();
      await panel.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => {});
      await panel.send('Network.disable').catch(() => {});
    },
  };
}
async function selectMemberOrganizationThroughUi(panel) {
  await openSection(panel, 'Organization');
  const selected = () => evaluate(panel, `(() => {
    const section = [...document.querySelectorAll('button[aria-expanded]')]
      .find(button => button.textContent.trim() === 'Organization')?.parentElement?.nextElementSibling;
    const label = [...(section?.querySelectorAll('span') ?? [])].find(span => span.textContent.trim() === 'Acting as');
    const control = label?.parentElement?.parentElement?.querySelector('button[role="combobox"]');
    return chrome.storage.local.get('matrx.org.active').then(stored => ({
      count: control ? 1 : 0, name: control?.textContent.trim() ?? null,
      id: stored['matrx.org.active']?.id ?? null,
    }));
  })()`);
  const before = await waitFor('member_organization_picker_ready', selected, state => state?.count === 1, 30_000);
  if (before.name !== 'Choose…' || before.id) fail('unexpected_preselected_member_organization');
  stage = 'ready_manual_member_organization';
  process.stdout.write('STAGE ready_manual_member_organization\n');
  await waitFor('member_organization_selected_in_ui', selected,
    state => state?.count === 1 && UUID.test(state.id ?? '') && state.name && state.name !== 'Choose…', 180_000);
  report.observations.organization_selected_through_membership_ui = true;
  report.observations.organization_membership_resolver = 'canonical mbr_for_user picker';
}
async function selectTestOrganization(panel, name) {
  await openSection(panel, 'Organization');
  const readState = () =>
    evaluate(
      panel,
      `(() => {
    const section = [...document.querySelectorAll('button[aria-expanded]')]
      .find(b => b.textContent.trim() === 'Organization');
    const body = section?.parentElement?.nextElementSibling;
    const label = [...(body?.querySelectorAll('span') ?? [])]
      .find(s => s.textContent.trim() === 'Acting as');
    const buttons = [...(label?.parentElement?.parentElement?.querySelectorAll('button[role="combobox"]') ?? [])];
    const text = body?.textContent ?? '';
    return { sectionExpanded: section?.getAttribute('aria-expanded') === 'true',
      controlCount: buttons.length, approvedDisplayed: buttons.length === 1 && buttons[0].textContent.trim() === ${JSON.stringify(name)},
      chooseDisplayed: buttons.length === 1 && buttons[0].textContent.trim() === 'Choose…',
      loading: text.includes('Loading…'), noMembership: text.includes('You are not a member of any organization'),
      needsSignin: text.includes('Sign in to choose'), actingLabel: Boolean(label),
      organizationError: Boolean(body?.querySelector('.text-destructive')) };
  })()`,
    );
  const state = await waitFor(
    'organization_control_or_terminal',
    readState,
    (s) => s?.controlCount === 1 || s?.noMembership || s?.organizationError || s?.needsSignin,
    60_000,
  ).catch(() => null);
  report.observations.organization_ui = state ?? (await readState());
  if (!state || state.controlCount !== 1) fail('organization_control_unavailable');
  if (!state.approvedDisplayed) {
    if (!state.chooseDisplayed) fail('unexpected_preselected_organization');
    report.observations.organization_step = 'opening_acting_as_picker';
    await click(panel, 'organization', 'Acting as');
    report.observations.organization_step = 'finding_approved_option';
    await waitFor(
      'approved_org_option_in_open_select',
      () =>
        evaluate(
          panel,
          `(() =>
      [...document.querySelectorAll('[role="option"]')]
        .filter(o => o.textContent.trim() === ${JSON.stringify(name)}).length)()`,
        ),
      (n) => n === 1,
      30_000,
    );
    report.observations.organization_step = 'selecting_approved_option';
    await click(panel, 'option', name);
  }
  await waitFor('test_org_selected', readState, (s) => s?.approvedDisplayed === true);
  report.observations.organization_selected_through_ui = true;
}
function notesState(panel) {
  return evaluate(
    panel,
    `(() => {
    const tab = document.querySelector('button[role="tab"][title="Notes"]');
    const root = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
    const active = tab?.getAttribute('data-state') === 'active' && root?.getAttribute('data-state') === 'active';
    const text = root?.textContent ?? '';
    const buttons = [...(root?.querySelectorAll('button') ?? [])].filter(b => !b.disabled);
    return { active, empty: text.includes('No notes yet.'), error: Boolean(root?.querySelector('[role="alert"]')) ||
      /could not|failed|unavailable|try again/i.test(text), retry: buttons.some(b => /retry|try again/i.test(b.textContent)),
      create: buttons.some(b => b.textContent.trim() === 'New note'), editor: Boolean(root?.querySelector('textarea[placeholder^="Start writing"]')),
      title: root?.querySelector('input[placeholder="Untitled"]')?.value === ${JSON.stringify(noteTitle)},
      draftA: root?.querySelector('textarea[placeholder^="Start writing"]')?.value === ${JSON.stringify(draftA)},
      draftB: root?.querySelector('textarea[placeholder^="Start writing"]')?.value === ${JSON.stringify(draftB)},
      draftC: root?.querySelector('textarea[placeholder^="Start writing"]')?.value === ${JSON.stringify(draftC)},
      saved: text.includes('Saved'), saving: text.includes('Saving'),
      noteInList: [...(root?.querySelectorAll('li button') ?? [])].some(b => b.textContent.includes(${JSON.stringify(noteTitle)})),
      detailFailure: text.includes('Could not load this note.'), missingDetail: text.includes('This note is unavailable.'),
      detailRetry: buttons.some(b => b.textContent.trim() === 'Retry loading note'),
      back: buttons.some(b => b.textContent.trim() === 'Back'),
      deleteFailure: text.includes('Could not confirm deletion.'),
      deleteRetry: buttons.some(b => b.textContent.trim() === 'Retry delete'),
    };
  })()`,
  );
}
function trackedRequestForPause(requests, event) {
  return event.networkId ? (requests.get(event.networkId) ?? null) : null;
}
if (process.argv.includes('--self-test-correlation')) {
  const owned = { method: 'PATCH', ownedDelete: false, injected: false };
  const unrelated = { method: 'PATCH', ownedDelete: false, injected: false };
  const requests = new Map([
    ['network-owned', owned],
    ['network-other', unrelated],
  ]);
  const ownedPause = trackedRequestForPause(requests, {
    requestId: 'fetch-owned',
    networkId: 'network-owned',
  });
  assert.equal(ownedPause, owned, 'paused owned delete must resolve its Network request');
  ownedPause.ownedDelete = true;
  assert.equal(unrelated.ownedDelete, false, 'unrelated PATCH must not inherit owned delete');
  assert.equal(
    trackedRequestForPause(requests, {
      requestId: 'fetch-other',
      networkId: 'network-other',
    }),
    unrelated,
    'other PATCH must remain separate',
  );
  assert.equal(
    trackedRequestForPause(requests, {
      requestId: 'fetch-orphan',
    }),
    null,
    'interception id alone cannot establish a Network response',
  );
  process.stdout.write('PASS notes_network_correlation\n');
  process.exit(0);
}
function armNotesTransport(panel, origin) {
  let mode = 'observe';
  let deleteMode = 'observe';
  let ownedNoteId = null;
  let failedGet = 0;
  let failedPost = 0;
  let failedDetail = 0;
  let missingDetail = 0;
  let failedDelete = 0;
  let zeroDelete = 0;
  let heldPatch = 0;
  let autosaveDispatches = 0;
  let passed = 0;
  let passedGet = 0;
  let interceptionFailed = false;
  let pendingPatch = null;
  const detailIds = [];
  const createdNoteIds = [];
  const requests = new Map();
  const responses = [];
  const offResponse = panel.on('Network.responseReceived', (event) => {
    const tracked = requests.get(event.requestId);
    if (!tracked) return;
    responses.push({
      method: tracked.method,
      status: event.response.status,
      stage,
      ownedDetail: tracked.ownedDetail,
      ownedDelete: tracked.ownedDelete,
      injected: tracked.injected,
    });
    tracked.status = event.response.status;
  });
  const offFinished = panel.on('Network.loadingFinished', event => {
    const tracked = requests.get(event.requestId);
    if (!tracked) return;
    if (tracked.method === 'POST' && tracked.inScope && !tracked.injected && tracked.status >= 200 && tracked.status < 300) {
      void panel.send('Network.getResponseBody', { requestId: event.requestId }).then(body => {
        try {
          const value = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body);
          const id = Array.isArray(value) ? value[0]?.id : value?.id;
          if (UUID.test(id ?? '')) createdNoteIds.push(id);
          else interceptionFailed = true;
        } catch { interceptionFailed = true; }
      }).catch(() => { interceptionFailed = true; });
    }
    requests.delete(event.requestId);
  });
  const offRequest = panel.on('Network.requestWillBeSent', (event) => {
    const url = new URL(event.request.url);
    if (
      url.origin === origin &&
      url.pathname === '/rest/v1/notes' &&
      ['GET', 'POST', 'PATCH'].includes(event.request.method)
    ) {
      const id = /^eq\.([0-9a-f-]{36})$/i.exec(url.searchParams.get('id') ?? '')?.[1] ?? null;
      if (event.request.method === 'GET' && id) detailIds.push(id);
      requests.set(event.requestId, {
        method: event.request.method,
        ownedDetail: event.request.method === 'GET' && Boolean(ownedNoteId) && id === ownedNoteId,
        ownedDelete: false,
        injected: false,
        inScope: false,
      });
    }
  });
  const off = panel.on('Fetch.requestPaused', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    const headers = Object.entries(request.headers).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]);
    const inScope =
      url.origin === origin &&
      url.pathname === '/rest/v1/notes' &&
      headers.some(
        ([key, value]) =>
          (key === 'accept-profile' || key === 'content-profile') && value === 'workbench',
      );
    const id = /^eq\.([0-9a-f-]{36})$/i.exec(url.searchParams.get('id') ?? '')?.[1] ?? null;
    const owned = inScope && ownedNoteId && id === ownedNoteId;
    const deleting =
      owned &&
      request.method === 'PATCH' &&
      (headers.some(
        ([key, value]) => key === 'prefer' && /(?:^|,)\s*count=exact(?:,|$)/i.test(value),
      ) ||
        (typeof request.postData === 'string' && /"deleted_at"\s*:/.test(request.postData)));
    const autosaving = owned && request.method === 'PATCH' && !deleting;
    if (autosaving) autosaveDispatches += 1;
    const action =
      inScope && mode === 'fail_get' && request.method === 'GET'
        ? 'fail_get'
        : owned && mode === 'fail_detail' && request.method === 'GET'
          ? 'fail_detail'
          : owned && mode === 'missing_detail' && request.method === 'GET'
            ? 'missing_detail'
            : inScope && mode === 'fail_post' && request.method === 'POST'
              ? 'fail_post'
              : deleting && deleteMode === 'fail_delete'
                ? 'fail_delete'
                : deleting && deleteMode === 'zero_delete'
                  ? 'zero_delete'
                  : (autosaving || (!ownedNoteId && inScope && request.method === 'PATCH')) &&
                      mode === 'hold_patch' &&
                      !pendingPatch
                    ? 'hold_patch'
                    : 'pass';
    const tracked = trackedRequestForPause(requests, event);
    if (tracked) {
      tracked.ownedDelete = Boolean(deleting);
      tracked.injected = action !== 'pass' && action !== 'hold_patch';
      tracked.inScope = inScope;
    }
    if (action === 'hold_patch') {
      pendingPatch = event.requestId;
      heldPatch += 1;
      return;
    }
    const command = action.startsWith('fail_')
      ? panel.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' })
      : action === 'missing_detail' || action === 'zero_delete'
        ? panel.send('Fetch.fulfillRequest', {
            requestId: event.requestId,
            responseCode: action === 'missing_detail' ? 200 : 204,
            responseHeaders:
              action === 'missing_detail'
                ? [{ name: 'content-type', value: 'application/json' }]
                : [{ name: 'content-range', value: '*/0' }],
            body: action === 'missing_detail' ? Buffer.from('null').toString('base64') : '',
          })
        : panel.send('Fetch.continueRequest', { requestId: event.requestId });
    void command
      .then(() => {
        if (action === 'fail_get') failedGet += 1;
        else if (action === 'fail_post') failedPost += 1;
        else if (action === 'fail_detail') failedDetail += 1;
        else if (action === 'missing_detail') missingDetail += 1;
        else if (action === 'fail_delete') failedDelete += 1;
        else if (action === 'zero_delete') zeroDelete += 1;
        else {
          passed += 1;
          if (inScope && request.method === 'GET') passedGet += 1;
        }
      })
      .catch(() => {
        interceptionFailed = true;
      });
  });
  return {
    start: async () => {
      await panel.send('Network.enable');
      return panel.send('Fetch.enable', {
        patterns: [{ urlPattern: `${origin}/rest/v1/notes*`, requestStage: 'Request' }],
      });
    },
    setMode: (next) => {
      mode = next;
    },
    setDeleteMode: (next) => {
      deleteMode = next;
    },
    setOwnedNoteId: (id) => {
      if (!/^[0-9a-f-]{36}$/i.test(id) || !detailIds.includes(id)) fail('owned_note_id_unproven');
      ownedNoteId = id;
    },
    state: () => ({
      responses: [...responses],
      detailIds: [...detailIds],
      createdNoteIds: [...createdNoteIds],
      failedGet,
      failedPost,
      failedDetail,
      missingDetail,
      failedDelete,
      zeroDelete,
      heldPatch,
      autosaveDispatches,
      passed,
      passedGet,
      interceptionFailed,
      patchPending: Boolean(pendingPatch),
    }),
    releasePatch: async () => {
      if (!pendingPatch) fail('owned_patch_not_pending');
      const id = pendingPatch;
      pendingPatch = null;
      mode = 'observe';
      await panel.send('Fetch.continueRequest', { requestId: id });
    },
    stop: async () => {
      if (pendingPatch)
        await panel.send('Fetch.continueRequest', { requestId: pendingPatch }).catch(() => {});
      await panel.send('Fetch.disable').catch(() => {});
      off();
      offRequest();
      offResponse();
      offFinished();
    },
  };
}
async function fillPanelControl(panel, selector, value) {
  let lastHitSample = null;
  const target = await waitFor(
    'editor_control_hittable',
    async () => {
      lastHitSample = await evaluate(
        panel,
        `(() => {
        const tab = document.querySelector('button[role="tab"][title="Notes"][data-state="active"]');
        const root = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
        const el = root?.querySelector(${JSON.stringify(selector)});
        if (!el) return { reason: 'control_absent' };
        if (el.disabled) return { reason: 'control_disabled' };
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        const points = [[0.5, 0.5], [0.5, 0.15], [0.5, 0.85], [0.2, 0.5], [0.8, 0.5]];
        for (const [px, py] of points) {
          const x = r.left + r.width * px, y = r.top + r.height * py;
          if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) continue;
          if (el.contains(document.elementFromPoint(x, y))) return { target: { x, y } };
        }
        const center = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const modal = document.querySelector('[role="alertdialog"][data-state="open"], [role="dialog"][data-state="open"]');
        return { reason: 'target_occluded', modalOpen: Boolean(modal),
          centerHitTag: center?.tagName?.toLowerCase() ?? null,
          hasArea: r.width > 0 && r.height > 0 };
      })()`,
      );
      return lastHitSample;
    },
    (sample) => Boolean(sample?.target),
    10_000,
  )
    .then((sample) => sample.target)
    .catch(() => {
      report.observations.editor_hit_target_failure = lastHitSample;
      fail('editor_control_not_hittable');
    });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...target,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...target,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    modifiers: process.platform === 'darwin' ? 4 : 2,
    windowsVirtualKeyCode: 65,
    commands: ['selectAll'],
  });
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    modifiers: process.platform === 'darwin' ? 4 : 2,
    windowsVirtualKeyCode: 65,
  });
  const selection = await evaluate(
    panel,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      return el && document.activeElement === el && el.selectionStart === 0 &&
        el.selectionEnd === el.value.length;
    })()`,
  );
  if (!selection) fail('editor_select_all_not_observed');
  await panel.send('Input.insertText', { text: value });
}
async function clickOwnedNoteRow(panel) {
  const target = await evaluate(
    panel,
    `(() => {
    const tab = document.querySelector('button[role="tab"][title="Notes"]');
    const root = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
    const matches = [...(root?.querySelectorAll('li button') ?? [])]
      .filter(b => b.textContent.includes(${JSON.stringify(noteTitle)}));
    if (matches.length !== 1) return null;
    const el = matches[0];
    el.scrollIntoView({block:'center'});
    const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return el.contains(document.elementFromPoint(x,y)) ? {x,y} : null;
  })()`,
  );
  if (!target) fail('owned_note_row_not_hittable');
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...target,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...target,
    button: 'left',
    clickCount: 1,
  });
}
try {
  const before = await identity();
  report.build = { before, after: null };
  report.imported_artifact = await verifyImportedNativeEvidence(before.extensionDir, RECEIPT);
  if (report.imported_artifact.sourceSha !== EXPECTED_SOURCE_SHA) fail('unexpected_source_sha');
  const origin = await supabaseOrigin();
  if (origin !== 'https://db.matrxserver.com') fail('unexpected_supabase_origin');
  const config = await privateConfig();
  const native = await runNativeSidepanelQa({
    headed: ROLE === 'member' && INTERACTIVE_MEMBER,
    extensionDir: before.extensionDir,
    expectedRelease: before,
    localDevReceiptPath: RECEIPT,
    exercisePanel: async ({ page, panel }) => {
      stage = 'real_signin';
      await realLogin(page, panel, config);
      stage = 'organization';
      if (ROLE === 'member' && INTERACTIVE_MEMBER) await selectMemberOrganizationThroughUi(panel);
      else await selectTestOrganization(panel, config.approved_organization_name);
      const transport = armNotesTransport(panel, origin);
      await transport.start();
      try {
        stage = 'D61_failed_list';
        transport.setMode('fail_get');
        await click(panel, 'title', 'Notes');
        await waitFor(
          'owned_notes_get_failed',
          transport.state,
          (s) => s.failedGet > 0 && !s.interceptionFailed,
          30_000,
        );
        const failedList = await waitFor(
          'visible_notes_load_error',
          () => notesState(panel),
          (s) => s.active && s.error && s.retry && !s.empty,
          30_000,
        );
        report.observations.D61 = {
          fault_scoped: true,
          failed_requests: transport.state().failedGet,
          visible_error: failedList.error,
          visible_retry: failedList.retry,
          falsely_empty: failedList.empty,
        };
        transport.setMode('observe');
        stage = 'D61_retry';
        const retryLabel = await evaluate(
          panel,
          `(() => {
          const root = document.getElementById(document.querySelector('button[role="tab"][title="Notes"]')?.getAttribute('aria-controls') ?? '');
          return [...(root?.querySelectorAll('button') ?? [])].find(b => !b.disabled && /retry|try again/i.test(b.textContent))?.textContent.trim() ?? null;
        })()`,
        );
        if (!retryLabel) fail('notes_retry_missing');
        await click(panel, 'button', retryLabel);
        await waitFor(
          'notes_list_recovered',
          () => notesState(panel),
          (s) => s.active && s.create && !s.error,
          45_000,
        );
        report.observations.D61.recovered_from_real_retry = true;

        stage = 'D62_failed_create';
        transport.setMode('fail_post');
        await click(panel, 'button', 'New note');
        await waitFor(
          'owned_notes_post_failed',
          transport.state,
          (s) => s.failedPost > 0 && !s.interceptionFailed,
          30_000,
        );
        const failedCreate = await waitFor(
          'visible_notes_create_error',
          () => notesState(panel),
          (s) => s.active && s.error && s.retry && s.create && !s.editor,
          30_000,
        );
        report.observations.D62 = {
          fault_scoped: true,
          failed_requests: transport.state().failedPost,
          visible_error: failedCreate.error,
          retry_visible: failedCreate.retry,
          create_available_again: failedCreate.create,
          remains_in_list: !failedCreate.editor,
        };
        transport.setMode('observe');
        stage = 'D62_refresh_click';
        const beforeRefresh = transport.state().passedGet;
        await click(panel, 'button', 'Refresh notes');
        await waitFor(
          'notes_refreshed_before_create_retry',
          transport.state,
          (s) => s.passedGet > beforeRefresh && !s.interceptionFailed,
          30_000,
        );
        report.observations.D62.refreshed_notes_before_retry = true;
        stage = 'D62_retry_label';
        const createRetryLabel = await evaluate(
          panel,
          `(() => {
          const root = document.getElementById(document.querySelector('button[role="tab"][title="Notes"]')?.getAttribute('aria-controls') ?? '');
          return [...(root?.querySelectorAll('button') ?? [])].find(b => !b.disabled && /retry|try again/i.test(b.textContent))?.textContent.trim() ?? null;
        })()`,
        );
        if (!createRetryLabel) fail('create_retry_missing');
        stage = 'D62_retry_click';
        await click(panel, 'button', createRetryLabel);
        report.observations.D62.retry_clicked = true;
        stage = 'D62_retry_editor';
        await waitFor(
          'created_note_editor',
          () => notesState(panel),
          (s) => s.editor,
          45_000,
        );
        report.observations.D62.recovered_by_real_create = true;
        const created = await waitFor('owned_note_create_response_id', transport.state,
          s => s.createdNoteIds.length === 1 && !s.interceptionFailed, 30_000);
        await writeFile(FIXTURE_RECEIPT, `${JSON.stringify({
          schema_version: 1, status: 'created', note_id: created.createdNoteIds[0],
          note_title: noteTitle, role: ROLE, source_sha: EXPECTED_SOURCE_SHA,
          tree_sha256: before.treeSha256,
        }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        report.observations.owned_fixture_receipt = FIXTURE_RECEIPT;

        stage = 'D63_seed_owned_note';
        await fillPanelControl(panel, 'input[placeholder="Untitled"]', noteTitle);
        await waitFor(
          'owned_note_title_saving',
          () => notesState(panel),
          (s) => s.title && s.saving,
          15_000,
        );
        await waitFor(
          'owned_note_title_saved',
          () => notesState(panel),
          (s) => s.title && s.saved,
          45_000,
        );
        transport.setMode('hold_patch');
        await fillPanelControl(panel, 'textarea[placeholder^="Start writing"]', draftA);
        await waitFor(
          'first_owned_write_held',
          transport.state,
          (s) => s.heldPatch === 1 && s.patchPending,
          30_000,
        );
        await fillPanelControl(panel, 'textarea[placeholder^="Start writing"]', draftB);
        await waitFor(
          'latest_draft_visible_while_pending',
          () => notesState(panel),
          (s) => s.draftB && s.saving && !s.saved,
          15_000,
        );
        // The 600 ms debounce is the behavior under test: keep A held long enough
        // for B's timer to fire while A is still in flight.
        await new Promise((resolveWait) => setTimeout(resolveWait, 900));
        if (!transport.state().patchPending || !(await notesState(panel)).draftB)
          fail('latest_draft_not_held_through_debounce');
        await transport.releasePatch();
        await waitFor(
          'latest_draft_saved',
          () => notesState(panel),
          (s) => s.draftB && s.saved && !s.saving,
          60_000,
        );
        report.observations.D63 = {
          first_write_held: true,
          latest_draft_visible_while_pending: true,
          saved_after_release: true,
        };
        stage = 'D63_reopen';
        await click(panel, 'button', 'Back');
        await waitFor(
          'owned_note_in_list',
          () => notesState(panel),
          (s) => s.noteInList,
          45_000,
        );
        await panel.send('Page.reload', { ignoreCache: true });
        await waitFor(
          'notes_tab_present_after_reload',
          () =>
            evaluate(panel, `Boolean(document.querySelector('button[role="tab"][title="Notes"]'))`),
          Boolean,
          30_000,
        );
        if (!(await notesState(panel)).active) await click(panel, 'title', 'Notes');
        await waitFor(
          'notes_tab_after_reload',
          () => notesState(panel),
          (s) => s.active && s.noteInList,
          60_000,
        );
        const detailRequestsBeforeReopen = transport.state().detailIds.length;
        await clickOwnedNoteRow(panel);
        await waitFor(
          'latest_draft_reopened_from_server',
          () => notesState(panel),
          (s) => s.editor && s.title && s.draftB,
          45_000,
        );
        report.observations.D63.reopened_latest_draft = true;

        const detailIds = transport.state().detailIds.slice(detailRequestsBeforeReopen);
        if (detailIds.length !== 1) fail('owned_detail_request_not_unique');
        if (detailIds[0] !== transport.state().createdNoteIds[0]) fail('owned_detail_id_not_created_id');
        transport.setOwnedNoteId(detailIds[0]);

        stage = 'D67_failed_detail';
        await click(panel, 'button', 'Back');
        await waitFor(
          'owned_note_ready_for_detail_fault',
          () => notesState(panel),
          (s) => s.noteInList && !s.editor,
          30_000,
        );
        transport.setMode('fail_detail');
        await panel.send('Page.reload', { ignoreCache: true });
        await waitFor(
          'notes_tab_present_for_detail_fault',
          () =>
            evaluate(panel, `Boolean(document.querySelector('button[role="tab"][title="Notes"]'))`),
          Boolean,
          30_000,
        );
        if (!(await notesState(panel)).active) await click(panel, 'title', 'Notes');
        await waitFor(
          'owned_note_list_before_detail_fault',
          () => notesState(panel),
          (s) => s.active && s.noteInList,
          60_000,
        );
        await clickOwnedNoteRow(panel);
        await waitFor(
          'owned_detail_transport_failure',
          transport.state,
          (s) => s.failedDetail > 0 && !s.interceptionFailed,
          30_000,
        );
        const failedDetailUi = await waitFor(
          'failed_detail_terminal_ui',
          () => notesState(panel),
          (s) => s.detailFailure && s.detailRetry && s.back && !s.editor,
          30_000,
        );
        report.observations.D67 = {
          injected_transport_failure: transport.state().failedDetail,
          visible_failure: failedDetailUi.detailFailure,
          retry_and_back: failedDetailUi.detailRetry && failedDetailUi.back,
          terminal_without_editor: !failedDetailUi.editor,
        };

        stage = 'D67_missing_detail';
        transport.setMode('missing_detail');
        await click(panel, 'button', 'Retry loading note');
        await waitFor(
          'injected_missing_detail_response',
          transport.state,
          (s) => s.missingDetail > 0 && !s.interceptionFailed,
          30_000,
        );
        const missingDetailUi = await waitFor(
          'missing_detail_terminal_ui',
          () => notesState(panel),
          (s) => s.missingDetail && s.detailRetry && s.back && !s.editor,
          30_000,
        );
        report.observations.D67.injected_successful_missing_row = true;
        report.observations.D67.missing_row_terminal = missingDetailUi.missingDetail;
        transport.setMode('observe');
        const realDetailBefore = transport
          .state()
          .responses.filter((r) => r.ownedDetail && !r.injected && r.status === 200).length;
        stage = 'D67_real_recovery';
        await click(panel, 'button', 'Retry loading note');
        await waitFor(
          'owned_detail_recovered_from_live_service',
          transport.state,
          (s) =>
            s.responses.filter((r) => r.ownedDetail && !r.injected && r.status === 200).length >
            realDetailBefore,
          45_000,
        );
        await waitFor(
          'owned_editor_restored',
          () => notesState(panel),
          (s) => s.editor && s.title && s.draftB,
          45_000,
        );
        report.observations.D67.recovered_from_real_detail_get = true;

        stage = 'D68_transport_failure';
        transport.setDeleteMode('fail_delete');
        await click(panel, 'title', 'Delete note');
        await click(panel, 'button', 'Delete');
        await waitFor(
          'owned_delete_transport_failure',
          transport.state,
          (s) => s.failedDelete > 0 && !s.interceptionFailed,
          30_000,
        );
        const failedDeleteUi = await waitFor(
          'delete_failure_keeps_editor',
          () => notesState(panel),
          (s) => s.editor && s.title && s.draftB && s.deleteFailure && s.deleteRetry,
          30_000,
        );
        report.observations.D68 = {
          injected_transport_failure: transport.state().failedDelete,
          editor_and_draft_preserved: failedDeleteUi.editor && failedDeleteUi.draftB,
          retry_requires_confirmation: false,
        };

        stage = 'D68_zero_affected_rows';
        transport.setDeleteMode('zero_delete');
        await click(panel, 'button', 'Retry delete');
        await click(panel, 'button', 'Delete');
        await waitFor(
          'injected_zero_row_delete_response',
          transport.state,
          (s) => s.zeroDelete > 0 && !s.interceptionFailed,
          30_000,
        );
        const zeroDeleteUi = await waitFor(
          'zero_row_delete_keeps_editor',
          () => notesState(panel),
          (s) => s.editor && s.title && s.draftB && s.deleteFailure && s.deleteRetry,
          30_000,
        );
        report.observations.D68.injected_zero_affected_rows = transport.state().zeroDelete;
        report.observations.D68.zero_row_kept_editor = zeroDeleteUi.editor;
        report.observations.D68.retry_requires_confirmation = true;

        stage = 'D68_pending_autosave_delete';
        transport.setDeleteMode('observe');
        transport.setMode('hold_patch');
        await fillPanelControl(panel, 'textarea[placeholder^="Start writing"]', draftC);
        await waitFor(
          'owned_autosave_pending_before_delete',
          transport.state,
          (s) => s.patchPending && s.heldPatch >= 2 && !s.interceptionFailed,
          30_000,
        );
        const autosaveDispatchesBeforeDelete = transport.state().autosaveDispatches;
        await click(panel, 'button', 'Retry delete');
        await click(panel, 'button', 'Delete');
        await waitFor(
          'live_owned_delete_response',
          transport.state,
          (s) =>
            s.responses.some(
              (r) => r.ownedDelete && !r.injected && r.status >= 200 && r.status < 300,
            ),
          45_000,
        );
        await waitFor(
          'owned_note_removed_from_list',
          () => notesState(panel),
          (s) => s.active && s.create && !s.editor && !s.noteInList,
          45_000,
        );
        await transport.releasePatch();
        await new Promise((resolveWait) => setTimeout(resolveWait, 900));
        if (transport.state().autosaveDispatches !== autosaveDispatchesBeforeDelete)
          fail('autosave_dispatched_after_confirmed_delete');
        await panel.send('Page.reload', { ignoreCache: true });
        await waitFor(
          'notes_tab_present_after_delete',
          () =>
            evaluate(panel, `Boolean(document.querySelector('button[role="tab"][title="Notes"]'))`),
          Boolean,
          30_000,
        );
        if (!(await notesState(panel)).active) await click(panel, 'title', 'Notes');
        await waitFor(
          'owned_note_absent_after_live_reload',
          () => notesState(panel),
          (s) => s.active && s.create && !s.noteInList && !s.editor && !s.error,
          60_000,
        );
        report.observations.D68.real_delete_confirmed_by_live_response = true;
        report.observations.D68.owned_note_absent_after_reload = true;
        report.observations.D68.no_new_autosave_after_delete = true;
        await writeFile(FIXTURE_RECEIPT, `${JSON.stringify({
          schema_version: 1, status: 'deleted_confirmed', note_id: detailIds[0],
          note_title: noteTitle, role: ROLE, source_sha: EXPECTED_SOURCE_SHA,
          tree_sha256: before.treeSha256,
        }, null, 2)}\n`, { mode: 0o600 });
      } catch (error) {
        report.observations.failure_ui = await notesState(panel).catch(() => ({
          unavailable: true,
        }));
        report.observations.failure_transport = transport.state();
        // The driver explicitly exposes content-free categories and geometry.
        if (error?.driverFailure) report.driver_failure = error.driverFailure;
        throw error;
      } finally {
        await transport.stop();
      }
    },
  });
  report.extension_id = native.extensionId;
  report.build.after = await identity();
  assert.deepEqual(report.build.after, before);
  report.imported_artifact = await verifyImportedNativeEvidence(before.extensionDir, RECEIPT);
  if (report.imported_artifact.sourceSha !== EXPECTED_SOURCE_SHA) fail('unexpected_source_sha_after');
  report.status = 'pass';
  stage = 'complete';
} catch {
  report.failure_stage = stage;
  report.failure_code ??= 'stage_operation_failed';
  process.exitCode = 1;
} finally {
  await mkdir(join(REPO, 'test-results'), { recursive: true, mode: 0o700 });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `${report.status === 'pass' ? 'PASS' : 'UNVERIFIED'} notes_native_acceptance\n`,
  );
}
