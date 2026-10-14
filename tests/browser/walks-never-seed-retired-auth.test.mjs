/**
 * Guard: no walk may write the retired `matrx.auth.*` storage keys. Auth reads
 * `matrx.oauth.session` (@ai-matrx/auth matrx-oauth); a walk that seeds the old keys
 * lands signed out ("Could not restore your saved sign-in"). Every walk signs in through
 * seed-extension-session.mjs. Unit tests (`*.test.*`) may use the old key names as fake
 * fixtures for "legacy bearer is ignored" assertions, so only non-test walks are scanned.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// An object-literal key (`'matrx.auth.x': value`) or a `.set('matrx.auth.x', ...)` call.
const RETIRED_AUTH_WRITE = /['"`]matrx\.auth\.[A-Za-z]+['"`]\s*:|\.set\(\s*['"`]matrx\.auth\./;

function walkFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (/\.(mjs|cjs|js)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

test('the matcher catches a seeded retired key (guard fails on a planted write)', () => {
  assert.ok(RETIRED_AUTH_WRITE.test(`set({ 'matrx.auth.accessToken': t })`));
  assert.ok(RETIRED_AUTH_WRITE.test(`storage.local.set('matrx.auth.expiresAt', 1)`));
  assert.ok(!RETIRED_AUTH_WRITE.test(`set({ 'matrx.oauth.session': s })`));
});

test('no walk writes matrx.auth.* keys', () => {
  const offenders = walkFiles(HERE).filter((f) =>
    readFileSync(f, 'utf8')
      .split('\n')
      .some((l) => RETIRED_AUTH_WRITE.test(l)),
  );
  assert.deepEqual(offenders, [], 'seed through tests/browser/seed-extension-session.mjs instead');
});
