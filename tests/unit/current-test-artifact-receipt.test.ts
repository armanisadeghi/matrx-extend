import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { afterEach, it } from 'vitest';
import {
  selectOrImportNativeTarget,
  verifyDownloadedTree,
  verifyGitHubMetadata,
  verifyImportedNativeEvidence,
  withReservedImportTarget,
} from '../../scripts/current-test-artifact.mjs';
import {
  recordLocalDevBuild,
  requireLocalDevReceipt,
} from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';

const repo = resolve(import.meta.dirname, '..', '..');
const owner = 'armanisadeghi/matrx-extend';
const sha = 'ceda515a275d5ccfc0675e999ad2aa9307a70264';
const digest = `sha256:${'a'.repeat(64)}`;
const run = {
  id: 37020466023,
  repository: { full_name: owner },
  head_repository: { full_name: owner },
  workflow_id: 1517,
  path: '.github/workflows/ci.yml',
  event: 'push',
  head_branch: 'main',
  status: 'completed',
  conclusion: 'success',
  head_sha: sha,
  run_attempt: 1,
};
const workflow = { id: 1517 };
const artifact = {
  id: 8421,
  name: `matrx-extend-development-test-${sha}-${run.id}-${run.run_attempt}`,
  expired: false,
  digest,
  workflow_run: { id: run.id, head_sha: sha },
};
const owned: string[] = [];
afterEach(async () => {
  for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true });
});

async function fixture() {
  const source = randomBytes(20).toString('hex');
  const root = join(repo, 'test-results', 'ci-artifacts', source);
  owned.push(root);
  const build = join(root, '37020466023-1', 'chrome-mv3');
  await mkdir(build, { recursive: true });
  const version = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).version;
  const config = await readFile(join(repo, 'wxt.config.ts'), 'utf8');
  const key = /const devExtensionKey =\s*'([^']+)'/.exec(config)?.[1];
  assert.ok(key, 'the checked-in development key is required for this fixture');
  await writeFile(
    join(build, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, version, key }),
  );
  await writeFile(join(build, 'sidepanel.js'), 'development guest entry');
  const localReceiptPath = join(root, '37020466023-1', 'local-dev-receipt.json');
  const receipt = await recordLocalDevBuild({ extensionDir: build, outputPath: localReceiptPath });
  const ciReceipt = {
    ...receipt,
    extensionDir: '/home/runner/work/matrx-extend/matrx-extend/.output/chrome-mv3',
  };
  const provenance = {
    schema_version: 1,
    kind: 'ci_development_test',
    eligibleStore: false,
    publish_state: 'not_published',
    repository: owner,
    workflow: '.github/workflows/ci.yml',
    event: 'push',
    ref: 'refs/heads/main',
    sourceSha: run.head_sha,
    runId: run.id,
    runAttempt: run.run_attempt,
    version,
    expectedExtensionId: 'cihdmkcdjjckfhjpgoedmgfpoljebaml',
    treeSha256: receipt.treeSha256,
  };
  return { root, build, version, receipt, ciReceipt, provenance, localReceiptPath };
}

it('accepts only successful main-push CI metadata and the exact artifact digest', () => {
  assert.equal(
    verifyGitHubMetadata(run, workflow, artifact, String(run.id), String(artifact.id)),
    'a'.repeat(64),
  );
  for (const changed of [
    { run: { conclusion: 'cancelled' } },
    { run: { event: 'pull_request' } },
    { run: { head_branch: 'feature' } },
    { run: { path: '.github/workflows/release.yml' } },
    { run: { head_sha: 'b'.repeat(40) } },
    { run: { repository: { full_name: 'other/repo' } } },
    { run: { run_attempt: 2 } },
    { artifact: { digest: 'sha256:invalid' } },
    { artifact: { id: 8422 } },
    { artifact: { workflow_run: { id: run.id, head_sha: 'b'.repeat(40) } } },
  ]) {
    assert.throws(
      () =>
        verifyGitHubMetadata(
          { ...run, ...changed.run },
          workflow,
          { ...artifact, ...changed.artifact },
          String(run.id),
          String(artifact.id),
        ),
      /test_artifact_(?:run|github_metadata)_refused/,
    );
  }
  assert.throws(
    () => verifyGitHubMetadata(run, { id: 1518 }, artifact, String(run.id), String(artifact.id)),
    /test_artifact_run_refused/,
  );
  assert.throws(
    () => verifyGitHubMetadata(run, workflow, artifact, '37020466024', String(artifact.id)),
    /test_artifact_run_refused/,
  );
});

