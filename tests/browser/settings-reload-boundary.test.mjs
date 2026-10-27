import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { publishAtomicJsonReport } from './atomic-json-report.mjs';
import { captureFailure } from './profile-reload-capture.mjs';
import { NATIVE_STAGES } from './scrape-save-auth-report.mjs';
import * as fullRechecks from './settings-full-extension-rechecks.mjs';
import {
  GUEST_PREFERENCES,
  preferenceBaseline,
  restoreGuestPreferenceBaseline,
} from './settings-guest-preference-batch.mjs';
import {
  evaluate,
  settingsActionSummary,
  tabTitlePredicateExpression,
  waitFor,
  waitForReplacementSettingsTab,
} from './settings-panel-driver.mjs';
import {
  classifyReloadSettingsFailure,
  observeReloadSettingsPanel,
  observeSettingsReacquisition,
} from './settings-reload-boundary.mjs';

async function sharedGuestOpeningSource() {
  const source = await readFile(new URL('./settings-panel-driver.mjs', import.meta.url), 'utf8');
  const start = source.indexOf(
    'export async function openGuestSettings(panel, onStep = () => {}) {',
  );
  const end = source.indexOf('\nexport async function openSection(', start);
  assert.ok(start >= 0 && end > start, 'actual shared guest Settings opening must be present');
  return source.slice(start, end).replace('export async function', 'async function');
}

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

for (const scenario of [
  { name: 'current guest DOM', readyState: 'complete', guest: true, passes: true },
  { name: 'loading document', readyState: 'loading', guest: true, passes: false },
  { name: 'missing guest state', readyState: 'complete', guest: false, passes: false },
  { name: 'missing Settings tab', readyState: 'complete', guest: true, tabCount: 0, passes: false },
  {
    name: 'duplicate Settings tabs',
    readyState: 'complete',
    guest: true,
    tabCount: 2,
    passes: false,
  },
])
  test(`native Settings reload readiness: ${scenario.name}`, async () => {
    const source = await readFile(
      new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
      'utf8',
    );
    const start = source.indexOf('async function settings(panel, onStep = () => {}) {');
    const end = source.indexOf('\nasync function deepClean(', start);
    assert.ok(start >= 0 && end > start);
    const commands = [];
    const settingsTab = {
      getBoundingClientRect: () => ({ width: 28, height: 28 }),
      closest: () => null,
      getAttribute: (name) => (name === 'title' ? 'Settings' : null),
    };
    const document = {
      readyState: scenario.readyState,
      body: { innerText: scenario.guest ? 'Organization\nSign in to choose' : 'Organization' },
      querySelectorAll: (selector) =>
        selector === 'button[role="tab"]' || selector === 'button[role="tab"][data-state="active"]'
          ? Array(scenario.tabCount ?? 1).fill(settingsTab)
          : [],
    };
    const panel = {
      async send(method, params) {
        commands.push(method);
        if (method === 'Page.reload') return {};
        if (method === 'Target.getTargetInfo') throw new Error('diagnostic lookup unavailable');
        assert.equal(method, 'Runtime.evaluate');
        const value = await runInNewContext(params.expression, {
          document,
          getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
        });
        return { result: { value } };
      },
    };
    let trustedClicks = 0;
    let diagnosticCalls = 0;
    const opening = `${await sharedGuestOpeningSource()}\n${source.slice(start, end)}`;
    const subject =
      process.env.SETTINGS_NEGATIVE_CONTROL_PREFLIGHT === '1'
        ? opening.replace(
            'async function reloadSettings(panel) {',
            "async function reloadSettings(panel) { await panel.send('Target.getTargetInfo');",
          )
        : opening;
    const reloadSettings = new Function(
      'waitForReplacementSettingsTab',
      'click',
      'waitFor',
      'evaluate',
      'tabTitlePredicateExpression',
      'observeSettingsReacquisition',
      'EXTENSION_ID',
      `${subject}\nreturn reloadSettings;`,
    )(
      (ownedPanel) => waitForReplacementSettingsTab(ownedPanel, 120),
      async () => {
        trustedClicks++;
      },
      (name, read, accept) => waitFor(name, read, accept, 120),
      evaluate,
      tabTitlePredicateExpression,
      async () => {
        diagnosticCalls++;
      },
      'owned-extension',
    );
    const failure = await reloadSettings(panel).then(
      () => null,
      (error) => error.message,
    );
    if (scenario.tabCount !== undefined) {
      assert.match(
        failure,
        /replacement_settings_tab_ready_not_observed/,
        'missing or duplicate Settings tabs must refuse reload before click',
      );
      assert.equal(trustedClicks, 0);
      return;
    }
    if (!scenario.passes) {
      assert.match(
        failure,
        scenario.readyState === 'loading'
          ? /panel_document_after_reload_not_observed/
          : /guest_settings_not_observed/,
      );
      assert.equal(trustedClicks, scenario.readyState === 'loading' ? 0 : 1);
      return;
    }
    assert.equal(failure, null, 'current guest DOM must finish native Settings reload readiness');
    assert.equal(commands[0], 'Page.reload');
    assert.equal(
      commands.every((method) => ['Page.reload', 'Runtime.evaluate'].includes(method)),
      true,
    );
    assert.equal(trustedClicks, 1);
    assert.equal(diagnosticCalls, 0);
  });

