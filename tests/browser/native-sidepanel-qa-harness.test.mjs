#!/usr/bin/env node
import './panel-visibility-diagnostic.test.mjs';
import './panel-visible-reopen-repair.test.mjs';
import './initial-panel-context-readiness.test.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import {
  activateOwnedSidePanel,
  isSettledGuestPanel,
  observeSidePanelContext,
  panelContextDiagnostic,
  panelContextFailureDiagnostic,
  panelDocumentDiagnostic,
  requireExpectedExtension,
  requireOwnedCommandLine,
  requireSidePanelContext,
  requireSpawnedProfileOwner,
  resolveExpectedRelease,
} from './native-sidepanel-qa-harness.mjs';
import { captureLifecycleEvidence } from './profile-reload-capture.mjs';

const profile = '/private/tmp/owned-profile';
const expectedExtensionDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
  '.output/chrome-mv3-dev',
);
const productionBuildDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
  '.output/chrome-mv3',
);
const extensionId = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const expectedPanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
const receipt = {
  version: '0.2.44',
  treeSha256: 'a'.repeat(64),
  storeZip: { path: '/private/tmp/store.zip', sha256: 'b'.repeat(64) },
};
const localReceipt = {
  schema_version: 1,
  kind: 'local_dev_unpacked',
  publish_state: 'not_published',
  observedAt: '2026-09-27T12:00:00.000Z',
  version: '0.2.104',
  treeSha256: 'c'.repeat(64),
  extensionDir: productionBuildDir,
};

// Captured D133: target activation focused an existing hidden SIDE_PANEL;
// only the trusted open RPC can request reopening it. Browser visibility is
// still checked by the native acceptance driver, not supplied by this guard.
for (const reply of [
  { ok: true, result: { opened: true } },
  { ok: true, result: { opened: false } },
  { ok: false, result: { opened: true } },
  null,
]) {
  let result = '{"ok":true,"result":{"opened":true}}'; // stale prior reply
  const events = [];
  const accepted = reply?.ok === true && reply?.result?.opened === true;
  const page = {
    bringToFront: async () => events.push('foreground'),
    locator(selector) {
      assert.ok(['#open-panel', '#result'].includes(selector));
      const locator = {
        evaluate: async (mutate) => {
          assert.equal(selector, '#result');
          const element = { textContent: result };
          mutate(element);
          result = element.textContent;
          events.push('clear');
        },
        click: async () => {
          assert.equal(selector, '#open-panel');
          assert.deepEqual(events, ['foreground', 'clear']);
          assert.equal(result, '', 'stale successful reply must be cleared before the open');
          events.push('trusted-open');
          if (reply !== null) result = JSON.stringify(reply);
        },
        filter: ({ hasText }) => {
          assert.equal(hasText.test(''), false);
          assert.equal(hasText.test('   '), false);
          return locator;
        },
        waitFor: async () => {
          assert.equal(selector, '#result');
          events.push('fresh-reply');
          if (!result.trim()) throw new Error('native_open_reply_not_observed');
        },
        textContent: async () => result,
      };
      return locator;
    },
  };
  const activation = activateOwnedSidePanel({
    panel: { send: async () => ({ result: { value: { visibility: 'hidden' } } }) },
    page,
    cdp: {
      send: async (method, args) => {
        assert.equal(method, 'Target.activateTarget');
        assert.deepEqual(args, { targetId: 'owned-panel' });
        assert.equal(accepted, true, 'refused or absent reply cannot activate the panel');
        events.push('activate');
      },
    },
    panelTargetId: 'owned-panel',
  });
  if (accepted) await activation;
  else
    await assert.rejects(
      activation,
      reply === null ? /native_open_reply_not_observed/ : /native_sidepanel_open_refused/,
    );
  assert.deepEqual(events, [
    'foreground',
    'clear',
    'trusted-open',
    'fresh-reply',
    ...(accepted ? ['activate'] : []),
  ]);
}
console.log('PASS owned side panel reopening requires a fresh trusted successful open reply');

