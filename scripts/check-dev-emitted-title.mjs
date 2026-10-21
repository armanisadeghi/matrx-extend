import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function assertDevEmittedTitle(manifest) {
  assert.ok(manifest.key, 'Keyed Chrome development manifest must retain its stable key');
  assert.equal(manifest.name, 'Matrx Extend DEV', 'Emitted development extension name lost DEV');
  assert.equal(
    manifest.action?.default_title,
    'Matrx Extend DEV',
    'Emitted development toolbar title lost DEV after WXT merged the popup entrypoint',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifestPath = process.argv[2];
  assert.ok(manifestPath, 'usage: node scripts/check-dev-emitted-title.mjs <manifest.json>');
  assertDevEmittedTitle(JSON.parse(await readFile(manifestPath, 'utf8')));
}
