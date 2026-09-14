import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashReleaseTree, promoteUnpackedRelease } from '../../scripts/sync-unpacked-release.mjs';

const roots: string[] = [];
const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'matrx-release-artifacts-'));
  roots.push(root);
  return root;
};
const writeBundle = (dir: string, version: string, keyed = true) => {
  mkdirSync(join(dir, 'chunks'), { recursive: true });
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ version, ...(keyed ? { key: 'dev-key' } : {}) }),
  );
  writeFileSync(join(dir, 'chunks', `main-${version}.js`), `bundle-${version}`);
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('release unpacked promotion', () => {
  it('replaces a stale 0.2.12 development tree with the complete keyed release tree', () => {
    const root = makeRoot();
    const source = join(root, 'chrome-mv3');
    const destination = join(root, 'chrome-mv3-dev');
    writeBundle(source, '0.2.21');
    writeBundle(destination, '0.2.12');
    writeFileSync(join(destination, 'chunks', 'obsolete-0.2.12.js'), 'obsolete');
    const promoted = promoteUnpackedRelease({
      sourceDir: source,
      destinationDir: destination,
      version: '0.2.21',
    });
    expect(JSON.parse(readFileSync(join(destination, 'manifest.json'), 'utf8')).version).toBe(
      '0.2.21',
    );
    expect(() => readFileSync(join(destination, 'chunks', 'obsolete-0.2.12.js'))).toThrow();
    expect(promoted.destinationHash).toBe(hashReleaseTree(source));
  });

  it('refuses an unkeyed Store bundle without replacing the existing development tree', () => {
    const root = makeRoot();
    const source = join(root, 'chrome-mv3');
    const destination = join(root, 'chrome-mv3-dev');
    writeBundle(source, '0.2.21', false);
    writeBundle(destination, '0.2.12');
    const before = hashReleaseTree(destination);
    expect(() =>
      promoteUnpackedRelease({ sourceDir: source, destinationDir: destination, version: '0.2.21' }),
    ).toThrow('unkeyed Store bundle');
    expect(hashReleaseTree(destination)).toBe(before);
  });

  it('refuses a symlink-corrupted release tree before replacing the existing development tree', () => {
    const root = makeRoot();
    const source = join(root, 'chrome-mv3');
    const destination = join(root, 'chrome-mv3-dev');
    writeBundle(source, '0.2.21');
    symlinkSync('/etc/passwd', join(source, 'chunks', 'escaped.js'));
    writeBundle(destination, '0.2.12');
    const before = hashReleaseTree(destination);
    expect(() =>
      promoteUnpackedRelease({ sourceDir: source, destinationDir: destination, version: '0.2.21' }),
    ).toThrow('Refusing symlink');
    expect(hashReleaseTree(destination)).toBe(before);
  });

  it('CLI records only the verified keyed promotion and both artifact hashes', () => {
    const root = makeRoot();
    const source = join(root, 'chrome-mv3');
    const destination = join(root, 'chrome-mv3-dev');
    const storeZip = join(root, 'store.zip');
    const localZip = join(root, 'local.zip');
    const receipt = join(root, 'release-receipt.json');
    writeBundle(source, '0.2.21');
    writeFileSync(storeZip, 'store-bytes');
    writeFileSync(localZip, 'local-bytes');
    const result = spawnSync(
      'node',
      [
        'scripts/sync-unpacked-release.mjs',
        '--root',
        root,
        '--version',
        '0.2.21',
        '--source-sha',
        'abc123',
        '--source',
        source,
        '--destination',
        destination,
        '--store-zip',
        storeZip,
        '--local-zip',
        localZip,
        '--receipt',
        receipt,
        '--publish-state',
        'pushed',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toMatchObject({
      sourceSha: 'abc123',
      version: '0.2.21',
      publishState: 'pushed',
      sourcePath: source,
      destinationPath: destination,
    });
  });
});
