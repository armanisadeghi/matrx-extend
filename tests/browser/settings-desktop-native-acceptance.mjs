#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { verifyDesktopArtifactIdentity } from './desktop-artifact-identity.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { desktopStorageFaultSource } from './settings-desktop-storage-faults.mjs';
import {
  panelIdentity,
  settingsShellReady,
  signInSettings,
  verifyCurrentSettingsIdentity,
} from './settings-native-auth-driver.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

// D84/D86: the actual Settings handlers and Chrome storage in a disposable
// native side panel. A storage wrapper creates one controlled failure/delay.
const REPO = resolve(import.meta.dirname, '..', '..');
const EXTENSION_DIR = process.env.MATRX_DESKTOP_SETTINGS_EXTENSION_DIR;
const RECEIPT_PATH = process.env.MATRX_DESKTOP_SETTINGS_RECEIPT;
const MODE = process.env.MATRX_DESKTOP_SETTINGS_AUTH_MODE ?? 'guest';
const CASE = process.env.MATRX_DESKTOP_SETTINGS_CASE ?? 'full';
const OUTPUT = join(REPO, 'test-results', `settings-desktop-native-${randomUUID()}.json`);
const STORAGE_SALT = randomUUID();
const PORT_KEY = 'matrxLocalEnginePortOverride';
const PAIR_KEY = 'matrx.desktop.pairToken';
// These synthetic values belong only to the disposable test profile. Their
// bytes are never included in reports, errors, screenshots, or console output.
const PAIR_A = 'fixture-pair-cedar-63';
const PAIR_B = 'fixture-pair-maple-64';
const PAIR_C = 'fixture-pair-willow-65';
const RESET_DRAFT = 'Review Harbor Dental new-patient intake';
const report = {
  schema_version: 1,
  defects: ['EXT-D-0084', 'EXT-D-0086'],
  scope: 'native side-panel storage behavior in an owned disposable profile',
  case: CASE,
  role: MODE,
  status: 'unverified',
  build: null,
  authentication: null,
  cases: [],
  limits: [
    'Storage fault injection does not establish a healthy desktop-engine connection.',
    'Pair-code clear requires an HTTP transport and is not inferred from a stored synthetic code.',
  ],
};
let stage = 'receipt';
let expectedIdentity = null;

function safeCode(error) {
  const message = String(error?.message ?? '');
  for (const code of [
    'desktop_reset_local_overlap',
    'desktop_reset_session_overlap',
    'desktop_reset_session_fixture_survived',
    'desktop_refused_reset_removed_local_key',
    'desktop_refused_reset_removed_session_key',
    'desktop_refused_reset_changed_local_value',
    'desktop_refused_reset_changed_session_value',
    'desktop_reset_guest_ui_missing',
    'desktop_reset_token_survived',
    'desktop_reset_profile_survived',
    'desktop_reset_admin_gate_survived',
  ])
    if (message.includes(code)) return code;
  if (/^(desktop_|native_sidepanel_)[a-z0-9_]+$/.test(message)) return message;
  if (error?.driverFailure?.code) return error.driverFailure.code;
  return error?.code === 'ERR_ASSERTION' ? 'desktop_assertion_failed' : 'desktop_acceptance_failed';
}

