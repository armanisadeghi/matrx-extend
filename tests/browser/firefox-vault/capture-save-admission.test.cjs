const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { test } = require('node:test');

test('capture-save launch hold refuses before browser or credential custody', () => {
  const driver = join(__dirname, 'read-only-auth-driver.mjs');
  const result = spawnSync(process.execPath, [driver, '--capture-save'], {
    cwd: join(__dirname, '..', '..', '..'),
    env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /capture_save_implementation_incomplete/);
});
