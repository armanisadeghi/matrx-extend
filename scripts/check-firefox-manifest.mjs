import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifestPath = process.argv[2];
assert.ok(manifestPath, 'usage: node scripts/check-firefox-manifest.mjs <manifest-path>');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const gecko = manifest.browser_specific_settings?.gecko;

assert.equal(manifest.manifest_version, 3);
assert.equal(gecko?.id, 'matrx-extend@aimatrx.com');
assert.equal(gecko?.strict_min_version, '153.0');
assert.deepEqual(gecko?.data_collection_permissions, {
  required: [
    'personallyIdentifyingInfo',
    'authenticationInfo',
    'personalCommunications',
    'browsingActivity',
    'websiteContent',
    'websiteActivity',
    'bookmarksInfo',
  ],
  optional: ['technicalAndInteraction'],
});

for (const field of ['minimum_chrome_version', 'key', 'side_panel', 'externally_connectable']) {
  assert.equal(field in manifest, false, `${field} must be absent from Firefox manifest`);
}
for (const permission of [
  'sidePanel',
  'offscreen',
  'tabGroups',
  'debugger',
  'pageCapture',
  'tabCapture',
]) {
  assert.equal(
    [...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])].includes(
      permission,
    ),
    false,
    `${permission} must be absent from Firefox permissions`,
  );
}
assert.ok(manifest.sidebar_action, 'WXT must synthesize Firefox sidebar_action');
