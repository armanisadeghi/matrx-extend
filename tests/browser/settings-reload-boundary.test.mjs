import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
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
import {
  settingsFixtureIntegrityFailure,
  withExactSettingsFixture,
} from './settings-scrape-mode-baseline.mjs';
import { finalizeSettingsSenderDocumentDiagnostic } from './settings-sender-document-diagnostic.mjs';

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
    const end = source.indexOf('\nasync function port(', start);
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
    let origin = 100;
    const panel = {
      async send(method, params) {
        commands.push(method);
        if (method === 'Page.reload') {
          origin = 200;
          return {};
        }
        if (method === 'Target.getTargetInfo') throw new Error('diagnostic lookup unavailable');
        assert.equal(method, 'Runtime.evaluate');
        const value = await runInNewContext(params.expression, {
          document,
          performance: { timeOrigin: origin },
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
      'assert',
      'waitForReplacementSettingsTab',
      'click',
      'waitFor',
      'evaluate',
      'tabTitlePredicateExpression',
      'observeSettingsReacquisition',
      'EXTENSION_ID',
      `${subject}\nreturn reloadSettings;`,
    )(
      assert,
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
    assert.deepEqual(commands.slice(0, 2), ['Runtime.evaluate', 'Page.reload']);
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
      const value = await runInNewContext(params.expression, {
        document,
        chrome,
        performance: { timeOrigin: 100 + reloads },
      });
      return { result: { value } };
    },
  };
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const settingsStart = source.indexOf('async function settings(panel, onStep = () => {}) {');
  const reloadStart = source.indexOf('\nasync function reloadSettings(panel) {', settingsStart);
  const reloadEnd = source.indexOf('\nasync function port(', reloadStart);
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
    'settingsFixtureIntegrityFailure',
    'assert',
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
    settingsFixtureIntegrityFailure,
    assert,
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
    '        } catch (error) {\n          if (publicationFailure) throw publicationFailure;\n          const fixtureFailure = settingsFixtureIntegrityFailure(error);\n          report.guestStageFailed = guestStage;',
  );
  const end = source.indexOf("        criterion(\n          byId('T63')", start);
  assert.ok(start >= 0 && end > start);
  const actualCatch = source.slice(start, end);
  const runCatch = new Function(
    'settingsFixtureIntegrityFailure',
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
        settingsFixtureIntegrityFailure,
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
        settingsFixtureIntegrityFailure,
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
        settingsFixtureIntegrityFailure,
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
  const start = source.indexOf("        let guestStage = 'warm_observation';");
  const end = source.indexOf("        criterion(\n          byId('T63')", start);
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
  let sampleCount = 0;
  const canary = 'CANARY_private_token_storage_identity';
  const failure = new TypeError(canary);
  failure.code = 'EPIPE';
  failure.stack = `TypeError: ${canary}\n at observe (/private/tests/browser/settings-guest-preference-batch.mjs:812:7)`;
  const markedFixtureFailure = scenario === 'fixture' ? await fixturePrimaryFailure() : null;
  const unknown = Object.assign(new Error(canary), { name: canary, code: canary, stack: canary });
  const deps = {
    settingsFixtureIntegrityFailure,
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
      sampleCount += 1;
      if (scenario === 'fixture') throw markedFixtureFailure;
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
      if (scenario === 'mismatch') return { ...observed, selected: 'Ask before acting' };
      if (scenario === 'store' || (scenario === 'final_store' && sampleCount === 2)) {
        const stores = observed.shadowFootprint.stores.map((entry) => ({ ...entry }));
        stores[0].storagePresent = true;
        stores[0].parseStatus = 'valid';
        stores[0].fieldPresent = true;
        stores[0].mode = 'ask';
        return { ...observed, shadowFootprint: { status: 'observed', stores } };
      }
      if (scenario === 'residual')
        return { ...observed, shadowFootprint: { ...observed.shadowFootprint, CANARY: canary } };
      return observed;
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
      mutation === 'constant_receipt'
        ? (error) => {
            const value = fullRechecks.safeUnexpectedError(error);
            if (value.modeComparison) value.modeComparison.firstFalse = 'selection';
            return value;
          }
        : mutation === 'constant_projector'
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
  if (scenario === 'mismatch') {
    assert.equal(diagnostic.modeComparison.firstFalse, 'selection');
    assert.equal(diagnostic.modeComparison.serialization, 'equal');
  }
  if (['store', 'final_store', 'residual'].includes(scenario)) {
    assert.equal(diagnostic.modeComparison.firstFalse, 'permissionComparison');
    assert.equal(diagnostic.modeComparison.serialization, 'unequal');
    assert.equal(diagnostic.modeComparison.residual, scenario === 'residual');
    assert.equal(diagnostic.modeComparison.stage, scenario === 'final_store' ? 'final' : 'initial');
    assert.equal(
      diagnostic.modeComparison.stores[0].storagePresent,
      scenario === 'residual' ? 'equal' : 'unequal',
    );
  }
  assert.equal(
    diagnostic.code,
    ['mismatch', 'store', 'final_store', 'residual'].includes(scenario)
      ? 'T10_shadow_baseline_mismatch_before_capture'
      : scenario === 'getter'
        ? 'diagnostic_unavailable'
        : ['unknown', 'primitive'].includes(scenario)
          ? 'other'
          : 'EPIPE',
  );
  assert.equal(
    diagnostic.name,
    ['mismatch', 'store', 'final_store', 'residual'].includes(scenario)
      ? 'Error'
      : ['unknown', 'primitive', 'getter'].includes(scenario)
        ? 'OtherError'
        : 'TypeError',
  );
  assert.equal(
    report.guestCaptureStageFailed,
    ['mismatch', 'store', 'residual'].includes(scenario)
      ? 'initial_mode_compare'
      : scenario === 'final_store'
        ? 'final_mode_compare'
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
  'store',
  'final_store',
  'residual',
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
    () => runWarmSettingsScenario('store', 'constant_receipt'),
    (error) => error.code === 'ERR_ASSERTION',
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

test('receipt getter failure preserves the original error projection', () => {
  const error = new Error('T10_shadow_baseline_mismatch_before_capture');
  error.stack =
    'Error: mismatch\n at capture (/private/tests/browser/settings-full-extension-rechecks.mjs:294:13)';
  Object.defineProperty(error, 'safeModeComparison', {
    get() {
      throw new Error('CANARY');
    },
  });
  const result = fullRechecks.safeUnexpectedError(error);
  assert.equal(result.name, 'Error');
  assert.equal(result.code, 'T10_shadow_baseline_mismatch_before_capture');
  assert.equal(result.modeComparison, undefined);
  assert.deepEqual(result.source, {
    file: 'settings-full-extension-rechecks.mjs',
    line: 294,
    column: 13,
  });
  assert.doesNotMatch(JSON.stringify(result), /CANARY/);
});

test('same-sample receipt identifies ordered failures and invalid store structure', async () => {
  const mode = GUEST_PREFERENCES.find((item) => item.caseId === 'T10');
  const footprint = {
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
  };
  const observed = {
    activeSettings: true,
    count: 1,
    selected: 'Act without asking',
    shadowFootprint: footprint,
  };
  const baseline = preferenceBaseline(observed, mode);
  const samples = [
    { sample: { ...observed, activeSettings: false, count: 2 }, first: 'visible' },
    {
      sample: {
        ...observed,
        shadowFootprint: { ...footprint, stores: footprint.stores.slice(0, 2) },
      },
      first: 'observedValid',
    },
    {
      sample: {
        ...observed,
        shadowFootprint: {
          ...footprint,
          stores: [footprint.stores[1], footprint.stores[0], footprint.stores[2]],
        },
      },
      first: 'observedValid',
    },
    {
      sample: {
        ...observed,
        shadowFootprint: {
          ...footprint,
          stores: footprint.stores.map((entry, i) =>
            i === 2 ? { ...entry, parseStatus: 'invalid' } : entry,
          ),
        },
      },
      first: 'observedValid',
    },
  ];
  for (const { sample, first } of samples) {
    let reads = 0;
    await assert.rejects(
      () =>
        fullRechecks.captureGuestPreferenceBaselines({
          panel: {},
          preferences: [mode],
          caseEntryBaselines: { T10: baseline },
          settings: async () => {},
          openSection: async () => {},
          observePreference: async () => {
            reads++;
            return sample;
          },
        }),
      (error) => {
        const receipt = fullRechecks.safeUnexpectedError(error).modeComparison;
        assert.equal(receipt.firstFalse, first);
        assert.equal(error.message, 'T10_shadow_baseline_mismatch_before_capture');
        return true;
      },
    );
    assert.equal(reads, 1);
  }
});

test('projector reads receipt fields once before emitting finite categories', () => {
  const flip = (first) => {
    let n = 0;
    return () => (++n === 1 ? first : 'CANARY_private');
  };
  const entry = Object.defineProperties(
    {},
    {
      identity: { get: flip('valid') },
      storagePresent: { get: flip('equal') },
      observed: {
        get: () =>
          Object.defineProperties(
            {},
            {
              status: { get: flip('valid') },
              storage: { get: flip(true) },
              field: { get: flip(false) },
            },
          ),
      },
    },
  );
  const receipt = Object.defineProperties(
    { predicates: {}, stores: [entry] },
    {
      stage: { get: flip('initial') },
      firstFalse: { get: flip('count') },
      serialization: { get: flip('unequal') },
    },
  );
  const error = Object.defineProperties(new Error('T10_shadow_baseline_mismatch_before_capture'), {
    safeModeComparison: { value: receipt },
    name: { get: flip('Error') },
  });
  const projected = fullRechecks.safeUnexpectedError(error);
  assert.equal(projected.name, 'Error');
  assert.equal(projected.modeComparison.stage, 'initial');
  assert.equal(projected.modeComparison.firstFalse, 'count');
  assert.equal(projected.modeComparison.stores[0].storagePresent, 'equal');
  assert.doesNotMatch(JSON.stringify(projected), /CANARY/);
});

test('comparison reports distinct count, baseline and missing-footprint branches', async () => {
  const mode = GUEST_PREFERENCES.find((item) => item.caseId === 'T10');
  const footprint = {
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
  };
  const sample = {
    activeSettings: true,
    count: 1,
    selected: 'Act without asking',
    shadowFootprint: footprint,
  };
  const original = preferenceBaseline(sample, mode);
  const cases = [
    [{ ...sample, count: 2 }, original, 'count'],
    [sample, { ...original, value: 'ask' }, 'baselineValue'],
    [
      sample,
      {
        ...original,
        observation: { ...sample, shadowFootprint: { ...footprint, status: 'unknown' } },
      },
      'baselineValid',
    ],
    [{ ...sample, shadowFootprint: undefined }, original, 'observedValid'],
    [
      { ...sample, shadowFootprint: { ...footprint, status: 'unknown' } },
      original,
      'observedValid',
    ],
  ];
  for (const [observation, baseline, first] of cases) {
    await assert.rejects(
      () =>
        fullRechecks.captureGuestPreferenceBaselines({
          panel: {},
          preferences: [mode],
          caseEntryBaselines: { T10: baseline },
          settings: async () => {},
          openSection: async () => {},
          observePreference: async () => observation,
        }),
      (error) => {
        const result = fullRechecks.safeUnexpectedError(error);
        assert.equal(result.modeComparison.firstFalse, first);
        assert.equal(
          result.modeComparison.serialization,
          ['observedValid', 'baselineValid'].includes(first) ? 'unavailable' : 'equal',
        );
        assert.equal(result.code, 'T10_shadow_baseline_mismatch_before_capture');
        return true;
      },
    );
  }
});

test('allowlisted code preserves primary metadata without reading a throwing message', () => {
  let messageReads = 0;
  const failure = Object.defineProperties(
    {},
    {
      name: { value: 'TypeError' },
      code: { value: 'EPIPE' },
      stack: {
        value:
          'TypeError: CANARY\n at observe (/private/tests/browser/settings-guest-preference-batch.mjs:812:7)',
      },
      message: {
        get() {
          messageReads++;
          throw new Error('CANARY_private');
        },
      },
    },
  );
  assert.deepEqual(fullRechecks.safeUnexpectedError(failure), {
    name: 'TypeError',
    code: 'EPIPE',
    source: { file: 'settings-guest-preference-batch.mjs', line: 812, column: 7 },
  });
  assert.equal(messageReads, 0);
  let fallbackReads = 0;
  const fallback = Object.defineProperty({ name: 'Error', code: 'unknown' }, 'message', {
    get() {
      fallbackReads++;
      return fallbackReads === 1 ? 'T10_shadow_baseline_mismatch_before_capture' : 'CANARY_private';
    },
  });
  assert.equal(
    fullRechecks.safeUnexpectedError(fallback).code,
    'T10_shadow_baseline_mismatch_before_capture',
  );
  assert.equal(fallbackReads, 1);
});

test('malformed samples retain comparator exceptions or intentionally omit best-effort receipt', async () => {
  const mode = GUEST_PREFERENCES.find((item) => item.caseId === 'T10');
  const theme = GUEST_PREFERENCES.find((item) => item.caseId === 'T04');
  const footprint = {
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
  };
  const sample = {
    activeSettings: true,
    count: 1,
    selected: 'Act without asking',
    shadowFootprint: footprint,
  };
  const baseline = preferenceBaseline(sample, mode);
  const immutable = JSON.stringify(baseline);
  const failure = Object.assign(new TypeError('CANARY_private'), {
    code: 'EPIPE',
    stack:
      'TypeError: CANARY\n at compare (/private/tests/browser/settings-guest-preference-batch.mjs:239:15)',
  });
  const throwingStore = Object.defineProperty({}, 'store', {
    get() {
      throw failure;
    },
  });
  const throwingJson = {
    ...footprint,
    toJSON() {
      throw failure;
    },
  };
  for (const kind of [
    'early_ui_null_store',
    'comparator_null_store',
    'comparator_getter',
    'comparator_serialization',
  ]) {
    const calls = [];
    const observation = {
      ...sample,
      shadowFootprint:
        kind === 'comparator_serialization'
          ? throwingJson
          : {
              ...footprint,
              stores: [
                kind === 'comparator_getter' ? throwingStore : null,
                ...footprint.stores.slice(1),
              ],
            },
      ...(kind === 'early_ui_null_store' ? { activeSettings: false } : {}),
    };
    await assert.rejects(
      () =>
        fullRechecks.captureGuestPreferenceBaselines({
          panel: {},
          preferences: [mode, theme],
          caseEntryBaselines: { T10: baseline, T04: { value: 'system' } },
          settings: async () => calls.push('settings'),
          openSection: async () => calls.push('open'),
          observePreference: async () => {
            calls.push('observe');
            return observation;
          },
          restorePreferenceBaseline: async () => calls.push('restore'),
          preferenceBaseline: () => {
            throw new Error('baseline must remain immutable');
          },
          onStage: (stage) => calls.push(stage),
        }),
      (error) => {
        // Null stores fail closed; best-effort receipt generation is omitted for malformed data.
        if (kind === 'early_ui_null_store')
          assert.equal(error.message, 'T10_shadow_baseline_mismatch_before_capture');
        else if (kind === 'comparator_null_store')
          assert.equal(error.message, 'T10_shadow_baseline_mismatch_before_capture');
        else assert.equal(error, failure, 'original comparator exception identity must survive');
        const projected = fullRechecks.safeUnexpectedError(error);
        assert.equal(
          projected.modeComparison,
          undefined,
          'malformed/throwing samples intentionally omit receipt',
        );
        if (kind === 'comparator_getter' || kind === 'comparator_serialization') {
          assert.equal(projected.code, 'EPIPE');
          assert.deepEqual(projected.source, {
            file: 'settings-guest-preference-batch.mjs',
            line: 239,
            column: 15,
          });
        }
        assert.doesNotMatch(JSON.stringify(projected), /CANARY|private/);
        return true;
      },
    );
    assert.equal(calls.at(-1), 'initial_mode_compare');
    assert.equal(calls.filter((value) => value === 'observe').length, 1);
    assert.equal(calls.includes('restore'), false);
    assert.equal(JSON.stringify(baseline), immutable);
  }
});

async function actualDocumentReplacement(mutation = null, unchanged = false, invalid = false) {
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  let body = source.slice(
    source.indexOf('async function reloadSettings(panel) {'),
    source.indexOf('\nasync function port('),
  );
  if (mutation === 'ready_only') body = body.replace('v.origin !== previousOrigin &&', '');
  const samples = [
    { origin: 111, ready: true },
    { origin: 111, ready: true },
    { origin: 222, ready: false },
    { origin: 222, ready: true },
  ];
  let current = { origin: invalid ? null : 111, ready: true };
  let sent = false;
  let reads = 0;
  const opened = [];
  const deps = {
    assert,
    evaluate: async (_panel, expression) => {
      reads++;
      return runInNewContext(expression, {
        performance: { timeOrigin: current.origin },
        document: { readyState: current.ready ? 'complete' : 'loading' },
      });
    },
    waitFor: async (label, read, accept) => {
      assert.equal(label, 'panel_document_after_reload');
      for (const sample of samples) {
        current = unchanged ? samples[0] : sample;
        if (accept(await read())) return current;
      }
      throw new Error(`${label}_not_observed`);
    },
    settings: async () => opened.push(current.origin),
    observeSettingsReacquisition: async () => ({}),
    EXTENSION_ID: 'owned-extension',
  };
  const reload = new Function(...Object.keys(deps), `${body}; return reloadSettings;`)(
    ...Object.values(deps),
  );
  if (unchanged || invalid) {
    await assert.rejects(
      reload({
        send: async () => {
          sent = true;
        },
      }),
      invalid ? /identity_unavailable/ : /panel_document_after_reload_not_observed/,
    );
    assert.deepEqual(opened, []);
    if (invalid) assert.equal(sent, false);
  } else {
    await reload({
      send: async () => {
        sent = true;
      },
    });
    assert.equal(sent, true);
    assert.deepEqual(opened, [222], 'Settings may open only in the new complete document');
    assert.equal(reads, 5);
  }
}

test('actual canonical reload rejects old complete samples and requires a new complete document', async () => {
  await actualDocumentReplacement();
  await actualDocumentReplacement(null, true);
  await actualDocumentReplacement(null, false, true);
  await assert.rejects(actualDocumentReplacement('ready_only'), /Settings may open only/);
});

async function fixturePrimaryFailure(primary = new Error('CANARY_primary_private')) {
  const local = {
    values: {},
    async get(keys) {
      return Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys])
          .filter((key) => Object.hasOwn(this.values, key))
          .map((key) => [key, structuredClone(this.values[key])]),
      );
    },
    async set(values) {
      Object.assign(this.values, structuredClone(values));
    },
    async remove(key) {
      delete this.values[key];
    },
  };
  try {
    await withExactSettingsFixture({
      getPanel: () => null,
      driver: {
        evaluate: (_panel, expression) =>
          runInNewContext(expression, {
            chrome: { storage: { local } },
            crypto: webcrypto,
            TextEncoder,
          }),
      },
      reloadSettings: async () => {
        throw new Error('CANARY_cleanup');
      },
      execute: async () => {
        throw primary;
      },
    });
  } catch (error) {
    return error;
  }
  throw new Error('fixture failure was not produced');
}

async function extractedRunCase(source, events, projector = fullRechecks.safeUnexpectedError) {
  const start = source.indexOf('async function runCase(c, fn) {');
  const end = source.indexOf('\nlet observedPort;', start);
  const deps = {
    settingsFixtureIntegrityFailure,
    safeUnexpectedError: projector,
    publicationFailure: undefined,
    checkpoint: (kind, id) => events.push([kind, id]),
    criterion: (item, name, status, evidence) => item.criteria.push({ name, status, evidence }),
  };
  return new Function(...Object.keys(deps), `${source.slice(start, end)}; return runCase;`)(
    ...Object.values(deps),
  );
}

test('actual runCase publishes originating fail and case_end before genuine fixture abort, ordinary failures continue', async () => {
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const marked = await fixturePrimaryFailure();
  for (const failure of [
    new Error('ordinary assertion'),
    Object.assign(new Error('ordinary cleanup'), { safeCleanupFailed: true }),
    Object.assign(new Error('forged fixture'), { fixtureIntegrityFailure: { phase: 'restore' } }),
    marked,
  ]) {
    const events = [];
    const runCase = await extractedRunCase(source, events);
    const c = { id: 'EXT-F-1003-T40', criteria: [] };
    let caught;
    try {
      await runCase(c, async () => {
        throw failure;
      });
    } catch (error) {
      caught = error;
    }
    assert.equal(c.status, 'fail');
    assert.deepEqual(events, [
      ['case_start', c.id],
      ['case_end', c.id],
    ]);
    assert.equal(caught, failure === marked ? marked : undefined);
    if (failure === marked) {
      assert.equal(c.cleanupAlsoFailed, true);
      assert.equal(c.error, 'settings_fixture_integrity_failed');
      assert.doesNotMatch(JSON.stringify(c), /CANARY/);
    }
  }
  const mutant = source.replace('if (fixtureAbort) throw fixtureAbort;', '');
  const runCase = await extractedRunCase(mutant, []);
  await assert.rejects(
    async () =>
      assert.rejects(
        runCase({ id: 'T40', criteria: [] }, async () => {
          throw marked;
        }),
        (error) => error === marked,
      ),
    /Missing expected rejection/,
  );
});

test('actual exercisePanel controlled return preserves harness verification and terminal outer publication', async () => {
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('exercisePanel: async (') + 'exercisePanel: '.length;
  const end =
    source.indexOf('\n    },\n  });\n  assert.equal(result.verified, true);', start) +
    '\n    }'.length;
  assert.ok(start > 0 && end > start);
  const marked = await fixturePrimaryFailure();
  const events = [];
  const report = {
    cases: ['T04', 'T10'].map((id) => ({
      id: `EXT-F-1003-${id}`,
      status: 'unverified',
      criteria: [],
      steps: [],
    })),
  };
  let remaining = 0;
  const deps = {
    settingsFixtureIntegrityFailure,
    publicationFailure: undefined,
    report,
    settings: async () => {},
    THEME_RENDERING_PROBE: false,
    GUEST_PREFERENCES: [{ caseId: 'T04' }, { caseId: 'T10' }],
    byId: (id) => report.cases.find((c) => c.id.endsWith(id)),
    runCase: await extractedRunCase(source, events),
    reloadSettings: async () => {},
    runGuestPreferenceCase: async () => {
      if (events.length === 1) throw marked;
      remaining++;
    },
  };
  const exercise = new Function(...Object.keys(deps), `return (${source.slice(start, end)});`)(
    ...Object.values(deps),
  );
  let teardown = 0;
  // External native harness owns this callback/teardown boundary; callback source owns the abort.
  try {
    await exercise({ panel: {} });
  } finally {
    teardown++;
  }
  assert.equal(teardown, 1);
  assert.equal(remaining, 0);
  assert.equal(report.fixtureAborted, true);
  assert.equal(report.cases[0].status, 'fail');
  assert.equal(report.cases[1].status, 'unverified');
  assert.deepEqual(
    events.map(([kind]) => kind),
    ['case_start', 'case_end'],
  );
  assert.doesNotMatch(JSON.stringify(report), /CANARY/);
  const removedReturn = source
    .slice(start, end)
    .replace('if (!fixtureFailure) throw error;', 'throw error;');
  const exerciseMutant = new Function(...Object.keys(deps), `return (${removedReturn});`)(
    ...Object.values(deps),
  );
  events.length = 0;
  await assert.rejects(exerciseMutant({ panel: {} }), (error) => error === marked);

  // Execute the unchanged post-native verification, catch, enforcement and final publisher source.
  const suffixStart = source.indexOf('  assert.equal(result.verified, true);', end);
  assert.ok(suffixStart > end);
  const directory = mkdtempSync(join(tmpdir(), 'settings-controlled-abort-final-'));
  try {
    const output = join(directory, 'report.json');
    report.build = {};
    report.preconditions = [];
    const outerDeps = {
      assert,
      report,
      result: { verified: true, artifacts: [] },
      DEV_BUILD_RECEIPT: undefined,
      settingsFixtureIntegrityFailure,
      publicationFailure: undefined,
      observedPort: undefined,
      THEME_RENDERING_PROBE: false,
      enforceFullExtensionRechecks: fullRechecks.enforceFullExtensionRechecks,
      RELOAD_SENDER_DOCUMENT_DIAGNOSTIC: false,
      RELOAD_OPEN_DIAGNOSTIC: false,
      finalizeSettingsSenderDocumentDiagnostic,
      publishAtomicJsonReport,
      OUTPUT: output,
      console: { log() {}, error() {} },
      process: { exitCode: 0 },
      criterion: (item, name, status, evidence) => item.criteria.push({ name, status, evidence }),
    };
    const finish = new Function(
      ...Object.keys(outerDeps),
      `return (async () => { try { ${source.slice(suffixStart)} return report; })();`,
    );
    await finish(...Object.values(outerDeps));
    const published = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(published.build.verified, true);
    assert.equal(published.terminal, true);
    assert.equal(published.status, 'fail');
    assert.equal(published.fixtureAborted, true);
    assert.equal(published.cases[0].status, 'fail');
    assert.equal(published.cases[1].fullExtensionReload, undefined);
    const prior = await readFile(output, 'utf8');
    await assert.rejects(
      finish(
        ...Object.values({
          ...outerDeps,
          publishAtomicJsonReport: () => {
            throw new Error('publisher_failed');
          },
        }),
      ),
      /publisher_failed/,
    );
    assert.equal(await readFile(output, 'utf8'), prior);
    report.build = {};
    await finish(...Object.values({ ...outerDeps, result: { verified: false } }));
    assert.equal(
      JSON.parse(await readFile(output, 'utf8')).build.verified,
      undefined,
      'failed native verification cannot fabricate verified build',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('actual inner guest catch rethrows fixture integrity after bounded stage receipt', async () => {
  await assert.rejects(
    runWarmSettingsScenario('fixture'),
    (error) => settingsFixtureIntegrityFailure(error)?.ownershipEstablished === true,
  );
});

test('actual full recheck records fixture fail before rethrow and kills swallowed-marker mutant', async () => {
  const marked = await fixturePrimaryFailure();
  const item = { id: 'EXT-F-1003-T67', criteria: [], steps: [] };
  await assert.rejects(
    fullRechecks.runFullExtensionRecheck(item, async () => {
      throw marked;
    }),
    (error) => error === marked,
  );
  assert.equal(item.fullExtensionReload.status, 'fail');
  assert.equal(item.fullExtensionReload.criteria.at(-1).status, 'fail');
  assert.ok(item.fullExtensionReload.fixtureIntegrityFailure);
  assert.doesNotMatch(JSON.stringify(item), /CANARY/);
  const mutantSource = fullRechecks.runFullExtensionRecheck
    .toString()
    .replace('throw error;', 'return result;');
  assert.notEqual(mutantSource, fullRechecks.runFullExtensionRecheck.toString());
  const mutant = new Function(
    'settingsFixtureIntegrityFailure',
    'safeUnexpectedError',
    `return (${mutantSource});`,
  )(settingsFixtureIntegrityFailure, fullRechecks.safeUnexpectedError);
  await assert.rejects(
    async () =>
      assert.rejects(
        mutant({ id: item.id, criteria: [], steps: [] }, async () => {
          throw marked;
        }),
      ),
    /Missing expected rejection/,
  );
});

// A mutable primary's own cause must never select the diagnostics for its cleanup wrapper.
async function verifyBrandedPrimaryDiagnostics(rechecks = fullRechecks) {
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const misleadingCause = Object.assign(new Error('CANARY_misleading_cause'), {
    code: 'ECONNRESET',
    safeCategory: 'auto_scrape_mode_recheck_failed',
    safeStage: 'choice_wait',
    safeFailureKind: 'restore',
  });
  const t40 = () =>
    Object.assign(new Error('CANARY_operation', { cause: misleadingCause }), {
      code: 'EPIPE',
      safeLastAutoScrapeObservation: {
        active: true,
        sectionOpen: true,
        controlCount: 1,
        visibleMatches: false,
        storedMatches: false,
        raw: 'CANARY_raw',
      },
    });
  const t67 = () =>
    Object.assign(new Error('CANARY_operation', { cause: misleadingCause }), {
      code: 'ETIMEDOUT',
      safeCategory: 'auto_scrape_mode_recheck_failed',
      safeStage: 'choice_record',
      safeFailureKind: 'case',
      safeOriginalStage: 'choice_wait',
    });
  const getterPrimary = t40();
  Object.defineProperty(getterPrimary, 'cause', {
    get() {
      throw new Error('CANARY_getter');
    },
  });
  const errors = [
    ['T40', t40()],
    ['T40', getterPrimary],
    ['T67', t67()],
    ['T67', Object.freeze(t67())],
    ['T40', 'CANARY_primitive'],
  ];
  for (const [id, primary] of errors) {
    const marked = await fixturePrimaryFailure(primary);
    if (Object.isFrozen(primary)) assert.equal(marked.cause, primary);
    else assert.equal(marked, primary);
    const item = { id: `EXT-F-1003-${id}`, criteria: [], steps: [] };
    const run = await extractedRunCase(source, [], rechecks.safeUnexpectedError);
    await assert.rejects(
      run(item, async () => {
        throw marked;
      }),
      (error) => error === marked,
    );
    const operation = item.operationFailure;
    assert.ok(operation);
    if (typeof primary === 'string') {
      assert.equal(operation.code, 'other');
      assert.equal(operation.name, 'OtherError');
    } else if (id === 'T40') {
      assert.equal(
        operation.code,
        'EPIPE',
        'mutable primary owns operation code despite misleading cause',
      );
      assert.deepEqual(operation.lastSafeObservation, {
        active: true,
        sectionOpen: true,
        controlCount: 1,
        visibleMatches: false,
        storedMatches: false,
      });
    } else {
      assert.equal(operation.code, 'ETIMEDOUT');
      assert.deepEqual(operation.autoScrapeMode, {
        category: 'auto_scrape_mode_recheck_failed',
        stage: 'choice_record',
        kind: 'case',
        originalStage: 'choice_wait',
      });
    }
    assert.equal(item.fixtureIntegrityFailure.phase, 'retire_before_restore');
    assert.equal(item.cleanupAlsoFailed, true);
    const full = { id: item.id, criteria: [], steps: [] };
    await assert.rejects(
      rechecks.runFullExtensionRecheck(full, async () => {
        throw marked;
      }),
      (error) => error === marked,
    );
    assert.deepEqual(full.fullExtensionReload.operationFailure, operation);
    assert.equal(full.fullExtensionReload.cleanupAlsoFailed, true);
    assert.doesNotMatch(JSON.stringify(item) + JSON.stringify(full), /CANARY|raw:/);
  }
}

test('actual cleanup producer and controllers retain primary diagnostics with own causes and authentic wrappers', async () => {
  await verifyBrandedPrimaryDiagnostics();
  const source = await readFile(
    new URL('./settings-full-extension-rechecks.mjs', import.meta.url),
    'utf8',
  );
  for (const replacement of [
    'const error = failure?.safeCleanupFailed === true && failure?.cause !== undefined ? failure.cause : failure;',
    "const error = new Error('constant_projector');",
  ]) {
    const mutated = source.replace(
      'const error = originalSettingsCleanupFailure(failure);',
      replacement,
    );
    assert.notEqual(mutated, source);
    const executable = mutated.replace(
      /from '(\.\/[^']+)'/g,
      (_match, relative) => `from '${new URL(relative, import.meta.url).href}'`,
    );
    const rechecks = await import(
      `data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`
    );
    await assert.rejects(
      verifyBrandedPrimaryDiagnostics(rechecks),
      /mutable primary owns operation code/,
    );
  }
});
