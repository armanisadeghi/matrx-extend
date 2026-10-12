import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashReleaseTree } from './sync-unpacked-release.mjs';
import { requireCiDevPromotionReceipt } from './verify-ci-dev-promotion.mjs';

// Captured EXT-D-0221 shape: Screenshots acceptance consumes a promoted CI build.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'screenshots-ci-promotion-'));
  const sha = 'fe631ec14c443d025dec04c1fa00795b1feaddb0';
  const source = join(root, 'test-results/ci-artifacts', sha, '38316843884-1/chrome-mv3');
  const destination = join(root, '.output/chrome-mv3-dev');
  mkdirSync(source, { recursive: true });
  const key = readFileSync(new URL('../wxt.config.ts', import.meta.url), 'utf8').match(
    /'(MIIB[^']+)'/,
  )[1];
  writeFileSync(
    join(source, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, version: '0.2.509', key }),
  );
  writeFileSync(join(source, 'sidepanel.html'), '<title>Screenshots acceptance</title>');
  cpSync(source, destination, { recursive: true });
  const tree = hashReleaseTree(source);
  const receipt = {
    schema_version: 1,
    kind: 'ci_development_test_promotion',
    eligibleStore: false,
    publish_state: 'not_published',
    observedAt: '2026-10-12T22:43:54.177Z',
    sourceSha: sha,
    mainSha: sha,
    compatibility: 'exact-source',
    allowedDiffPaths: [],
    version: '0.2.509',
    runId: 38316843884,
    runAttempt: 1,
    artifactId: 11777408625,
    sourceDir: source,
    destinationDir: destination,
    treeSha256: tree,
    fileCount: 2,
  };
  const evidence = {
    kind: 'ci_development_test',
    eligibleStore: false,
    publish_state: 'not_published',
    ...Object.fromEntries(
      ['sourceSha', 'version', 'runId', 'runAttempt', 'artifactId', 'treeSha256'].map((k) => [
        k,
        receipt[k],
      ]),
    ),
    githubArtifactDigest: 'sha256:23f19b512ac8896c8d5bc2f19ee7a6fa07af98980e6f2a6baf6877a28dd4b275',
  };
  return {
    root,
    source,
    destination,
    receipt,
    evidence,
    sha,
    options: {
      extensionDir: destination,
      expectedSourceSha: sha,
      expectedExtensionId: 'cihdmkcdjjckfhjpgoedmgfpoljebaml',
      repoRoot: root,
    },
  };
}

test('accepts the true promotion kind and retains CI artifact identity', () => {
  const f = fixture();
  try {
    const result = requireCiDevPromotionReceipt(f.receipt, f.evidence, f.options);
    assert.equal(result.kind, 'ci_development_test_promotion');
    assert.equal(result.sourceSha, f.sha);
    assert.equal(result.runId, 38316843884);
    assert.equal(result.artifactId, 11777408625);
    assert.equal(result.extensionId, 'cihdmkcdjjckfhjpgoedmgfpoljebaml');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

for (const mismatch of [
  'missing-source',
  'wrong-source',
  'receipt-source',
  'import-source',
  'wrong-id',
  'manifest-id',
  'wrong-path',
  'source-path',
  'run',
  'artifact',
  'version',
  'tree',
  'import-tree',
  'runtime-equivalent',
]) {
  test(`rejects ${mismatch} before browser startup`, () => {
    const f = fixture();
    try {
      if (mismatch === 'missing-source') f.options.expectedSourceSha = undefined;
      if (mismatch === 'wrong-source') f.options.expectedSourceSha = 'a'.repeat(40);
      if (mismatch === 'receipt-source') f.receipt.sourceSha = 'a'.repeat(40);
      if (mismatch === 'import-source') f.evidence.sourceSha = 'a'.repeat(40);
      if (mismatch === 'wrong-id') f.options.expectedExtensionId = 'a'.repeat(32);
      if (mismatch === 'manifest-id') {
        for (const build of [f.source, f.destination]) {
          const path = join(build, 'manifest.json');
          const manifest = JSON.parse(readFileSync(path, 'utf8'));
          manifest.key = Buffer.alloc(294, 7).toString('base64');
          writeFileSync(path, JSON.stringify(manifest));
        }
        f.receipt.treeSha256 = f.evidence.treeSha256 = hashReleaseTree(f.source);
      }
      if (mismatch === 'wrong-path') f.receipt.destinationDir = f.source;
      if (mismatch === 'source-path') f.receipt.sourceDir = f.destination;
      if (mismatch === 'run') f.receipt.runId++;
      if (mismatch === 'artifact') f.receipt.artifactId++;
      if (mismatch === 'version') f.receipt.version = '0.2.510';
      if (mismatch === 'tree')
        writeFileSync(join(f.destination, 'sidepanel.html'), 'changed installed tree');
      if (mismatch === 'import-tree')
        writeFileSync(join(f.source, 'sidepanel.html'), 'changed imported tree');
      if (mismatch === 'runtime-equivalent') {
        f.receipt.compatibility = 'runtime-equivalent';
        f.receipt.mainSha = 'a'.repeat(40);
      }
      assert.throws(
        () => requireCiDevPromotionReceipt(f.receipt, f.evidence, f.options),
        /ci_dev_promotion_.*refused/,
      );
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}
