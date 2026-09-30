#!/usr/bin/env node
/** Native Notes D61/D62/D63 acceptance. Launch only under the shared resource guard. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const RECEIPT = process.env.NOTES_DEV_BUILD_RECEIPT;
const OUTPUT = join(REPO, 'test-results/notes-native-acceptance.json');
const ADMIN_ENV = join(homedir(), 'code/aidream/.env');
const DEV_ENV = join(REPO, '.env.development');
const PRIVATE_CONFIG = join(REPO, 'test-results/d22-private-config.json');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const EMAIL = 'admin@admin.com';
const noteTitle = `Harbor Dental — intake handoff ${randomUUID().slice(0, 8)}`;
const draftA = 'Confirm insurance eligibility before the patient arrives.';
const draftB = `${draftA}\nCall the patient if coverage needs an updated card.`;
let stage = 'receipt';
const report = {
  schema_version: 1,
  cases: ['EXT-D-0061', 'EXT-D-0062', 'EXT-D-0063'],
  status: 'unverified',
  build: null,
  observations: {},
  fault_scope: 'owned panel, workbench.notes GET/POST/PATCH transport only',
  data_scope: 'one newly created Harbor Dental intake handoff note; preserved for review',
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
async function approvedOrganizationName() {
  const stat = await lstat(PRIVATE_CONFIG).catch(() => fail('test_org_config_missing'));
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) fail('test_org_config_not_private');
  const config = JSON.parse(
    await readFile(PRIVATE_CONFIG, 'utf8').catch(() => fail('test_org_config_missing')),
  );
  if (
    typeof config.approved_organization_name !== 'string' ||
    !config.approved_organization_name.trim()
  )
    fail('test_org_name_missing');
  return config.approved_organization_name;
}
async function realAdminLogin(page, panel) {
  const web = await page.context().newPage();
  try {
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const location = new URL(web.url());
    if (location.origin !== WEB_ORIGIN || location.pathname !== '/login') fail('web_login_origin');
    const source = await readFile(ADMIN_ENV, 'utf8').catch(() =>
      fail('credential_file_unavailable'),
    );
    const values = {};
    for (const line of source.split(/\r?\n/)) {
      const match = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
      if (match)
        values[match[1]] = /^(['"]).*\1$/.test(match[2]) ? match[2].slice(1, -1) : match[2];
    }
    if (values.AI_ADMIN_USERNAME !== EMAIL || !values.AI_ADMIN_PASSWORD)
      fail('admin_credentials_unavailable');
    await web.locator('input[name="email"]').fill(EMAIL);
    await web.locator('input[name="password"]').fill(values.AI_ADMIN_PASSWORD);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname !== '/login', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    await web.waitForFunction(
      async (expected) => {
        const response = await fetch('/api/whoami', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) return false;
        const identity = await response.json();
        return identity?.signed_in === true && identity.email === expected;
      },
      EMAIL,
      { timeout: 90_000 },
    );
    await click(panel, 'title', 'Settings');
    await openSection(panel, 'Account');
    await click(panel, 'button', 'Sign in');
    await waitFor(
      'admin_account',
      () =>
        evaluate(
          panel,
          `(() => {
      const section = [...document.querySelectorAll('button[aria-expanded]')].find(b => b.textContent.trim() === 'Account');
      return section?.parentElement?.nextElementSibling?.textContent.includes(${JSON.stringify(EMAIL)}) &&
        [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Sign out');
    })()`,
        ),
      Boolean,
      90_000,
    );
    report.observations.real_admin_ui_signin = true;
  } finally {
    await web.close();
  }
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
      saved: text.includes('Saved'), saving: text.includes('Saving'),
      noteInList: [...(root?.querySelectorAll('li button') ?? [])].some(b => b.textContent.includes(${JSON.stringify(noteTitle)})),
    };
  })()`,
  );
}
function armNotesTransport(panel, origin) {
  let mode = 'observe';
  let failedGet = 0;
  let failedPost = 0;
  let heldPatch = 0;
  let passed = 0;
  let passedGet = 0;
  let interceptionFailed = false;
  let pendingPatch = null;
  const requests = new Map();
  const responses = [];
  const offResponse = panel.on('Network.responseReceived', (event) => {
    const method = requests.get(event.requestId);
    if (!method) return;
    responses.push({ method, status: event.response.status, stage });
    requests.delete(event.requestId);
  });
  const offRequest = panel.on('Network.requestWillBeSent', (event) => {
    const url = new URL(event.request.url);
    if (
      url.origin === origin &&
      url.pathname === '/rest/v1/notes' &&
      ['GET', 'POST', 'PATCH'].includes(event.request.method)
    )
      requests.set(event.requestId, event.request.method);
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
    const action =
      inScope && mode === 'fail_get' && request.method === 'GET'
        ? 'fail_get'
        : inScope && mode === 'fail_post' && request.method === 'POST'
          ? 'fail_post'
          : inScope && mode === 'hold_patch' && request.method === 'PATCH' && !pendingPatch
            ? 'hold_patch'
            : 'pass';
    if (action === 'hold_patch') {
      pendingPatch = event.requestId;
      heldPatch += 1;
      return;
    }
    void panel
      .send(
        action.startsWith('fail_') ? 'Fetch.failRequest' : 'Fetch.continueRequest',
        action.startsWith('fail_')
          ? { requestId: event.requestId, errorReason: 'Failed' }
          : { requestId: event.requestId },
      )
      .then(() => {
        if (action === 'fail_get') failedGet += 1;
        else if (action === 'fail_post') failedPost += 1;
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
    state: () => ({
      responses: [...responses],
      failedGet,
      failedPost,
      heldPatch,
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
    },
  };
}
async function fillPanelControl(panel, selector, value) {
  const target = await evaluate(
    panel,
    `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled) return null;
    el.scrollIntoView({block:'center'});
    const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + Math.min(r.height / 2, 20);
    return document.elementFromPoint(x,y) === el ? {x,y} : null;
  })()`,
  );
  if (!target) fail('editor_control_not_hittable');
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
  const origin = await supabaseOrigin();
  const organization = await approvedOrganizationName();
  const native = await runNativeSidepanelQa({
    extensionDir: before.extensionDir,
    expectedRelease: before,
    localDevReceiptPath: RECEIPT,
    exercisePanel: async ({ page, panel }) => {
      stage = 'real_signin';
      await realAdminLogin(page, panel);
      stage = 'organization';
      await selectTestOrganization(panel, organization);
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
        await clickOwnedNoteRow(panel);
        await waitFor(
          'latest_draft_reopened_from_server',
          () => notesState(panel),
          (s) => s.editor && s.title && s.draftB,
          45_000,
        );
        report.observations.D63.reopened_latest_draft = true;
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
