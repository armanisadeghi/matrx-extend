#!/usr/bin/env node
/** Snapshot a local keyed WXT build without claiming a published release. */
import { open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashReleaseTree } from './sync-unpacked-release.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BUILD = resolve(REPO, '.output', 'chrome-mv3-dev');
// `wxt dev` owns chrome-mv3-dev, while `wxt build` writes a separately keyed
// local artifact to chrome-mv3. Both are safe for an owned-browser check; no
// other output directory can be certified as a local artifact.
const LOCAL_BUILD_DIRECTORIES = new Set([
  DEFAULT_BUILD,
  resolve(REPO, '.output', 'chrome-mv3'),
]);
const SHA256 = /^[a-f0-9]{64}$/;

export function requireLocalDevReceipt(receipt, extensionDir) {
  if (
    receipt?.kind !== 'local_dev_unpacked' ||
    receipt.schema_version !== 1 ||
    receipt.publish_state !== 'not_published' ||
    typeof receipt.version !== 'string' ||
    !SHA256.test(receipt.treeSha256 ?? '') ||
    typeof receipt.extensionDir !== 'string' ||
    !LOCAL_BUILD_DIRECTORIES.has(resolve(extensionDir)) ||
    resolve(receipt.extensionDir) !== resolve(extensionDir) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(receipt.observedAt ?? '') ||
    !Number.isFinite(Date.parse(receipt.observedAt))
  )
    throw new Error('local_dev_build_receipt_refused');
  return receipt;
}

export async function recordLocalDevBuild({ extensionDir = DEFAULT_BUILD, outputPath }) {
  const build = resolve(extensionDir);
  if (!LOCAL_BUILD_DIRECTORIES.has(build)) throw new Error('local_dev_build_path_refused');
  if (typeof outputPath !== 'string' || !outputPath)
    throw new Error('local_dev_receipt_output_refused');
  const output = resolve(outputPath);
  if (dirname(output) !== resolve(REPO, 'test-results'))
    throw new Error('local_dev_receipt_output_refused');
  const [manifest, pkg] = await Promise.all([
    readFile(resolve(build, 'manifest.json'), 'utf8').then(JSON.parse),
    readFile(resolve(REPO, 'package.json'), 'utf8').then(JSON.parse),
  ]);
  if (
    manifest.manifest_version !== 3 ||
    typeof manifest.key !== 'string' ||
    manifest.key.length === 0 ||
    manifest.version !== pkg.version
  )
    throw new Error('local_dev_manifest_refused');
  const treeSha256 = hashReleaseTree(build);
  const receipt = {
    schema_version: 1,
    kind: 'local_dev_unpacked',
    publish_state: 'not_published',
    observedAt: new Date().toISOString(),
    extensionDir: build,
    version: manifest.version,
    treeSha256,
  };
  // A second hash detects a concurrent build during snapshot creation.
  if (hashReleaseTree(build) !== treeSha256) throw new Error('local_dev_tree_changed');
  const handle = await open(output, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (
      process.argv.length !== 6 ||
      process.argv[2] !== '--extension-dir' ||
      process.argv[4] !== '--output'
    )
      throw new Error('local_dev_arguments_refused');
    await recordLocalDevBuild({ extensionDir: process.argv[3], outputPath: process.argv[5] });
    process.stdout.write('LOCAL_DEV_BUILD_RECORDED\n');
  } catch {
    process.stderr.write('LOCAL_DEV_BUILD_REFUSED\n');
    process.exitCode = 1;
  }
}
