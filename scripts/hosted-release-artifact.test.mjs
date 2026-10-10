import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { prepareHostedReleaseArtifact } from './hosted-release-artifact.mjs';
import { hashReleaseTree } from './sync-unpacked-release.mjs';

const root = await mkdtemp(join(tmpdir(), 'hosted-release-artifact-test-'));
after(() => rm(root, { recursive: true, force: true }));
const scrapeDriverSource = await readFile(
  new URL('../tests/browser/scrape-guest-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const scrapePreflight = new (Object.getPrototypeOf(async () => {}).constructor)(
  'assert',
  'readFile',
  'join',
  'hashReleaseTree',
  'EXTENSION_DIR',
  'RECEIPT',
  'ARTIFACT_CHANNEL',
  `${scrapeDriverSource.slice(
    scrapeDriverSource.indexOf('  const receipt = JSON.parse(await readFile(RECEIPT'),
    scrapeDriverSource.indexOf(
      '  report.artifact = {',
      scrapeDriverSource.indexOf('  const receipt = JSON.parse(await readFile(RECEIPT'),
    ),
  )}\nreturn receipt;`,
);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceSha = 'a'.repeat(40);
const version = '0.2.205';
const config = await readFile(resolve(import.meta.dirname, '../wxt.config.ts'), 'utf8');
const key = /const devExtensionKey\s*=\s*'([^']+)'/.exec(config)?.[1];
assert.ok(key, 'canonical development public key');

async function fixture(label) {
  const artifactDir = join(root, label);
  const local = join(artifactDir, 'local');
  const store = join(artifactDir, 'store');
  await mkdir(local, { recursive: true });
  await mkdir(store);
  await writeFile(
    join(local, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, version, key, action: { default_popup: 'popup.html' } }),
  );
  await writeFile(
    join(store, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, version, action: {} }),
  );
  await writeFile(join(local, 'background.js'), 'development-only background module');
  await writeFile(join(store, 'background.js'), 'Store reviewer background module');
  await writeFile(join(local, 'popup.html'), 'development popup');
  await writeFile(join(store, 'sidepanel.html'), 'Store side panel');
  const localZip = join(artifactDir, `matrx-extend-${version}-local.zip`);
  const storeZip = join(artifactDir, `matrx-extend-${version}-store.zip`);
  execFileSync('zip', ['-q', '-r', localZip, '.'], { cwd: local });
  execFileSync('zip', ['-q', '-r', storeZip, '.'], { cwd: store });
  const receipt = {
    sourceSha,
    publishState: 'pushed',
    version,
    treeSha256: hashReleaseTree(local),
    localZip: { path: localZip, sha256: sha256(await readFile(localZip)) },
    storeZip: { path: storeZip, sha256: sha256(await readFile(storeZip)) },
  };
  await writeFile(join(artifactDir, 'release-receipt.json'), JSON.stringify(receipt));
  return { artifactDir, receipt, local, store, localZip, storeZip };
}

test('guest and member Store cases load Store bytes with only manifest.key added', async () => {
  const { artifactDir, receipt, store, storeZip } = await fixture('store-cases');
  for (const acceptanceCase of [
    'guest-chat',
    'guest-scrape',
    'member-chat',
    'guest-data',
    'guest-seo',
  ]) {
    const output = join(root, `output-${acceptanceCase}`);
    await mkdir(output);
    const prepared = await prepareHostedReleaseArtifact(
      artifactDir,
      output,
      sourceSha,
      acceptanceCase,
    );
    const adapted = JSON.parse(await readFile(prepared.relocatedReceipt));
    const manifest = JSON.parse(await readFile(join(prepared.extensionDir, 'manifest.json')));
    const { key: addedKey, ...withoutKey } = manifest;
    assert.equal(prepared.kind, 'published_store_zip_adapted');
    assert.equal(
      await readFile(join(prepared.extensionDir, 'background.js'), 'utf8'),
      'Store reviewer background module',
    );
    assert.equal(
      await readFile(join(prepared.extensionDir, 'sidepanel.html'), 'utf8'),
      'Store side panel',
    );
    assert.equal(addedKey, key);
    assert.deepEqual(withoutKey, JSON.parse(await readFile(join(store, 'manifest.json'))));
    assert.equal(adapted.artifactSelection.source, 'release_receipt_store_zip');
    assert.equal(adapted.artifactSelection.originalStoreTreeSha256, hashReleaseTree(store));
    assert.equal(adapted.artifactSelection.runtimeExtensionDir, prepared.extensionDir);
    assert.equal(
      adapted.artifactSelection.runtimeTreeSha256,
      hashReleaseTree(prepared.extensionDir),
    );
    assert.deepEqual(adapted.artifactSelection.modifiedPaths, ['manifest.json']);
    assert.equal(sha256(await readFile(storeZip)), receipt.storeZip.sha256);
  }
});

test('real imported Store receipt passes the real Scrape preflight and tampered runtime fails', async () => {
  const { artifactDir } = await fixture('scrape-driver-receipt');
  const output = join(root, 'scrape-driver-output');
  await mkdir(output);
  const prepared = await prepareHostedReleaseArtifact(
    artifactDir,
    output,
    sourceSha,
    'guest-scrape',
  );
  const runPreflight = () =>
    scrapePreflight(
      assert,
      readFile,
      join,
      hashReleaseTree,
      prepared.extensionDir,
      prepared.relocatedReceipt,
      'store',
    );
  const receipt = await runPreflight();
  assert.equal(receipt.artifactSelection.source, 'release_receipt_store_zip');
  assert.equal(receipt.artifactSelection.selectedZipSha256, receipt.storeZip.sha256);
  for (const kind of [
    'published_store_zip_adapted',
    'local_dev_unpacked',
    'published_store_crx_unpacked',
  ]) {
    await writeFile(prepared.relocatedReceipt, JSON.stringify({ ...receipt, kind }));
    await assert.rejects(runPreflight(), /scrape_store_receipt_required/);
  }
  await writeFile(prepared.relocatedReceipt, JSON.stringify(receipt));
  await writeFile(join(prepared.extensionDir, 'background.js'), 'altered Store runtime');
  await assert.rejects(runPreflight(), /scrape_receipt_tree_mismatch/);
});

test('a wrong Store ZIP is refused even when the local ZIP is valid', async () => {
  const { artifactDir, storeZip } = await fixture('wrong-store');
  await writeFile(storeZip, 'wrong selected Store archive');
  const output = join(root, 'wrong-store-output');
  await mkdir(output);
  await assert.rejects(
    prepareHostedReleaseArtifact(artifactDir, output, sourceSha, 'guest-scrape'),
    /store ZIP hash/,
  );
});

test('an intentional local release case keeps the development payload', async () => {
  const { artifactDir } = await fixture('local-case');
  const output = join(root, 'local-output');
  await mkdir(output);
  const prepared = await prepareHostedReleaseArtifact(
    artifactDir,
    output,
    sourceSha,
    'local-diagnostic',
  );
  assert.equal(prepared.kind, 'published_release');
  assert.equal(
    await readFile(join(prepared.extensionDir, 'background.js'), 'utf8'),
    'development-only background module',
  );
  const receipt = JSON.parse(await readFile(prepared.relocatedReceipt));
  assert.equal(receipt.artifactSelection.source, 'release_receipt_local_zip');
});