async function state(panel) {
  return evaluate(
    panel,
    `(async () => {
    const pane = (() => {
      const tab = document.querySelector('button[role="tab"][title="Settings"][data-state="active"]');
      return tab ? document.getElementById(tab.getAttribute('aria-controls')) : null;
    })();
    const port = pane?.querySelector('input[placeholder="auto"]');
    const pair = pane?.querySelector('input[placeholder="Pair code"]');
    const row = port?.parentElement;
    // A read-only observer must never consume the held initial get([portKey]).
    const local = await chrome.storage.local.get(null);
    const dialog = [...document.querySelectorAll('[role="alertdialog"]')]
      .find((item) => item.textContent.includes('Clear local data?'));
    const pairDialog = [...document.querySelectorAll('[role="alertdialog"], [role="dialog"]')]
      .find((item) => item.textContent.includes('Forget the desktop pair code?'));
    const text = document.body?.textContent ?? '';
    return {
      settingsAvailable: !!document.querySelector('button[title="Settings"]'),
      settingsActive: !!pane,
      guest: text.includes('Sign in to choose') || text.includes("You're using Matrx as a guest."),
      portInput: port?.value ?? null,
      portSaved: Number.isInteger(local[${JSON.stringify(PORT_KEY)}]) ? local[${JSON.stringify(PORT_KEY)}] : null,
      portButton: [...(row?.querySelectorAll('button') ?? [])]
        .find((item) => ['Set', 'Save'].includes(item.textContent.trim()))?.textContent.trim() ?? null,
      portError: text.includes('Could not save port. Try again.'),
      portRangeError: text.includes('Port must be 1–65535.'),
      pairAvailable: !!pair,
      pairInputPresent: !!pair?.value,
      pairStored: typeof local[${JSON.stringify(PAIR_KEY)}] === 'string' && !!local[${JSON.stringify(PAIR_KEY)}],
      pairIsA: local[${JSON.stringify(PAIR_KEY)}] === ${JSON.stringify(PAIR_A)},
      pairIsB: local[${JSON.stringify(PAIR_KEY)}] === ${JSON.stringify(PAIR_B)},
      pairIsC: local[${JSON.stringify(PAIR_KEY)}] === ${JSON.stringify(PAIR_C)},
      pairSaveError: text.includes('Could not save pair code. Try again.'),
      pairForgetError: text.includes('Could not forget pair code. Try again.'),
      forgetVisible: [...(pane?.querySelectorAll('button') ?? [])].some((item) => item.textContent.trim() === 'Forget pair code'),
      pairDialog: !!pairDialog,
      resetDialog: !!dialog,
      resetError: !!dialog?.textContent.includes('Could not finish reset. Try again.'),
      signInVisible: [...(pane?.querySelectorAll('button') ?? [])].some((item) => item.textContent.trim() === 'Sign in'),
    };
  })()`,
  );
}

async function storageCensus(panel, baseline = null) {
  return evaluate(
    panel,
    `(async () => {
    const salt = ${JSON.stringify(STORAGE_SALT)};
    const baseline = ${JSON.stringify(baseline)};
    const local = await chrome.storage.local.get(null);
    const session = await chrome.storage.session.get(null);
    const digest = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(salt + JSON.stringify(value)))),
      (byte) => byte.toString(16).padStart(2, '0')).join('');
    const category = (area, key) => {
      if (area === 'session' && key === 'matrx.crossComponent.instanceId') return 'instance';
      if (area === 'session' && key === 'matrx.qa.desktopSettings.session') return 'fixture';
      if (area === 'local' && ['matrx.guest.signature', 'matrx.guest.nonce', 'matrx.guest.createdAt'].includes(key)) return 'guest';
      if (area === 'local' && ['matrxLocalEnginePort', 'matrxLocalEngineLastGoodPort'].includes(key)) return 'discovery';
      if (area === 'local' && key === 'matrx.chat.v1') return 'chat';
      if (area === 'local' && key === 'matrx.user.isAdmin') return 'guest_admin_gate';
      return 'other';
    };
    const freshChatDefault = (raw) => {
      if (typeof raw !== 'string') return false;
      try {
        const parsed = JSON.parse(raw), state = parsed?.state;
        return parsed.version === 1 && state && Object.keys(state).sort().join(',') ===
          'boundComputeTarget,chatActorId,draft,permissionMode,selectedAgentId,variableValues' &&
          state.chatActorId === 'guest' && state.selectedAgentId === null &&
          state.draft === '' && state.boundComputeTarget === null &&
          state.variableValues && Object.keys(state.variableValues).length === 0 &&
          state.permissionMode && Object.keys(state.permissionMode).length === 0;
      } catch { return false; }
    };
    const entries = async (area, values) => Promise.all(Object.entries(values).map(async ([key, value]) => ({
      key: await digest([area, key]), value: await digest([area, key, value]),
      label: key,
      category: category(area, key), freshDefault: key === 'matrx.chat.v1' && freshChatDefault(value),
      guestAdminGate: key === 'matrx.user.isAdmin' && value === false,
    })));
    const current = { local: await entries('local', local), session: await entries('session', session) };
    if (!baseline) return { baseline: current,
      counts: { local: current.local.length, session: current.session.length },
      sessionFixturePresent: Object.hasOwn(session, 'matrx.qa.desktopSettings.session') };
    const compare = (area) => {
      const result = { before: baseline[area].length, missing: 0, identical: 0,
        allowedFresh: 0, unexplained: 0, unexplainedKeys: [] };
      for (const prior of baseline[area]) {
        const now = current[area].find((item) => item.key === prior.key);
        if (!now) { result.missing++; continue; }
        if (now.value === prior.value) {
          result.identical++;
          if (!((prior.category === 'chat' && now.freshDefault && !prior.freshDefault) ||
            (prior.category === 'guest_admin_gate' && now.guestAdminGate))) {
            result.unexplained++;
            result.unexplainedKeys.push(prior.label);
          }
        } else if (['guest', 'instance', 'discovery'].includes(prior.category) ||
          (prior.category === 'chat' && now.freshDefault) ||
          (prior.category === 'guest_admin_gate' && now.guestAdminGate)) result.allowedFresh++;
        else {
          result.unexplained++;
          result.unexplainedKeys.push(prior.label);
        }
      }
      return result;
    };
    return { local: compare('local'), session: compare('session'),
      sessionFixturePresent: Object.hasOwn(session, 'matrx.qa.desktopSettings.session') };
  })()`,
  );
}

