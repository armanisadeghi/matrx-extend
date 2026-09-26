// Real release-helper CLI and filesystem; inject only OS errors at the fs boundary.
// Use case: Arman's installed extension and release receipt must agree after an
// attempted update, even when antivirus/file permissions prevent cleanup/restore.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

function fixture(mode) {
  const root = mkdtempSync(join(tmpdir(), 'matrx-release-recovery-'));
  const source = join(root, 'candidate');
  const destinations = [join(root, 'chrome-mv3-dev'), join(root, 'chrome-mv3')];
  for (const [dir, version] of [[source, '0.3.2'], [destinations[0], '0.3.0'], [destinations[1], '0.3.1']]) {
    mkdirSync(dir);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ key: 'local-development-key', version }));
    writeFileSync(join(dir, 'sidepanel.js'), `extension release ${version}`);
  }
  const receipt = join(root, 'receipt.json');
  writeFileSync(receipt, '{"version":"0.3.1"}\n');
  writeFileSync(join(root, 'store.zip'), 'validated Store bytes');
  writeFileSync(join(root, 'local.zip'), 'validated keyed bytes');
  const preload = join(root, 'fs-fault.mjs');
  writeFileSync(preload, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const mode = ${JSON.stringify(mode)};
const receipt = ${JSON.stringify(receipt)};
const rm = fs.rmSync;
const rename = fs.renameSync;
fs.rmSync = (path, options) => {
  const value = String(path);
  if ((mode === 'cleanup' && value.includes('.chrome-mv3.release-backup-')) ||
      (mode === 'receipt-cleanup' && value.startsWith(receipt + '.stage-'))) {
    throw Object.assign(new Error('injected filesystem cleanup refusal'), { code: 'EACCES' });
  }
  return rm(path, options);
};
fs.renameSync = (from, to) => {
  if ((mode === 'receipt' || mode === 'restore') && String(to) === receipt) {
    throw Object.assign(new Error('injected receipt write refusal'), { code: 'EACCES' });
  }
  if (mode === 'restore' && String(from).includes('.chrome-mv3.release-backup-')) {
    throw Object.assign(new Error('injected prior bundle restore refusal'), { code: 'EACCES' });
  }
  return rename(from, to);
};
syncBuiltinESMExports();
`);
  return { root, source, destinations, receipt, preload };
}
function run(value) {
  return spawnSync(process.execPath, ['--import', value.preload,
    resolve('scripts/sync-unpacked-release.mjs'), '--root', value.root,
    '--source', value.source, '--version', '0.3.2', '--source-sha', 'validated-candidate',
    '--destination', value.destinations[0], '--also-destination', value.destinations[1],
    '--store-zip', join(value.root, 'store.zip'), '--local-zip', join(value.root, 'local.zip'),
    '--receipt', value.receipt], { encoding: 'utf8' });
}
const manifestVersion = (dir) => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).version;
for (const mode of ['cleanup', 'receipt-cleanup']) {
  test(`${mode} failure keeps committed bundles and receipt coherent and exits successfully`, () => {
    const value = fixture(mode);
    try {
      const result = run(value);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /WARNING: Release committed; cleanup failed/);
      assert.deepEqual(value.destinations.map(manifestVersion), ['0.3.2', '0.3.2']);
      assert.equal(JSON.parse(readFileSync(value.receipt, 'utf8')).version, '0.3.2');
      for (const dir of value.destinations) assert.equal(readFileSync(join(dir, 'sidepanel.js'), 'utf8'), 'extension release 0.3.2');
      if (mode === 'cleanup') {
        const backup = readdirSync(value.root).find((name) => name.startsWith('.chrome-mv3.release-backup-'));
        assert.ok(backup, 'failed cleanup must retain the prior bundle');
        assert.equal(manifestVersion(join(value.root, backup)), '0.3.1');
      }
    } finally { rmSync(value.root, { recursive: true, force: true }); }
  });
}
test('receipt commit failure restores both distinct prior bundles and leaves old receipt', () => {
  const value = fixture('receipt');
  try {
    const result = run(value);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /prior unpacked paths restored/);
    assert.deepEqual(value.destinations.map(manifestVersion), ['0.3.0', '0.3.1']);
    assert.equal(readFileSync(value.receipt, 'utf8'), '{"version":"0.3.1"}\n');
  } finally { rmSync(value.root, { recursive: true, force: true }); }
});
test('failed rollback retains the unrecovered backup while restoring the independent destination', () => {
  const value = fixture('restore');
  try {
    const result = run(value);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Recovery incomplete/);
    assert.equal(manifestVersion(value.destinations[0]), '0.3.0');
    assert.equal(existsSync(value.destinations[1]), false);
    const backup = readdirSync(value.root).find((name) => name.startsWith('.chrome-mv3.release-backup-'));
    assert.ok(backup);
    assert.equal(manifestVersion(join(value.root, backup)), '0.3.1');
    assert.ok(result.stderr.includes(join(value.root, backup)), 'error names the recoverable prior bytes');
    assert.equal(readFileSync(value.receipt, 'utf8'), '{"version":"0.3.1"}\n');
  } finally { rmSync(value.root, { recursive: true, force: true }); }
});
