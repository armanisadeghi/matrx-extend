#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requireExpectedExtension, requireOwnedCommandLine } from './native-sidepanel-qa-harness.mjs';

const profile = '/private/tmp/owned-profile';
const extensionId = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';

assert.throws(
  () => requireOwnedCommandLine({ arguments: ['--user-data-dir=/private/tmp/other', '--remote-debugging-port=0'] }, profile),
  /foreign_browser_refused/,
);
assert.throws(
  () => requireExpectedExtension([{ type: 'service_worker', url: 'chrome-extension://foreign/background.js' }], extensionId),
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
const source = await readFile(new URL('./native-sidepanel-qa-harness.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(source, /9222/);
assert.doesNotMatch(source, /Browser\.close\(/);
console.log('PASS native sidepanel harness refuses foreign CDP/browser identities');
