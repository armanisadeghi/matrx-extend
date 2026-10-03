#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import {
  isSettledGuestPanel,
  requireExpectedExtension,
  requireOwnedCommandLine,
  requireSidePanelContext,
  requireSpawnedProfileOwner,
  resolveExpectedRelease,
} from './native-sidepanel-qa-harness.mjs';

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
const source = await readFile(
  new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
  'utf8',
);
assert.doesNotMatch(source, /9222/);
assert.doesNotMatch(source, /Browser\.close\(/);
console.log('PASS native sidepanel harness refuses foreign CDP/browser identities');

const { safeStartupFailureCode } = await import('./native-sidepanel-qa-harness.mjs');
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

// SUT: reloadOwnedExtension owns Developer mode setup, the native reload,
// target lifecycle proof, and refusal when Chrome disables the extension.
// Browser UI and CDP are external dependencies; their state follows UI actions.
const { reloadOwnedExtension } = await import('./native-sidepanel-qa-harness.mjs');
async function reloadCase({ initiallyEnabled, disabledAfter = false }) {
  let developerMode = initiallyEnabled;
  let reloaded = false;
  let opened = false;
  let toggles = 0;
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
          events.get('Target.targetDestroyed')({ targetId: oldWorker.targetId });
          events.get('Target.targetCreated')({ targetInfo: worker });
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
          targetInfos: reloaded ? [worker, ...(opened ? [panel] : [])] : [oldWorker, oldPanel],
        };
      if (method === 'Target.attachToTarget') return { sessionId: 'owned-session' };
      if (method === 'Runtime.evaluate')
        return {
          result: { value: [{ contextType: 'SIDE_PANEL', documentUrl: panelUrl, tabId: -1 }] },
        };
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
  assert.equal(
    toggles,
    initiallyEnabled ? 0 : 1,
    'native reload preserves existing Developer mode',
  );
  return result;
}
await reloadCase({ initiallyEnabled: false });
await reloadCase({ initiallyEnabled: true });
await assert.rejects(
  reloadCase({ initiallyEnabled: false, disabledAfter: true }),
  /native_extension_reload_disabled/,
);
console.log('PASS native reload enables Developer mode and refuses Chrome-disabled extensions');
