#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { evaluate, waitFor, openSection, click } from './settings-panel-driver.mjs';

// A guest changes Theme in the real native panel, cancels a reset, then confirms it.
// Removing either storage clear or making Cancel destructive must make this go red.
const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'settings-local-reset-acceptance.json');
const PORT = 65001;
const SESSION_KEY = 'matrx.qa.settingsReset.session';
const SESSION_VALUE = 'disposable-guest-session-state';
const report = {
  feature: 'EXT-F-1003',
  case: 'EXT-F-1003-T49',
  build: { extensionId: 'cihdmkcdjjckfhjpgoedmgfpoljebaml' },
  surface: 'fresh isolated Chrome-for-Testing native side panel; signed-out guest',
  steps: [],
  status: 'fail',
};

async function setEnginePort(panel) {
  await click(panel, 'port', 'Local engine port');
  await panel.send('Input.insertText', { text: String(PORT) });
  await waitFor('port_input_typed', () => portControlState(panel),
    (state) => state?.value === String(PORT) && state.focused);
  await click(panel, 'button', 'Set');
  await waitFor('port_override_persisted', async () => ({
    control: await portControlState(panel), storage: await storageState(panel),
  }), (state) => state.storage?.port === PORT);
}

async function portControlState(panel) {
  return evaluate(panel, `(() => {
    const input = document.querySelector('input[placeholder="auto"]');
    if (!input) return null;
    const button = [...input.parentElement.querySelectorAll('button')]
      .find((el) => /^(Set|Save)$/.test(el.textContent.trim()));
    return { value: input.value, focused: document.activeElement === input,
      button: button?.textContent.trim() ?? null,
      error: input.parentElement.nextElementSibling?.textContent.trim() ?? null };
  })()`);
}

async function seedDisposableSession(panel) {
  await evaluate(panel, `(async () => {
    await chrome.storage.session.set({ [${JSON.stringify(SESSION_KEY)}]: ${JSON.stringify(SESSION_VALUE)} });
  })()`);
  await waitFor('session_fixture_persisted', () => storageState(panel), (s) => s.sessionFixtureMatches);
}

async function panelState(panel) {
  return evaluate(panel, `(() => {
    const row = [...document.querySelectorAll('span')].find((el) => el.textContent.trim() === 'Theme');
    const trigger = row?.parentElement?.parentElement?.querySelector('button[role="combobox"]');
    const text = document.body?.innerText ?? '';
    const resetDialog = [...document.querySelectorAll('[role="alertdialog"]')]
      .find((el) => el.querySelector('[data-slot="alert-dialog-title"]')?.textContent.trim() === 'Clear local data?');
    return {
      settings: !!document.querySelector('button[title="Settings"][data-state="active"]'),
      theme: trigger?.textContent.trim() ?? null,
      guest: text.includes('Sign in to choose') || text.includes("You're using Matrx as a guest."),
      signIn: [...document.querySelectorAll('button')].some((el) => /sign in/i.test(el.textContent)),
      dialog: !!resetDialog,
    };
  })()`);
}

async function storageState(panel) {
  return evaluate(panel, `(async () => {
    const local = await chrome.storage.local.get(null);
    const session = await chrome.storage.session.get(null);
    let theme = null;
    if (typeof local['matrx.settings.v1'] === 'string') {
      try { theme = JSON.parse(local['matrx.settings.v1']).state?.theme ?? null; } catch {}
    }
    return { theme, port: local.matrxLocalEnginePortOverride ?? null,
      hasSettingsKey: Object.hasOwn(local, 'matrx.settings.v1'),
      hasSessionFixture: Object.hasOwn(session, ${JSON.stringify(SESSION_KEY)}),
      sessionFixtureMatches: session[${JSON.stringify(SESSION_KEY)}] === ${JSON.stringify(SESSION_VALUE)},
      localKeys: Object.keys(local).sort(), sessionKeys: Object.keys(session).sort() };
  })()`);
}

