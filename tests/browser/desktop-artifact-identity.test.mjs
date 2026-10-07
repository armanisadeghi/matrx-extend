import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import {
  desktopArtifactSelectionEnv,
  verifyDesktopArtifactIdentity,
} from './desktop-artifact-identity.mjs';

const repo = resolve(import.meta.dirname, '..', '..');
const sources = execFileSync('git', ['rev-list', '--max-count=2', 'HEAD'], {
  cwd: repo,
  encoding: 'utf8',
})
  .trim()
  .split('\n');

async function fixture(sourceSha, runId, artifactId) {
  const target = join(repo, 'test-results', 'ci-artifacts', sourceSha, `${runId}-1`);
  const extensionDir = join(target, 'chrome-mv3');
  const receiptPath = join(target, 'local-dev-receipt.json');
  await mkdir(extensionDir, { recursive: true });
  await writeFile(
    join(extensionDir, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, version: '0.2.391' }),
  );
  const treeSha256 = hashReleaseTree(extensionDir);
  await writeFile(
    receiptPath,
    JSON.stringify({
      kind: 'local_dev_unpacked',
      extensionDir,
      version: '0.2.391',
      treeSha256,
    }),
  );
  await writeFile(
    join(target, 'import-status.json'),
    JSON.stringify({
      sourceSha,
      runId,
      runAttempt: 1,
      artifactId,
      treeSha256,
    }),
  );
  return {
    target,
    input: {
      repo,
      extensionDir,
      receiptPath,
      sourceSha,
      runId: String(runId),
      artifactId: String(artifactId),
    },
  };
}

test('selected desktop CI artifact is accepted for two changing source/run/artifact identities', async () => {
  for (const [index, sourceSha] of sources.entries()) {
    const runId = Date.now() + index;
    const artifactId = runId + 100;
    const { target, input } = await fixture(sourceSha, runId, artifactId);
    try {
      const result = await verifyDesktopArtifactIdentity(input);
      const selectedEnv = desktopArtifactSelectionEnv({ sourceSha, runId, artifactId });
      assert.deepEqual(
        [
          selectedEnv.MATRX_DESKTOP_SETTINGS_SOURCE_SHA,
          selectedEnv.MATRX_DESKTOP_SETTINGS_RUN_ID,
          selectedEnv.MATRX_DESKTOP_SETTINGS_ARTIFACT_ID,
        ],
        [sourceSha, String(runId), String(artifactId)],
      );
      assert.deepEqual(
        [result.build.source_sha, result.build.run_id, result.build.artifact_id],
        [sourceSha, runId, artifactId],
      );
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  }
});

test('desktop selection refuses wrong source, run, artifact, attempt, tree, and runtime', async () => {
  const runId = Date.now() + 10;
  const artifactId = runId + 100;
  const { target, input } = await fixture(sources[0], runId, artifactId);
  const statusPath = join(target, 'import-status.json');
  const manifestPath = join(input.extensionDir, 'manifest.json');
  const originalStatus = {
    sourceSha: sources[0],
    runId,
    runAttempt: 1,
    artifactId,
    treeSha256: hashReleaseTree(input.extensionDir),
  };
  try {
    await assert.rejects(
      verifyDesktopArtifactIdentity({ ...input, sourceSha: undefined }),
      /desktop_source_selection_required/,
    );
    await assert.rejects(
      verifyDesktopArtifactIdentity({ ...input, sourceSha: sources[1] }),
      /desktop_source_mismatch/,
    );
    await assert.rejects(
      verifyDesktopArtifactIdentity({ ...input, runId: String(runId + 1) }),
      /desktop_run_mismatch/,
    );
    await assert.rejects(
      verifyDesktopArtifactIdentity({ ...input, artifactId: String(artifactId + 1) }),
      /desktop_artifact_mismatch/,
    );
    await writeFile(statusPath, JSON.stringify({ ...originalStatus, runAttempt: 2 }));
    await assert.rejects(verifyDesktopArtifactIdentity(input), /desktop_attempt_mismatch/);
    await writeFile(statusPath, JSON.stringify(originalStatus));
    await writeFile(manifestPath, JSON.stringify({ manifest_version: 3, version: '0.2.392' }));
    await assert.rejects(verifyDesktopArtifactIdentity(input), /desktop_tree_mismatch/);
    const changedTree = hashReleaseTree(input.extensionDir);
    const receipt = JSON.parse(await readFile(input.receiptPath, 'utf8'));
    await writeFile(input.receiptPath, JSON.stringify({ ...receipt, treeSha256: changedTree }));
    await writeFile(statusPath, JSON.stringify({ ...originalStatus, treeSha256: changedTree }));
    await assert.rejects(verifyDesktopArtifactIdentity(input), /desktop_version_mismatch/);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
