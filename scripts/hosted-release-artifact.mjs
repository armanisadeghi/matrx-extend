import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { hashReleaseTree } from './sync-unpacked-release.mjs';

const STORE_CASES = new Set([
  'guest-chat',
  'guest-scrape',
  'member-chat',
  'guest-data',
  'guest-seo',
]);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function zipEntries(path) {
  const entries = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trimEnd().split('\n');
  assert.ok(entries.includes('manifest.json'), 'selected ZIP must contain root manifest');
  assert.ok(
    entries.every(
      (entry) =>
        entry &&
        !entry.startsWith('/') &&
        !entry.includes('\\') &&
        !entry.split('/').includes('..'),
    ),
    'unsafe selected ZIP entry',
  );
}

function zipManifest(path) {
  return JSON.parse(execFileSync('unzip', ['-p', path, 'manifest.json'], { encoding: 'utf8' }));
}

export async function prepareHostedReleaseArtifact(
  artifactDir,
  outputDir,
  expectedSha,
  acceptanceCase,
) {
  const receipt = JSON.parse(await readFile(join(artifactDir, 'release-receipt.json'), 'utf8'));
  assert.match(expectedSha, /^[a-f0-9]{40}$/);
  assert.equal(receipt.sourceSha, expectedSha, 'release source SHA must match selected tag');
  assert.equal(receipt.publishState, 'pushed', 'release must be published');
  assert.match(receipt.version, /^\d+\.\d+\.\d+$/);
  assert.match(receipt.treeSha256, /^[a-f0-9]{64}$/);
  const zipFiles = await readdir(artifactDir);
  for (const kind of ['local', 'store']) {
    const expectedName = `matrx-extend-${receipt.version}-${kind}.zip`;
    assert.ok(
      zipFiles.includes(expectedName),
      `${kind} ZIP missing from selected release artifact`,
    );
    assert.equal(basename(receipt[`${kind}Zip`]?.path ?? ''), expectedName);
    assert.match(receipt[`${kind}Zip`].sha256, /^[a-f0-9]{64}$/);
    const actual = join(artifactDir, expectedName);
    assert.equal(sha256(await readFile(actual)), receipt[`${kind}Zip`].sha256, `${kind} ZIP hash`);
    receipt[`${kind}Zip`].path = actual;
  }

  const storeCase = STORE_CASES.has(acceptanceCase);
  const selectedKind = storeCase ? 'store' : 'local';
  const selectedZip = receipt[`${selectedKind}Zip`].path;
  zipEntries(selectedZip);
  const extensionDir = join(outputDir, storeCase ? 'chrome-mv3-store' : 'chrome-mv3-dev');
  await mkdir(extensionDir); // An old tree must never be mixed into this runtime input.
  execFileSync('unzip', ['-q', selectedZip, '-d', extensionDir]);
  const manifestPath = join(extensionDir, 'manifest.json');
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.version, receipt.version, 'selected ZIP version');

  if (storeCase) {
    assert.equal(manifest.key, undefined, 'Store ZIP manifest must be unkeyed');
    const storeTreeSha256 = hashReleaseTree(extensionDir);
    const localManifest = zipManifest(receipt.localZip.path);
    assert.equal(localManifest.version, receipt.version, 'matching-version public key source');
    assert.ok(
      typeof localManifest.key === 'string' && localManifest.key,
      'local public key required',
    );
    const keyBytes = Buffer.from(localManifest.key, 'base64');
    assert.equal(keyBytes.toString('base64'), localManifest.key, 'canonical public key encoding');
    const extensionId = [...createHash('sha256').update(keyBytes).digest().subarray(0, 16)]
      .map((byte) => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15)))
      .join('');
    assert.equal(extensionId, 'cihdmkcdjjckfhjpgoedmgfpoljebaml', 'release public key identity');
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, key: localManifest.key })}\n`, {
      mode: 0o600,
    });
    const { key, ...adaptedWithoutKey } = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(key, localManifest.key, 'only matching public key added');
    assert.deepEqual(adaptedWithoutKey, manifest, 'Store manifest fields preserved');
    const publisherSourceTreeSha256 = receipt.treeSha256;
    receipt.kind = 'native_store_zip_candidate_key_adapted';
    receipt.storeTreeSha256 = storeTreeSha256;
    receipt.treeSha256 = hashReleaseTree(extensionDir);
    receipt.artifactSelection = {
      source: 'release_receipt_store_zip',
      publisherSourceTreeSha256,
      selectedZipSha256: receipt.storeZip.sha256,
      originalStoreTreeSha256: storeTreeSha256,
      runtimeTreeSha256: receipt.treeSha256,
      runtimeExtensionDir: extensionDir,
      manifestBeforeSha256: sha256(manifestBytes),
      manifestAfterSha256: sha256(await readFile(manifestPath)),
      adaptation:
        'manifest.key only; copied from matching-version local ZIP; original Store ZIP unchanged',
      modifiedPaths: ['manifest.json'],
    };
    assert.equal(
      sha256(await readFile(selectedZip)),
      receipt.storeZip.sha256,
      'original Store ZIP immutable',
    );
  } else {
    assert.ok(typeof manifest.key === 'string' && manifest.key, 'local package must be keyed');
    assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256, 'release tree hash');
    receipt.artifactSelection = {
      source: 'release_receipt_local_zip',
      selectedZipSha256: receipt.localZip.sha256,
      runtimeTreeSha256: receipt.treeSha256,
      runtimeExtensionDir: extensionDir,
      adaptation: 'none',
      modifiedPaths: [],
    };
  }
  assert.equal(
    hashReleaseTree(extensionDir),
    receipt.artifactSelection.runtimeTreeSha256,
    'runtime input tree',
  );
  const relocatedReceipt = join(outputDir, 'release-receipt.json');
  await writeFile(relocatedReceipt, `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  return {
    extensionDir,
    relocatedReceipt,
    kind: storeCase ? 'published_store_zip_adapted' : 'published_release',
  };
}