try {
  const packageJson = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8'));
  const receipt = JSON.parse(await readFile(join(REPO, '.output', 'release-receipt.json'), 'utf8'));
  assert.equal(receipt.version, packageJson.version, 'released build must match current package version');
  assert.match(receipt.sourceSha, /^[a-f0-9]{40}$/, 'receipt must identify source revision');
  execFileSync('git', ['merge-base', '--is-ancestor', receipt.sourceSha, 'HEAD'], { cwd: REPO });
  execFileSync('git', ['diff', '--quiet', receipt.sourceSha, '--', 'src/features/settings/SettingsView.tsx'], { cwd: REPO });
  report.build.version = receipt.version;
  report.build.sourceSha = receipt.sourceSha;
  report.build.treeSha256 = receipt.treeSha256;
  const result = await runNativeSidepanelQa({ exercisePanel: async ({ panel }) => {
    await click(panel, 'title', 'Settings');
    await waitFor('settings_view', () => panelState(panel), (s) => s.settings && s.guest);
    await openSection(panel, 'Appearance');
    await click(panel, 'theme', 'Theme');
    await click(panel, 'option', 'Dark');
    await waitFor('dark_theme_ui', () => panelState(panel), (s) => s.theme === 'Dark');
    await waitFor('dark_theme_storage', () => storageState(panel), (s) => s.theme === 'dark');
    report.steps.push({ action: 'Set Dark in Settings', result: 'Dark visible and persisted' });

    await openSection(panel, 'Desktop bridge');
    await setEnginePort(panel);
    await seedDisposableSession(panel);
    report.steps.push({ action: 'Set local engine port and disposable guest session fixture', result: 'independent local and session values persisted in isolated profile' });

    await openSection(panel, 'Data & reset');
    await click(panel, 'button', 'Clear local data on this device');
    await waitFor('reset_dialog', () => panelState(panel), (s) => s.dialog);
    await click(panel, 'dialog', 'Cancel');
    await waitFor('cancel_closed_dialog', () => panelState(panel), (s) => !s.dialog);
    assert.equal((await panelState(panel)).theme, 'Dark');
    const beforeConfirm = await storageState(panel);
    assert.equal(beforeConfirm.theme, 'dark');
    assert.equal(beforeConfirm.port, PORT, 'Cancel must preserve local port override');
    assert.equal(beforeConfirm.hasSessionFixture, true, 'Cancel must preserve guest session fixture');
    assert.equal(beforeConfirm.sessionFixtureMatches, true, 'Cancel must preserve exact guest session value');
    report.steps.push({ action: 'Cancel Clear local data', result: 'dialog closed; Dark theme, port override, and session fixture preserved' });

    await click(panel, 'button', 'Clear local data on this device');
    await waitFor('reset_dialog_reopened', () => panelState(panel), (s) => s.dialog);
    await click(panel, 'dialog', 'Clear & sign out');
    await waitFor('local_and_session_cleared', () => storageState(panel), (s) =>
      !s.hasSettingsKey && s.port === null && !s.hasSessionFixture);
    const after = await storageState(panel);
    assert.equal(after.hasSettingsKey, false);
    assert.equal(after.port, null);
    assert.equal(after.hasSessionFixture, false);
    assert.deepEqual(beforeConfirm.localKeys.filter((key) => after.localKeys.includes(key)), [],
      'all pre-confirm local keys must be cleared');
    assert.deepEqual(beforeConfirm.sessionKeys.filter((key) => after.sessionKeys.includes(key)), [],
      'all pre-confirm session keys must be cleared');
    report.steps.push({ action: 'Confirm Clear & sign out', result: 'all prior local and session keys removed' });

    await panel.send('Page.reload', { ignoreCache: true });
    await waitFor('guest_after_reload', () => panelState(panel), (s) => s.guest && s.signIn);
    await click(panel, 'title', 'Settings');
    await waitFor('settings_after_reload', () => panelState(panel), (s) => s.settings);
    await openSection(panel, 'Appearance');
    await waitFor('default_theme_after_reload', () => panelState(panel), (s) => s.theme === 'System');
    const reloaded = await storageState(panel);
    assert.equal(reloaded.theme, null);
    assert.equal(reloaded.port, null);
    assert.equal(reloaded.hasSessionFixture, false);
    report.steps.push({ action: 'Reload native panel', result: 'guest controls and System default visible; theme, port, and session fixture absent' });
  }});
  assert.equal(result.verified, true);
  report.build.verified = true;
  report.artifacts = result.artifacts;
  report.status = 'pass';
} catch (error) {
  report.error = String(error?.message ?? error);
  process.exitCode = 1;
} finally {
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`${report.status.toUpperCase()} ${report.case}: ${OUTPUT}`);
  if (report.error) console.error(report.error);
}
