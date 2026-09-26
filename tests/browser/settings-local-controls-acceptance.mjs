#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

// Runs against a receipt-verified, disposable Chrome profile and its real native panel.
// UI actions use trusted CDP pointer/keyboard input; DOM and Chrome API reads are evidence only.
const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'settings-local-controls-acceptance.json');
const EXTENSION_ID = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const VALID_PORT = 65001;
const IDS = ['T22', 'T37', 'T46', 'T70'].map((id) => `EXT-F-1003-${id}`);
const report = {
  schema_version: 1,
  scope: 'real isolated Chrome-for-Testing native side panel; signed-out guest',
  build: { extensionId: EXTENSION_ID },
  preconditions: ['Owned disposable profile', 'Released extension receipt and tree hash verified', 'Guest panel settled before interaction'],
  cases: IDS.map((id) => ({ id, role: 'guest', status: 'unverified', steps: [], criteria: [] })),
};
const byId = (suffix) => report.cases.find((c) => c.id.endsWith(suffix));
const criterion = (c, name, status, evidence) => c.criteria.push({ name, status, evidence });

async function settings(panel) {
  await click(panel, 'title', 'Settings');
  await waitFor('guest_settings', () => evaluate(panel, `(() => {
    const text = document.body?.innerText ?? '';
    return { active: !!document.querySelector('button[title="Settings"][data-state="active"]'),
      guest: text.includes("You're using Matrx as a guest.") || text.includes('Sign in to choose') };
  })()`), (s) => s?.active && s.guest);
}

async function reloadSettings(panel) {
  await panel.send('Page.reload', { ignoreCache: true });
  await waitFor('guest_panel_after_reload', () => evaluate(panel, `(() => {
    const text = document.body?.innerText ?? '';
    return document.readyState === 'complete' && text.includes("You're using Matrx as a guest.");
  })()`), (v) => v === true);
  await settings(panel);
}

async function guestSections(panel) {
  return evaluate(panel, `(() => ({
    sections: [...document.querySelectorAll('button[aria-expanded]')].map((b) => b.textContent.trim()),
    advancedText: (document.body?.innerText ?? '').includes('Advanced agent capabilities'),
    adminControls: ['Audit key', 'Permission gate'].filter((s) => (document.body?.innerText ?? '').includes(s)),
  }))()`);
}

async function deepClean(panel) {
  return evaluate(panel, `(() => {
    const s = document.querySelector('[role="switch"][aria-label="Deep clean"]');
    const row = s?.parentElement?.parentElement;
    return { count: document.querySelectorAll('[role="switch"][aria-label="Deep clean"]').length,
      checked: s?.getAttribute('aria-checked') ?? null,
      hint: row?.textContent ?? null };
  })()`);
}

async function port(panel) {
  return evaluate(panel, `(async () => {
    const input = document.querySelector('input[placeholder="auto"]');
    const local = await chrome.storage.local.get('matrxLocalEnginePortOverride');
    const row = input?.parentElement;
    return { value: input?.value ?? null,
      saved: local.matrxLocalEnginePortOverride ?? null,
      button: [...(row?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim()),
      override: row?.textContent.includes('override') ?? false,
      error: row?.nextElementSibling?.textContent.trim() ?? null };
  })()`);
}

async function replacePort(panel, value) {
  await click(panel, 'port', 'Local engine port');
  await panel.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await panel.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  if (value) await panel.send('Input.insertText', { text: value });
  else {
    await panel.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await panel.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  }
  await waitFor('port_input', () => port(panel), (s) => s?.value === value);
  await click(panel, 'button', (await port(panel)).button.includes('Save') ? 'Save' : 'Set');
}

async function about(panel) {
  return evaluate(panel, `(() => {
    const value = (label) => {
      const span = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === label);
      return span?.parentElement?.lastElementChild?.textContent.trim() ?? null;
    };
    const text = document.body?.innerText ?? '';
    return { browser: value('Browser'), version: value('Installed version'),
      extensionId: value('Extension ID'), readiness: value('Browser APIs for saved logins'),
      expectedBrowser: navigator.userAgent.includes('Edg/') ? 'Microsoft Edge' :
        navigator.userAgent.includes('OPR/') ? 'Opera' : navigator.userAgent.includes('Chrome/') ? 'Chrome' : 'This browser',
      manifestVersion: chrome.runtime.getManifest().version, runtimeId: chrome.runtime.id,
      passwordApis: typeof chrome.runtime.sendMessage === 'function' &&
        typeof chrome.tabs?.get === 'function' && typeof chrome.scripting?.executeScript === 'function' &&
        typeof chrome.storage?.local?.get === 'function',
      updateApi: typeof chrome.runtime.requestUpdateCheck === 'function',
      hasUpdateButton: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Check for extension update'),
      updateText: text.match(/Your browser did not find an update right now\.|Version [^\\n]+ is available\.|An update is available\.|Your browser limited update checks\.|Could not check right now\./)?.[0] ?? null,
      browserManaged: text.includes('Updates are managed by your browser. Open its Extensions page'),
      unavailableRemedy: text.includes('Reload or reinstall Matrx Extend in a supported browser') };
  })()`);
}

