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