it('accepts a copied remote build only when its preserved receipt binds the real bytes and manifest', async () => {
  const { build, version, receipt, ciReceipt, provenance, localReceiptPath } = await fixture();
  assert.deepEqual(JSON.parse(await readFile(localReceiptPath, 'utf8')), receipt);
  assert.equal(requireLocalDevReceipt(receipt, build), receipt);
  await verifyDownloadedTree(build, ciReceipt, provenance, run, version);
  await writeFile(join(build, 'sidepanel.js'), 'tampered after CI receipt');
  await assert.rejects(
    verifyDownloadedTree(build, ciReceipt, provenance, run, version),
    /test_artifact_tree_refused/,
  );
});

it('refuses a receipt bound to another run directory or a symlinked build entry', async () => {
  const { root, build, version, receipt, ciReceipt, provenance } = await fixture();
  const wrongOutput = join(root, '37020466024-1', 'local-dev-receipt.json');
  await mkdir(resolve(wrongOutput, '..'));
  await assert.rejects(
    recordLocalDevBuild({ extensionDir: build, outputPath: wrongOutput }),
    /local_dev_receipt_output_refused/,
  );
  assert.throws(
    () =>
      requireLocalDevReceipt(
        { ...receipt, extensionDir: join(root, '37020466024-1', 'chrome-mv3') },
        build,
      ),
    /local_dev_build_receipt_refused/,
  );
  await symlink(join(build, 'sidepanel.js'), join(build, 'shadow.js'));
  await assert.rejects(
    verifyDownloadedTree(build, ciReceipt, provenance, run, version),
    /Refusing symlink/,
  );
});

it('refuses an occupied import path without changing its existing bytes', async () => {
  const { root } = await fixture();
  const source = basename(root);
  const existing = join(root, '37020466023-1', 'chrome-mv3', 'sidepanel.js');
  const original = await readFile(existing);
  let entered = false;
  await assert.rejects(
    withReservedImportTarget(source, run.id, run.run_attempt, async () => {
      entered = true;
    }),
    { code: 'EEXIST' },
  );
  assert.equal(entered, false);
  assert.deepEqual(await readFile(existing), original);
  const target = resolve(existing, '../..');
  await writeFile(join(target, 'import-status.json'), JSON.stringify({ artifactId: artifact.id }));
  const reused = await selectOrImportNativeTarget(
    join(repo, 'test-results', 'ci-artifacts'),
    String(run.id),
    String(artifact.id),
    async () => {
      throw new Error('duplicate import must not run');
    },
  );
  assert.equal(reused.target, target);
  assert.deepEqual(await readFile(existing), original);
  let importedWrongArtifact = false;
  await assert.rejects(
    selectOrImportNativeTarget(
      join(repo, 'test-results', 'ci-artifacts'),
      String(run.id),
      String(artifact.id + 1),
      async () => {
        importedWrongArtifact = true;
        throw new Error('wrong artifact unavailable');
      },
    ),
    /wrong artifact unavailable/,
  );
  assert.equal(importedWrongArtifact, true);
});

