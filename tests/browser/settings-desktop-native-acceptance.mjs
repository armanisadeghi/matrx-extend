#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
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
const OUTPUT = join(REPO, 'test-results', `settings-desktop-native-${randomUUID()}.json`);
const SOURCE = '991385d9816b31a568619522e4795c001b4d3a06';
const RUN_ID = 37129518563;
const ARTIFACT_ID = 11275878549;
const PORT_KEY = 'matrxLocalEnginePortOverride';
const PAIR_KEY = 'matrx.desktop.pairToken';
// These synthetic values belong only to the disposable test profile. Their
// bytes are never included in reports, errors, screenshots, or console output.
const PAIR_A = 'fixture-pair-cedar-63';
const PAIR_B = 'fixture-pair-maple-64';
const PAIR_C = 'fixture-pair-willow-65';
const report = {
  schema_version: 1,
  defects: ['EXT-D-0084', 'EXT-D-0086'],
  scope: 'native side-panel storage behavior in an owned disposable profile',
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
    const local = await chrome.storage.local.get([${JSON.stringify(PORT_KEY)}, ${JSON.stringify(PAIR_KEY)}]);
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

async function replaceInput(panel, kind, value) {
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
    (s) => (kind === 'port' ? s?.portInput === value : s?.pairInputPresent === Boolean(value)),
  );
}

async function savePort(panel, value) {
  await replaceInput(panel, 'port', String(value));
  await click(panel, 'button', (await state(panel)).portButton);
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
  assert.ok(EXTENSION_DIR && RECEIPT_PATH, 'desktop_artifact_inputs_required');
  const extensionDir = resolve(EXTENSION_DIR);
  const receiptPath = resolve(RECEIPT_PATH);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const imported = extensionDir.match(/\/ci-artifacts\/([a-f0-9]{40})\/(\d+)-(\d+)\/chrome-mv3$/);
  const importedStatus = JSON.parse(
    await readFile(join(extensionDir, '..', 'import-status.json'), 'utf8'),
  );
  assert.equal(receipt.kind, 'local_dev_unpacked', 'desktop_receipt_kind_refused');
  assert.equal(receipt.sourceSha ?? imported?.[1], SOURCE, 'desktop_source_mismatch');
  assert.equal(imported?.[1], SOURCE, 'desktop_source_mismatch');
  assert.equal(importedStatus.sourceSha, SOURCE, 'desktop_source_mismatch');
  assert.equal(importedStatus.runId, RUN_ID, 'desktop_run_mismatch');
  assert.equal(importedStatus.artifactId, ARTIFACT_ID, 'desktop_artifact_mismatch');
  assert.equal(importedStatus.treeSha256, receipt.treeSha256, 'desktop_tree_mismatch');
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256, 'desktop_tree_mismatch');
  for (const sha of ['39ee192b', 'cf0877f1', '17b8ea9d'])
    execFileSync('git', ['merge-base', '--is-ancestor', sha, SOURCE], { cwd: REPO });
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, receipt.version, 'desktop_version_mismatch');
  report.build = {
    source_sha: SOURCE,
    run_id: RUN_ID,
    artifact_id: ARTIFACT_ID,
    tree_sha256: receipt.treeSha256,
    version: receipt.version,
  };

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
    exercisePanel: async ({ page, panel, activatePanel }) => {
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
        assert.equal((await faultState(panel)).calls, 1, 'desktop_later_port_write_started_early');
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
          await click(panel, 'button', 'Forget pair code');
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
        await click(panel, 'button', 'Forget pair code');
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

      stage = 'desktop_reset';
      await openSection(panel, 'Data & reset');
      await click(panel, 'button', 'Clear local data on this device');
      await waitFor(
        'desktop_reset_dialog',
        () => state(panel),
        (s) => s?.resetDialog,
      );
      await fault(panel, 'clear', null, 'reject');
      try {
        await click(panel, 'dialog', 'Clear & sign out');
        await waitFor(
          'desktop_reset_refusal',
          () => state(panel),
          (s) => s?.resetDialog && s.resetError && s.portSaved === 65005,
        );
        assert.equal((await faultState(panel)).calls, 1);
        passed('reset refusal keeps confirmation and saved value', {
          error_visible: true,
          retry_available: true,
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
      assert.equal((await state(panel)).portSaved, null);
      assert.equal((await panelIdentity(panel)).accessTokenPresent, false);
      passed('reset retry clears local state and signs out after reload', {
        cleared: true,
        signed_out: true,
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
