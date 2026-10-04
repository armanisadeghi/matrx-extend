#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import {
  isSettledGuestPanel,
  observeSidePanelContext,
  panelContextDiagnostic,
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
  },
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
const { reloadOwnedExtension } = await import('./native-sidepanel-qa-harness.mjs');
async function reloadCase({
  initiallyEnabled,
  disabledAfter = false,
  contextResults,
  retireBeforeClick = false,
  clickFailure = false,
}) {
  let developerMode = initiallyEnabled;
  let reloaded = false;
  let opened = false;
  let toggles = 0;
  let contextReads = 0;
  let targetReads = 0;
  const events = new Map();
  const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  const oldWorker = {
    type: 'service_worker',
    targetId: 'old-worker',
    url: `chrome-extension://${extensionId}/background.js`,
  };
  const worker = { ...oldWorker, targetId: 'new-worker' };
  const oldPanel = { type: 'page', targetId: 'old-panel', url: panelUrl };
  const panel = { ...oldPanel, targetId: 'new-panel' };
  const details = {
    goto: async () => {},
    close: async () => {},
    evaluate: async () => ({
      state: reloaded && disabledAfter ? 'DISABLED' : 'ENABLED',
      unsupported_developer_extension: reloaded && disabledAfter,
    }),
    locator(selector) {
      if (selector === 'extensions-toolbar #devMode')
        return {
          evaluate: async () => developerMode,
          click: async () => {
            developerMode = !developerMode;
            toggles += 1;
          },
        };
      assert.equal(selector, 'extensions-detail-view #dev-reload-button');
      return {
        count: async () => 1,
        isVisible: async () => true,
        click: async () => {
          assert.equal(
            developerMode,
            true,
            'native reload must enable Developer mode before reload',
          );
          reloaded = true;
          events.get('Target.targetInfoChanged')({ targetInfo: oldWorker });
          events.get('Target.targetDestroyed')({ targetId: oldWorker.targetId });
          events.get('Target.targetCreated')({ targetInfo: worker });
          if (clickFailure) throw new Error('native_reload_click_interrupted');
        },
      };
    },
  };
  const cdp = {
    on: (event, listener) => events.set(event, listener),
    off: (event) => events.delete(event),
    async send(method) {
      if (method === 'Target.getTargets')
        return {
          targetInfos: reloaded
            ? [worker, ...(opened ? [panel] : [])]
            : retireBeforeClick && ++targetReads >= 2
              ? [oldPanel]
              : [oldWorker, oldPanel],
        };
      if (method === 'Target.attachToTarget') return { sessionId: 'owned-session' };
      if (method === 'Runtime.evaluate')
        return (
          contextResults?.[Math.min(contextReads++, contextResults.length - 1)] ?? {
            result: { value: [{ contextType: 'SIDE_PANEL', documentUrl: panelUrl, tabId: -1 }] },
          }
        );
      assert.ok(['Target.setDiscoverTargets', 'Target.detachFromTarget'].includes(method));
      return {};
    },
  };
  const result = await reloadOwnedExtension({
    cdp,
    context: { newPage: async () => details },
    page: {
      bringToFront: async () => {},
      locator: () => ({
        click: async () => {
          opened = true;
        },
      }),
    },
    extensionId,
    oldPanelId: oldPanel.targetId,
  });
  assert.equal(result.management_reload_clicked, true);
  assert.equal(result.old_targets_retired, true);
  assert.equal(result.worker_replaced, true);
  assert.equal(result.panel_replaced, true);
  const timeline = result.retirement_evidence.timeline;
  assert.equal(timeline.old_worker_id, oldWorker.targetId);
  assert.equal(timeline.replacement_worker_id, worker.targetId);
  assert.equal(timeline.pre_click_old_worker_present, true);
  assert.equal(timeline.final_predicate, true);
  assert.deepEqual(timeline.final_snapshot, [
    { target_id: worker.targetId, type: 'service_worker', kind: 'worker' },
    { target_id: panel.targetId, type: 'page', kind: 'panel' },
  ]);
  const phases = timeline.entries.map((entry) => entry.phase);
  assert.ok(phases.indexOf('discovery_enabled') < phases.indexOf('listeners_registered'));
  assert.ok(phases.indexOf('listeners_registered') < phases.indexOf('pre_click_snapshot'));
  assert.ok(phases.indexOf('pre_click_snapshot') < phases.indexOf('click_started'));
  assert.ok(phases.indexOf('click_started') < phases.indexOf('target_info_changed'));
  assert.ok(phases.indexOf('target_destroyed') < phases.indexOf('target_created'));
  assert.ok(phases.indexOf('target_created') < phases.indexOf('click_resolved'));
  assert.ok(timeline.entries.every((entry) => /^\d{4}-/.test(entry.at)));
  assert.ok(
    timeline.entries.every((entry) => !JSON.stringify(entry).includes('chrome-extension://')),
  );
  if (contextResults) assert.equal(result.context_boundary.attempts, contextResults.length);
  assert.equal(
    toggles,
    initiallyEnabled ? 0 : 1,
    'native reload preserves existing Developer mode',
  );
  return result;
}
await reloadCase({ initiallyEnabled: false });
await reloadCase({ initiallyEnabled: true });
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
