import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promoteVerifiedCiDevArtifact } from './promote-ci-dev-artifact.mjs';
import { hashReleaseTree } from './sync-unpacked-release.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function commit(root, path, content) {
  const file = join(root, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
  git(root, 'add', '--', path);
  git(root, 'commit', '-qm', `Update ${path}`);
  return git(root, 'rev-parse', 'HEAD');
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ci-dev-promotion-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'ci-dev@test.invalid');
  git(root, 'config', 'user.name', 'CI development test');
  const sha = commit(root, 'src/panel.js', 'source build');
  git(root, 'update-ref', 'refs/remotes/origin/main', sha);
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
  return { root, source, destination, evidence, sha };
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
      [f.sha, '0.2.456', f.evidence.treeSha256],
    );
    assert.equal(receipt.eligibleStore, false);
    assert.equal(receipt.publish_state, 'not_published');
    assert.equal(receipt.compatibility, 'exact-source');
    assert.equal(receipt.mainSha, f.sha);
    assert.deepEqual(receipt.allowedDiffPaths, []);
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
          evidence: { ...f.evidence, source: { originMain: 'a'.repeat(40), localHead: f.sha } },
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

test('accepts a forward resource journal commit and records both source revisions', () => {
  const f = fixture();
  try {
    const journal = 'docs/stabilization/resource-journals/native-run.jsonl';
    const mainSha = commit(f.root, journal, '{"event":"completed"}\n');
    git(f.root, 'update-ref', 'refs/remotes/origin/main', mainSha);
    const result = promoteVerifiedCiDevArtifact({
      sourceDir: f.source,
      evidence: f.evidence,
      repoRoot: f.root,
    });
    const receipt = JSON.parse(readFileSync(result.receiptPath, 'utf8'));
    assert.equal(result.compatibility, 'runtime-equivalent');
    assert.equal(receipt.sourceSha, f.sha);
    assert.equal(receipt.mainSha, mainSha);
    assert.deepEqual(receipt.allowedDiffPaths, [journal]);
    assert.equal(hashReleaseTree(f.destination), f.evidence.treeSha256);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('refuses a changed source file despite an allowed resource journal', () => {
  const f = fixture();
  try {
    commit(
      f.root,
      'docs/stabilization/resource-journals/native-run.jsonl',
      '{"event":"completed"}\n',
    );
    const mainSha = commit(f.root, 'src/panel.js', 'changed runtime');
    git(f.root, 'update-ref', 'refs/remotes/origin/main', mainSha);
    const before = hashReleaseTree(f.destination);
    assert.throws(
      () =>
        promoteVerifiedCiDevArtifact({
          sourceDir: f.source,
          evidence: f.evidence,
          repoRoot: f.root,
        }),
      /ci_dev_runtime_source_changed/,
    );
    assert.equal(hashReleaseTree(f.destination), before);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('refuses a runtime file renamed into an allowed journal path', () => {
  const f = fixture();
  try {
    const journal = 'docs/stabilization/resource-journals/panel.jsonl';
    mkdirSync(join(f.root, 'docs/stabilization/resource-journals'), { recursive: true });
    git(f.root, 'mv', 'src/panel.js', journal);
    git(f.root, 'commit', '-qm', 'Move runtime source into journal directory');
    const mainSha = git(f.root, 'rev-parse', 'HEAD');
    git(f.root, 'update-ref', 'refs/remotes/origin/main', mainSha);
    const before = hashReleaseTree(f.destination);
    assert.throws(
      () =>
        promoteVerifiedCiDevArtifact({
          sourceDir: f.source,
          evidence: f.evidence,
          repoRoot: f.root,
        }),
      /ci_dev_runtime_source_changed/,
    );
    assert.equal(hashReleaseTree(f.destination), before);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('refuses runtime edits even when a later commit restores the final source tree', () => {
  const f = fixture();
  try {
    commit(f.root, 'src/panel.js', 'intermediate runtime change');
    const mainSha = commit(f.root, 'src/panel.js', 'source build');
    git(f.root, 'update-ref', 'refs/remotes/origin/main', mainSha);
    assert.throws(
      () =>
        promoteVerifiedCiDevArtifact({
          sourceDir: f.source,
          evidence: f.evidence,
          repoRoot: f.root,
        }),
      /ci_dev_runtime_source_changed/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('refuses a checkout whose HEAD differs from origin/main', () => {
  const f = fixture();
  try {
    commit(
      f.root,
      'docs/stabilization/resource-journals/native-run.jsonl',
      '{"event":"completed"}\n',
    );
    assert.throws(
      () =>
        promoteVerifiedCiDevArtifact({
          sourceDir: f.source,
          evidence: f.evidence,
          repoRoot: f.root,
        }),
      /ci_dev_checkout_not_origin_main/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('refuses an artifact source outside current main ancestry', () => {
  const f = fixture();
  try {
    git(f.root, 'checkout', '--orphan', 'different-history');
    const mainSha = commit(
      f.root,
      'docs/stabilization/resource-journals/native-run.jsonl',
      '{"event":"completed"}\n',
    );
    git(f.root, 'update-ref', 'refs/remotes/origin/main', mainSha);
    assert.throws(
      () =>
        promoteVerifiedCiDevArtifact({
          sourceDir: f.source,
          evidence: f.evidence,
          repoRoot: f.root,
        }),
      /ci_dev_source_not_ancestor/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
