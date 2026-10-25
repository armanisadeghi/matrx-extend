import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { captureSettingsShellDiagnostic } from './settings-shell-diagnostic.mjs';

const expectedPanelUrl = 'chrome-extension://private-extension/sidepanel.html';
const expectedTargetId = 'private-target-id-xyz';

function panelDocument({
  url = expectedPanelUrl,
  tabs = 3,
  settings = true,
  disabled = false,
} = {}) {
  const button = {
    disabled,
    getBoundingClientRect: () => ({ width: 24, height: 24 }),
    getAttribute: (name) => (name === 'title' ? 'Settings' : null),
    closest: () => null,
  };
  const document = {
    readyState: 'complete',
    visibilityState: 'visible',
    querySelectorAll: (selector) =>
      selector === 'button[role="tab"]'
        ? settings
          ? [button]
          : []
        : selector === '[role="tab"]'
          ? Array.from({ length: tabs })
          : [],
  };
  return {
    send: async (method, options) => {
      assert.equal(method, 'Runtime.evaluate');
      return {
        result: {
          value: runInNewContext(options.expression, {
            document,
            location: { href: url },
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
          }),
        },
      };
    },
  };
}

test('shell diagnostic sees a lifted Settings tab and rejects duplicate or inert tabs', async () => {
  const window = new Window({ url: expectedPanelUrl });
  try {
    window.document.body.innerHTML =
      '<div id="app"><button role="tab" data-matrx-title="Settings"></button></div>';
    const rect = { width: 24, height: 24 };
    window.HTMLElement.prototype.getBoundingClientRect = () => rect;
    const read = async () =>
      captureSettingsShellDiagnostic({
        panel: {
          send: async (_method, args) => ({ result: { value: window.eval(args.expression) } }),
        },
        browserSession: { send: async () => ({ targetInfos: [] }) },
        expectedTargetId,
        expectedPanelUrl,
      });
    const lifted = await read();
    assert.deepEqual([lifted.settings_button_count, lifted.settings_button_visible], [1, true]);
    const duplicate = window.document.querySelector('button').cloneNode();
    window.document.getElementById('app').append(duplicate);
    const doubled = await read();
    assert.deepEqual([doubled.settings_button_count, doubled.settings_button_visible], [2, null]);
    duplicate.remove();
    window.document.querySelector('button').setAttribute('inert', '');
    const inert = await read();
    assert.deepEqual([inert.settings_button_count, inert.settings_button_visible], [1, false]);
  } finally {
    await window.happyDOM.abort();
  }
});

test('shell diagnostic separates an owned live target from a replacement without exposing IDs', async () => {
  const owned = await captureSettingsShellDiagnostic({
    panel: panelDocument(),
    browserSession: {
      send: async () => ({ targetInfos: [{ targetId: expectedTargetId, url: expectedPanelUrl }] }),
    },
    expectedTargetId,
    expectedPanelUrl,
  });
  assert.equal(owned.original_target_url_matches, true);
  assert.equal(owned.replacement_panel_present, false);
  assert.equal(owned.owned_sidepanel_url_matches, true);
  assert.equal(owned.role_tab_count, 3);
  assert.equal(owned.settings_button_count, 1);
  assert.equal(owned.settings_button_visible, true);

  const replacement = await captureSettingsShellDiagnostic({
    panel: panelDocument({ url: 'about:blank', tabs: 0, settings: false }),
    browserSession: {
      send: async () => ({
        targetInfos: [{ targetId: 'other-private-target-abc', url: expectedPanelUrl }],
      }),
    },
    expectedTargetId,
    expectedPanelUrl,
  });
  assert.equal(replacement.original_target_present, false);
  assert.equal(replacement.replacement_panel_present, true);
  assert.equal(replacement.owned_sidepanel_url_matches, false);
  assert.equal(replacement.role_tab_count, 0);
  assert.equal(replacement.settings_button_count, 0);
  assert.equal(replacement.settings_button_visible, null);
  for (const value of [
    expectedTargetId,
    'other-private-target-abc',
    expectedPanelUrl,
    'about:blank',
  ]) {
    assert.equal(JSON.stringify({ owned, replacement }).includes(value), false);
  }

  const unobserved = await captureSettingsShellDiagnostic({
    panel: { send: async () => ({ result: {} }) },
    browserSession: { send: async () => ({}) },
    expectedTargetId,
    expectedPanelUrl,
  });
  assert.equal(unobserved.target_query_available, false);
  assert.equal(unobserved.document_observed, false);
  assert.equal(unobserved.role_tab_count, null);
});

test('shell wait owns the operation before it can time out', async () => {
  const source = await readFile(
    new URL('./settings-d87-native-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const body = source.match(
    /async function openSettings\(panel\) \{([\s\S]*?)\n\}\n\nasync function chooseTheme/,
  )?.[1];
  assert.ok(body, 'd87_open_settings_body_missing');
  const create = new Function(
    'waitFor',
    'observation',
    'settingsShellReady',
    'AUTH_MODE',
    `let operation='member_logical_organization_proof';
     return { openSettings: async function openSettings(panel) { ${body} },
       operation: () => operation };`,
  );
  const driver = create(
    async () => {
      throw new Error('d87_settings_shell_not_observed');
    },
    () => ({ settingsAvailable: false, guest: false }),
    () => false,
    'member',
  );
  await assert.rejects(driver.openSettings({}), /d87_settings_shell_not_observed/);
  assert.equal(driver.operation(), 'settings_shell');
});

test('shell diagnostic runs only for the shell observation failure', async () => {
  const source = await readFile(
    new URL('./settings-d87-native-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const body = source.match(
    /\} catch \(error\) \{\n([\s\S]*?) {8}const authFailure = memberAuthFailureReport\(error, operation\);/,
  )?.[1];
  assert.ok(body, 'd87_shell_failure_handler_missing');
  const calls = [];
  const report = {};
  const handle = new Function(
    'failureCode',
    'captureSettingsShellDiagnostic',
    'report',
    'panel',
    'browserSession',
    'panelTarget',
    `return async (error) => { ${body} };`,
  )(
    (error) => error.message,
    async (input) => {
      calls.push(input);
      return { document_observed: true };
    },
    report,
    { kind: 'owned-panel' },
    { kind: 'browser-session' },
    { targetId: expectedTargetId, url: expectedPanelUrl },
  );

  await handle(new Error('d87_settings_ready_not_observed'));
  assert.equal(calls.length, 0);
  assert.equal(Object.hasOwn(report, 'settings_shell_diagnostic'), false);

  await handle(new Error('d87_settings_shell_not_observed'));
  assert.equal(calls.length, 1);
  assert.deepEqual(report.settings_shell_diagnostic, { document_observed: true });
  assert.equal(calls[0].expectedTargetId, expectedTargetId);
  assert.equal(calls[0].expectedPanelUrl, expectedPanelUrl);
});
