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
import { panelIdentity } from './settings-native-auth-driver.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const RECEIPT = process.env.PROFILE_DEV_BUILD_RECEIPT;
const OUTPUT_DIR = process.env.PROFILE_OUTPUT_DIR;
const RUN_ID = process.env.PROFILE_RUN_ID;
const SOURCE_SHA = process.env.PROFILE_EXPECTED_SOURCE_SHA;
const CI_RUN_ID = Number(process.env.PROFILE_EXPECTED_CI_RUN_ID);
const ARTIFACT_ID = Number(process.env.PROFILE_EXPECTED_ARTIFACT_ID);
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
    return { profile:buttons.some(b=>b.textContent.trim()==='Profile'),
      back:buttons.some(b=>b.title==='Back'), chat:!!document.querySelector('button[role="tab"][title="Chat"][data-state="active"]'),
      preferred:input?.value ?? null, dirty:(document.body.innerText??'').includes('Unsaved changes'),
      discard:buttons.some(b=>b.textContent.trim()==='Discard'), saveEnabled:buttons.some(b=>b.textContent.trim()==='Save'&&!b.disabled),
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
    if (entry.status === null || entry.status < 400) return;
    void panel
      .send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) => {
        const raw = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
        const code = JSON.parse(raw)?.code;
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
      events.map(({ route, method, status, outcome, error_code }) => ({
        route,
        method,
        status,
        outcome,
        error_code,
      })),
    stop: () => {
      offRequest();
      offResponse();
      offFinished();
      offFailed();
    },
  };
}
async function openProfile(panel) {
  await click(panel, 'title', 'admin@admin.com');
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
async function caseT02(panel, original) {
  const id = 'EXT-F-1004-T02';
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
  await openProfile(panel);
  const reopened = await waitFor(
    'profile_cancel_restored',
    () => state(panel),
    (s) => s.preferred === original && !s.dirty,
    30000,
  );
  report.cases.push({
    id,
    mode: 'admin',
    dimension: 'warm',
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
async function caseT04(panel, original) {
  const id = 'EXT-F-1004-T04';
  const startedAt = new Date().toISOString();
  const diagnostic = { stages: [], requests: [] };
  report.t04_diagnostic = diagnostic;
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
    await openProfile(panel);
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
        await openProfile(panel);
        await waitFor(
          'profile_restore_reopen',
          () => state(panel),
          (s) => s.preferred === original && !s.dirty,
          30000,
        );
        await observe('cleanup_after_reopen', original);
      }
      report.restoration = { verified: true, at: new Date().toISOString() };
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
  report.cases.push({
    id,
    mode: 'admin',
    dimension: 'warm',
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
    mode: 'admin',
    dimension: 'warm',
    branch: 'save-draft',
    status: 'passed',
    started_at: startedAt,
    observed: { saved_after_reopen: true, original_restored_after_reopen: true },
  });
}

try {
  assert.ok(RUN_ID && /^[a-zA-Z0-9_-]+$/.test(RUN_ID), 'run_id_required');
  assert.ok(OUTPUT_DIR && OUTPUT_DIR.startsWith('/'), 'output_dir_required');
  assert.ok(RECEIPT && RECEIPT.startsWith('/'), 'receipt_required');
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
    exercisePanel: async ({ page, panel }) => {
      report.stage = 'authentication';
      const auth = { stage: 'begin', signin_observations: {} };
      const identity = await signInAdminSettings({
        page,
        panel,
        report: auth,
        stage: (v) => {
          auth.stage = v;
        },
        readCredentials: credentials,
        captureIdentity: true,
      });
      const selectedOrg = await selectApprovedOrganization(panel);
      const stored = await panelIdentity(panel);
      assert.equal(stored.profileId, identity.userId, 'profile_identity_mismatch');
      assert.equal(stored.isAdmin, true, 'admin_role_unverified');
      assert.ok(stored.organizationId, 'device_organization_missing');
      report.identity = {
        email: identity.email,
        role: 'admin',
        device_organization_present: Boolean(stored.organizationId),
        profile_matches_first_party: stored.profileId === identity.userId,
        device_organization_name: selectedOrg,
      };
      report.stage = 'profile';
      await click(panel, 'title', 'Settings');
      await openProfile(panel);
      const original = (await state(panel)).preferred ?? '';
      report.original_preferred_present = Boolean(original);
      await caseT02(panel, original);
      await caseT04(panel, original);
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
  report.status = 'failed';
  report.failure_code = String(error?.message ?? 'unknown')
    .split(':', 1)[0]
    .slice(0, 100);
} finally {
  report.finished_at = new Date().toISOString();
  await mkdir(OUTPUT_DIR ?? join(REPO, 'test-results'), { recursive: true, mode: 0o700 });
  const output = join(
    OUTPUT_DIR ?? join(REPO, 'test-results'),
    `profile-native-${RUN_ID ?? randomUUID()}.json`,
  );
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(`PROFILE_NATIVE_REPORT ${output} ${report.status}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}
