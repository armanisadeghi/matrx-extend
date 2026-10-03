#!/usr/bin/env node
/** Prepare a published release artifact, then run the real native-panel guest test. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  const sourceShas = (await readdir(sourceRoot)).filter((name) => /^[a-f0-9]{40}$/.test(name));
  const targets = [];
  for (const sourceSha of sourceShas) {
    for (const attempt of await readdir(join(sourceRoot, sourceSha))) {
      if (!new RegExp(`^${runId}-[1-9][0-9]*$`).test(attempt)) continue;
      const target = join(sourceRoot, sourceSha, attempt);
      const status = JSON.parse(await readFile(join(target, 'import-status.json'), 'utf8'));
      if (status.artifactId === Number(artifactId)) targets.push({ target, sourceSha });
    }
  }
  assert.equal(targets.length, 1, 'expected one import matching selected CI run and artifact');
  const { target, sourceSha } = targets[0];
  const extensionDir = join(target, 'chrome-mv3');
  const relocatedReceipt = join(target, 'local-dev-receipt.json');
  const evidence = await verifyImportedNativeEvidence(extensionDir, relocatedReceipt);
  assert.equal(evidence.eligibleStore, false);
  assert.equal(evidence.sourceSha, sourceSha);
  assert.equal(evidence.runId, Number(runId));
  assert.equal(evidence.artifactId, Number(artifactId));
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
  // Chromium removes Store verification metadata when this signed CRX is loaded
  // as an unpacked extension. Record that exact adaptation before the immutable
  // runtime receipt; every remaining file stays covered by the strict tree hash.
  const metadataPath = '_metadata/verified_contents.json';
  const metadataBytes = await readFile(join(extensionDir, metadataPath));
  const removedStoreMetadata = {
    path: metadataPath,
    bytes: metadataBytes.length,
    sha256: sha256(metadataBytes),
  };
  await unlink(join(extensionDir, metadataPath));
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
      'Temporary manifest.key copied from CRX3 RSA signing proof; exact Store verification metadata removed for unpacked Chromium loading; original CRX unchanged',
    removedStoreMetadata,
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
  assert.ok(
    [
      'guest-chat',
      'settings-controls',
      'settings-persistence',
      'member-chat',
      'prepare-stale-results',
    ].includes(acceptanceCase),
  );
  if (acceptanceCase === 'settings-controls')
    assert.equal(kind, 'ci_development_test', 'Settings controls requires CI development receipt');
  if (acceptanceCase === 'settings-persistence')
    assert.equal(
      kind,
      'ci_development_test',
      'Settings persistence requires CI development receipt',
    );
  if (acceptanceCase === 'member-chat')
    assert.equal(kind, 'published_release', 'Member Chat requires exact published release receipt');
  if (acceptanceCase === 'prepare-stale-results')
    assert.equal(kind, 'ci_development_test', 'Prepare requires exact CI development receipt');
  const memberLinkPath = join(dirname(relocatedReceipt), 'member-magic-link-private.json');
  const adminCredentialsPath = join(runtimeDir, 'prepare-admin-credentials-private.json');
  let adminCredentialsCreated = false;
  if (acceptanceCase === 'member-chat') {
    assert.ok(process.env.MATRX_HOSTED_MEMBER_LINK_JSON, 'member link secret required');
    await writeFile(memberLinkPath, process.env.MATRX_HOSTED_MEMBER_LINK_JSON, {
      mode: 0o600,
      flag: 'wx',
    });
  }
  if (acceptanceCase === 'prepare-stale-results') {
    assert.ok(process.env.MATRX_HOSTED_ADMIN_CREDENTIALS_JSON, 'Prepare admin secret required');
    const parsed = JSON.parse(process.env.MATRX_HOSTED_ADMIN_CREDENTIALS_JSON);
    assert.equal(parsed.email, 'admin@admin.com', 'Prepare admin identity required');
    assert.ok(
      typeof parsed.password === 'string' && parsed.password,
      'Prepare admin password required',
    );
    await writeFile(adminCredentialsPath, JSON.stringify(parsed), { mode: 0o600, flag: 'wx' });
    adminCredentialsCreated = true;
  }
  const childEnv = {
    ...process.env,
    MATRX_GUEST_CHAT_EXTENSION_DIR: extensionDir,
    MATRX_REVIEWER_EXTENSION_DIR: extensionDir,
    MATRX_REVIEWER_RELEASE_RECEIPT: relocatedReceipt,
    ...(acceptanceCase === 'settings-persistence'
      ? { MATRX_D87_EXTENSION_DIR: extensionDir, MATRX_D87_RECEIPT: relocatedReceipt }
      : {}),
    ...(acceptanceCase === 'member-chat' ? { MATRX_REVIEWER_MAGIC_LINK_FILE: memberLinkPath } : {}),
    ...(acceptanceCase === 'prepare-stale-results'
      ? {
          MATRX_PREPARE_EXTENSION_DIR: extensionDir,
          MATRX_PREPARE_RECEIPT: relocatedReceipt,
          MATRX_PREPARE_ADMIN_CREDENTIALS_FILE: adminCredentialsPath,
        }
      : {}),
    ...(acceptanceCase === 'settings-controls'
      ? {
          SETTINGS_DEV_EXTENSION_DIR: extensionDir,
          SETTINGS_DEV_BUILD_RECEIPT: relocatedReceipt,
        }
      : {}),
    ...(kind === 'ci_development_test'
      ? { MATRX_GUEST_CHAT_DEV_RECEIPT: relocatedReceipt }
      : { MATRX_GUEST_CHAT_RELEASE_RECEIPT: relocatedReceipt }),
  };
  childEnv.MATRX_HOSTED_MEMBER_LINK_JSON = undefined;
  childEnv.MATRX_HOSTED_ADMIN_CREDENTIALS_JSON = undefined;
  childEnv.MATRX_REVIEWER_CREDENTIALS_FILE = undefined;
  try {
    const child = spawn(
      process.execPath,
      [
        join(
          repo,
          acceptanceCase === 'settings-controls'
            ? 'tests/browser/settings-local-controls-acceptance.mjs'
            : acceptanceCase === 'settings-persistence'
              ? 'tests/browser/settings-d87-native-acceptance.mjs'
              : acceptanceCase === 'prepare-stale-results'
                ? 'tests/browser/prepare-stale-result-native-acceptance.mjs'
                : acceptanceCase === 'member-chat'
                  ? 'tests/browser/reviewer-chat-store-acceptance.mjs'
                  : 'tests/browser/guest-chat-store-acceptance.mjs',
        ),
      ],
      {
        cwd: repo,
        stdio: 'inherit',
        env: childEnv,
      },
    );
    const result = await new Promise((resolveRun, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolveRun({ code, signal }));
    });
    assert.equal(
      result.code,
      0,
      `native side-panel acceptance exited ${result.code ?? result.signal}`,
    );
  } finally {
    if (acceptanceCase === 'member-chat') await unlink(memberLinkPath);
    if (adminCredentialsCreated) await unlink(adminCredentialsPath);
  }
}

// Each phase runs under its own fresh resource admission on the same host.
// Setup has no product verdict, and acceptance never installs dependencies.
const phase = process.env.MATRX_HOSTED_PHASE ?? 'acceptance';
assert.ok(['package', 'browser', 'acceptance'].includes(phase), 'invalid hosted phase');
assert.ok(process.env.MATRX_RESOURCE_OWNER, 'hosted phase requires owned resource permit');
const runtimeDir = resolve(process.env.MATRX_HOSTED_BROWSER_RUNTIME_DIR ?? '');
assert.ok(process.env.MATRX_HOSTED_BROWSER_RUNTIME_DIR && process.env.PLAYWRIGHT_BROWSERS_PATH);
const packageDir = join(runtimeDir, 'node_modules/playwright-core');
if (phase === 'package') {
  const installed = await ownedProcess('npm', [
    'install',
    '--prefix',
    runtimeDir,
    '--no-save',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    'playwright-core@1.56.1',
  ]);
  assert.equal(installed.code, 0, 'pinned Playwright core install failed');
}
const runtimePackage = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
assert.equal(runtimePackage.version, '1.56.1', 'runtime version mismatch');
if (phase === 'package') {
  console.log('HOSTED_PACKAGE_READY', runtimePackage.version);
  process.exit(0);
}
if (phase === 'browser') {
  const browser = await ownedProcess(join(runtimeDir, 'node_modules/.bin/playwright-core'), [
    'install',
    'chromium',
    '--no-shell',
  ]);
  assert.equal(browser.code, 0, 'bundled Chromium install failed');
}
const { chromium } = await import(pathToFileURL(join(packageDir, 'index.mjs')));
await access(chromium.executablePath());
// Playwright writes this only after a complete extraction. Never reuse a partial download.
const browsers = JSON.parse(await readFile(join(packageDir, 'browsers.json'), 'utf8'));
const revision = browsers.browsers.find((browser) => browser.name === 'chromium').revision;
await access(
  join(process.env.PLAYWRIGHT_BROWSERS_PATH, `chromium-${revision}`, 'INSTALLATION_COMPLETE'),
);
console.log('HOSTED_BROWSER_READY', revision, phase);
if (phase === 'browser') process.exit(0);

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
await run(prepared);
