import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { evaluate, waitFor, waitForReplacementSettingsTab } from './settings-panel-driver.mjs';
import {
  classifyReloadSettingsFailure,
  observeReloadSettingsPanel,
  observeSettingsReacquisition,
} from './settings-reload-boundary.mjs';

test('reload failure keeps the first click boundary and only safe pointer fields', () => {
  const error = new Error('private browser content must not reach evidence');
  error.driverFailure = {
    code: 'pointer_target_not_unique',
    sampleStage: 'visibility_filter',
    matchedTargetCount: 2,
    visibleMatchCount: 0,
    hitTarget: false,
    selectedPointAvailable: false,
    rawHtml: 'private browser content',
  };
  assert.deepEqual(classifyReloadSettingsFailure(error, 'before_click'), {
    step: 'before_click',
    category: 'pointer_target_not_unique',
    pointer: {
      sampleStage: 'visibility_filter',
      matchedTargetCount: 2,
      visibleMatchCount: 0,
      hitTarget: false,
      selectedPointAvailable: false,
    },
  });
});

test('reload failure distinguishes a missing guest state from a closed panel', () => {
  assert.deepEqual(
    classifyReloadSettingsFailure(
      new Error('guest_settings_not_observed:{"guest":false}'),
      'guest_wait_started',
    ),
    { step: 'guest_wait_started', category: 'guest_state_not_observed', pointer: null },
  );
  assert.deepEqual(classifyReloadSettingsFailure(new Error('Target closed'), 'before_click'), {
    step: 'before_click',
    category: 'panel_transport_closed',
    pointer: null,
  });
  assert.deepEqual(
    classifyReloadSettingsFailure(new Error('private browser content'), 'unexpected'),
    { step: 'unknown', category: 'other', pointer: null },
  );
});

test('producer-wrapped CDP closure remains transport failure after guest wait', async () => {
  let produced;
  try {
    await waitFor(
      'guest_settings',
      async () => {
        throw new Error('Target closed while reading private browser content');
      },
      () => false,
      1,
    );
  } catch (error) {
    produced = error;
  }
  assert.equal(produced?.message.startsWith('guest_settings_not_observed:'), true);
  const classified = classifyReloadSettingsFailure(produced, 'guest_wait_started');
  assert.deepEqual(classified, {
    step: 'guest_wait_started',
    category: 'panel_transport_closed',
    pointer: null,
  });
  assert.equal(JSON.stringify(classified).includes('private browser content'), false);
});

