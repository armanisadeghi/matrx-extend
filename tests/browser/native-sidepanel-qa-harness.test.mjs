#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isSettledGuestPanel,
  requireExpectedExtension,
  requireOwnedCommandLine,
  requireSidePanelContext,
  requireSpawnedProfileOwner,
  resolveExpectedRelease,
} from './native-sidepanel-qa-harness.mjs';

const profile = '/private/tmp/owned-profile';
const extensionId = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const receipt = {
  version: '0.2.44',
  treeSha256: 'a'.repeat(64),
  storeZip: { path: '/private/tmp/store.zip', sha256: 'b'.repeat(64) },
};

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
    guestBanner: true,
    signInControl: true,
    composer: true,
    visibleControls: 4,
  }),
  true,
);
assert.equal(
  isSettledGuestPanel({
    ready: true,
    guestBanner: true,
    signInControl: true,
    composer: false,
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
  extensionDir: '/Users/armanisadeghi/code/matrx-extend/.output/chrome-mv3-dev',
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