async function fault(panel, operation, key, mode) {
  assert.equal(
    await evaluate(panel, desktopStorageFaultSource({ operation, key, mode })),
    true,
    'desktop_injection_not_installed',
  );
}
async function faultState(panel) {
  return evaluate(panel, 'window.__desktopSettingsFault?.state() ?? null');
}
async function restoreFault(panel) {
  await evaluate(
    panel,
    '(() => { window.__desktopSettingsFault?.release(); window.__desktopSettingsFault?.restore(); return true; })()',
  );
}

async function replaceInput(panel, kind, value, expectedValue = value) {
  if (kind === 'port') await click(panel, 'port', 'Local engine port');
  else {
    // Locate and focus the real visible pair field with a trusted mouse click.
    const point = await evaluate(
      panel,
      `(() => {
      const input = document.querySelector('input[placeholder="Pair code"]');
      if (!input) return null;
      input.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = input.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      return document.elementFromPoint(x, y) === input ? { x, y } : null;
    })()`,
    );
    assert.ok(point, 'desktop_pair_input_unavailable');
    await panel.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await panel.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      clickCount: 1,
    });
  }
  const modifiers = process.platform === 'darwin' ? 4 : 2;
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    modifiers,
    windowsVirtualKeyCode: 65,
    commands: ['selectAll'],
  });
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    modifiers,
    windowsVirtualKeyCode: 65,
  });
  await panel.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Backspace',
    code: 'Backspace',
    windowsVirtualKeyCode: 8,
  });
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Backspace',
    code: 'Backspace',
    windowsVirtualKeyCode: 8,
  });
  if (value) await panel.send('Input.insertText', { text: value });
  await waitFor(
    'desktop_input_changed',
    () => state(panel),
    (s) =>
      kind === 'port'
        ? s?.portInput === expectedValue
        : s?.pairInputPresent === Boolean(expectedValue),
  );
}

async function savePort(panel, value) {
  await replaceInput(panel, 'port', String(value));
  await click(panel, 'button', (await state(panel)).portButton);
}

async function setOwnedHttpTransport(attachWorker) {
  const worker = await attachWorker();
  try {
    // This changes only the owned profile's rendered availability state. It is
    // deliberately not an engine simulator or evidence of a connection.
    const sent = await evaluate(
      worker,
      `chrome.runtime.sendMessage({ __matrx: true, kind: 'desktop:availability',
        payload: { transport: 'http', health: null, lastChecked: Date.now() } })`,
    );
    assert.deepEqual(sent, { ack: true }, 'desktop_http_fixture_not_delivered');
  } finally {
    await worker.detach();
  }
}

async function confirmPairForget(panel) {
  const point = await evaluate(
    panel,
    `(() => {
    const dialog = [...document.querySelectorAll('[role="alertdialog"], [role="dialog"]')]
      .find((item) => item.textContent.includes('Forget the desktop pair code?'));
    const button = [...(dialog?.querySelectorAll('button') ?? [])]
      .find((item) => item.textContent.trim() === 'Forget pair code');
    if (!button || button.disabled) return null;
    button.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = button.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return hit === button || button.contains(hit) ? { x, y } : null;
  })()`,
  );
  assert.ok(point, 'desktop_pair_confirmation_not_hit_tested');
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...point,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...point,
    button: 'left',
    clickCount: 1,
  });
}