test('replacement-panel probe admits only fixed typed fields into receipt', async () => {
  const valid = {
    runtimeIdMatches: true,
    documentReady: false,
    visible: true,
    settingsTabCount: 1,
    settingsActiveCount: 0,
    guestBannerPresent: false,
    guestOrganizationGuidancePresent: true,
  };
  const panel = (value) => ({ send: async () => ({ result: { value } }) });
  const contaminated = {
    ...valid,
    rawError: 'secret',
    url: 'https://private.test/path',
    body: 'private page body',
    credentials: 'private credential',
  };
  const accepted = await observeReloadSettingsPanel(panel(contaminated), 'owned-extension');
  assert.deepEqual(accepted, { sampled: true, ...valid });
  for (const secret of ['secret', 'private.test', 'private page body', 'private credential'])
    assert.equal(JSON.stringify(accepted).includes(secret), false);
  const opposite = await observeReloadSettingsPanel(
    panel({
      ...valid,
      documentReady: true,
      guestBannerPresent: true,
      guestOrganizationGuidancePresent: false,
    }),
    'owned-extension',
  );
  assert.equal(opposite.documentReady, true);
  assert.equal(opposite.guestBannerPresent, true);
  assert.equal(opposite.guestOrganizationGuidancePresent, false);
  for (const invalid of [
    { ...valid, guestBannerPresent: 'private credential' },
    { ...valid, visible: 'https://private.test/path' },
    { ...valid, settingsTabCount: 'private page body' },
    { ...valid, settingsActiveCount: -1 },
  ]) {
    const result = await observeReloadSettingsPanel(panel(invalid), 'owned-extension');
    assert.deepEqual(result, { sampled: false });
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('failed native Settings panel reload serializes the owned document and context boundary', async () => {
  const extensionId = 'owned-extension';
  const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  const document = {
    URL: panelUrl,
    readyState: 'complete',
    visibilityState: 'visible',
    body: { innerText: "You're using Matrx as a guest." },
    querySelectorAll: (selector) => (selector === '#app' ? [{}] : []),
  };
  const chrome = {
    runtime: {
      id: extensionId,
      getContexts: async () => [{ contextType: 'SIDE_PANEL', documentUrl: panelUrl, tabId: -1 }],
    },
  };
  let reloads = 0;
  const panel = {
    async send(method, params) {
      if (method === 'Target.getTargetInfo')
        return {
          targetInfo: {
            targetId: 'private-target-id',
            type: 'page',
            url: panelUrl,
            title: 'private title',
          },
        };
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { url: panelUrl } } };
      if (method === 'Page.reload') {
        reloads++;
        return {};
      }
      assert.equal(method, 'Runtime.evaluate');
      const value = await runInNewContext(params.expression, { document, chrome });
      return { result: { value } };
    },
  };
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const settingsStart = source.indexOf('async function settings(panel, onStep = () => {}) {');
  const reloadStart = source.indexOf('\nasync function reloadSettings(panel) {', settingsStart);
  const reloadEnd = source.indexOf('\nasync function guestSections(', reloadStart);
  const runCaseStart = source.indexOf('async function runCase(c, fn) {');
  const runCaseEnd = source.indexOf('\nlet observedPort;', runCaseStart);
  assert.ok(settingsStart >= 0 && reloadStart > settingsStart && reloadEnd > reloadStart);
  assert.ok(runCaseStart >= 0 && runCaseEnd > runCaseStart);
  const originalRunCase = source.slice(runCaseStart, runCaseEnd);
  const runCaseSource =
    process.env.SETTINGS_NEGATIVE_CONTROL_DROP_REACQUIRE === '1'
      ? originalRunCase.replace(
          'if (error?.reacquireDiagnostic) c.reacquireDiagnostic = error.reacquireDiagnostic;',
          '',
        )
      : originalRunCase;
  const { reloadSettings, runCase } = new Function(
    'waitForReplacementSettingsTab',
    'click',
    'waitFor',
    'evaluate',
    'observeSettingsReacquisition',
    'EXTENSION_ID',
    'criterion',
    `${source.slice(settingsStart, reloadEnd)}\n${runCaseSource}\nreturn { reloadSettings, runCase };`,
  )(
    (ownedPanel) => waitForReplacementSettingsTab(ownedPanel, 120),
    () => {
      throw new Error('readiness must prevent click');
    },
    waitFor,
    evaluate,
    observeSettingsReacquisition,
    extensionId,
    (c, name, status, evidence) => c.criteria.push({ name, status, evidence }),
  );
  const c = { criteria: [] };
  await runCase(c, () => reloadSettings(panel));
  const receipt = JSON.parse(JSON.stringify(c));
  assert.equal(reloads, 1);
  assert.equal(receipt.status, 'fail');
  assert.match(receipt.error, /replacement_settings_tab_ready_not_observed/);
  assert.deepEqual(receipt.reacquireDiagnostic, {
    beforeTargetObserved: true,
    target: { sampled: true, sameAsBefore: true, expectedPanelUrl: true, typePage: true },
    frame: { sampled: true, expectedPanelUrl: true, navigationError: false },
    renderer: {
      sampled: true,
      expectedPanelUrl: true,
      readyState: 'complete',
      visible: true,
      runtimeIdMatches: true,
      rootCount: 1,
      settingsTabCount: 0,
      contextQueryAvailable: true,
      contextQueryFailed: false,
      exactSidePanelContextCount: 1,
    },
  });
  for (const secret of ['private-target-id', 'private title', panelUrl])
    assert.equal(JSON.stringify(receipt).includes(secret), false);

  const wrongUrl = 'https://private.example/account?token=private-token';
  const wrongPanel = {
    async send(method, params) {
      if (method === 'Target.getTargetInfo')
        return { targetInfo: { targetId: 'other-private-id', type: 'page', url: wrongUrl } };
      if (method === 'Page.getFrameTree')
        return { frameTree: { frame: { url: wrongUrl, unreachableUrl: wrongUrl } } };
      assert.equal(method, 'Runtime.evaluate');
      const value = await runInNewContext(params.expression, {
        document: { ...document, URL: wrongUrl, querySelectorAll: () => [] },
        chrome: {
          runtime: { ...chrome.runtime, id: 'other-extension', getContexts: async () => [] },
        },
      });
      return { result: { value } };
    },
  };
  const mismatch = await observeSettingsReacquisition(wrongPanel, extensionId, 'private-target-id');
  assert.equal(mismatch.target.sameAsBefore, false);
  assert.equal(mismatch.target.expectedPanelUrl, false);
  assert.equal(mismatch.frame.expectedPanelUrl, false);
  assert.equal(mismatch.frame.navigationError, true);
  assert.equal(mismatch.renderer.expectedPanelUrl, false);
  assert.equal(mismatch.renderer.runtimeIdMatches, false);
  assert.equal(mismatch.renderer.rootCount, 0);
  assert.equal(mismatch.renderer.exactSidePanelContextCount, 0);
  assert.equal(JSON.stringify(mismatch).includes(wrongUrl), false);
});
