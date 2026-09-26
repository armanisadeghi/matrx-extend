import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readManifest(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const [chromePath, safariPath] = process.argv.slice(2);
assert.ok(
  chromePath && safariPath,
  'usage: node scripts/check-browser-manifests.mjs <chrome> <safari>',
);

const [chrome, safari] = await Promise.all([readManifest(chromePath), readManifest(safariPath)]);

assert.equal(chrome.manifest_version, 3);
assert.equal(chrome.minimum_chrome_version, '116');
assert.ok(chrome.key, 'Chrome development manifest must retain its stable key');
assert.deepEqual(chrome.side_panel, { default_path: 'sidepanel.html' });
assert.ok(chrome.externally_connectable?.matches?.includes('https://*.aimatrx.com/*'));
for (const permission of ['sidePanel', 'offscreen', 'tabGroups', 'debugger']) {
  assert.ok(chrome.permissions?.includes(permission), `Chrome must retain ${permission}`);
}
for (const permission of ['pageCapture', 'tabCapture']) {
  assert.ok(
    chrome.optional_permissions?.includes(permission),
    `Chrome must retain optional ${permission}`,
  );
}

assert.equal(safari.manifest_version, 2);
assert.equal(safari.minimum_chrome_version, undefined);
assert.equal(safari.key, undefined);
assert.equal(safari.browser_action?.default_popup, 'popup.html');
assert.equal(safari.externally_connectable, undefined);
for (const permission of [
  'sidePanel',
  'offscreen',
  'tabGroups',
  'debugger',
  'nativeMessaging',
  'history',
  'bookmarks',
  'downloads',
  'identity',
  'notifications',
  'sessions',
]) {
  assert.ok(!safari.permissions?.includes(permission), `Safari must omit ${permission}`);
}
for (const permission of ['pageCapture', 'clipboardRead', 'tabCapture']) {
  assert.ok(
    !safari.optional_permissions?.includes(permission),
    `Safari must omit optional ${permission}`,
  );
}
assert.equal(safari.options_ui, undefined);
