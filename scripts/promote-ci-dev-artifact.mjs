#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
/** Install an already-imported CI development artifact at the stable unpacked path. */
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyImportedNativeEvidence } from './current-test-artifact.mjs';
import { hashReleaseTree, promoteUnpackedReleaseToMany } from './sync-unpacked-release.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMPORTED = /^test-results\/ci-artifacts\/([a-f0-9]{40})\/([1-9]\d*)-([1-9]\d*)\/chrome-mv3$/;
// WXT bundles src/ plus public assets; these stabilization records are not imported
// by src/ or wxt.config.ts. Keep operational policy and executable files excluded.
// Changes to this promoter or its tests require a new successful CI artifact.
const RUNTIME_EQUIVALENT_PATH =
  /^docs\/stabilization\/(?:resource-journals\/[^/]+\.jsonl|[^/]+\.(?:md|html|txt)|inventory\.json|(?:defects|reports|evidence)\/(?:[^/]+\/)*[^/]+\.(?:json|jsonl|md|html|txt|log|png|jpg|jpeg|webp))$/;

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function sourceCompatibility(root, sourceSha) {
  const mainSha = git(root, 'rev-parse', 'HEAD');
  if (mainSha !== git(root, 'rev-parse', 'origin/main'))
    throw new Error('ci_dev_checkout_not_origin_main');
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', sourceSha, mainSha], {
    cwd: root,
  });
  if (ancestor.error || ancestor.status !== 0) throw new Error('ci_dev_source_not_ancestor');
  const diffPaths = execFileSync(
    'git',
    ['diff', '--no-renames', '--name-only', '-z', sourceSha, mainSha],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(Boolean);
  const committedPaths = execFileSync(
    'git',
    ['log', '--no-renames', '--format=', '--name-only', '-z', `${sourceSha}..${mainSha}`],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(Boolean);
  if ([...diffPaths, ...committedPaths].some((path) => !RUNTIME_EQUIVALENT_PATH.test(path)))
    throw new Error('ci_dev_runtime_source_changed');
  assertCurrentMain(root, mainSha);
  return {
    mainSha,
    compatibility: mainSha === sourceSha ? 'exact-source' : 'runtime-equivalent',
    diffPaths,
  };
}

function assertCurrentMain(root, mainSha) {
  if (
    git(root, 'rev-parse', 'HEAD') !== mainSha ||
    git(root, 'rev-parse', 'origin/main') !== mainSha
  )
    throw new Error('ci_dev_main_changed_during_promotion');
}

function assertNoSymlinkParents(path, root) {
  let cursor = path;
  while (cursor.startsWith(`${root}/`) || cursor === root) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error('ci_dev_symlink_path_refused');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    cursor = dirname(cursor);
  }
}

export function promoteVerifiedCiDevArtifact({ sourceDir, evidence, repoRoot = REPO }) {
  const root = resolve(repoRoot);
  const source = resolve(sourceDir);
  const destination = join(root, '.output', 'chrome-mv3-dev');
  const receiptFile = join(root, 'test-results', 'ci-dev-promotion-receipt.json');
  const relative = source.startsWith(`${root}/`) ? source.slice(root.length + 1) : '';
  const match = IMPORTED.exec(relative);
  if (!match) throw new Error('ci_dev_paths_refused');
  if (
    evidence?.kind !== 'ci_development_test' ||
    evidence.eligibleStore !== false ||
    evidence.publish_state !== 'not_published' ||
    evidence.sourceSha !== match[1] ||
    evidence.runId !== Number(match[2]) ||
    evidence.runAttempt !== Number(match[3]) ||
    !/^[a-f0-9]{64}$/.test(evidence.treeSha256 ?? '') ||
    !/^\d+\.\d+\.\d+$/.test(evidence.version ?? '')
  )
    throw new Error('ci_dev_evidence_refused');
  assertNoSymlinkParents(source, root);
  assertNoSymlinkParents(destination, root);
  assertNoSymlinkParents(receiptFile, root);
  if (hashReleaseTree(source) !== evidence.treeSha256) throw new Error('ci_dev_source_changed');
  const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3 || manifest.version !== evidence.version)
    throw new Error('ci_dev_manifest_refused');
  const compatibility = sourceCompatibility(root, evidence.sourceSha);
  if (
    evidence.source?.originMain !== compatibility.mainSha ||
    evidence.source?.localHead !== compatibility.mainSha
  )
    throw new Error('ci_dev_evidence_refused');
  const observedAt = new Date().toISOString();
  assertCurrentMain(root, compatibility.mainSha);
  const promotion = promoteUnpackedReleaseToMany({
    sourceDir: source,
    destinationDirs: [destination],
    version: evidence.version,
    beforeCommit: (result) => {
      assertCurrentMain(root, compatibility.mainSha);
      if (result.sourceHash !== evidence.treeSha256) throw new Error('ci_dev_staged_tree_changed');
      const receipt = {
        schema_version: 1,
        kind: 'ci_development_test_promotion',
        eligibleStore: false,
        publish_state: 'not_published',
        observedAt,
        sourceSha: evidence.sourceSha,
        mainSha: compatibility.mainSha,
        compatibility: compatibility.compatibility,
        allowedDiffPaths: compatibility.diffPaths,
        version: evidence.version,
        runId: evidence.runId,
        runAttempt: evidence.runAttempt,
        artifactId: evidence.artifactId,
        sourceDir: source,
        destinationDir: destination,
        treeSha256: result.sourceHash,
        fileCount: result.fileCount,
      };
      const staged = `${receiptFile}.stage-${process.pid}-${Date.now()}`;
      try {
        writeFileSync(staged, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        renameSync(staged, receiptFile);
      } finally {
        rmSync(staged, { force: true });
      }
    },
  });
  return {
    sourceSha: evidence.sourceSha,
    mainSha: compatibility.mainSha,
    compatibility: compatibility.compatibility,
    version: evidence.version,
    treeSha256: promotion.sourceHash,
    destinationDir: destination,
    receiptPath: receiptFile,
  };
}

export async function promoteImportedCiDevArtifact(sourceDir) {
  const source = resolve(sourceDir);
  const evidence = await verifyImportedNativeEvidence(
    source,
    join(dirname(source), 'local-dev-receipt.json'),
  );
  return promoteVerifiedCiDevArtifact({ sourceDir: source, evidence });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error(
        'ci_dev_usage: node scripts/promote-ci-dev-artifact.mjs <imported-chrome-mv3-path>',
      );
    const result = await promoteImportedCiDevArtifact(process.argv[2]);
    process.stdout.write(
      `CI_DEV_PROMOTED ${result.sourceSha} ${result.version} ${result.treeSha256} ${result.destinationDir}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${/^ci_dev_|^test_artifact_|^local_dev_/.test(error.message) ? error.message : 'ci_dev_promotion_failed'}\n`,
    );
    process.exitCode = 1;
  }
}
