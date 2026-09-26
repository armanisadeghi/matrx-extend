#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';

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

async function evaluate(panel, expression) {
  const response = await panel.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error('panel_runtime_exception');
  return response.result?.value;
}

async function waitFor(label, read, accept, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    try { last = await read(); } catch (error) {
      // A panel reload briefly destroys its JavaScript execution context.
      last = { transient: String(error?.message ?? error) };
    }
    if (accept(last)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  } while (Date.now() < deadline);
  throw new Error(`${label}_not_observed:${JSON.stringify(last)}`);
}

async function openSection(panel, label) {
  const expanded = await evaluate(panel, `(() => {
    const button = [...document.querySelectorAll('button[aria-expanded]')]
      .find((el) => el.textContent.trim() === ${JSON.stringify(label)});
    return button?.getAttribute('aria-expanded') ?? null;
  })()`);
  assert.notEqual(expanded, null, `${label} section exists`);
  if (expanded === 'false') await click(panel, 'section', label);
  await waitFor(`${label}_expanded`, () => evaluate(panel, `(() =>
    [...document.querySelectorAll('button[aria-expanded]')]
      .find((el) => el.textContent.trim() === ${JSON.stringify(label)})
      ?.getAttribute('aria-expanded'))()`), (value) => value === 'true');
}

async function click(panel, kind, label) {
  const pointerSample = (scroll) => evaluate(panel, `(() => {
    const kind = ${JSON.stringify(kind)}, label = ${JSON.stringify(label)};
    const visible = (el) => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
        style.display !== 'none' && !el.closest('[inert]');
    };
    let candidates;
    if (kind === 'title') candidates = [...document.querySelectorAll('button[title]')]
      .filter((el) => el.title === label);
    else if (kind === 'section') candidates = [...document.querySelectorAll('button[aria-expanded]')]
      .filter((el) => el.textContent.trim() === label);
    else if (kind === 'theme') candidates = [...document.querySelectorAll('span')]
      .filter((el) => el.textContent.trim() === 'Theme')
      .flatMap((el) => [...el.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
    else if (kind === 'port') candidates = [...document.querySelectorAll('input[placeholder="auto"]')];
    else if (kind === 'option') candidates = [...document.querySelectorAll('[role="option"]')]
      .filter((el) => el.textContent.trim() === label);
    else if (kind === 'dialog') candidates = [...document.querySelectorAll('[role="dialog"] button')]
      .filter((el) => el.textContent.trim() === label);
    else candidates = [...document.querySelectorAll('button')]
      .filter((el) => el.textContent.trim() === label);
    candidates = candidates.filter(visible);
    if (candidates.length !== 1) return { count: candidates.length };
    const target = candidates[0];
    if (${scroll}) target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const hitTarget = hit === target || target.contains(hit);
    let animating = false;
    for (let ancestor = target; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.getAnimations({ subtree: false }).some((animation) => animation.playState === 'running')) {
        animating = true;
        break;
      }
    }
    return { count: 1, x, y, hitTarget, animating,
      viewport: { width: innerWidth, height: innerHeight },
      hitTag: hit?.tagName ?? null };
  })()`);
  let location = await pointerSample(true);
  assert.equal(location?.count, 1, `unique visible ${kind} ${label}`);
  // Poll outside the page: a paused requestAnimationFrame must not strand
  // Runtime.evaluate(awaitPromise) or hide the last pointer diagnostic.
  const deadline = Date.now() + 3000;
  let previous, stableSamples = 0;
  do {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    try {
      location = await pointerSample(false);
    } catch (error) {
      throw new Error(`pointer_sample_failed for ${kind} ${label}: ${String(error?.message ?? error)}; last=${JSON.stringify(location)}`);
    }
    stableSamples = location?.count === 1 && location.hitTarget && !location.animating &&
      previous !== undefined && Math.abs(previous.x - location.x) < 0.25 &&
      Math.abs(previous.y - location.y) < 0.25 ? stableSamples + 1 : 0;
    location = { ...location, stableSamples };
    if (stableSamples >= 2) break;
    previous = location?.count === 1 ? { x: location.x, y: location.y } : undefined;
  } while (Date.now() < deadline);
  assert.equal(stableSamples >= 2, true,
    `stable hit target for ${kind} ${label}: ${JSON.stringify(location)}`);
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: location.x, y: location.y, button: 'left', clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: location.x, y: location.y, button: 'left', clickCount: 1,
  });
  if (kind === 'port') {
    const control = await portControlState(panel);
    assert.equal(control?.focused, true,
      `real mouse click focused port input: ${JSON.stringify({ location, control })}`);
  }
}

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
    return {
      settings: !!document.querySelector('button[title="Settings"][data-state="active"]'),
      theme: trigger?.textContent.trim() ?? null,
      guest: text.includes('Sign in to choose') || text.includes("You're using Matrx as a guest."),
      signIn: [...document.querySelectorAll('button')].some((el) => /sign in/i.test(el.textContent)),
      dialog: !!document.querySelector('[role="dialog"]'),
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