// Execute the actual authenticated Scrape setup prefix with external auth and
// browser dependencies doubled. A focus-only callback cannot satisfy this path.
const scrapeSource = await readFile(
  new URL('./scrape-guest-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const setupStart = scrapeSource.indexOf('exercisePanel: async ({');
const setupEnd = scrapeSource.indexOf('      report.panel_viewports.push({', setupStart);
assert.ok(setupStart >= 0 && setupEnd > setupStart, 'authenticated Scrape setup seam missing');
const setup = `${scrapeSource.slice(setupStart + 'exercisePanel: '.length, setupEnd)}\n}`;
const events = [];
const exerciseSetup = new Function(
  'signInSettings',
  'selectRequiredSettingsOrganization',
  'startPanelTransitionRecorder',
  'traceOrganizationPointers',
  'classifyPanelTransition',
  'selection',
  'requiredOrganizationName',
  'report',
  'assert',
  'REPO',
  'waitFor',
  'evaluate',
  `let expectedIdentity; return (${setup});`,
)(
  async () => ({ mode: 'member' }),
  async () => ({}),
  async () => ({ mark: async () => {}, stop: async () => ({ status: 'measured', events: [] }) }),
  (value) => value,
  () => 'no_hidden_event',
  { mode: 'member' },
  undefined,
  {},
  assert,
  '',
  async (boundary, read, accepts) => {
    assert.equal(boundary, 'scrape_authenticated_panel_foreground');
    assert.equal(accepts(await read()), true);
    events.push('visible');
  },
  async () => events.includes('reopen'),
);
await exerciseSetup({
  page: {},
  panel: {},
  browserSession: {
    send: async (method) => {
      assert.equal(method, 'Browser.getVersion');
      return { product: 'Chrome/fixture' };
    },
  },
  activatePanel: async () => {
    throw new Error('focus-only activation cannot reopen hidden panel');
  },
  reopenPanel: async () => events.push('reopen'),
  observePanelVisibility: async () => {},
  requireResourceHealth: async () => events.push('health'),
  resourceAction: async (action) => action(),
});
assert.deepEqual(events, ['health', 'reopen', 'visible', 'health']);
console.log('PASS actual authenticated Scrape setup reopens before checking native visibility');

// A normal `wxt build` must be eligible for owned-browser QA without copying
// it onto the installed dev path. A sibling output directory must stay denied.
assert.equal(requireLocalDevReceipt(localReceipt, productionBuildDir), localReceipt);
assert.throws(
  () =>
    requireLocalDevReceipt(
      { ...localReceipt, extensionDir: '/private/tmp/foreign-build' },
      '/private/tmp/foreign-build',
    ),
  /local_dev_build_receipt_refused/,
);

assert.throws(
  () =>
    requireOwnedCommandLine(
      { arguments: ['--user-data-dir=/private/tmp/other', '--remote-debugging-port=0'] },
      profile,
    ),
  /foreign_browser_refused/,
);
assert.throws(
  () => requireSpawnedProfileOwner('host-7002', 7001),
  /profile_owner_not_spawned_child/,
);
assert.throws(
  () => resolveExpectedRelease({ receipt, extensionDir: '/private/tmp/other' }),
  /override_provenance_refused/,
);
assert.throws(
  () =>
    resolveExpectedRelease({
      receipt,
      extensionDir: '/private/tmp/other',
      expectedRelease: { treeSha256: 'c'.repeat(64), version: receipt.version },
    }),
  /override_provenance_refused/,
);
assert.throws(
  () =>
    requireSidePanelContext(
      [
        {
          contextType: 'TAB',
          documentUrl: `chrome-extension://${extensionId}/sidepanel.html`,
          tabId: -1,
        },
      ],
      `chrome-extension://${extensionId}/sidepanel.html`,
    ),
  /runtime_context_missing/,
);
assert.equal(
  isSettledGuestPanel({
    ready: true,
    guestAccount: true,
    scrapeTrigger: true,
    chatTrigger: true,
    visibleControls: 4,
  }),
  true,
);
assert.equal(
  isSettledGuestPanel({
    ready: true,
    guestAccount: true,
    scrapeTrigger: true,
    chatTrigger: false,
    visibleControls: 4,
  }),
  false,
);
assert.equal(
  isSettledGuestPanel({
    ready: true,
    guestAccount: false,
    scrapeTrigger: true,
    chatTrigger: true,
    visibleControls: 4,
  }),
  false,
);
assert.throws(
  () =>
    requireExpectedExtension(
      [{ type: 'service_worker', url: 'chrome-extension://foreign/background.js' }],
      extensionId,
    ),
  /expected_extension_missing/,
);
requireOwnedCommandLine(
  { arguments: [`--user-data-dir=${profile}`, '--remote-debugging-port=0'] },
  profile,
);
requireExpectedExtension(
  [{ type: 'service_worker', url: `chrome-extension://${extensionId}/background.js` }],
  extensionId,
);
requireSpawnedProfileOwner('host-7001', 7001);
assert.deepEqual(resolveExpectedRelease({ receipt }), {
  extensionDir: expectedExtensionDir,
  treeSha256: receipt.treeSha256,
  version: receipt.version,
  storeZipPath: receipt.storeZip.path,
  storeZipSha256: receipt.storeZip.sha256,
});
assert.equal(
  resolveExpectedRelease({
    receipt,
    extensionDir: '/private/tmp/receipt-matched',
    expectedRelease: { treeSha256: receipt.treeSha256, version: receipt.version },
  }).extensionDir,
  '/private/tmp/receipt-matched',
);
requireSidePanelContext(
  [
    {
      contextType: 'SIDE_PANEL',
      documentUrl: `chrome-extension://${extensionId}/sidepanel.html`,
      tabId: -1,
    },
  ],
  `chrome-extension://${extensionId}/sidepanel.html`,
);
const wrongPanelContext = {
  contextType: 'SIDE_PANEL',
  documentUrl: `${expectedPanelUrl}?foreign`,
  tabId: -1,
};
const exactPanelContext = { contextType: 'SIDE_PANEL', documentUrl: expectedPanelUrl, tabId: -1 };
assert.deepEqual(panelContextDiagnostic([], expectedPanelUrl), {
  contextCount: 0,
  sidePanelCount: 0,
  expectedExtensionCount: 0,
  exactUrlCount: 0,
  globalTabCount: 0,
  exactContextCount: 0,
  missingDocumentUrlCount: 0,
  emptyDocumentUrlCount: 0,
  otherExtensionUrlCount: 0,
  nonExtensionUrlCount: 0,
});
assert.deepEqual(
  panelContextDiagnostic(
    [
      wrongPanelContext,
      { contextType: 'SIDE_PANEL', documentUrl: expectedPanelUrl, tabId: 7 },
      exactPanelContext,
      { contextType: 'TAB', documentUrl: 'chrome-extension://foreign/private', tabId: -1 },
    ],
    expectedPanelUrl,
  ),
  {
    contextCount: 4,
    sidePanelCount: 3,
    expectedExtensionCount: 3,
    exactUrlCount: 2,
    globalTabCount: 3,
    exactContextCount: 1,
    missingDocumentUrlCount: 0,
    emptyDocumentUrlCount: 0,
    otherExtensionUrlCount: 1,
    nonExtensionUrlCount: 0,
  },
);
// A SIDE_PANEL result can omit documentUrl or expose a different origin; neither
// is evidence that the exact owned context exists. A later exact result identifies
// a registration window without changing the immediate refusal.
for (const [initial, expectedShape] of [
  [
    { contextType: 'SIDE_PANEL', tabId: -1 },
    { missingDocumentUrlCount: 1, otherExtensionUrlCount: 0, nonExtensionUrlCount: 0 },
  ],
  [
    { contextType: 'SIDE_PANEL', documentUrl: '', tabId: -1 },
    { missingDocumentUrlCount: 0, emptyDocumentUrlCount: 1, otherExtensionUrlCount: 0 },
  ],
  [
    {
      contextType: 'SIDE_PANEL',
      documentUrl: 'chrome-extension://foreign/sidepanel.html',
      tabId: -1,
    },
    { missingDocumentUrlCount: 0, otherExtensionUrlCount: 1, nonExtensionUrlCount: 0 },
  ],
  [
    { contextType: 'SIDE_PANEL', documentUrl: 'about:blank', tabId: -1 },
    { missingDocumentUrlCount: 0, otherExtensionUrlCount: 0, nonExtensionUrlCount: 1 },
  ],
]) {
  const diagnostic = await panelContextFailureDiagnostic({
    contexts: [initial],
    panelUrl: expectedPanelUrl,
    readContexts: async () => [exactPanelContext],
    waitBetween: async () => {},
  });
  assert.equal(diagnostic.contextCount, 1);
  assert.equal(diagnostic.exactContextCount, 0);
  assert.equal(diagnostic.followUp.exact_expected_count, 1);
  assert.equal(diagnostic.followUpQueryFailed, false);
  for (const [key, value] of Object.entries(expectedShape)) assert.equal(diagnostic[key], value);
}
const persistentMismatch = await panelContextFailureDiagnostic({
  contexts: [wrongPanelContext],
  panelUrl: expectedPanelUrl,
  readContexts: async () => [wrongPanelContext],
  waitBetween: async () => {},
});
assert.equal(persistentMismatch.followUp.exact_expected_count, 0);
const queryFailure = await panelContextFailureDiagnostic({
  contexts: [wrongPanelContext],
  panelUrl: expectedPanelUrl,
  readContexts: async () => {
    throw new Error('private query detail');
  },
  waitBetween: async () => {},
});
assert.equal(queryFailure.followUp, null);
assert.equal(queryFailure.followUpQueryFailed, true);
// Captured D117: both worker reads had one global SIDE_PANEL with an empty URL.
// The SUT must distinguish an unfinished document from a loaded renderer whose
// runtime context still has an empty URL, without returning any raw identifiers.
const emptyPanelContext = { contextType: 'SIDE_PANEL', documentUrl: '', tabId: -1 };
for (const [documentUrl, readyState, runtimeId, runtimeContexts, expected] of [
  [
    '',
    'loading',
    undefined,
    null,
    {
      exactUrl: false,
      emptyUrl: true,
      readyState: 'loading',
      runtimeIdentityExact: false,
      contextQueryAvailable: false,
      sidePanelCount: null,
      emptyContextUrlCount: null,
      exactContextCount: null,
    },
  ],
  [
    expectedPanelUrl,
    'complete',
    extensionId,
    [emptyPanelContext],
    {
      exactUrl: true,
      emptyUrl: false,
      readyState: 'complete',
      runtimeIdentityExact: true,
      contextQueryAvailable: true,
      sidePanelCount: 1,
      emptyContextUrlCount: 1,
      exactContextCount: 0,
    },
  ],
  [
    expectedPanelUrl,
    'interactive',
    extensionId,
    [exactPanelContext, wrongPanelContext],
    {
      exactUrl: true,
      emptyUrl: false,
      readyState: 'interactive',
      runtimeIdentityExact: true,
      contextQueryAvailable: true,
      sidePanelCount: 2,
      emptyContextUrlCount: 0,
      exactContextCount: 1,
    },
  ],
]) {
  const calls = [];
  const cdp = {
    async send(method, params, sessionId) {
      calls.push(method);
      if (method === 'Target.attachToTarget') {
        assert.deepEqual(params, { targetId: 'owned-panel-target', flatten: true });
        return { sessionId: 'owned-panel-session' };
      }
      if (method === 'Target.detachFromTarget') {
        assert.deepEqual(params, { sessionId: 'owned-panel-session' });
        return {};
      }
      assert.equal(sessionId, 'owned-panel-session');
      if (method === 'Page.getFrameTree')
        return {
          frameTree: {
            frame: {
              url: documentUrl,
              loaderId: documentUrl ? 'opaque-loader' : '',
              unreachableUrl: documentUrl ? '' : 'private-navigation-error-url',
            },
          },
        };
      assert.equal(method, 'Runtime.evaluate');
      assert.equal(params.awaitPromise, true);
      let runtimeQueryCalls = 0;
      const value = await runInNewContext(params.expression, {
        URL,
        document: { URL: documentUrl, readyState },
        chrome:
          runtimeContexts === null
            ? undefined
            : {
                runtime: {
                  id: runtimeId,
                  async getContexts(filter) {
                    runtimeQueryCalls += 1;
                    assert.equal(JSON.stringify(filter), '{"contextTypes":["SIDE_PANEL"]}');
                    return runtimeContexts;
                  },
                },
              },
      });
      assert.equal(runtimeQueryCalls, runtimeContexts === null ? 0 : 1);
      return { result: { value: JSON.parse(JSON.stringify(value)) } };
    },
  };
  const observation = await panelDocumentDiagnostic({
    cdp,
    panelTargetId: 'owned-panel-target',
    panelUrl: expectedPanelUrl,
  });
  assert.deepEqual(observation, {
    frame: {
      present: true,
      exactUrl: documentUrl === expectedPanelUrl,
      emptyUrl: documentUrl === '',
      loaderPresent: Boolean(documentUrl),
      navigationError: !documentUrl,
    },
    renderer: expected,
    queryFailed: false,
  });
  assert.deepEqual(calls, [
    'Target.attachToTarget',
    'Page.getFrameTree',
    'Runtime.evaluate',
    'Target.detachFromTarget',
  ]);
  assert.equal(JSON.stringify(observation).includes('chrome-extension://'), false);
  assert.equal(JSON.stringify(observation).includes('private-navigation-error-url'), false);
}
for (const failedMethod of ['Target.attachToTarget', 'Page.getFrameTree', 'Runtime.evaluate']) {
  const calls = [];
  const observation = await panelDocumentDiagnostic({
    cdp: {
      async send(method) {
        calls.push(method);
        if (method === failedMethod) throw new Error('private diagnostic detail');
        if (method === 'Target.attachToTarget') return { sessionId: 'owned-session' };
        return {};
      },
    },
    panelTargetId: 'owned-panel-target',
    panelUrl: expectedPanelUrl,
  });
  assert.equal(observation.queryFailed, true);
  assert.equal(
    observation.failedStage,
    {
      'Target.attachToTarget': 'attach',
      'Page.getFrameTree': 'frame_tree',
      'Runtime.evaluate': 'renderer',
    }[failedMethod],
  );
  assert.equal(calls.includes('Target.detachFromTarget'), failedMethod !== 'Target.attachToTarget');
  assert.equal(JSON.stringify(observation).includes('private'), false);
}
const diagnosticOrder = [];
const documentBoundary = await panelContextFailureDiagnostic({
  contexts: [emptyPanelContext],
  panelUrl: expectedPanelUrl,
  readDocument: async () => {
    diagnosticOrder.push('document');
    return { queryFailed: true };
  },
  readContexts: async () => {
    diagnosticOrder.push('worker');
    return [exactPanelContext];
  },
  waitBetween: async () => {},
});
assert.deepEqual(diagnosticOrder, ['document', 'worker']);
assert.equal(documentBoundary.emptyDocumentUrlCount, 1);
assert.equal(documentBoundary.document.queryFailed, true);
assert.equal(documentBoundary.followUpShape.exactContextCount, 1);
assert.equal(documentBoundary.followUpShape.emptyDocumentUrlCount, 0);
assert.throws(
  () => requireSidePanelContext([emptyPanelContext], expectedPanelUrl),
  /native_sidepanel_runtime_context_missing/,
);
let contextReads = 0;
const boundary = await observeSidePanelContext({
  readContexts: async () => (++contextReads === 1 ? [wrongPanelContext] : [exactPanelContext]),
  panelUrl: expectedPanelUrl,
  attempts: 2,
  waitBetween: async () => {},
});
assert.equal(boundary.first.side_panel_count, 1);
assert.equal(boundary.first.exact_expected_count, 0);
assert.equal(boundary.last.exact_expected_count, 1);
assert.equal(boundary.exact_expected_appeared, true);
assert.equal(boundary.attempts, 2);
const absentBoundary = await observeSidePanelContext({
  readContexts: async () => [wrongPanelContext],
  panelUrl: expectedPanelUrl,
  attempts: 2,
  waitBetween: async () => {},
});
assert.equal(absentBoundary.exact_expected_appeared, false);
assert.equal(absentBoundary.last.exact_expected_count, 0);
const source = await readFile(
  new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
  'utf8',
);
assert.doesNotMatch(source, /9222/);
assert.doesNotMatch(source, /Browser\.close\(/);
console.log('PASS native sidepanel harness refuses foreign CDP/browser identities');

const { safeStartupFailureCode, safeEndpointDiagnostic, safeEndpointWaitDiagnostic } = await import(
  './native-sidepanel-qa-harness.mjs'
);
assert.equal(
  safeStartupFailureCode(new Error('owned_cdp_endpoint_timeout')),
  'owned_cdp_endpoint_timeout',
);
assert.equal(safeStartupFailureCode(new Error('owned_cdp_open_failed')), 'owned_cdp_open_failed');
assert.equal(
  safeStartupFailureCode(new Error('owned_cdp_process_inspection_failed')),
  'owned_cdp_process_inspection_failed',
);
assert.equal(safeStartupFailureCode(new Error('owned_cdp_open_timeout')), 'owned_cdp_open_timeout');
assert.equal(
  safeStartupFailureCode(new Error('spawn /private/path with private startup detail failed')),
  'unclassified',
);
assert.equal(safeStartupFailureCode({ message: 'owned_cdp_endpoint_timeout' }), 'unclassified');
console.log('PASS native startup diagnostic exposes only fixed owned-CDP failure codes');
const endpointError = new Error('owned_cdp_endpoint_refused');
endpointError.endpointDiagnostic = {
  boundary: 'record_validation',
  reason: 'browser_path_missing',
  shape: {
    lineCount: 2,
    hasTrailingNewline: true,
    portTokenDigits: true,
    browserPathShape: false,
    rawEndpoint: 'private endpoint value',
  },
  rawError: 'private error value',
};
assert.deepEqual(safeEndpointDiagnostic(endpointError), {
  boundary: 'record_validation',
  reason: 'browser_path_missing',
  shape: {
    lineCount: 2,
    hasTrailingNewline: true,
    portTokenDigits: true,
    browserPathShape: false,
  },
});
endpointError.endpointDiagnostic.reason = 'private error value';
assert.equal(safeEndpointDiagnostic(endpointError), null);
endpointError.endpointDiagnostic.reason = 'record_shape';
endpointError.endpointDiagnostic.shape.lineCount = 'private endpoint value';
assert.equal(safeEndpointDiagnostic(endpointError), null);
assert.equal(safeEndpointDiagnostic(new Error('owned_cdp_endpoint_timeout')), null);
console.log('PASS native startup endpoint diagnostic emits only fixed branch and shape fields');
const timeoutError = new Error('owned_cdp_endpoint_timeout');
timeoutError.endpointWaitDiagnostic = {
  polls: 180,
  elapsedMs: 5037,
  longestReadMs: 2,
  privatePath: '/private/profile',
};
assert.deepEqual(safeEndpointWaitDiagnostic(timeoutError), {
  polls: 180,
  elapsedMs: 5037,
  longestReadMs: 2,
});
timeoutError.endpointWaitDiagnostic.polls = 'private value';
assert.equal(safeEndpointWaitDiagnostic(timeoutError), null);
assert.equal(safeEndpointWaitDiagnostic(new Error('owned_cdp_open_timeout')), null);
console.log('PASS native endpoint timeout emits bounded numeric polling evidence');

// SUT: reloadOwnedExtension owns Developer mode setup, the native reload,
// target lifecycle proof, and refusal when Chrome disables the extension.
// Browser UI and CDP are external dependencies; their state follows UI actions.
const { reloadCase } = await import('./native-reload-fixture.mjs');
await reloadCase({ initiallyEnabled: false });
await reloadCase({ initiallyEnabled: true });
for (const [openReply, category] of [
  [{ ok: true, result: { opened: false, reason: 'private URL token' } }, 'open_refused'],
  [{ ok: false, error: 'private URL token' }, 'rpc_refused'],
  [null, 'reply_not_observed'],
  ['malformed', 'malformed_reply'],
]) {
  const result = await reloadCase({
    initiallyEnabled: true,
    openReply,
    expectedCategory: category,
  });
  const captured = captureLifecycleEvidence(result.retirement_evidence);
  const request = captured?.open_panel_request;
  assert.equal(request?.category, category);
  assert.equal(request?.received, openReply !== null);
  assert.equal(request?.worker_at_click.status, 'activated');
  assert.equal(request?.worker_at_click.running_status, 'running');
  assert.equal(Number.isSafeInteger(request?.click_monotonic_ms), true);
  assert.doesNotMatch(JSON.stringify(captured), /private|token|chrome-extension:\/\//);
}
await reloadCase({
  initiallyEnabled: true,
  openReply: { ok: true, result: { opened: false } },
  replyDelayTargetReads: 3,
  expectedCategory: 'reply_not_observed',
});
await assert.rejects(
  reloadCase({
    initiallyEnabled: true,
    openReply: { ok: true, result: { opened: false, reason: 'private URL token' } },
    panelAppears: false,
    expectFailure: true,
  }),
  (error) => {
    const captured = captureLifecycleEvidence(error.lifecycleEvidence);
    assert.equal(error.message, 'native_extension_replacement_panel_unverified');
    assert.equal(captured.open_panel_request.category, 'open_refused');
    assert.equal(captured.open_panel_request.opened, false);
    assert.doesNotMatch(JSON.stringify(captured), /private|token/);
    return true;
  },
);
for (const executionEvidence of [
  'restartable',
  'noReplacementVersion',
  'unavailable',
  'ambiguous',
]) {
  await assert.rejects(
    reloadCase({ initiallyEnabled: true, executionEvidence, expectFailure: true }),
    (error) =>
      error.message === 'native_extension_worker_retirement_unverified' &&
      error.lifecycleEvidence.old_worker_destroyed_event === true &&
      error.lifecycleEvidence.old_worker_execution_retired === false &&
      error.lifecycleEvidence.timeline.final_predicate === false,
    `destroyed debugger target must not bypass ${executionEvidence} execution evidence`,
  );
}
const retainedResult = await reloadCase({
  initiallyEnabled: true,
  skipDestroyed: true,
  retainedHost: true,
});
const retainedCapture = captureLifecycleEvidence(retainedResult.retirement_evidence);
assert.equal(retainedCapture.old_worker_destroyed_event, false);
assert.equal(retainedCapture.old_worker_execution_retired, true);
assert.equal(retainedCapture.reload_lifetime.pre_click_version_count, 1);
assert.equal(retainedCapture.reload_lifetime.version_events_dropped, 0);
await assert.rejects(
  reloadCase({
    initiallyEnabled: true,
    retainedHost: true,
    skipDestroyed: true,
    contextResults: [{ result: { value: [] } }],
  }),
  /native_sidepanel_runtime_context_missing/,
);
await assert.rejects(
  reloadCase({
    initiallyEnabled: true,
    retainedHost: true,
    skipDestroyed: true,
    multipleWorkers: true,
  }),
  /native_extension_worker_retirement_unverified/,
);

await assert.rejects(
  reloadCase({ initiallyEnabled: true, skipDestroyed: true, executionEvidence: 'restartable' }),
  (error) => {
    const captured = captureLifecycleEvidence(error.lifecycleEvidence);
    return (
      error.message === 'native_extension_worker_retirement_unverified' &&
      captured.old_worker_destroyed_event === false &&
      captured.old_worker_absent === true &&
      captured.replacement_worker_present === true &&
      captured.timeline.final_predicate === false &&
      captured.reload_lifetime.old_version_mapping === 'correlated' &&
      captured.reload_lifetime.versions.at(-1).running_status === 'stopped' &&
      captured.reload_lifetime.old_host_probe.outcome === 'target_absent' &&
      captured.reload_lifetime.independent_targets.some((entry) => entry.phase === 'destroyed')
    );
  },
);
await assert.rejects(reloadCase({ initiallyEnabled: true, clickFailure: true }), (error) => {
  const captured = captureLifecycleEvidence(error.lifecycleEvidence);
  return (
    error.message === 'native_reload_click_interrupted' &&
    captured?.timeline?.old_worker_id === 'old-worker' &&
    captured.timeline.pre_click_old_worker_present === true &&
    captured.timeline.final_predicate === false &&
    captured.timeline.entries.some((entry) => entry.phase === 'click_started') &&
    captured.timeline.entries.some((entry) => entry.phase === 'target_destroyed') &&
    captured.timeline.entries.every(
      (entry) => !JSON.stringify(entry).includes('chrome-extension://'),
    )
  );
});
await assert.rejects(
  reloadCase({ initiallyEnabled: true, retireBeforeClick: true }),
  (error) =>
    error.message === 'native_extension_old_worker_retired_before_reload' &&
    error.lifecycleEvidence.timeline.pre_click_old_worker_present === false &&
    error.lifecycleEvidence.timeline.entries.some(
      (entry) => entry.phase === 'listeners_registered',
    ) &&
    error.lifecycleEvidence.timeline.entries.every((entry) => entry.phase !== 'click_started'),
);
const wrongContextResult = {
  result: {
    value: [{ contextType: 'SIDE_PANEL', documentUrl: `${expectedPanelUrl}?foreign`, tabId: -1 }],
  },
};
const exactContextResult = {
  result: { value: [{ contextType: 'SIDE_PANEL', documentUrl: expectedPanelUrl, tabId: -1 }] },
};
const delayed = await reloadCase({
  initiallyEnabled: true,
  contextResults: [wrongContextResult, exactContextResult],
});
assert.equal(delayed.context_boundary.first.exact_expected_count, 0);
assert.equal(delayed.context_boundary.last.exact_expected_count, 1);
assert.equal(delayed.context_boundary.exact_expected_appeared, true);
await assert.rejects(
  reloadCase({ initiallyEnabled: true, contextResults: [wrongContextResult] }),
  (error) =>
    error.message === 'native_sidepanel_runtime_context_missing' &&
    error.contextBoundary.first.exact_expected_count === 0 &&
    error.contextBoundary.last.exact_expected_count === 0 &&
    error.contextBoundary.exact_expected_appeared === false &&
    error.lifecycleEvidence.old_worker_absent === true,
);
await assert.rejects(
  reloadCase({ initiallyEnabled: true, contextResults: [{ result: { value: [] } }] }),
  (error) =>
    error.message === 'native_sidepanel_runtime_context_missing' &&
    error.contextBoundary.first.side_panel_count === 0 &&
    error.contextBoundary.exact_expected_appeared === false,
);
await assert.rejects(
  reloadCase({ initiallyEnabled: true, contextResults: [{ exceptionDetails: {} }] }),
  (error) =>
    error.message === 'native_sidepanel_runtime_context_query_failed' &&
    error.contextBoundary.query_failed === true &&
    error.contextBoundary.first === null,
);
await assert.rejects(
  reloadCase({ initiallyEnabled: false, disabledAfter: true }),
  (error) =>
    error.message === 'native_extension_reload_disabled' &&
    captureLifecycleEvidence(error.lifecycleEvidence)?.timeline?.final_predicate === true &&
    error.lifecycleEvidence.timeline.final_snapshot.some(
      (target) => target.target_id === 'new-panel',
    ) &&
    error.lifecycleEvidence.management.state === 'DISABLED',
);
console.log('PASS native reload enables Developer mode and refuses Chrome-disabled extensions');
