/** Read-only native acceptance gate for the existing CI promotion receipt. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyImportedNativeEvidence } from './current-test-artifact.mjs';
import { hashReleaseTree } from './sync-unpacked-release.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_ID = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
function refuse() {
  throw new Error('ci_dev_promotion_identity_refused');
}
function noSymlinks(path, root) {
  for (
    let cursor = path;
    cursor === root || cursor.startsWith(`${root}/`);
    cursor = dirname(cursor)
  ) {
    if (lstatSync(cursor).isSymbolicLink()) refuse();
  }
}

// evidence must come from verifyImportedNativeEvidence, never the promotion receipt.
export function requireCiDevPromotionReceipt(
  receipt,
  evidence,
  { extensionDir, expectedSourceSha, expectedExtensionId = DEV_ID, repoRoot = REPO },
) {
  const root = resolve(repoRoot);
  const destination = join(root, '.output/chrome-mv3-dev');
  if (
    !/^[a-f0-9]{40}$/.test(expectedSourceSha ?? '') ||
    expectedExtensionId !== DEV_ID ||
    receipt?.schema_version !== 1 ||
    receipt.kind !== 'ci_development_test_promotion' ||
    receipt.eligibleStore !== false ||
    receipt.publish_state !== 'not_published' ||
    receipt.sourceSha !== expectedSourceSha ||
    // This gate is deliberately exact-source. Runtime-equivalent promotions need
    // a separately reviewed history policy; they are never silently accepted.
    receipt.compatibility !== 'exact-source' ||
    receipt.mainSha !== expectedSourceSha ||
    !Array.isArray(receipt.allowedDiffPaths) ||
    receipt.allowedDiffPaths.length !== 0 ||
    receipt.destinationDir !== destination ||
    resolve(extensionDir) !== destination ||
    !Number.isSafeInteger(receipt.runId) ||
    receipt.runId <= 0 ||
    !Number.isSafeInteger(receipt.runAttempt) ||
    receipt.runAttempt <= 0 ||
    !Number.isSafeInteger(receipt.artifactId) ||
    receipt.artifactId <= 0 ||
    receipt.sourceDir !==
      join(
        root,
        'test-results/ci-artifacts',
        expectedSourceSha,
        `${receipt.runId}-${receipt.runAttempt}`,
        'chrome-mv3',
      ) ||
    evidence?.kind !== 'ci_development_test' ||
    evidence.eligibleStore !== false ||
    evidence.publish_state !== 'not_published' ||
    !/^sha256:[a-f0-9]{64}$/.test(evidence.githubArtifactDigest ?? '') ||
    !/^[a-f0-9]{64}$/.test(receipt.treeSha256 ?? '') ||
    !/^\d+\.\d+\.\d+$/.test(receipt.version ?? '') ||
    ['sourceSha', 'runId', 'runAttempt', 'artifactId', 'version', 'treeSha256'].some(
      (key) => receipt[key] !== evidence[key],
    ) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(receipt.observedAt ?? '') ||
    !Number.isFinite(Date.parse(receipt.observedAt))
  )
    refuse();
  noSymlinks(destination, root);
  noSymlinks(receipt.sourceDir, root);
  const manifest = JSON.parse(readFileSync(join(destination, 'manifest.json'), 'utf8'));
  const key = Buffer.from(manifest.key ?? '', 'base64');
  const extensionId = [...createHash('sha256').update(key).digest('hex').slice(0, 32)]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join('');
  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== receipt.version ||
    key.length < 200 ||
    extensionId !== expectedExtensionId ||
    hashReleaseTree(destination) !== receipt.treeSha256 ||
    hashReleaseTree(receipt.sourceDir) !== receipt.treeSha256
  )
    refuse();
  return Object.freeze({
    kind: receipt.kind,
    publishState: receipt.publish_state,
    extensionDir: destination,
    sourceSha: expectedSourceSha,
    mainSha: receipt.mainSha,
    compatibility: receipt.compatibility,
    version: receipt.version,
    treeSha256: receipt.treeSha256,
    extensionId,
    runId: receipt.runId,
    runAttempt: receipt.runAttempt,
    artifactId: receipt.artifactId,
    githubArtifactDigest: evidence.githubArtifactDigest,
  });
}

export async function verifyCiDevPromotionReceipt({
  receiptPath,
  receipt,
  extensionDir,
  expectedSourceSha,
  expectedExtensionId = DEV_ID,
}) {
  try {
    if (resolve(receiptPath) !== join(REPO, 'test-results/ci-dev-promotion-receipt.json')) refuse();
    noSymlinks(resolve(receiptPath), REPO);
    const recorded = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (receipt !== undefined && JSON.stringify(receipt) !== JSON.stringify(recorded)) refuse();
    receipt = recorded;
    if (
      !/^[a-f0-9]{40}$/.test(expectedSourceSha ?? '') ||
      receipt.sourceSha !== expectedSourceSha ||
      typeof receipt.sourceDir !== 'string'
    )
      refuse();
    const evidence = await verifyImportedNativeEvidence(
      receipt.sourceDir,
      join(dirname(receipt.sourceDir), 'local-dev-receipt.json'),
    );
    return requireCiDevPromotionReceipt(receipt, evidence, {
      extensionDir,
      expectedSourceSha,
      expectedExtensionId,
    });
  } catch {
    refuse();
  }
}
