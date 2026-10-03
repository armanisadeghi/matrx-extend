#!/usr/bin/env node
/** Receipt-bound native Profile acceptance in an owned Chrome profile. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyImportedNativeEvidence } from '../../scripts/current-test-artifact.mjs';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { signInAdminSettings } from './admin-settings-signin.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { assertFirstSaveOwnedRow, ownedDeleteUrl } from './profile-empty-row-restoration.mjs';
import { panelIdentity } from './settings-native-auth-driver.mjs';
import { signInSettings } from './settings-native-auth-driver.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const RECEIPT = process.env.PROFILE_DEV_BUILD_RECEIPT;
const OUTPUT_DIR = process.env.PROFILE_OUTPUT_DIR;
const RUN_ID = process.env.PROFILE_RUN_ID;
const SOURCE_SHA = process.env.PROFILE_EXPECTED_SOURCE_SHA;
const CI_RUN_ID = Number(process.env.PROFILE_EXPECTED_CI_RUN_ID);
const ARTIFACT_ID = Number(process.env.PROFILE_EXPECTED_ARTIFACT_ID);
const AUTH_MODE = process.env.PROFILE_AUTH_MODE ?? 'admin';
const report = {
  schema_version: 1,
  kind: 'profile_native_acceptance',
  run_id: RUN_ID,
  started_at: new Date().toISOString(),
  status: 'unverified',
  stage: 'preflight',
  cases: [],
  artifact: null,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  launch: {
    auth_mode: AUTH_MODE,
    profile_run_id: RUN_ID,
    profile_dev_build_receipt: RECEIPT,
    profile_output_dir: OUTPUT_DIR,
    playwright_module: process.env.MATRX_PLAYWRIGHT_MODULE ?? null,
    chrome_executable: process.env.MATRX_CHROME_PATH ?? null,
    playwright_browsers_path: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null,
    temp_dir: process.env.TMPDIR ?? null,
  },
};

function readEnvValue(source, key) {
  const line = source.split(/\r?\n/).find((item) => item.startsWith(`${key}=`));
  if (!line) throw new Error('admin_credential_unavailable');
  const value = line.slice(key.length + 1).trim();
  return value.replace(/^['"]|['"]$/g, '');
}
async function credentials() {
  const source = await readFile(join(homedir(), 'code/aidream/.env'), 'utf8');
  const email = readEnvValue(source, 'AI_ADMIN_USERNAME');
  const password = readEnvValue(source, 'AI_ADMIN_PASSWORD');
  assert.equal(email, 'admin@admin.com', 'admin_identity_required');
  assert.ok(password, 'admin_password_required');
  return { email, password };
}
async function profileApiConfig() {
  const source = await readFile(join(REPO, '.env.production'), 'utf8');
  const url = readEnvValue(source, 'WXT_SUPABASE_URL');
  const key = readEnvValue(source, 'WXT_SUPABASE_PUBLISHABLE_KEY');
  assert.equal(new URL(url).protocol, 'https:', 'profile_api_url_invalid');
  assert.ok(key, 'profile_api_key_missing');
  return { url, key };
}
async function profileOwnerRequest(panel, { key, organizationId }, requestUrl, method = 'GET') {
  const result = await evaluate(
    panel,
    `(async () => {
      const stored = await chrome.storage.local.get('matrx.auth.accessToken');
      const token = stored['matrx.auth.accessToken'];
      if (typeof token !== 'string' || !token) return { ok: false, status: 0, rows: [] };
      const response = await fetch(${JSON.stringify(requestUrl)}, {
        method: ${JSON.stringify(method)},
        headers: {
          apikey: ${JSON.stringify(key)},
          Authorization: 'Bearer ' + token,
          'X-Organization-Id': ${JSON.stringify(organizationId)},
          'Accept-Profile': 'users',
          'Content-Profile': 'users',
          ...( ${JSON.stringify(method)} === 'DELETE' ? { Prefer: 'return=representation' } : {} ),
        },
      });
      if (!response.ok) return { ok: false, status: response.status, rows: [] };
      const rows = await response.json();
      return { ok: Array.isArray(rows), status: response.status, rows: Array.isArray(rows) ? rows : [] };
    })()`,
  );
  assert.equal(result?.ok, true, `profile_owner_${method.toLowerCase()}_failed`);
  assert.equal(result.status, 200, `profile_owner_${method.toLowerCase()}_status`);
  return result.rows;
}
async function readProfileOwnerRow(panel, config, userId) {
  const url = new URL('/rest/v1/user_form_profile', config.url);
  url.searchParams.set('select', 'user_id,organization_id,preferred_name,created_at,version');
  url.searchParams.set('user_id', `eq.${userId}`);
  const rows = await profileOwnerRequest(panel, config, url.href);
  assert.ok(rows.length <= 1, 'profile_owner_row_not_unique');
  return rows[0] ?? null;
}
async function deleteOwnedProfileRow(panel, config, owned, expectedVersion) {
  const row = await readProfileOwnerRow(panel, config, owned.userId);
  assert.ok(row, 'owned_profile_cleanup_row_missing');
  const url = ownedDeleteUrl(config.url, owned, row, expectedVersion);
  const deleted = await profileOwnerRequest(panel, config, url, 'DELETE');
  assert.equal(deleted.length, 1, 'owned_profile_conditional_delete_missed');
  assert.equal(deleted[0]?.user_id, owned.userId, 'owned_profile_deleted_wrong_owner');
  assert.equal(
    await readProfileOwnerRow(panel, config, owned.userId),
    null,
    'owned_profile_absence_not_restored',
  );
}
async function selectApprovedOrganization(panel) {
  const configPath = join(REPO, 'test-results/notes-private-config.json');
  const metadata = await stat(configPath);
  assert.equal(metadata.mode & 0o077, 0, 'organization_fixture_not_private');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const name = config.approved_organization_name;
  assert.ok(typeof name === 'string' && name.trim(), 'approved_organization_missing');
  await openSection(panel, 'Organization');
  const selected = () =>
    evaluate(
      panel,
      `(() => {
    const section=[...document.querySelectorAll('button[aria-expanded]')].find(b=>b.textContent.trim()==='Organization');
    const body=section?.parentElement?.nextElementSibling;
    const label=[...(body?.querySelectorAll('span')??[])].find(s=>s.textContent.trim()==='Acting as');
    const control=label?.parentElement?.parentElement?.querySelector('button[role="combobox"]');
    return {count:control?1:0,name:control?.textContent.trim()??null,
      noMembership:(body?.textContent??'').includes('You are not a member of any organization'),
      error:Boolean(body?.querySelector('.text-destructive'))};
  })()`,
    );
  const before = await waitFor(
    'organization_picker_ready',
    selected,
    (s) => s?.count === 1 || s?.noMembership || s?.error,
    30000,
  );
  assert.equal(before.count, 1, 'organization_picker_unavailable');
  if (before.name !== name) {
    assert.equal(before.name, 'Choose…', 'unexpected_preselected_organization');
    await click(panel, 'organization', 'Acting as');
    await waitFor(
      'approved_organization_option',
      () =>
        evaluate(
          panel,
          `(() =>
      [...document.querySelectorAll('[role="option"]')].filter(o=>o.textContent.trim()===${JSON.stringify(name)}).length)()`,
        ),
      (n) => n === 1,
      30000,
    );
    await click(panel, 'option', name);
  }
  await waitFor('approved_organization_selected', selected, (s) => s?.name === name, 30000);
  return name;
}
async function state(panel) {
  return evaluate(
    panel,
    `(() => {
    const visible = (el) => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el);
      return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none' && !el.closest('[inert]'); };
    const buttons=[...document.querySelectorAll('button')].filter(visible);
    const row=[...document.querySelectorAll('span')].find(el=>el.textContent.trim()==='Preferred');
    const input=row?.parentElement?.querySelector('input') ?? row?.parentElement?.parentElement?.querySelector('input');
    const backButton=document.querySelector('button[title="Back"]');
    const profileRoot=backButton?.parentElement?.parentElement;
    const profileBody=profileRoot?.children?.[1];
    const headerSave=profileRoot?.querySelector('button[aria-label="Save profile"]');
    return { profile:buttons.some(b=>b.textContent.trim()==='Profile'),
      back:buttons.some(b=>b.title==='Back'), chat:!!document.querySelector('button[role="tab"][title="Chat"][data-state="active"]'),
      preferred:input?.value ?? null, dirty:(document.body.innerText??'').includes('Unsaved changes'),
      discard:buttons.some(b=>b.textContent.trim()==='Discard'), saveEnabled:buttons.some(b=>b.textContent.trim()==='Save'&&!b.disabled),
      editorCount:profileBody?.querySelectorAll('input,textarea,select').length??0,
      headerSaveDisabled:headerSave?.disabled??null,
      loading:!input,
      error:([...document.querySelectorAll('div')].find(el=>el.classList.contains('text-destructive')&&
        el.classList.contains('rounded-xl')&&el.classList.contains('border-destructive/40'))?.textContent??'').slice(0,160) };
  })()`,
  );
}
function redactedState(observed, expected) {
  return {
    preferred_matches_expected: observed.preferred === expected,
    preferred_empty: observed.preferred === '',
    preferred_missing: observed.preferred === null,
    dirty: observed.dirty,
    save_enabled: observed.saveEnabled,
    error_present: Boolean(observed.error),
    loading: observed.loading,
    back: observed.back,
  };
}
function observeProfileRequests(panel) {
  const requests = new Map();
  const events = [];
  const route = (url) => {
    try {
      const path = new URL(url).pathname;
      if (path === '/rest/v1/user_form_profile') return 'profile_row';
      if (path === '/rest/v1/rpc/get_user_form_context') return 'profile_context';
    } catch {
      /* An unrelated URL. */
    }
    return null;
  };
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    const name = route(request?.url);
    if (name)
      requests.set(requestId, {
        route: name,
        method: request.method,
        status: null,
        outcome: 'pending',
        error_code: null,
        row_present: null,
      });
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const entry = requests.get(requestId);
    if (entry) entry.status = response.status;
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    const entry = requests.get(requestId);
    if (!entry) return;
    entry.outcome = 'finished';
    events.push(entry);
    requests.delete(requestId);
    if (entry.status === null) return;
    void panel
      .send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) => {
        const raw = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
        const parsed = raw ? JSON.parse(raw) : null;
        if (entry.route === 'profile_row' && entry.method === 'GET' && entry.status === 200)
          entry.row_present = Boolean(parsed && typeof parsed === 'object' && parsed.user_id);
        const code = parsed?.code;
        if (typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code)) entry.error_code = code;
      })
      .catch(() => {});
  });
  const offFailed = panel.on('Network.loadingFailed', ({ requestId }) => {
    const entry = requests.get(requestId);
    if (entry) {
      entry.outcome = 'network_failed';
      events.push(entry);
      requests.delete(requestId);
    }
  });
  return {
    start: () => panel.send('Network.enable'),
    snapshot: () =>
      events.map(({ route, method, status, outcome, error_code, row_present }) => ({
        route,
        method,
        status,
        outcome,
        error_code,
        row_present,
      })),
    stop: () => {
      offRequest();
      offResponse();
      offFinished();
      offFailed();
    },
  };
}
async function openProfile(panel, email) {
  await click(panel, 'title', email);
  await click(panel, 'button-text', 'Profile');
  const ready = await waitFor(
    'profile_ready',
    () => state(panel),
    (s) => s.back && s.preferred !== null,
    30000,
  );
  assert.equal(Boolean(ready.error), false, 'profile_initial_load_failed');
}
async function clickProfileHeader(panel, label) {
  const target = await waitFor(
    'profile_header_button_hittable',
    () =>
      evaluate(
        panel,
        `(() => {
    const back=document.querySelector('button[title="Back"]');
    const header=back?.parentElement;
    const matches=[...(header?.querySelectorAll('button')??[])].filter(b=>b.textContent.trim()===${JSON.stringify(label)});
    if(matches.length!==1 || matches[0].disabled)return null;
    const el=matches[0];el.scrollIntoView({block:'center',behavior:'instant'});
    const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    return el.contains(document.elementFromPoint(x,y))?{x,y}:null;
  })()`,
      ),
    (v) => v?.x > 0,
    10000,
  );
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
async function fillPreferred(panel, value) {
  const target = await waitFor(
    'preferred_hittable',
    () =>
      evaluate(
        panel,
        `(() => {
    const label=[...document.querySelectorAll('span')].find(el=>el.textContent.trim()==='Preferred');
    const el=label?.parentElement?.querySelector('input')??label?.parentElement?.parentElement?.querySelector('input');
    if(!el || el.closest('[inert]')) return null;
    el.scrollIntoView({block:'center',behavior:'instant'});
    const r=el.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;
    return el.contains(document.elementFromPoint(x,y))?{x,y}:null;
  })()`,
      ),
    (v) => v?.x > 0,
    10000,
  );
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
  await panel.send('Input.insertText', { text: value });
  await waitFor(
    'preferred_draft',
    () => state(panel),
    (s) => s.preferred === value && s.dirty && s.saveEnabled,
    10000,
  );
}
async function caseBack(panel, original, email, mode, dimension) {
  const id = mode === 'member' ? 'EXT-F-1004-T01' : 'EXT-F-1004-T02';
  const startedAt = new Date().toISOString();
  await fillPreferred(panel, `Profile cancel ${randomUUID().slice(0, 8)}`);
  const draft = await state(panel);
  await click(panel, 'title', 'Back');
  const back = await waitFor(
    'chat_after_back',
    () => state(panel),
    (s) => s.chat && !s.back,
    10000,
  );
  await openProfile(panel, email);
  const reopened = await waitFor(
    'profile_cancel_restored',
    () => state(panel),
    (s) => s.preferred === original && !s.dirty,
    30000,
  );
  report.cases.push({
    id,
    mode,
    dimension,
    branch: 'default',
    status: 'passed',
    started_at: startedAt,
    observed: {
      draft_dirty: draft.dirty,
      discard_visible: draft.discard,
      back_chat: back.chat,
      reopened_original: reopened.preferred === original,
    },
  });
}
async function caseSaveDiscard(panel, original, email, mode, dimension) {
  const id = mode === 'member' ? 'EXT-F-1004-T03' : 'EXT-F-1004-T04';
  const startedAt = new Date().toISOString();
  const diagnostic = { mode, dimension, stages: [], requests: [] };
  report.save_discard_diagnostics ??= [];
  report.save_discard_diagnostics.push(diagnostic);
  const network = observeProfileRequests(panel);
  await network.start();
  const observe = async (stage, expected) => {
    diagnostic.stages.push({ stage, ...redactedState(await state(panel), expected) });
  };
  await fillPreferred(panel, `Profile discard ${randomUUID().slice(0, 8)}`);
  await observe('discard_draft', '');
  await clickProfileHeader(panel, 'Discard');
  const discarded = await waitFor(
    'profile_discard_restored',
    () => state(panel),
    (s) => s.preferred === original && !s.dirty && !s.saveEnabled,
    10000,
  );
  await observe('discard_settled', original);
  const savedValue = `Profile save ${randomUUID().slice(0, 8)}`;
  await fillPreferred(panel, savedValue);
  await observe('save_draft', savedValue);
  let firstError = null;
  let cleanupError = null;
  try {
    await clickProfileHeader(panel, 'Save');
    await waitFor(
      'profile_save_settled',
      () => state(panel),
      (s) => s.preferred === savedValue && !s.dirty && !s.error,
      30000,
    );
    await observe('save_settled', savedValue);
    await click(panel, 'title', 'Back');
    await openProfile(panel, email);
    await waitFor(
      'profile_saved_after_reopen',
      () => state(panel),
      (s) => s.preferred === savedValue && !s.dirty,
      30000,
    );
    await observe('saved_after_reopen', savedValue);
  } catch (error) {
    firstError = error;
    diagnostic.first_failure = String(error?.message ?? 'unknown')
      .split(':', 1)[0]
      .slice(0, 100);
    await observe('first_failure', savedValue).catch(() => {});
  } finally {
    try {
      const current = await state(panel);
      await observe('before_cleanup', original);
      if (current.preferred !== original) {
        await fillPreferred(panel, original);
        await observe('cleanup_draft', original);
        await clickProfileHeader(panel, 'Save');
        await waitFor(
          'profile_original_restored',
          () => state(panel),
          (s) => s.preferred === original && !s.dirty && !s.error,
          30000,
        );
        await observe('cleanup_settled', original);
        await click(panel, 'title', 'Back');
        await openProfile(panel, email);
        await waitFor(
          'profile_restore_reopen',
          () => state(panel),
          (s) => s.preferred === original && !s.dirty,
          30000,
        );
        await observe('cleanup_after_reopen', original);
      }
      diagnostic.original_value_restored = true;
    } catch (error) {
      cleanupError = error;
      diagnostic.cleanup_failure = String(error?.message ?? 'unknown')
        .split(':', 1)[0]
        .slice(0, 100);
      await observe('cleanup_failure', original).catch(() => {});
    } finally {
      diagnostic.requests = network.snapshot();
      network.stop();
    }
  }
  if (firstError) throw firstError;
  if (cleanupError) throw cleanupError;
  assert.ok(
    diagnostic.requests.filter(
      (request) =>
        request.route === 'profile_row' && request.method === 'GET' && request.status === 200,
    ).length >= 2,
    'profile_saved_and_restored_server_reads_missing',
  );
  assert.ok(
    diagnostic.requests.filter(
      (request) =>
        request.route === 'profile_row' && request.method === 'POST' && request.status === 200,
    ).length >= 2,
    'profile_save_and_restore_server_writes_missing',
  );
  report.cases.push({
    id,
    mode,
    dimension,
    branch: 'discard-draft',
    status: 'passed',
    started_at: startedAt,
    observed: {
      discard_restored: discarded.preferred === original,
      save_disabled: !discarded.saveEnabled,
    },
  });
  report.cases.push({
    id,
    mode,
    dimension,
    branch: 'save-draft',
    status: 'passed',
    started_at: startedAt,
    observed: { saved_after_reopen: true, original_restored_after_reopen: true },
  });
}

async function caseT25(panel, original, email, mode, dimension) {
  const id = 'EXT-F-1004-T25';
  const startedAt = new Date().toISOString();
  const fault = { matched: 0, refused: 0, failures: 0 };
  const network = observeProfileRequests(panel);
  await click(panel, 'title', 'Back');
  await waitFor(
    'chat_before_denied_read',
    () => state(panel),
    (s) => s.chat && !s.back,
    10000,
  );
  const offPaused = panel.on('Fetch.requestPaused', ({ requestId, request }) => {
    const ownerRead =
      request?.method === 'GET' && new URL(request.url).pathname === '/rest/v1/user_form_profile';
    if (ownerRead) fault.matched += 1;
    void panel
      .send(
        ownerRead ? 'Fetch.failRequest' : 'Fetch.continueRequest',
        ownerRead ? { requestId, errorReason: 'Failed' } : { requestId },
      )
      .then(() => {
        if (ownerRead) fault.refused += 1;
      })
      .catch(() => {
        fault.failures += 1;
      });
  });
  await network.start();
  await panel.send('Fetch.enable', {
    patterns: [{ urlPattern: '*://*/rest/v1/user_form_profile*', requestStage: 'Request' }],
  });
  let blocked;
  try {
    await click(panel, 'title', email);
    await click(panel, 'button-text', 'Profile');
    blocked = await waitFor(
      'profile_owner_read_denied',
      () => state(panel),
      (s) => s.back && Boolean(s.error) && s.headerSaveDisabled === true,
      30000,
    );
    assert.ok(fault.refused > 0, 'owner_read_network_refusal_not_observed');
    assert.equal(fault.failures, 0, 'owner_read_fault_failed');
    assert.equal(blocked.preferred, null, 'denied_read_showed_preferred_editor');
    assert.equal(blocked.editorCount, 0, 'denied_read_showed_editors');
    assert.equal(blocked.saveEnabled, false, 'denied_read_enabled_save');
    assert.equal(blocked.dirty, false, 'denied_read_showed_dirty_footer');
  } finally {
    await panel.send('Fetch.disable');
    offPaused();
  }
  await click(panel, 'button-text', 'Retry loading profile');
  const recovered = await waitFor(
    'profile_retry_restored_owner_read',
    () => state(panel),
    (s) => s.preferred === original && !s.error && !s.dirty,
    30000,
  );
  const requests = await waitFor(
    'profile_retry_network_read_finished',
    () => network.snapshot(),
    (events) =>
      events.some(
        (request) =>
          request.route === 'profile_row' && request.method === 'GET' && request.status === 200,
      ),
    10000,
  );
  network.stop();
  assert.ok(
    requests.some(
      (request) =>
        request.route === 'profile_row' && request.method === 'GET' && request.status === 200,
    ),
    'profile_retry_successful_owner_read_not_observed',
  );
  report.cases.push({
    id,
    mode,
    dimension,
    branch: 'denied-owner-read-retry',
    status: 'passed',
    started_at: startedAt,
    observed: {
      network_owner_reads_refused: fault.refused,
      editors_during_denial: blocked.editorCount,
      header_save_disabled: blocked.headerSaveDisabled,
      footer_save_enabled: blocked.saveEnabled,
      dirty_footer_during_denial: blocked.dirty,
      retry_restored_original: recovered.preferred === original,
      owner_read_http_200_after_retry: true,
    },
  });
}

try {
  assert.ok(RUN_ID && /^[a-zA-Z0-9_-]+$/.test(RUN_ID), 'run_id_required');
  assert.ok(['admin', 'member'].includes(AUTH_MODE), 'profile_auth_mode_invalid');
  assert.ok(OUTPUT_DIR?.startsWith('/'), 'output_dir_required');
  assert.ok(RECEIPT?.startsWith('/'), 'receipt_required');
  assert.match(SOURCE_SHA ?? '', /^[a-f0-9]{40}$/, 'expected_source_sha_required');
  assert.ok(Number.isSafeInteger(CI_RUN_ID) && CI_RUN_ID > 0, 'expected_ci_run_id_required');
  assert.ok(Number.isSafeInteger(ARTIFACT_ID) && ARTIFACT_ID > 0, 'expected_artifact_id_required');
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  requireLocalDevReceipt(receipt, receipt.extensionDir);
  const imported = await verifyImportedNativeEvidence(receipt.extensionDir, RECEIPT);
  assert.equal(imported.sourceSha, SOURCE_SHA, 'source_sha_mismatch');
  assert.equal(imported.runId, CI_RUN_ID, 'artifact_run_mismatch');
  assert.equal(imported.artifactId, ARTIFACT_ID, 'artifact_id_mismatch');
  report.artifact = {
    run_id: imported.runId,
    artifact_id: imported.artifactId,
    source_sha: imported.sourceSha,
    version: receipt.version,
    tree_sha256: receipt.treeSha256,
    extension_dir: receipt.extensionDir,
  };
  report.stage = 'browser';
  const native = await runNativeSidepanelQa({
    extensionDir: receipt.extensionDir,
    expectedRelease: receipt,
    localDevReceiptPath: RECEIPT,
    artifactRoot: OUTPUT_DIR,
    exercisePanel: async ({ page, panel, reloadExtension }) => {
      report.stage = 'authentication';
      let identity;
      let selectedOrg;
      if (AUTH_MODE === 'member') {
        const member = await signInSettings({
          mode: 'member',
          page,
          panel,
          repo: REPO,
          memberLinkFile: process.env.MATRX_REVIEWER_MAGIC_LINK_FILE,
          onStage: (stage) => {
            report.stage = `authentication:${stage}`;
          },
        });
        identity = { userId: member.profileId, email: member.email };
        selectedOrg = member.organization_selected;
        report.member_authentication = {
          first_party_identity_verified:
            member.web_signed_in &&
            member.extension_signed_in &&
            member.rendered_identity.profile_matches_first_party,
          canonical_nonadmin_check: member.canonical_nonadmin_check,
          rendered_identity: member.rendered_identity,
        };
      } else {
        const auth = { stage: 'begin', signin_observations: {} };
        identity = await signInAdminSettings({
          page,
          panel,
          report: auth,
          stage: (v) => {
            auth.stage = v;
          },
          readCredentials: credentials,
          captureIdentity: true,
        });
        selectedOrg = await selectApprovedOrganization(panel);
      }
      const stored = await panelIdentity(panel);
      assert.equal(stored.profileId, identity.userId, 'profile_identity_mismatch');
      assert.equal(stored.isAdmin, AUTH_MODE === 'admin', 'profile_role_unverified');
      assert.ok(stored.organizationId, 'device_organization_missing');
      report.identity = {
        role: AUTH_MODE,
        device_organization_present: Boolean(stored.organizationId),
        profile_matches_first_party: stored.profileId === identity.userId,
        organization_selection_verified: Boolean(selectedOrg),
      };
      report.stage = 'profile';
      await click(panel, 'title', 'Settings');
      const initialRead = observeProfileRequests(panel);
      await initialRead.start();
      await openProfile(panel, identity.email);
      let original = (await state(panel)).preferred ?? '';
      const initialRequests = await waitFor(
        'profile_initial_server_read_finished',
        () => initialRead.snapshot(),
        (events) =>
          events.some(
            (event) =>
              event.route === 'profile_row' &&
              event.method === 'GET' &&
              event.status === 200 &&
              event.row_present !== null,
          ),
        10000,
      );
      initialRead.stop();
      const initialRow = initialRequests.find(
        (event) =>
          event.route === 'profile_row' &&
          event.method === 'GET' &&
          event.status === 200 &&
          event.row_present !== null,
      );
      report.profile_row_existed_before = initialRow.row_present;
      report.original_preferred_present = Boolean(original);
      let owned = null;
      let ownedVersion = 0;
      let ownerConfig = null;
      let pendingMarker = null;
      let cleanupPanel = panel;
      let reloadedPanel = null;
      let executionError = null;
      try {
        if (!initialRow.row_present) {
          assert.equal(AUTH_MODE, 'member', 'first_save_requires_designated_member');
          ownerConfig = { ...(await profileApiConfig()), organizationId: stored.organizationId };
          assert.equal(
            await readProfileOwnerRow(panel, ownerConfig, identity.userId),
            null,
            'first_save_row_appeared_before_write',
          );
          const marker = `Profile first save ${randomUUID()}`;
          pendingMarker = marker;
          await fillPreferred(panel, marker);
          await clickProfileHeader(panel, 'Save');
          await waitFor(
            'first_profile_save_settled',
            () => state(panel),
            (s) => s.preferred === marker && !s.dirty && !s.error,
            30000,
          );
          const row = await readProfileOwnerRow(panel, ownerConfig, identity.userId);
          owned = assertFirstSaveOwnedRow(row, {
            userId: identity.userId,
            organizationId: stored.organizationId,
            marker,
          });
          ownedVersion = 1;
          original = marker;
          report.first_save = {
            case_id: 'EXT-F-1004-T28',
            branch: 'new-row-with-device-organization',
            status: 'provisional_until_original_absence_restored',
            row_created_by_ui: true,
            organization_matches_device: true,
            owner_matches_verified_member: true,
            original_absence_restoration_pending: true,
            scope: 'bounded branch only; not full T28 acceptance',
          };
        }
        await caseBack(panel, original, identity.email, AUTH_MODE, 'warm');
        await caseSaveDiscard(panel, original, identity.email, AUTH_MODE, 'warm');
        if (owned) {
          const row = await readProfileOwnerRow(panel, ownerConfig, identity.userId);
          ownedDeleteUrl(ownerConfig.url, owned, row, 3);
          ownedVersion = 3;
        }
        await caseT25(panel, original, identity.email, AUTH_MODE, 'warm');
        report.stage = 'extension_reload';
        const reloaded = await reloadExtension();
        reloadedPanel = reloaded.panel;
        cleanupPanel = reloaded.panel;
        report.extension_reload = {
          management_reload_clicked: reloaded.management_reload_clicked,
          old_targets_retired: reloaded.old_targets_retired,
          worker_replaced: reloaded.worker_replaced,
          panel_replaced: reloaded.panel_replaced,
        };
        const after = await panelIdentity(reloaded.panel);
        assert.equal(after.profileId, identity.userId, 'reload_profile_identity_changed');
        assert.equal(after.isAdmin, AUTH_MODE === 'admin', 'reload_profile_role_changed');
        assert.equal(after.organizationId, stored.organizationId, 'reload_organization_changed');
        await openProfile(reloaded.panel, identity.email);
        await caseBack(reloaded.panel, original, identity.email, AUTH_MODE, 'reload');
        await caseSaveDiscard(reloaded.panel, original, identity.email, AUTH_MODE, 'reload');
        if (owned) {
          const row = await readProfileOwnerRow(reloaded.panel, ownerConfig, identity.userId);
          ownedDeleteUrl(ownerConfig.url, owned, row, 5);
          ownedVersion = 5;
        }
        await caseT25(reloaded.panel, original, identity.email, AUTH_MODE, 'reload');
      } catch (error) {
        executionError = error;
      }
      let cleanupError = null;
      try {
        if (!owned && pendingMarker) {
          const row = await readProfileOwnerRow(cleanupPanel, ownerConfig, identity.userId);
          if (row) {
            owned = assertFirstSaveOwnedRow(row, {
              userId: identity.userId,
              organizationId: stored.organizationId,
              marker: pendingMarker,
            });
            ownedVersion = 1;
          } else {
            report.restoration = { verified: true, original_absence_restored: true };
          }
        }
        if (owned) {
          report.stage = 'restore_original_absence';
          await deleteOwnedProfileRow(cleanupPanel, ownerConfig, owned, ownedVersion);
          report.restoration = { verified: true, original_absence_restored: true };
          if (report.first_save) {
            report.first_save.original_absence_restoration_pending = false;
            report.first_save.status = 'bounded_pass';
          }
        } else if (!pendingMarker) {
          report.restoration = { verified: true, original_row_preserved: true };
        }
      } catch (error) {
        report.restoration = {
          verified: false,
          original_absence_restored: false,
          owned_row_may_remain: Boolean(owned || pendingMarker),
          failure_code: String(error?.message ?? 'unknown')
            .split(':', 1)[0]
            .slice(0, 100),
        };
        if (report.first_save) report.first_save.status = 'cleanup_unverified';
        cleanupError = error;
      } finally {
        if (reloadedPanel) await reloadedPanel.detach();
      }
      if (cleanupError) throw cleanupError;
      if (executionError) throw executionError;
    },
  });
  report.native = {
    extension_id: native.extensionId,
    panel_target_id: native.panelTargetId,
    artifacts: native.artifacts,
    verified: native.verified,
  };
  report.status = 'passed';
  report.stage = 'complete';
} catch (error) {
  const code = String(error?.message ?? 'unknown')
    .split(':', 1)[0]
    .slice(0, 100);
  report.status = code === 'profile_original_row_absent_mutation_refused' ? 'unverified' : 'failed';
  report.failure_code = code;
} finally {
  report.finished_at = new Date().toISOString();
  await mkdir(OUTPUT_DIR ?? join(REPO, 'test-results'), { recursive: true, mode: 0o700 });
  const output = join(
    OUTPUT_DIR ?? join(REPO, 'test-results'),
    `profile-native-${RUN_ID ?? randomUUID()}.json`,
  );
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`PROFILE_NATIVE_REPORT ${output} ${report.status}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}