async function seedUnsentChatDraft(panel) {
  await click(panel, 'title', 'Chat');
  const point = await evaluate(
    panel,
    `(() => {
    const tab = document.querySelector('button[role="tab"][title="Chat"][data-state="active"]');
    const pane = tab ? document.getElementById(tab.getAttribute('aria-controls')) : null;
    const input = pane?.querySelector('textarea');
    if (!input) return null;
    input.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = input.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return document.elementFromPoint(x, y) === input ? { x, y } : null;
  })()`,
  );
  assert.ok(point, 'desktop_chat_draft_input_unavailable');
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...point,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...point,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.insertText', { text: RESET_DRAFT });
  await waitFor(
    'desktop_chat_draft_persisted',
    () =>
      evaluate(
        panel,
        `(async () => {
    const tab = document.querySelector('button[role="tab"][title="Chat"][data-state="active"]');
    const pane = tab ? document.getElementById(tab.getAttribute('aria-controls')) : null;
    const input = pane?.querySelector('textarea');
    const raw = (await chrome.storage.local.get('matrx.chat.v1'))['matrx.chat.v1'];
    let persisted = false;
    try { persisted = JSON.parse(raw)?.state?.draft === ${JSON.stringify(RESET_DRAFT)}; } catch {}
    return input?.value === ${JSON.stringify(RESET_DRAFT)} && persisted;
  })()`,
      ),
    (value) => value === true,
  );
  await openSettings(panel);
}

async function openSettings(panel) {
  await waitFor(
    'desktop_settings_shell',
    () => state(panel),
    (s) => settingsShellReady(s, MODE),
    30000,
  );
  await click(panel, 'title', 'Settings');
  await waitFor(
    'desktop_settings_open',
    () => state(panel),
    (s) => s?.settingsActive && s.guest === (MODE === 'guest'),
  );
  await openSection(panel, 'Desktop bridge');
}

async function assertIdentity(panel) {
  if (MODE === 'guest') {
    const identity = await panelIdentity(panel);
    assert.equal(identity.accessTokenPresent, false, 'desktop_guest_identity_failed');
    report.authentication = {
      mode: 'guest',
      access_token_absent: true,
      profile_absent: identity.profileId === null,
      admin_flag_absent: identity.isAdmin !== true,
    };
  } else {
    await verifyCurrentSettingsIdentity({ panel, mode: MODE, ...expectedIdentity });
  }
}

async function reload(panel, signedOut = false) {
  await panel.send('Page.reload', { ignoreCache: true });
  if (signedOut) {
    await waitFor(
      'desktop_signed_out_shell',
      () => state(panel),
      (s) => s?.settingsAvailable && s.guest,
    );
    await click(panel, 'title', 'Settings');
    await openSection(panel, 'Desktop bridge');
    assert.equal((await panelIdentity(panel)).accessTokenPresent, false);
  } else {
    await openSettings(panel);
    await assertIdentity(panel);
  }
}

function passed(name, observation) {
  report.cases.push({ name, status: 'pass', observation });
}

