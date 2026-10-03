#!/usr/bin/env node
/** Prepare a published release artifact, then run the real native-panel guest test. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchingCrx3RsaKey } from './crx3-identity.mjs';
import { verifyImportedNativeEvidence } from './current-test-artifact.mjs';
import { hashReleaseTree } from './sync-unpacked-release.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STORE_130 = Object.freeze({
  id: 'hnfolienncfklkgmdjjmhhegglimlamg',
  version: '0.2.130',
  crxSha256: '9964183901e06c92c1a41e68294332bf27e3564ef0df1d860297d533829885b1',
});
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function ownedProcess(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveRun({ code, signal }));
  });
}

async function prepare(artifactDir, outputDir, expectedSha) {
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
  const extensionDir = join(outputDir, 'chrome-mv3-dev');
  await mkdir(extensionDir, { recursive: true });
  // Refuse archive paths that could write beyond the owned extraction directory.
  const listing = await new Promise((resolveList, reject) => {
    const child = spawn('unzip', ['-Z1', receipt.localZip.path]);
    let data = '';
    child.stdout.on('data', (chunk) => {
      data += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolveList(data) : reject(new Error('local ZIP listing failed')),
    );
  });
  const entries = listing.trimEnd().split('\n');
  assert.ok(entries.includes('manifest.json'), 'local ZIP must contain root manifest');
  assert.ok(
    entries.every(
      (entry) =>
        entry &&
        !entry.startsWith('/') &&
        !entry.split('/').includes('..') &&
        !entry.includes('\\'),
    ),
    'unsafe local ZIP entry',
  );
  const unzip = await ownedProcess('unzip', ['-q', receipt.localZip.path, '-d', extensionDir]);
  assert.equal(unzip.code, 0, 'local ZIP extraction failed');
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, receipt.version);
  assert.ok(typeof manifest.key === 'string' && manifest.key, 'local package must be keyed');
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256, 'release tree hash');
  const relocatedReceipt = join(outputDir, 'release-receipt.json');
  await writeFile(relocatedReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`PREPARED ${receipt.version} ${receipt.sourceSha} ${receipt.treeSha256}\n`);
  return { extensionDir, relocatedReceipt, kind: 'published_release' };
}

async function prepareDevelopment(runId, artifactId) {
  assert.match(runId, /^[1-9][0-9]*$/);
  assert.match(artifactId, /^[1-9][0-9]*$/);
  const imported = await ownedProcess(process.execPath, [
    join(repo, 'scripts/current-test-artifact.mjs'),
    'import',
    runId,
    artifactId,
  ]);
  assert.equal(imported.code, 0, 'authenticated CI development artifact import failed');
  const sourceRoot = join(repo, 'test-results/ci-artifacts');
  const sourceShas = await readdir(sourceRoot);
  assert.equal(sourceShas.length, 1, 'expected one imported CI source');
  assert.match(sourceShas[0], /^[a-f0-9]{40}$/);
  const attempts = await readdir(join(sourceRoot, sourceShas[0]));
  assert.equal(attempts.length, 1, 'expected one imported CI run attempt');
  assert.match(attempts[0], new RegExp(`^${runId}-[1-9][0-9]*$`));
  const target = join(sourceRoot, sourceShas[0], attempts[0]);
  const extensionDir = join(target, 'chrome-mv3');
  const relocatedReceipt = join(target, 'local-dev-receipt.json');
  const evidence = await verifyImportedNativeEvidence(extensionDir, relocatedReceipt);
  assert.equal(evidence.eligibleStore, false);
  assert.equal(evidence.sourceSha, sourceShas[0]);
  process.stdout.write(`PREPARED_DEVELOPMENT ${evidence.sourceSha} ${evidence.treeSha256}\n`);
  return { extensionDir, relocatedReceipt, kind: 'ci_development_test' };
}

async function preparePublishedStoreCrx(outputDir) {
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0.0.0&acceptformat=crx3&x=id%3D${STORE_130.id}%26uc`;
  const response = await fetch(url);
  assert.equal(response.ok, true, 'official Chrome update download failed');
  const crx = Buffer.from(await response.arrayBuffer());
  assert.equal(sha256(crx), STORE_130.crxSha256, 'published dashboard CRX SHA-256');
  assert.equal(crx.toString('ascii', 0, 4), 'Cr24', 'CRX magic');
  assert.equal(crx.readUInt32LE(4), 3, 'CRX3 format');
  const zipOffset = 12 + crx.readUInt32LE(8);
  assert.ok(zipOffset > 12 && zipOffset < crx.length - 100, 'CRX ZIP offset');
  assert.equal(crx.toString('ascii', zipOffset, zipOffset + 2), 'PK', 'CRX ZIP payload');
  const crxPath = join(outputDir, `${STORE_130.id}.crx`);
  const zipPath = join(outputDir, `${STORE_130.id}.zip`);
  await writeFile(crxPath, crx, { mode: 0o600 });
  await writeFile(zipPath, crx.subarray(zipOffset), { mode: 0o600 });
  const listing = await new Promise((resolveList, reject) => {
    const child = spawn('unzip', ['-Z1', zipPath]);
    let data = '';
    child.stdout.on('data', (chunk) => {
      data += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolveList(data) : reject(new Error('CRX ZIP listing failed')),
    );
  });
  const entries = listing.trimEnd().split('\n');
  assert.ok(entries.includes('manifest.json'), 'published CRX manifest missing');
  assert.ok(
    entries.every(
      (entry) =>
        entry &&
        !entry.startsWith('/') &&
        !entry.split('/').includes('..') &&
        !entry.includes('\\'),
    ),
    'unsafe CRX ZIP entry',
  );
  const extensionDir = join(outputDir, 'published-store-crx-unpacked');
  await mkdir(extensionDir, { recursive: true });
  const extracted = await ownedProcess('unzip', ['-q', zipPath, '-d', extensionDir]);
  assert.equal(extracted.code, 0, 'published CRX extraction failed');
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, STORE_130.version, 'published CRX version');
  assert.equal(manifest.key, undefined, 'published CRX payload manifest must be unkeyed');
  const signingKey = matchingCrx3RsaKey(crx, STORE_130.id);
  // Chrome adds this same Store signing key during installation. The temporary
  // unpacked copy needs it to keep the primary item ID under --load-extension.
  manifest.key = signingKey.toString('base64');
  await writeFile(join(extensionDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  const treeSha256 = hashReleaseTree(extensionDir);
  const receipt = {
    kind: 'published_store_crx_unpacked',
    version: STORE_130.version,
    extensionId: STORE_130.id,
    crxPath,
    crxSha256: STORE_130.crxSha256,
    treeSha256,
    downloadSource:
      'Google Chrome public update service; byte-identical to authenticated primary publisher Published main.crx',
    unpackedAdaptation:
      'Temporary manifest.key copied from CRX3 RSA signing proof for unpacked Chromium loading; original CRX unchanged',
  };
  const relocatedReceipt = join(outputDir, 'published-store-crx-receipt.json');
  await writeFile(relocatedReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `PREPARED_PUBLISHED_STORE_CRX ${STORE_130.version} ${STORE_130.id} ${treeSha256}\n`,
  );
  return { extensionDir, relocatedReceipt, kind: receipt.kind };
}

async function run({ extensionDir, relocatedReceipt, kind }) {
  const acceptanceCase = process.env.MATRX_HOSTED_ACCEPTANCE_CASE ?? 'guest-chat';
  assert.ok(['guest-chat', 'settings-controls'].includes(acceptanceCase));
  if (acceptanceCase === 'settings-controls')
    assert.equal(kind, 'ci_development_test', 'Settings controls requires CI development receipt');
  const child = spawn(
    process.execPath,
    [
      join(
        repo,
        acceptanceCase === 'settings-controls'
          ? 'tests/browser/settings-local-controls-acceptance.mjs'
          : 'tests/browser/guest-chat-store-acceptance.mjs',
      ),
    ],
    {
      cwd: repo,
      stdio: 'inherit',
      env: {
        ...process.env,
        MATRX_GUEST_CHAT_EXTENSION_DIR: extensionDir,
        ...(acceptanceCase === 'settings-controls'
          ? {
              SETTINGS_DEV_EXTENSION_DIR: extensionDir,
              SETTINGS_DEV_BUILD_RECEIPT: relocatedReceipt,
            }
          : {}),
        ...(kind === 'ci_development_test'
          ? { MATRX_GUEST_CHAT_DEV_RECEIPT: relocatedReceipt }
          : { MATRX_GUEST_CHAT_RELEASE_RECEIPT: relocatedReceipt }),
      },
    },
  );
  const result = await new Promise((resolveRun, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveRun({ code, signal }));
  });
  assert.equal(
    result.code,
    0,
    `native side-panel guest acceptance exited ${result.code ?? result.signal}`,
  );
}

const artifactDirArg = process.env.MATRX_HOSTED_RELEASE_ARTIFACT_DIR;
const outputDirArg = process.env.MATRX_HOSTED_GUEST_OUTPUT_DIR;
const expectedSha = process.env.MATRX_HOSTED_RELEASE_SHA;
const devRunId = process.env.MATRX_HOSTED_DEV_RUN_ID;
const devArtifactId = process.env.MATRX_HOSTED_DEV_ARTIFACT_ID;
const publishedStoreCrx = process.env.MATRX_HOSTED_PUBLISHED_STORE_CRX === '0.2.130';
const releaseMode = Boolean(artifactDirArg && expectedSha && !devRunId && !devArtifactId);
const developmentMode = Boolean(!artifactDirArg && !expectedSha && devRunId && devArtifactId);
if (
  !outputDirArg ||
  [releaseMode, developmentMode, publishedStoreCrx].filter(Boolean).length !== 1
) {
  throw new Error('hosted_guest_configuration_missing');
}
const outputDir = resolve(outputDirArg);
await mkdir(outputDir, { recursive: true });
const prepared = releaseMode
  ? await prepare(resolve(artifactDirArg), outputDir, expectedSha)
  : developmentMode
    ? await prepareDevelopment(devRunId, devArtifactId)
    : await preparePublishedStoreCrx(outputDir);
const runtimeDir = resolve(process.env.MATRX_HOSTED_BROWSER_RUNTIME_DIR ?? '');
if (!process.env.MATRX_HOSTED_BROWSER_RUNTIME_DIR || !process.env.PLAYWRIGHT_BROWSERS_PATH) {
  throw new Error('hosted_browser_runtime_configuration_missing');
}
const installed = await ownedProcess('npm', [
  'install',
  '--prefix',
  runtimeDir,
  '--no-save',
  '--ignore-scripts',
  'playwright@1.56.1',
]);
assert.equal(installed.code, 0, 'pinned Playwright install failed');
const browser = await ownedProcess(join(runtimeDir, 'node_modules/.bin/playwright'), [
  'install',
  'chromium',
]);
assert.equal(browser.code, 0, 'bundled Chromium install failed');
await run(prepared);