async function runCase(c, fn) {
  try {
    await fn();
  } catch (error) {
    c.error = String(error?.message ?? error);
    criterion(c, 'runner completed the case', 'fail', c.error);
  }
  c.status = c.criteria.some((x) => x.status === 'fail') ? 'fail'
    : c.criteria.length && c.criteria.every((x) => x.status === 'pass') ? 'pass' : 'unverified';
}

try {
  const packageJson = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8'));
  const receipt = JSON.parse(await readFile(join(REPO, '.output', 'release-receipt.json'), 'utf8'));
  assert.equal(receipt.version, packageJson.version, 'receipt version must match package');
  assert.match(receipt.sourceSha, /^[a-f0-9]{40}$/);
  execFileSync('git', ['merge-base', '--is-ancestor', receipt.sourceSha, 'HEAD'], { cwd: REPO });
  execFileSync('git', ['diff', '--quiet', receipt.sourceSha, '--', 'src/features/settings/SettingsView.tsx'], { cwd: REPO });
  report.build = { ...report.build, version: receipt.version, sourceSha: receipt.sourceSha, treeSha256: receipt.treeSha256 };
  const result = await runNativeSidepanelQa({ exercisePanel: async ({ panel }) => {
    await settings(panel);
    await runCase(byId('T22'), async () => {
      const c = byId('T22');
      for (const phase of ['warm', 'reload']) {
        if (phase === 'reload') await reloadSettings(panel);
        const state = await guestSections(panel);
        c.steps.push({ phase, action: 'Inspect guest Settings section list and admin controls', observation: state });
        criterion(c, `${phase} admin section and controls absent`,
          !state.sections.includes('Advanced agent capabilities') && !state.advancedText && state.adminControls.length === 0 ? 'pass' : 'fail', state);
      }
    });
    await runCase(byId('T37'), async () => {
      const c = byId('T37');
      await openSection(panel, 'Scrape');
      const before = await deepClean(panel);
      c.steps.push({ phase: 'warm', action: 'Observe initial Deep clean preference', observation: before });
      criterion(c, 'visible coming-soon hint', before.count === 1 && /coming soon/i.test(before.hint ?? '') ? 'pass' : 'fail', before);
      assert.match(before.checked ?? '', /^(true|false)$/);
      try {
        await click(panel, 'switch', 'Deep clean');
        const toggled = await waitFor('deep_clean_toggled', () => deepClean(panel), (s) => s?.checked !== before.checked);
        c.steps.push({ phase: 'warm', action: 'Toggle Deep clean', observation: toggled });
        criterion(c, 'toggle changes state', 'pass', toggled);
        await reloadSettings(panel);
        await openSection(panel, 'Scrape');
        const reloaded = await deepClean(panel);
        c.steps.push({ phase: 'reload', action: 'Inspect persisted state', observation: reloaded });
        criterion(c, 'state and coming-soon hint persist after reload',
          reloaded.checked === toggled.checked && /coming soon/i.test(reloaded.hint ?? '') ? 'pass' : 'fail', reloaded);
      } finally {
        const current = await deepClean(panel);
        if (current?.checked !== before.checked) await click(panel, 'switch', 'Deep clean');
        const restored = await waitFor('deep_clean_restored', () => deepClean(panel), (s) => s?.checked === before.checked);
        c.steps.push({ phase: 'cleanup', action: 'Restore original preference', observation: restored });
      }
    });
    await runCase(byId('T46'), async () => {
      const c = byId('T46');
      await openSection(panel, 'Desktop bridge');
      const initial = await port(panel);
      c.steps.push({ phase: 'warm', action: 'Record original engine port state', observation: initial });
      assert.equal(initial.saved, null, 'fresh disposable profile must have no override');
      try {
        await replacePort(panel, String(VALID_PORT));
        const saved = await waitFor('valid_port_saved', () => port(panel), (s) => s?.saved === VALID_PORT && s.override);
        c.steps.push({ phase: 'warm', action: 'Save valid port', observation: saved });
        criterion(c, 'valid port saved', 'pass', saved);
        criterion(c, 'rediscovery triggered and reflected in desktop status', 'unverified',
          'This UI/storage observation does not prove the worker handled DESKTOP_REDISCOVER.');
        await replacePort(panel, '65536');
        const invalid = await waitFor('invalid_port_error', () => port(panel), (s) => /Port must be 1–65535/.test(s?.error ?? ''));
        c.steps.push({ phase: 'warm', action: 'Submit invalid range', observation: invalid });
        criterion(c, 'invalid range shows error and retains saved port', invalid.saved === VALID_PORT ? 'pass' : 'fail', invalid);
        await reloadSettings(panel);
        await openSection(panel, 'Desktop bridge');
        const reloaded = await port(panel);
        c.steps.push({ phase: 'reload', action: 'Inspect valid override after reload', observation: reloaded });
        criterion(c, 'valid override persists after reload', reloaded.saved === VALID_PORT && reloaded.value === String(VALID_PORT) ? 'pass' : 'fail', reloaded);
        await replacePort(panel, '');
        const cleared = await waitFor('port_override_cleared', () => port(panel), (s) => s?.saved === null && !s.override);
        c.steps.push({ phase: 'warm', action: 'Clear override', observation: cleared });
        criterion(c, 'blank clears override and stale error', cleared.error ? 'fail' : 'pass', cleared);
        await reloadSettings(panel);
        await openSection(panel, 'Desktop bridge');
        const empty = await port(panel);
        c.steps.push({ phase: 'reload', action: 'Inspect cleared override after reload', observation: empty });
        criterion(c, 'cleared override persists after reload', empty.saved === null && empty.value === '' ? 'pass' : 'fail', empty);
      } finally {
        if ((await port(panel))?.saved !== null) {
          await replacePort(panel, '');
          const cleared = await waitFor('port_cleanup', () => port(panel), (s) => s?.saved === null);
          c.steps.push({ phase: 'cleanup', action: 'Clear disposable override', observation: cleared });
        }
      }
    });
    await runCase(byId('T70'), async () => {
      const c = byId('T70');
      await openSection(panel, 'About');
      const warm = await about(panel);
      c.steps.push({ phase: 'warm', action: 'Inspect About identity, API readiness, and update affordance', observation: warm });
      criterion(c, 'identity matches running browser, manifest, receipt and runtime ID',
        warm.browser === warm.expectedBrowser && warm.version === warm.manifestVersion && warm.version === report.build.version &&
        warm.extensionId === warm.runtimeId && warm.extensionId === EXTENSION_ID ? 'pass' : 'fail', warm);
      criterion(c, 'password-flow API readiness label and remedy',
        warm.passwordApis ? (warm.readiness === 'Ready' ? 'pass' : 'fail') :
          (warm.readiness === 'Unavailable' && warm.unavailableRemedy ? 'pass' : 'fail'), warm);
      criterion(c, 'password-flow API unavailable branch', 'unverified', 'No browser API was removed or mocked.');
      if (warm.updateApi && warm.hasUpdateButton) {
        await click(panel, 'button', 'Check for extension update');
        const checked = await waitFor('update_check_result', () => about(panel), (s) => s?.updateText !== null, 15000);
        c.steps.push({ phase: 'warm', action: 'Request real browser update check', observation: checked });
        criterion(c, 'observed browser update result shown accurately', checked.updateText ? 'pass' : 'fail', checked);
        criterion(c, 'no-update outcome', /did not find an update/.test(checked.updateText ?? '') ? 'pass' : 'unverified', checked);
      } else {
        criterion(c, 'browser-managed update instructions', warm.browserManaged ? 'pass' : 'fail', warm);
        criterion(c, 'real no-update outcome', 'unverified', 'requestUpdateCheck unavailable in this installed browser.');
      }
      for (const branch of ['update available', 'throttled', 'update error', 'update API unavailable'])
        criterion(c, `${branch} branch`, 'unverified', 'No browser API or update result was fabricated.');
      await reloadSettings(panel);
      await openSection(panel, 'About');
      const reloaded = await about(panel);
      c.steps.push({ phase: 'reload', action: 'Inspect current identity and API readiness', observation: reloaded });
      criterion(c, 'identity and API readiness remain current after reload',
        reloaded.version === report.build.version && reloaded.extensionId === EXTENSION_ID &&
        reloaded.passwordApis === warm.passwordApis && reloaded.readiness === warm.readiness ? 'pass' : 'fail', reloaded);
    });
  }});
  assert.equal(result.verified, true);
  report.build.verified = true;
  report.artifacts = result.artifacts;
} catch (error) {
  report.setup_error = String(error?.message ?? error);
  for (const c of report.cases) if (c.criteria.length === 0) criterion(c, 'setup completed', 'unverified', report.setup_error);
} finally {
  for (const c of report.cases) {
    c.build = report.build;
    c.preconditions = report.preconditions;
    c.evidence = report.artifacts ?? null;
  }
  report.status = report.cases.some((c) => c.status === 'fail') ? 'fail'
    : report.cases.every((c) => c.status === 'pass') ? 'pass' : 'unverified';
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`${report.status.toUpperCase()} settings-local-controls: ${OUTPUT}`);
  if (report.setup_error) console.error(report.setup_error);
  if (report.status === 'fail' || report.setup_error) process.exitCode = 1;
}
