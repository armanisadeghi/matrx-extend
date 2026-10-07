import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';

export function desktopArtifactSelectionEnv(prepared) {
  assert.match(prepared.sourceSha ?? '', /^[a-f0-9]{40}$/, 'desktop_source_selection_required');
  assert.ok(
    Number.isSafeInteger(prepared.runId) && prepared.runId > 0,
    'desktop_run_selection_required',
  );
  assert.ok(
    Number.isSafeInteger(prepared.artifactId) && prepared.artifactId > 0,
    'desktop_artifact_selection_required',
  );
  return {
    MATRX_DESKTOP_SETTINGS_SOURCE_SHA: prepared.sourceSha,
    MATRX_DESKTOP_SETTINGS_RUN_ID: String(prepared.runId),
    MATRX_DESKTOP_SETTINGS_ARTIFACT_ID: String(prepared.artifactId),
  };
}

// The hosted importer chooses and verifies an exact CI artifact. Keep that
// selection explicit all the way to the native driver.
export async function verifyDesktopArtifactIdentity({
  repo,
  extensionDir,
  receiptPath,
  sourceSha,
  runId,
  artifactId,
}) {
  assert.match(sourceSha ?? '', /^[a-f0-9]{40}$/, 'desktop_source_selection_required');
  assert.match(runId ?? '', /^[1-9]\d*$/, 'desktop_run_selection_required');
  assert.match(artifactId ?? '', /^[1-9]\d*$/, 'desktop_artifact_selection_required');
  const build = resolve(extensionDir);
  const match =
    /^test-results\/ci-artifacts\/([a-f0-9]{40})\/([1-9]\d*)-([1-9]\d*)\/chrome-mv3$/.exec(
      build.startsWith(`${resolve(repo)}/`) ? build.slice(resolve(repo).length + 1) : '',
    );
  assert.ok(match, 'desktop_artifact_path_refused');
  assert.equal(
    resolve(receiptPath),
    join(build, '..', 'local-dev-receipt.json'),
    'desktop_receipt_path_refused',
  );
  assert.equal(match[1], sourceSha, 'desktop_source_mismatch');
  assert.equal(match[2], runId, 'desktop_run_mismatch');
  const [receipt, status, manifest] = await Promise.all([
    readFile(receiptPath, 'utf8').then(JSON.parse),
    readFile(join(build, '..', 'import-status.json'), 'utf8').then(JSON.parse),
    readFile(join(build, 'manifest.json'), 'utf8').then(JSON.parse),
  ]);
  assert.equal(receipt.kind, 'local_dev_unpacked', 'desktop_receipt_kind_refused');
  assert.equal(resolve(receipt.extensionDir ?? ''), build, 'desktop_receipt_path_refused');
  if (receipt.sourceSha !== undefined)
    assert.equal(receipt.sourceSha, sourceSha, 'desktop_source_mismatch');
  if (receipt.runId !== undefined)
    assert.equal(receipt.runId, Number(runId), 'desktop_run_mismatch');
  if (receipt.artifactId !== undefined)
    assert.equal(receipt.artifactId, Number(artifactId), 'desktop_artifact_mismatch');
  assert.equal(status.sourceSha, sourceSha, 'desktop_source_mismatch');
  assert.equal(status.runId, Number(runId), 'desktop_run_mismatch');
  assert.equal(status.runAttempt, Number(match[3]), 'desktop_attempt_mismatch');
  assert.equal(status.artifactId, Number(artifactId), 'desktop_artifact_mismatch');
  assert.equal(status.treeSha256, receipt.treeSha256, 'desktop_tree_mismatch');
  assert.equal(hashReleaseTree(build), receipt.treeSha256, 'desktop_tree_mismatch');
  assert.equal(manifest.version, receipt.version, 'desktop_version_mismatch');
  for (const sha of ['39ee192b', 'cf0877f1', '17b8ea9d'])
    execFileSync('git', ['merge-base', '--is-ancestor', sha, sourceSha], { cwd: repo });
  return {
    receipt,
    build: {
      source_sha: sourceSha,
      run_id: Number(runId),
      artifact_id: Number(artifactId),
      tree_sha256: receipt.treeSha256,
      version: receipt.version,
    },
  };
}
