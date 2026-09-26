#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';

// A guest changes Theme in the real native panel, cancels a reset, then confirms it.
// Removing either storage clear or making Cancel destructive must make this go red.
const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'settings-local-reset-acceptance.json');
const report = {
  feature: 'EXT-F-1003',
  case: 'EXT-F-1003-T49',
  build: { version: '0.2.51', extensionId: 'cihdmkcdjjckfhjpgoedmgfpoljebaml' },
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
  const location = await evaluate(panel, `(() => {
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
    else if (kind === 'option') candidates = [...document.querySelectorAll('[role="option"]')]
      .filter((el) => el.textContent.trim() === label);
    else if (kind === 'dialog') candidates = [...document.querySelectorAll('[role="dialog"] button')]
      .filter((el) => el.textContent.trim() === label);
    else candidates = [...document.querySelectorAll('button')]
      .filter((el) => el.textContent.trim() === label);
    candidates = candidates.filter(visible);
    if (candidates.length !== 1) return { count: candidates.length };
    candidates[0].scrollIntoView({ block: 'center', inline: 'center' });
    const r = candidates[0].getBoundingClientRect();
    return { count: 1, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  assert.equal(location?.count, 1, `unique visible ${kind} ${label}`);
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: location.x, y: location.y, button: 'left', clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: location.x, y: location.y, button: 'left', clickCount: 1,
  });
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
    return { theme, hasSettingsKey: Object.hasOwn(local, 'matrx.settings.v1'),
      localKeys: Object.keys(local).sort(), sessionKeys: Object.keys(session).sort() };
  })()`);
}

try {
  const receipt = JSON.parse(await readFile(join(REPO, '.output', 'release-receipt.json'), 'utf8'));
  assert.equal(receipt.version, report.build.version, 'released build must be version 0.2.51');
  const result = await runNativeSidepanelQa({ exercisePanel: async ({ panel }) => {
    await click(panel, 'title', 'Settings');
    await waitFor('settings_view', () => panelState(panel), (s) => s.settings && s.guest);
    await openSection(panel, 'Appearance');
    await click(panel, 'theme', 'Theme');
    await click(panel, 'option', 'Dark');
    await waitFor('dark_theme_ui', () => panelState(panel), (s) => s.theme === 'Dark');
    await waitFor('dark_theme_storage', () => storageState(panel), (s) => s.theme === 'dark');
    report.steps.push({ action: 'Set Dark in Settings', result: 'Dark visible and persisted' });

    await openSection(panel, 'Data & reset');
    await click(panel, 'button', 'Clear local data on this device');
    await waitFor('reset_dialog', () => panelState(panel), (s) => s.dialog);
    await click(panel, 'dialog', 'Cancel');
    await waitFor('cancel_closed_dialog', () => panelState(panel), (s) => !s.dialog);
    assert.equal((await panelState(panel)).theme, 'Dark');
    const beforeConfirm = await storageState(panel);
    assert.equal(beforeConfirm.theme, 'dark');
    assert.ok(beforeConfirm.sessionKeys.length > 0, 'guest session storage must contain real state to prove session clear');
    report.steps.push({ action: 'Cancel Clear local data', result: 'dialog closed; Dark UI and persisted state preserved' });

    await click(panel, 'button', 'Clear local data on this device');
    await waitFor('reset_dialog_reopened', () => panelState(panel), (s) => s.dialog);
    await click(panel, 'dialog', 'Clear & sign out');
    await waitFor('settings_storage_removed', () => storageState(panel), (s) => !s.hasSettingsKey);
    const after = await storageState(panel);
    assert.equal(after.hasSettingsKey, false);
    assert.deepEqual(beforeConfirm.sessionKeys.filter((key) => after.sessionKeys.includes(key)), [],
      'previous guest session keys must be cleared');
    report.steps.push({ action: 'Confirm Clear & sign out', result: 'persisted Settings key and prior session keys removed' });

    await panel.send('Page.reload', { ignoreCache: true });
    await waitFor('guest_after_reload', () => panelState(panel), (s) => s.guest && s.signIn);
    await click(panel, 'title', 'Settings');
    await waitFor('settings_after_reload', () => panelState(panel), (s) => s.settings);
    await openSection(panel, 'Appearance');
    await waitFor('default_theme_after_reload', () => panelState(panel), (s) => s.theme === 'System');
    assert.equal((await storageState(panel)).theme, null);
    report.steps.push({ action: 'Reload native panel', result: 'guest controls and System default visible; removed Settings value stayed absent' });
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
