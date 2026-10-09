import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promoteVerifiedCiDevArtifact } from './promote-ci-dev-artifact.mjs';
import { hashReleaseTree } from './sync-unpacked-release.mjs';

const sha = 'eb5fc114fec75c6be5e0c4e4939aad53cf14ca1b';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ci-dev-promotion-'));
  const source = join(root, 'test-results', 'ci-artifacts', sha, '37986090931-1', 'chrome-mv3');
  const destination = join(root, '.output', 'chrome-mv3-dev');
  mkdirSync(source, { recursive: true });
  mkdirSync(destination, { recursive: true });
  writeFileSync(
    join(source, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, version: '0.2.456', key: 'development-key' }),
  );
  writeFileSync(join(source, 'panel.js'), randomBytes(20));
  writeFileSync(
    join(destination, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, version: '0.2.455', key: 'development-key' }),
  );
  writeFileSync(join(destination, 'old-chunk.js'), 'prior installation');
  const evidence = {
    kind: 'ci_development_test',
    eligibleStore: false,
    publish_state: 'not_published',
    sourceSha: sha,
    version: '0.2.456',
    runId: 37986090931,
    runAttempt: 1,
    artifactId: 11643292724,
    source: { originMain: sha, localHead: sha },
    treeSha256: hashReleaseTree(source),
  };
  return { root, source, destination, evidence };
}

test('promotes exact imported bytes, replaces obsolete files, and records SHA/version/tree', () => {
  const f = fixture();
  try {
    const result = promoteVerifiedCiDevArtifact({
      sourceDir: f.source,
      evidence: f.evidence,
      repoRoot: f.root,
    });
    const receipt = JSON.parse(readFileSync(result.receiptPath, 'utf8'));
    assert.equal(hashReleaseTree(f.destination), f.evidence.treeSha256);
    assert.throws(() => readFileSync(join(f.destination, 'old-chunk.js')), { code: 'ENOENT' });
    assert.deepEqual(
      [receipt.sourceSha, receipt.version, receipt.treeSha256],
      [sha, '0.2.456', f.evidence.treeSha256],
    );
    assert.equal(receipt.eligibleStore, false);
    assert.equal(receipt.publish_state, 'not_published');
    const again = promoteVerifiedCiDevArtifact({
      sourceDir: f.source,
      evidence: f.evidence,
      repoRoot: f.root,
    });
    assert.equal(hashReleaseTree(f.destination), again.treeSha256);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('refuses changed source or mismatched run without touching installed bytes', () => {
  const f = fixture();
  try {
    const before = hashReleaseTree(f.destination);
    assert.throws(
      () =>
        promoteVerifiedCiDevArtifact({
          sourceDir: f.source,
          evidence: { ...f.evidence, runId: 37986090932 },
          repoRoot: f.root,
        }),
      /ci_dev_evidence_refused/,
    );
    assert.throws(
      () =>
        promoteVerifiedCiDevArtifact({
          sourceDir: f.source,
          evidence: { ...f.evidence, source: { originMain: 'a'.repeat(40), localHead: sha } },
          repoRoot: f.root,
        }),
      /ci_dev_evidence_refused/,
    );
    writeFileSync(join(f.source, 'panel.js'), 'changed after verification');
    assert.throws(
      () =>
        promoteVerifiedCiDevArtifact({
          sourceDir: f.source,
          evidence: f.evidence,
          repoRoot: f.root,
        }),
      /ci_dev_source_changed/,
    );
    assert.equal(hashReleaseTree(f.destination), before);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('restores the installed tree when receipt commit fails', () => {
  const f = fixture();
  try {
    const before = hashReleaseTree(f.destination);
    const receiptPath = join(f.root, 'test-results', 'ci-dev-promotion-receipt.json');
    mkdirSync(receiptPath);
    assert.throws(
      () =>
        promoteVerifiedCiDevArtifact({
          sourceDir: f.source,
          evidence: f.evidence,
          repoRoot: f.root,
        }),
      /Promotion failed/,
    );
    assert.equal(hashReleaseTree(f.destination), before);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('refuses a symlinked stable destination', () => {
  const f = fixture();
  try {
    rmSync(f.destination, { recursive: true });
    symlinkSync(f.source, f.destination);
    assert.throws(
      () =>
        promoteVerifiedCiDevArtifact({
          sourceDir: f.source,
          evidence: f.evidence,
          repoRoot: f.root,
        }),
      /ci_dev_symlink_path_refused/,
    );
    assert.equal(hashReleaseTree(f.source), f.evidence.treeSha256);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