try {
  assert.ok(['guest', 'member', 'admin'].includes(MODE), 'desktop_auth_mode_invalid');
  assert.ok(['full', 'reset-census', 'remaining'].includes(CASE), 'desktop_case_invalid');
  if (CASE === 'reset-census') assert.equal(MODE, 'guest', 'desktop_reset_diagnostic_guest_only');
  assert.ok(EXTENSION_DIR && RECEIPT_PATH, 'desktop_artifact_inputs_required');
  const extensionDir = resolve(EXTENSION_DIR);
  const receiptPath = resolve(RECEIPT_PATH);
  const { receipt, build } = await verifyDesktopArtifactIdentity({
    repo: REPO,
    extensionDir,
    receiptPath,
    sourceSha: process.env.MATRX_DESKTOP_SETTINGS_SOURCE_SHA,
    runId: process.env.MATRX_DESKTOP_SETTINGS_RUN_ID,
    artifactId: process.env.MATRX_DESKTOP_SETTINGS_ARTIFACT_ID,
  });
  report.build = build;

  stage = 'native_panel';
  const run = await runNativeSidepanelQa({
    headed: true,
    extensionDir,
    expectedRelease: receipt,
    releaseReceiptPath: receiptPath,
    localDevReceiptPath: receiptPath,
    onStage: (value) => {
      stage = `native_panel:${value}`;
    },
    exercisePanel: async ({ page, panel, activatePanel, attachWorker }) => {
      if (MODE !== 'guest') {
        stage = 'authentication';
        const auth = await signInSettings({
          mode: MODE,
          page,
          panel,
          repo: REPO,
          adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
          memberLinkFile: process.env.MATRX_REVIEWER_MAGIC_LINK_FILE,
          onStage: (value) => {
            stage = `authentication:${value}`;
          },
        });
        expectedIdentity = {
          email: auth.email,
          profileId: auth.profileId,
          organizationId: auth.organizationId,
        };
        report.authentication = {
          mode: MODE,
          account_fingerprint: auth.account_fingerprint,
          web_signed_in: auth.web_signed_in,
          extension_signed_in: auth.extension_signed_in,
          rendered_identity: auth.rendered_identity,
        };
        await activatePanel();
      }
      stage = 'desktop_port';
      await openSettings(panel);
      await assertIdentity(panel);
      if (CASE === 'remaining') {
        stage = 'desktop_port_bounds';
        await savePort(panel, 1);
        await waitFor(
          'desktop_port_minimum',
          () => state(panel),
          (s) => s?.portSaved === 1,
        );
        await savePort(panel, 65535);
        await waitFor(
          'desktop_port_maximum',
          () => state(panel),
          (s) => s?.portSaved === 65535,
        );
        stage = 'desktop_port_zero';
        await savePort(panel, 0);
        await waitFor(
          'desktop_port_zero_rejected',
          () => state(panel),
          (s) => s?.portSaved === 65535 && s.portInput === '0' && s.portRangeError,
        );
        stage = 'desktop_port_high';
        await savePort(panel, 65536);
        await waitFor(
          'desktop_port_high_rejected',
          () => state(panel),
          (s) => s?.portSaved === 65535 && s.portInput === '65536' && s.portRangeError,
        );
        stage = 'desktop_port_nondigit';
        await replaceInput(panel, 'port', '12x3', '123');
        await waitFor(
          'desktop_port_nondigit_filtered',
          () => state(panel),
          (s) => s?.portInput === '123' && s.portSaved === 65535,
        );
        stage = 'desktop_port_blank';
        await savePort(panel, '');
        await waitFor(
          'desktop_port_blank_cleared',
          () => state(panel),
          (s) => s?.portSaved === null && s.portInput === '' && !s.portRangeError,
        );
        await reload(panel);
        assert.equal((await state(panel)).portSaved, null, 'desktop_blank_port_reappeared');
        passed('port bounds, filtered input, and blank clear persist across reload', {
          lower_bound: 1,
          upper_bound: 65535,
          invalid_values_rejected: true,
          nondigit_filtered: true,
          blank_cleared: true,
        });

        stage = 'desktop_http_fixture';
        await replaceInput(panel, 'pair', PAIR_A);
        await click(panel, 'button', 'Pair');
        await waitFor(
          'desktop_owned_pair_saved',
          () => state(panel),
          (s) => s?.pairIsA,
        );
        await setOwnedHttpTransport(attachWorker);
        await waitFor(
          'desktop_http_forget_visible',
          () => state(panel),
          (s) => s?.forgetVisible,
        );
        await click(panel, 'settings-button', 'Forget pair code');
        await waitFor(
          'desktop_forget_cancel_dialog',
          () => state(panel),
          (s) => s?.pairDialog,
        );
        await click(panel, 'button', 'Cancel');
        await waitFor(
          'desktop_forget_cancel_closed',
          () => state(panel),
          (s) => !s?.pairDialog && s.pairIsA,
        );
        passed('HTTP fixture Forget cancel retains owned pair code', { pairing_preserved: true });
        await fault(panel, 'remove', PAIR_KEY, 'reject');
        try {
          await click(panel, 'settings-button', 'Forget pair code');
          await waitFor(
            'desktop_forget_refusal_dialog',
            () => state(panel),
            (s) => s?.pairDialog,
          );
          await confirmPairForget(panel);
          await waitFor(
            'desktop_forget_refusal',
            () => state(panel),
            (s) => s?.pairForgetError && s.pairIsA,
          );
          assert.equal((await faultState(panel)).calls, 1);
          passed('HTTP fixture Forget refusal preserves owned pair code', {
            pairing_preserved: true,
            error_visible: true,
          });
        } finally {
          await restoreFault(panel);
        }
        await waitFor(
          'desktop_forget_refusal_dialog_closed',
          () => state(panel),
          (s) => !s?.pairDialog && s.forgetVisible,
        );
        await click(panel, 'settings-button', 'Forget pair code');
        await waitFor(
          'desktop_forget_retry_dialog',
          () => state(panel),
          (s) => s?.pairDialog,
        );
        await confirmPairForget(panel);
        await waitFor(
          'desktop_forget_retry',
          () => state(panel),
          (s) => s?.pairStored === false && !s.pairForgetError,
        );
        passed('HTTP fixture Forget retry removes owned browser pairing', {
          pairing_removed: true,
          engine_connection_unverified: true,
        });
        await savePort(panel, 65005);
        await waitFor(
          'desktop_reset_port_seed',
          () => state(panel),
          (s) => s?.portSaved === 65005,
        );
      } else if (CASE === 'full') {
        await savePort(panel, 65001);
        await waitFor(
          'desktop_port_baseline',
          () => state(panel),
          (s) => s?.portSaved === 65001,
        );
        passed('baseline port saved through trusted UI', { persisted: true });

        await fault(panel, 'set', PORT_KEY, 'reject');
        try {
          await savePort(panel, 65002);
          await waitFor(
            'desktop_port_refusal',
            () => state(panel),
            (s) => s?.portSaved === 65001 && s.portInput === '65002' && s.portError,
          );
          assert.equal((await faultState(panel)).calls, 1);
          passed('port refusal preserves prior value and offers retry', {
            prior_saved: true,
            error_visible: true,
          });
        } finally {
          await restoreFault(panel);
        }
        await click(panel, 'button', 'Save');
        await waitFor(
          'desktop_port_retry',
          () => state(panel),
          (s) => s?.portSaved === 65002 && !s.portError,
        );
        await reload(panel);
        assert.equal((await state(panel)).portInput, '65002');
        passed('port retry survives panel reload', { persisted: true });

        await fault(panel, 'set', PORT_KEY, 'hold');
        try {
          await savePort(panel, 65003);
          await waitFor(
            'desktop_first_port_held',
            () => faultState(panel),
            (s) => s?.held && s.calls === 1,
          );
          await savePort(panel, 65004);
          assert.equal(
            (await faultState(panel)).calls,
            1,
            'desktop_later_port_write_started_early',
          );
          assert.equal((await state(panel)).portSaved, 65002);
          await evaluate(panel, 'window.__desktopSettingsFault.release()');
          await waitFor(
            'desktop_later_port_persisted',
            () => state(panel),
            (s) => s?.portSaved === 65004,
          );
          assert.equal((await faultState(panel)).calls, 2);
        } finally {
          await restoreFault(panel);
        }
        await reload(panel);
        assert.equal((await state(panel)).portInput, '65004');
        passed('overlapping port submissions persist latest after reload', {
          ordered: true,
          persisted: true,
        });

        stage = 'desktop_initial_read';
        await click(panel, 'title', 'Chat');
        await fault(panel, 'get', PORT_KEY, 'hold');
        try {
          await click(panel, 'title', 'Settings');
          await waitFor(
            'desktop_initial_read_held',
            () => faultState(panel),
            (s) => s?.calls === 1 && s.held,
          );
          await openSection(panel, 'Desktop bridge');
          await savePort(panel, 65005);
          const beforeRead = await state(panel);
          assert.equal(beforeRead.portInput, '65005');
          assert.equal(beforeRead.portSaved, 65004, 'desktop_write_ran_before_initial_read');
          await evaluate(panel, 'window.__desktopSettingsFault.release()');
          await waitFor(
            'desktop_initial_read_write_finished',
            () => state(panel),
            (s) => s?.portSaved === 65005 && s.portInput === '65005',
          );
        } finally {
          await restoreFault(panel);
        }
        await reload(panel);
        assert.equal((await state(panel)).portInput, '65005');
        passed('delayed initial read preserves edited port and precedes write', {
          edit_preserved: true,
          write_ordered: true,
          persisted: true,
        });

        stage = 'desktop_pair';
        const pairAvailable = (await state(panel)).pairAvailable;
        if (pairAvailable) {
          await fault(panel, 'set', PAIR_KEY, 'reject');
          try {
            await replaceInput(panel, 'pair', PAIR_A);
            await click(panel, 'button', 'Pair');
            await waitFor(
              'desktop_pair_refusal',
              () => state(panel),
              (s) => s?.pairSaveError && s.pairInputPresent && !s.pairStored,
            );
            assert.equal((await faultState(panel)).calls, 1);
            passed('pair refusal keeps input and visible retry', {
              error_visible: true,
              prior_value_preserved: true,
            });
          } finally {
            await restoreFault(panel);
          }
          await click(panel, 'button', 'Pair');
          await waitFor(
            'desktop_pair_retry',
            () => state(panel),
            (s) => s?.pairIsA && !s.pairSaveError && !s.pairInputPresent,
          );
          passed('pair retry persisted synthetic value', { persisted: true });

          await fault(panel, 'set', PAIR_KEY, 'hold');
          try {
            await replaceInput(panel, 'pair', PAIR_B);
            await click(panel, 'button', 'Pair');
            await waitFor(
              'desktop_first_pair_held',
              () => faultState(panel),
              (s) => s?.held && s.calls === 1,
            );
            await replaceInput(panel, 'pair', PAIR_C);
            await click(panel, 'button', 'Pair');
            assert.equal(
              (await faultState(panel)).calls,
              1,
              'desktop_later_pair_write_started_early',
            );
            assert.equal(
              (await state(panel)).pairInputPresent,
              true,
              'desktop_older_pair_cleared_newer_input',
            );
            await evaluate(panel, 'window.__desktopSettingsFault.release()');
            await waitFor(
              'desktop_later_pair_persisted',
              () => state(panel),
              (s) => s?.pairIsC && !s.pairInputPresent,
            );
            assert.equal((await faultState(panel)).calls, 2);
          } finally {
            await restoreFault(panel);
          }
          await reload(panel);
          assert.equal((await state(panel)).pairIsC, true);
          passed('overlapping pair submissions persist latest after reload', {
            ordered: true,
            persisted: true,
          });
        } else {
          report.cases.push({
            name: 'pair-code entry',
            status: 'not_applicable',
            reason: 'native transport hides pair-code input',
          });
        }
        if ((await state(panel)).forgetVisible) {
          await fault(panel, 'remove', PAIR_KEY, 'reject');
          try {
            await click(panel, 'settings-button', 'Forget pair code');
            await waitFor(
              'desktop_pair_forget_dialog',
              () => state(panel),
              (s) => s?.pairDialog,
            );
            await confirmPairForget(panel);
            await waitFor(
              'desktop_pair_forget_refusal',
              () => state(panel),
              (s) => s?.pairForgetError && s.pairStored,
            );
            assert.equal((await faultState(panel)).calls, 1);
            passed('pair removal refusal preserves pairing and shows retry', {
              prior_value_preserved: true,
              error_visible: true,
            });
          } finally {
            await restoreFault(panel);
          }
          await waitFor(
            'desktop_pair_forget_refusal_dialog_closed',
            () => state(panel),
            (s) => !s?.pairDialog && s.forgetVisible,
          );
          await click(panel, 'settings-button', 'Forget pair code');
          await waitFor(
            'desktop_pair_forget_retry_dialog',
            () => state(panel),
            (s) => s?.pairDialog,
          );
          await confirmPairForget(panel);
          await waitFor(
            'desktop_pair_forget_retry',
            () => state(panel),
            (s) => s?.pairStored === false && !s.pairForgetError,
          );
          passed('pair removal retry clears browser pairing', { pairing_cleared: true });
        } else {
          report.cases.push({
            name: 'pair-code removal refusal and retry',
            status: 'unverified',
            reason: 'HTTP transport and product confirmation are unavailable in this profile',
          });
        }
      } else {
        await savePort(panel, 65005);
        await waitFor(
          'desktop_diagnostic_port_seed',
          () => state(panel),
          (s) => s?.portSaved === 65005,
        );
      }

      stage = 'desktop_reset';
      await seedUnsentChatDraft(panel);
      await evaluate(
        panel,
        `chrome.storage.session.set({ 'matrx.qa.desktopSettings.session': 'owned-disposable-session' })`,
      );
      const beforeReset = await storageCensus(panel);
      assert.equal(beforeReset.sessionFixturePresent, true, 'desktop_session_fixture_missing');
      assert.equal(
        beforeReset.baseline.local.find((item) => item.category === 'chat')?.freshDefault,
        false,
        'desktop_nondefault_chat_fixture_missing',
      );
      assert.ok(
        beforeReset.counts.local > 0 && beforeReset.counts.session > 0,
        'desktop_reset_census_empty',
      );
      await openSection(panel, 'Data & reset');
      await click(panel, 'button', 'Clear local data on this device');
      await waitFor(
        'desktop_reset_dialog',
        () => state(panel),
        (s) => s?.resetDialog,
      );
      if (CASE === 'remaining') {
        await click(panel, 'dialog', 'Cancel');
        await waitFor(
          'desktop_reset_cancel_closed',
          () => state(panel),
          (s) => !s?.resetDialog && s.portSaved === 65005,
        );
        const cancelledCensus = await storageCensus(panel, beforeReset.baseline);
        assert.equal(cancelledCensus.local.missing, 0, 'desktop_cancel_removed_local_key');
        assert.equal(cancelledCensus.session.missing, 0, 'desktop_cancel_removed_session_key');
        assert.equal(
          cancelledCensus.local.identical,
          cancelledCensus.local.before,
          'desktop_cancel_changed_local_value',
        );
        assert.equal(
          cancelledCensus.session.identical,
          cancelledCensus.session.before,
          'desktop_cancel_changed_session_value',
        );
        passed('reset Cancel preserves complete local and session census', {
          local_count: cancelledCensus.local.before,
          session_count: cancelledCensus.session.before,
        });
        await click(panel, 'button', 'Clear local data on this device');
        await waitFor(
          'desktop_reset_reopened',
          () => state(panel),
          (s) => s?.resetDialog,
        );
      }
      await fault(panel, 'clear', null, 'reject');
      try {
        await click(panel, 'dialog', 'Clear & sign out');
        await waitFor(
          'desktop_reset_refusal',
          () => state(panel),
          (s) => s?.resetDialog && s.resetError && s.portSaved === 65005,
        );
        const rejectedCensus = await storageCensus(panel, beforeReset.baseline);
        assert.equal(rejectedCensus.local.missing, 0, 'desktop_refused_reset_removed_local_key');
        assert.equal(
          rejectedCensus.session.missing,
          0,
          'desktop_refused_reset_removed_session_key',
        );
        assert.equal(
          rejectedCensus.local.identical,
          rejectedCensus.local.before,
          'desktop_refused_reset_changed_local_value',
        );
        assert.equal(
          rejectedCensus.session.identical,
          rejectedCensus.session.before,
          'desktop_refused_reset_changed_session_value',
        );
        assert.equal((await faultState(panel)).calls, 1);
        passed('reset refusal keeps confirmation and saved value', {
          error_visible: true,
          retry_available: true,
          prior_local_count: rejectedCensus.local.before,
          prior_session_count: rejectedCensus.session.before,
          prior_values_preserved: true,
        });
      } finally {
        await restoreFault(panel);
      }
      await click(panel, 'dialog', 'Clear & sign out');
      await waitFor(
        'desktop_reset_retry',
        () => state(panel),
        (s) => s?.portSaved === null && !s.resetDialog && s.signInVisible,
        30000,
      );
      await reload(panel, true);
      const signedOutState = await state(panel);
      assert.equal(signedOutState.portSaved, null);
      assert.equal(
        signedOutState.guest && signedOutState.signInVisible,
        true,
        'desktop_reset_guest_ui_missing',
      );
      const signedOutIdentity = await panelIdentity(panel);
      assert.equal(signedOutIdentity.accessTokenPresent, false, 'desktop_reset_token_survived');
      assert.equal(signedOutIdentity.profileId, null, 'desktop_reset_profile_survived');
      assert.equal(signedOutIdentity.isAdmin !== true, true, 'desktop_reset_admin_gate_survived');
      const clearedCensus = await storageCensus(panel, beforeReset.baseline);
      report.reset_census = {
        local: clearedCensus.local,
        session: clearedCensus.session,
        session_fixture_present: clearedCensus.sessionFixturePresent,
      };
      assert.equal(clearedCensus.local.unexplained, 0, 'desktop_reset_local_overlap');
      assert.equal(clearedCensus.session.unexplained, 0, 'desktop_reset_session_overlap');
      assert.equal(
        clearedCensus.sessionFixturePresent,
        false,
        'desktop_reset_session_fixture_survived',
      );
      passed('reset retry clears prior local/session values and signs out after reload', {
        signed_out: true,
        local: clearedCensus.local,
        session: clearedCensus.session,
        session_fixture_removed: true,
      });
    },
  });
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256, 'desktop_tree_mismatch');
  report.artifacts = run.artifacts;
  report.status = report.cases.some((item) => item.status === 'unverified') ? 'partial' : 'pass';
} catch (error) {
  report.status = 'fail';
  report.failure_stage = stage;
  report.failure_code = safeCode(error);
  process.exitCode = 1;
} finally {
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`${report.status.toUpperCase()} desktop Settings native acceptance: ${OUTPUT}`);
}