it('imports a missing exact target and refuses incomplete or ambiguous matches', async () => {
  const source = randomBytes(20).toString('hex');
  const root = join(repo, 'test-results', 'ci-artifacts');
  const first = join(root, source, `${run.id}-1`);
  owned.push(join(root, source));
  let imports = 0;
  const importMissing = async () => {
    imports += 1;
    await mkdir(first, { recursive: true });
    await writeFile(join(first, 'import-status.json'), JSON.stringify({ artifactId: artifact.id }));
  };
  const selected = await selectOrImportNativeTarget(
    root,
    String(run.id),
    String(artifact.id),
    importMissing,
  );
  assert.equal(selected.target, first);
  assert.equal(imports, 1);
  const secondSource = randomBytes(20).toString('hex');
  const second = join(root, secondSource, `${run.id}-1`);
  owned.push(join(root, secondSource));
  await mkdir(second, { recursive: true });
  await writeFile(join(second, 'import-status.json'), JSON.stringify({ artifactId: artifact.id }));
  await assert.rejects(
    selectOrImportNativeTarget(root, String(run.id), String(artifact.id), importMissing),
    /test_artifact_matching_import_ambiguous/,
  );
  await rm(join(second, 'import-status.json'));
  await assert.rejects(
    selectOrImportNativeTarget(root, String(run.id), String(artifact.id), importMissing),
    { code: 'ENOENT' },
  );
  assert.equal(imports, 1);
});

it('refuses a symlink at the run-qualified import destination', async () => {
  const source = randomBytes(20).toString('hex');
  const root = join(repo, 'test-results', 'ci-artifacts', source);
  owned.push(root);
  await mkdir(root, { recursive: true });
  await symlink(join(repo, 'test-results'), join(root, '37020466023-1'));
  await assert.rejects(
    withReservedImportTarget(source, run.id, run.run_attempt, async () => {}),
    /test_artifact_import_symlink_refused/,
  );
});

it('removes only a newly reserved import when its write fails', async () => {
  const source = randomBytes(20).toString('hex');
  const root = join(repo, 'test-results', 'ci-artifacts', source);
  owned.push(root);
  await assert.rejects(
    withReservedImportTarget(source, run.id, run.run_attempt, async (target: string) => {
      await writeFile(join(target, 'partial.json'), '{}');
      throw new Error('copy interrupted');
    }),
    /copy interrupted/,
  );
  await assert.rejects(readFile(join(root, '37020466023-1', 'partial.json')), { code: 'ENOENT' });
});

it('refuses mismatched CI provenance even when build bytes still match', async () => {
  const { build, version, ciReceipt, provenance } = await fixture();
  for (const changed of [
    { sourceSha: 'b'.repeat(40) },
    { runId: run.id + 1 },
    { runAttempt: 2 },
    { ref: 'refs/tags/v0.2.175' },
    { workflow: '.github/workflows/release.yml' },
    { eligibleStore: true },
    { treeSha256: 'b'.repeat(64) },
    { version: '0.0.0' },
  ]) {
    await assert.rejects(
      verifyDownloadedTree(build, ciReceipt, { ...provenance, ...changed }, run, version),
      /test_artifact_provenance_refused/,
    );
  }
  await assert.rejects(
    verifyDownloadedTree(
      build,
      { ...ciReceipt, treeSha256: 'b'.repeat(64) },
      provenance,
      run,
      version,
    ),
    /test_artifact_provenance_refused/,
  );
  assert.equal(hashReleaseTree(build), ciReceipt.treeSha256);
});

it('refuses a CI receipt with malformed schema, timestamp, or original build path', async () => {
  const { build, version, ciReceipt, provenance } = await fixture();
  for (const changed of [
    { schema_version: 2 },
    { observedAt: 'yesterday' },
    { extensionDir: '/tmp/other-extension/chrome-mv3' },
    { extensionDir: '/home/runner/work/matrx-extend/matrx-extend/.output/../chrome-mv3' },
  ]) {
    await assert.rejects(
      verifyDownloadedTree(build, { ...ciReceipt, ...changed }, provenance, run, version),
      /test_artifact_provenance_refused/,
    );
  }
});

