import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyFrozenArtifactIdentity } from '../../scripts/frozen-artifact-identity.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';

test('frozen artifact uses its own receipt version and tree', () => {
  const extensionDir = mkdtempSync(join(tmpdir(), 'matrx-frozen-artifact-'));
  try {
    const manifest = { manifest_version: 3, version: '0.2.387', key: 'test-key' };
    writeFileSync(join(extensionDir, 'manifest.json'), JSON.stringify(manifest));
    const receipt = { version: '0.2.387', treeSha256: hashReleaseTree(extensionDir) };

    // The workflow checkout can already have advanced to 0.2.388.
    assert.equal(
      verifyFrozenArtifactIdentity({ extensionDir, manifest, receipt }).version,
      '0.2.387',
    );
    assert.throws(
      () =>
        verifyFrozenArtifactIdentity({
          extensionDir,
          manifest: { ...manifest, version: '0.2.388' },
          receipt,
        }),
      /artifact_manifest_version_mismatch/,
    );
    assert.throws(
      () =>
        verifyFrozenArtifactIdentity({
          extensionDir,
          manifest,
          receipt: { ...receipt, treeSha256: '0'.repeat(64) },
        }),
      /artifact_tree_mismatch/,
    );
    writeFileSync(join(extensionDir, 'changed.txt'), 'unexpected mutation');
    assert.throws(
      () => verifyFrozenArtifactIdentity({ extensionDir, manifest, receipt }),
      /artifact_tree_mismatch/,
    );
  } finally {
    rmSync(extensionDir, { recursive: true, force: true });
  }
});

test('native acceptance drivers do not bind imported development version to checkout package', () => {
  const repo = join(import.meta.dirname, '..', '..');
  const drivers = [
    'settings-local-controls-acceptance.mjs',
    'seo-guest-acceptance.mjs',
    'contained-navigation-acceptance.mjs',
  ];
  for (const driver of drivers) {
    const source = readFileSync(join(repo, 'tests/browser', driver), 'utf8');
    assert.match(source, /verifyFrozenArtifactIdentity\(/, `${driver} must verify the artifact`);
    if (driver === 'settings-local-controls-acceptance.mjs') {
      assert.doesNotMatch(
        source,
        /receipt\.version, packageJson\.version, 'development receipt must match package'/,
      );
    } else {
      assert.match(
        source,
        /DEV_BUILD_RECEIPT === undefined[^\n]*\n[^\n]*assert\.equal\(manifest\.version, pkg\.version/,
      );
    }
  }
});