test('failed native Settings panel reload serializes the owned document and context boundary', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'settings-case-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const extensionId = 'owned-extension';
  const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  const document = {
    URL: panelUrl,
    readyState: 'complete',
    visibilityState: 'visible',
    body: { innerText: 'Organization\nSign in to choose' },
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
  const reloadEnd = source.indexOf('\nasync function deepClean(', reloadStart);
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
    'publishAtomicJsonReport',
    'NATIVE_STAGES',
    'OUTPUT',
    'CASE_IDS',
    'report',
    `${await sharedGuestOpeningSource()}\n${source.slice(settingsStart, reloadEnd)}\n${source.slice(source.indexOf('let publicationFailure;'), runCaseStart)}\n${runCaseSource}\nreturn { reloadSettings, runCase };`,
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
    publishAtomicJsonReport,
    NATIVE_STAGES,
    join(dir, 'report.json'),
    ['EXT-F-1003-T04'],
    { cases: [] },
  );
  const c = { id: 'EXT-F-1003-T04', criteria: [] };
  await runCase(c, () => reloadSettings(panel));
  const receipt = JSON.parse(JSON.stringify(c));
  assert.equal(reloads, 1);
  assert.equal(receipt.status, 'fail');
  assert.match(receipt.error, /replacement_settings_tab_ready_not_observed/);
  assert.deepEqual(receipt.reacquireDiagnostic, {
    beforeTargetObserved: false,
    target: { sampled: true, sameAsBefore: null, expectedPanelUrl: true, typePage: true },
    frame: { sampled: true, expectedPanelUrl: true, navigationError: false },
    renderer: {
      sampled: true,
      expectedPanelUrl: true,
      readyState: 'complete',
      visible: true,
      runtimeIdMatches: true,
      rootCount: 1,
      rootChildElementCount: 0,
      reactRootAttached: false,
      hydrationStateObservable: false,
      tabTriggerCount: 0,
      activePaneCount: 0,
      loadingIndicatorCount: 0,
      renderErrorPresent: false,
      serviceWorkerContextCount: 0,
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
  const mismatch = await observeSettingsReacquisition(wrongPanel, extensionId);
  assert.equal(mismatch.target.sameAsBefore, null);
  assert.equal(mismatch.target.expectedPanelUrl, false);
  assert.equal(mismatch.frame.expectedPanelUrl, false);
  assert.equal(mismatch.frame.navigationError, true);
  assert.equal(mismatch.renderer.expectedPanelUrl, false);
  assert.equal(mismatch.renderer.runtimeIdMatches, false);
  assert.equal(mismatch.renderer.rootCount, 0);
  assert.equal(mismatch.renderer.exactSidePanelContextCount, 0);
  assert.equal(JSON.stringify(mismatch).includes(wrongUrl), false);
});

test('actual Settings guest catch persists safe extension reload failure evidence', async () => {
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf(
    '      } catch (error) {\n        if (publicationFailure) throw publicationFailure;\n        report.guestStageFailed = guestStage;',
  );
  const end = source.indexOf("      criterion(\n        byId('T63')", start);
  assert.ok(start >= 0 && end > start);
  const actualCatch = source.slice(start, end);
  const runCatch = new Function(
    'injected',
    'report',
    'guestStage',
    'byId',
    'criterion',
    'captureFailure',
    'transportFailureClass',
    'publicationFailure',
    'safeUnexpectedError',
    'guestCaptureStage = "not_started"',
    `try { throw injected;\n${actualCatch}\nreturn report;`,
  );
  const error = new Error(
    'native_extension_replacement_panel_unverified: private browser response',
  );
  const publicationError = new Error('checkpoint publication failed');
  assert.throws(
    () =>
      runCatch(
        new Error('guest failure'),
        {},
        'extension_reload',
        undefined,
        undefined,
        undefined,
        undefined,
        publicationError,
      ),
    (error) => error === publicationError,
  );
  error.lifecycleEvidence = {
    old_worker_absent: true,
    observed_worker_count: 1,
    secret: 'private browser response',
  };
  error.contextBoundary = {
    first: { side_panel_count: 0, exact_expected_count: 0 },
    last: { side_panel_count: 0, exact_expected_count: 0 },
    attempts: 2,
    exact_expected_appeared: false,
    secret: 'private context URL',
  };
  const report = {
    cases: ['T63', 'T73', 'T76', 'T92'].map((suffix) => ({
      suffix,
      status: 'unverified',
      steps: [],
      criteria: [],
    })),
  };
  const saved = JSON.parse(
    JSON.stringify(
      runCatch(
        error,
        report,
        'extension_reload',
        (suffix) => report.cases.find((item) => item.suffix === suffix),
        (item, name, status, evidence) => item.criteria.push({ name, status, evidence }),
        captureFailure,
        () => 'socket_error',
        undefined,
        fullRechecks.safeUnexpectedError,
      ),
    ),
  );
  assert.equal(saved.guestStageFailed, 'extension_reload');
  assert.equal(
    saved.guestExtensionReloadFailure.failure_code,
    'native_extension_replacement_panel_unverified',
  );
  assert.equal(saved.guestExtensionReloadFailure.transport_failure_class, 'socket_error');
  assert.equal(saved.guestExtensionReloadFailure.retirement_evidence.old_worker_absent, true);
  assert.equal(saved.guestExtensionReloadFailure.context_boundary.attempts, 2);
  assert.equal(
    saved.cases.every(
      (item) => item.status === 'unverified' && item.criteria[0]?.status === 'unverified',
    ),
    true,
  );
  assert.doesNotMatch(JSON.stringify(saved), /private browser response|private context URL/);
  const other = new Error('private unrelated error');
  other.contextBoundary = {
    attempts: 5,
    exact_expected_appeared: true,
    secret: 'another private URL',
  };
  const secondReport = {
    cases: ['T63', 'T73', 'T76', 'T92'].map((suffix) => ({
      suffix,
      status: 'unverified',
      steps: [],
      criteria: [],
    })),
  };
  const second = JSON.parse(
    JSON.stringify(
      runCatch(
        other,
        secondReport,
        'reload_settings',
        (suffix) => secondReport.cases.find((item) => item.suffix === suffix),
        (item, name, status, evidence) => item.criteria.push({ name, status, evidence }),
        captureFailure,
        () => 'private transport class',
        undefined,
        fullRechecks.safeUnexpectedError,
      ),
    ),
  );
  assert.equal(second.guestExtensionReloadFailure.failure_code, 'unclassified');
  assert.equal(second.guestExtensionReloadFailure.transport_failure_class, 'other');
  assert.equal(second.guestExtensionReloadFailure.context_boundary.attempts, 5);
  assert.equal(second.guestExtensionReloadFailure.retirement_evidence, null);
  assert.doesNotMatch(
    JSON.stringify(second),
    /private unrelated error|private transport class|another private URL/,
  );
});

test('reacquisition diagnostic bounds populated render and worker observations without leaking content', async () => {
  const selectors = {
    '#app': Array(125).fill({
      childElementCount: 250,
      __reactContainer$private: { secret: 'private-value' },
    }),
    'button[role="tab"]': [
      ...Array(130).fill({ getAttribute: (name) => (name === 'title' ? 'Settings' : null) }),
      ...Array(10).fill({ getAttribute: () => null }),
    ],
    '[role="tabpanel"][data-state="active"]': [{}],
    '#app .animate-spin, #app .animate-pulse': [{}, {}],
    '#app p': [
      { textContent: 'private account and error details' },
      { textContent: 'The panel hit a render error' },
    ],
  };
  const contextQueries = [];
  const panel = {
    async send(method, params) {
      if (method !== 'Runtime.evaluate') throw new Error('private transport failure');
      return {
        result: {
          value: await runInNewContext(params.expression, {
            document: {
              URL: 'chrome-extension://owned/sidepanel.html',
              readyState: 'complete',
              visibilityState: 'visible',
              querySelectorAll: (selector) => selectors[selector] ?? [],
            },
            chrome: {
              runtime: {
                id: 'owned',
                getContexts: async (query) => {
                  contextQueries.push(JSON.parse(JSON.stringify(query)));
                  return [
                    { contextType: 'BACKGROUND', contextId: 'private-context-id' },
                    ...Array(135).fill({
                      contextType: 'SIDE_PANEL',
                      documentUrl: 'chrome-extension://owned/sidepanel.html',
                      tabId: -1,
                    }),
                  ];
                },
              },
            },
          }),
        },
      };
    },
  };
  const result = await observeSettingsReacquisition(panel, 'owned');
  assert.deepEqual(contextQueries, [{ contextTypes: ['SIDE_PANEL', 'BACKGROUND'] }]);
  const renderer = result.renderer;
  assert.equal(renderer.rootCount, 100);
  assert.equal(renderer.settingsTabCount, 100);
  assert.equal(renderer.exactSidePanelContextCount, 100);
  assert.equal(renderer.rootChildElementCount, 100);
  assert.equal(renderer.tabTriggerCount, 100);
  assert.equal(renderer.reactRootAttached, true);
  assert.equal(renderer.activePaneCount, 1);
  assert.equal(renderer.loadingIndicatorCount, 2);
  assert.equal(renderer.renderErrorPresent, true);
  assert.equal(renderer.serviceWorkerContextCount, 1);
  assert.equal(renderer.hydrationStateObservable, false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('reacquisition reports unavailable worker observation separately from zero contexts', async () => {
  for (const available of [true, false]) {
    const panel = {
      async send(method, params) {
        if (method !== 'Runtime.evaluate') throw new Error('unavailable');
        return {
          result: {
            value: await runInNewContext(params.expression, {
              document: {
                URL: '',
                readyState: 'complete',
                visibilityState: 'hidden',
                querySelectorAll: () => [],
              },
              chrome: {
                runtime: available
                  ? {
                      getContexts: async () => {
                        throw new Error('private');
                      },
                    }
                  : {},
              },
            }),
          },
        };
      },
    };
    const { renderer } = await observeSettingsReacquisition(panel, 'owned');
    assert.equal(renderer.sampled, true);
    assert.equal(renderer.contextQueryAvailable, available);
    assert.equal(renderer.contextQueryFailed, available);
    assert.equal(renderer.serviceWorkerContextCount, null);
    assert.equal(renderer.reactRootAttached, false);
  }
});

// Current Settings observations must agree on the native and tooltip-lifted tab.
for (const lifted of [false, true]) {
  test(`Settings active pane and reload observation use ${lifted ? 'lifted' : 'native'} label`, async () => {
    const window = new Window();
    try {
      window.document.body.innerHTML = `<div id="app">
        <button role="tab" ${lifted ? 'data-matrx-title' : 'title'}="Settings"
          data-state="active" aria-controls="settings-pane"></button>
        <div id="settings-pane" role="tabpanel" data-state="active">
          <button>Save preference</button>
        </div></div>`;
      const panel = {
        async send(method, { expression }) {
          assert.equal(method, 'Runtime.evaluate');
          return { result: { value: await window.eval(expression) } };
        },
      };
      window.chrome = { runtime: { id: 'owned-extension' } };
      const action = await settingsActionSummary(panel, 'Save preference');
      assert.deepEqual(
        [action.settingsActive, action.matchedCount, action.visibleCount],
        [true, 1, 0],
      );
      const observed = await observeReloadSettingsPanel(panel, 'owned-extension');
      assert.equal(observed.sampled, true);
      assert.deepEqual([observed.settingsTabCount, observed.settingsActiveCount], [1, 1]);
      const tab = window.document.querySelector('button[role="tab"]');
      const pane = window.document.getElementById('settings-pane');
      pane.setAttribute('data-state', 'inactive');
      assert.equal((await settingsActionSummary(panel, 'Save preference')).settingsActive, false);
      pane.setAttribute('data-state', 'active');
      const duplicate = tab.cloneNode();
      window.document.getElementById('app').append(duplicate);
      assert.equal((await settingsActionSummary(panel, 'Save preference')).settingsActive, false);
      const duplicateSample = await observeReloadSettingsPanel(panel, 'owned-extension');
      assert.deepEqual(
        [duplicateSample.settingsTabCount, duplicateSample.settingsActiveCount],
        [2, 2],
      );
      duplicate.remove();
      tab.setAttribute('aria-controls', 'wrong-pane');
      assert.equal((await settingsActionSummary(panel, 'Save preference')).settingsActive, false);
      tab.setAttribute('aria-controls', 'settings-pane');
      tab.setAttribute('title', 'Tools');
      tab.setAttribute('data-matrx-title', 'Settings');
      assert.equal((await settingsActionSummary(panel, 'Save preference')).settingsActive, false);
    } finally {
      await window.happyDOM.abort();
    }
  });
}

// Removing the actual ordinary warm catch projection must lose these diagnostics.
async function runWarmSettingsScenario(scenario, mutation = null) {
  let source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  if (mutation === 'drop_catch')
    source = source.replace('        report.guestFailure = safeUnexpectedError(error);', '');
  const start = source.indexOf("      let guestStage = 'warm_observation';");
  const end = source.indexOf("      criterion(\n        byId('T63')", start);
  assert.ok(start > 0 && end > start);
  const observed = {
    activeSettings: true,
    count: 1,
    selected: 'Act without asking',
    shadowFootprint: {
      status: 'observed',
      stores: ['settings', 'chat', 'pilot'].map((store) => ({
        store,
        storagePresent: false,
        fieldPresent: false,
        parseStatus: 'absent',
        mode: null,
        fingerprint: null,
        count: null,
      })),
    },
  };
  const mode = GUEST_PREFERENCES.find((p) => p.caseId === 'T10');
  const theme = GUEST_PREFERENCES.find((p) => p.caseId === 'T04');
  const baseline = preferenceBaseline(observed, mode);
  const immutable = JSON.stringify(baseline);
  const report = {
    cases: ['T04', 'T10', 'T28', 'T40', 'T67', 'T63', 'T73', 'T76', 'T92'].map((id) => ({
      id: `EXT-F-1003-${id}`,
      steps: [],
      criteria: [],
    })),
  };
  const calls = [];
  const canary = 'CANARY_private_token_storage_identity';
  const failure = new TypeError(canary);
  failure.code = 'EPIPE';
  failure.stack = `TypeError: ${canary}\n at observe (/private/tests/browser/settings-guest-preference-batch.mjs:812:7)`;
  const unknown = Object.assign(new Error(canary), { name: canary, code: canary, stack: canary });
  const deps = {
    report,
    publicationFailure: undefined,
    checkpoint: (...args) => calls.push(args.join(':')),
    observeGuestIdentityAndOrganization: async () => {
      calls.push('identity');
      return {};
    },
    recordGuestPhase: () => calls.push('record_phase'),
    recordGuestAdvancedDenial: async () => calls.push('record_denial'),
    caseEntryBaselines: {
      T10: baseline,
      ...(scenario === 'restore' ? { T04: { value: 'system' } } : {}),
    },
    captureGuestPreferenceBaselines: fullRechecks.captureGuestPreferenceBaselines,
    restoreGuestPreferenceBaseline: (...args) =>
      restoreGuestPreferenceBaseline(...args, {
        openSection: async () => {
          throw failure;
        },
      }),
    criterion: (c, name, status, evidence) => c.criteria.push({ name, status, evidence }),
    byId: (suffix) => report.cases.find((c) => c.id.endsWith(suffix)),
    panel: {},
    GUEST_PREFERENCES: [mode, ...(scenario === 'restore' ? [theme] : [])],
    settings: async () => calls.push('settings'),
    openSection: async () => calls.push('open_section'),
    observeGuestPreference: async () => {
      calls.push('observe');
      if (scenario === 'observer') throw failure;
      if (scenario === 'getter')
        throw Object.defineProperty({}, 'name', {
          get() {
            throw failure;
          },
        });
      if (scenario === 'primitive') throw 'CANARY_private_primitive';
      if (scenario === 'frozen') throw Object.freeze(failure);
      if (scenario === 'unknown') throw unknown;
      return scenario === 'mismatch' ? { ...observed, selected: 'Ask before acting' } : observed;
    },
    preferenceBaseline: () => {
      throw new Error('immutable baseline must not be recaptured');
    },
    reloadExtension: async () => {
      calls.push('reload');
      throw failure;
    },
    captureFailure,
    transportFailureClass: () => 'socket_error',
    safeUnexpectedError:
      mutation === 'constant_projector'
        ? () => ({
            name: 'TypeError',
            code: 'EPIPE',
            source: { file: 'settings-guest-preference-batch.mjs', line: 812, column: 7 },
          })
        : fullRechecks.safeUnexpectedError,
  };
  await new Function(...Object.keys(deps), `return (async () => {${source.slice(start, end)}})();`)(
    ...Object.values(deps),
  );
  assert.deepEqual(calls.slice(0, 3), [
    'guest_phase:warm_observation_start',
    'identity',
    'guest_phase:warm_observation_end',
  ]);
  assert.ok(calls.includes('record_denial'));
  assert.equal(JSON.stringify(baseline), immutable);
  assert.equal(calls.includes('reload'), scenario === 'unchanged');
  assert.equal(
    report.guestStageFailed,
    scenario === 'unchanged' ? 'extension_reload' : 'warm_observation',
  );
  const diagnostic = report.guestFailure;
  assert.ok(diagnostic, 'ordinary warm errors must survive the actual catch');
  assert.equal(
    diagnostic.code,
    scenario === 'mismatch'
      ? 'T10_shadow_baseline_mismatch_before_capture'
      : scenario === 'getter'
        ? 'diagnostic_unavailable'
        : ['unknown', 'primitive'].includes(scenario)
          ? 'other'
          : 'EPIPE',
  );
  assert.equal(
    diagnostic.name,
    scenario === 'mismatch'
      ? 'Error'
      : ['unknown', 'primitive', 'getter'].includes(scenario)
        ? 'OtherError'
        : 'TypeError',
  );
  assert.equal(
    report.guestCaptureStageFailed,
    scenario === 'mismatch'
      ? 'initial_mode_compare'
      : scenario === 'restore'
        ? 'restore_preference'
        : scenario === 'unchanged'
          ? 'final_mode_compare'
          : 'initial_mode_observe',
  );
  if (scenario === 'observer')
    assert.deepEqual(diagnostic.source, {
      file: 'settings-guest-preference-batch.mjs',
      line: 812,
      column: 7,
    });
  if (scenario === 'restore') assert.equal(diagnostic.baselineRestoration.stage, 'open_section');
  assert.doesNotMatch(JSON.stringify(report), /CANARY|private_token|\/private/);
  fullRechecks.enforceFullExtensionRechecks(report.cases);
  assert.equal(report.cases.find((c) => c.id.endsWith('T10')).criteria.at(-1).status, 'fail');
  assert.ok(report.guestFailure, 'downstream missing checks must preserve first diagnostic');
}

for (const scenario of [
  'mismatch',
  'observer',
  'restore',
  'unknown',
  'unchanged',
  'getter',
  'primitive',
  'frozen',
])
  test(`actual warm Settings baseline boundary retains ${scenario} safely`, () =>
    runWarmSettingsScenario(scenario));
test('Settings actual warm oracle kills erased catch and constant diagnostic guts in memory', async () => {
  await assert.rejects(
    () => runWarmSettingsScenario('observer', 'drop_catch'),
    /ordinary warm errors must survive/,
  );
  await assert.rejects(
    () => runWarmSettingsScenario('unknown', 'constant_projector'),
    (error) => error.code === 'ERR_ASSERTION',
  );
});

test('baseline capture diagnostic callbacks cannot replace comparison failure or block reload readiness', async () => {
  const mode = GUEST_PREFERENCES.find((item) => item.caseId === 'T10');
  const observed = {
    activeSettings: true,
    count: 1,
    selected: 'Act without asking',
    shadowFootprint: {
      status: 'observed',
      stores: ['settings', 'chat', 'pilot'].map((store) => ({
        store,
        storagePresent: false,
        fieldPresent: false,
        parseStatus: 'absent',
        mode: null,
        fingerprint: null,
        count: null,
      })),
    },
  };
  const baseline = preferenceBaseline(observed, mode);
  for (const asynchronous of [false, true]) {
    const calls = [];
    const injected = new Error('CANARY_diagnostic_callback');
    const args = {
      panel: {},
      preferences: [mode],
      caseEntryBaselines: { T10: baseline },
      settings: async () => calls.push('settings'),
      openSection: async () => calls.push('open'),
      observePreference: async () => {
        calls.push('observe');
        return observed;
      },
      onStage: () => {
        if (asynchronous) return Promise.reject(injected);
        throw injected;
      },
    };
    const restored = await fullRechecks.captureGuestPreferenceBaselines(args);
    assert.equal(restored.T10, baseline);
    assert.deepEqual(calls, ['settings', 'open', 'observe', 'open', 'observe']);
    await assert.rejects(
      () =>
        fullRechecks.captureGuestPreferenceBaselines({
          ...args,
          observePreference: async () => ({ ...observed, selected: 'Ask before acting' }),
        }),
      (error) =>
        error !== injected && error.message === 'T10_shadow_baseline_mismatch_before_capture',
    );
  }
});