it('binds the native result to unchanged CI evidence and freshly classifies source drift', async () => {
  const { root, build, receipt, ciReceipt, provenance, localReceiptPath } = await fixture();
  const target = resolve(build, '..');
  const sourceSha = basename(root);
  const nativeProvenance = { ...provenance, sourceSha };
  const ciReceiptBytes = Buffer.from(JSON.stringify(ciReceipt));
  const provenanceBytes = Buffer.from(JSON.stringify(nativeProvenance));
  await writeFile(join(target, 'ci-receipt.json'), ciReceiptBytes);
  await writeFile(join(target, 'provenance.json'), provenanceBytes);
  const status = {
    schema_version: 1,
    eligibleStore: false,
    sourceSha,
    runId: run.id,
    runAttempt: run.run_attempt,
    artifactId: artifact.id,
    githubArtifactDigest: digest,
    treeSha256: receipt.treeSha256,
    ciReceiptSha256: createHash('sha256').update(ciReceiptBytes).digest('hex'),
    provenanceSha256: createHash('sha256').update(provenanceBytes).digest('hex'),
  };
  await writeFile(join(target, 'import-status.json'), JSON.stringify(status));
  const fakeBin = join(root, 'fake-bin');
  await mkdir(fakeBin);
  await writeFile(
    join(fakeBin, 'git'),
    '#!/bin/sh\ncase "$1 $2" in\n  "fetch --quiet") exit 0;;\n  "rev-parse origin/main") printf "%s\\n" "$FAKE_ORIGIN_SHA";;\n  "rev-parse HEAD") printf "%s\\n" "$FAKE_LOCAL_SHA";;\n  "status --porcelain") printf "%s" "$FAKE_TRACKED_DIRT";;\n  "ls-files --others") printf "%s" "$FAKE_UNTRACKED_RUNNER";;\n  *) exit 3;;\nesac\n',
    { mode: 0o700 },
  );
  const oldPath = process.env.PATH;
  try {
    process.env.PATH = `${fakeBin}:${oldPath}`;
    process.env.FAKE_ORIGIN_SHA = sourceSha;
    process.env.FAKE_LOCAL_SHA = sourceSha;
    process.env.FAKE_TRACKED_DIRT = '';
    process.env.FAKE_UNTRACKED_RUNNER = '';
    const current = await verifyImportedNativeEvidence(build, localReceiptPath);
    assert.equal(current.artifactId, artifact.id);
    assert.equal(current.githubArtifactDigest, digest);
    assert.equal(current.treeSha256, receipt.treeSha256);
    assert.equal(current.source.claim, 'current_pushed_source');
    process.env.FAKE_ORIGIN_SHA = 'b'.repeat(40);
    assert.equal(
      (await verifyImportedNativeEvidence(build, localReceiptPath)).source.claim,
      'exact_pushed_commit_only',
    );
    process.env.FAKE_ORIGIN_SHA = sourceSha;
    process.env.FAKE_UNTRACKED_RUNNER = 'tests/browser/seo-guest-acceptance-local.mjs';
    const untracked = await verifyImportedNativeEvidence(build, localReceiptPath);
    assert.equal(untracked.source.claim, 'exact_pushed_commit_only');
    assert.deepEqual(untracked.source.untrackedRunnerInputs, [
      'tests/browser/seo-guest-acceptance-local.mjs',
    ]);
    await writeFile(join(target, 'ci-receipt.json'), 'changed');
    await assert.rejects(
      verifyImportedNativeEvidence(build, localReceiptPath),
      /test_artifact_native_evidence_refused/,
    );
  } finally {
    process.env.PATH = oldPath;
    Reflect.deleteProperty(process.env, 'FAKE_ORIGIN_SHA');
    Reflect.deleteProperty(process.env, 'FAKE_LOCAL_SHA');
    Reflect.deleteProperty(process.env, 'FAKE_TRACKED_DIRT');
    Reflect.deleteProperty(process.env, 'FAKE_UNTRACKED_RUNNER');
  }
});
