import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readManifest(dir) {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error(`Invalid manifest JSON: ${manifestPath}`);
  }
  return manifest;
}

function fileEntries(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = lstatSync(full);
      const rel = relative(root, full);
      if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in release tree: ${rel}`);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) files.push(rel);
      else throw new Error(`Refusing non-file release entry: ${rel}`);
    }
  };
  walk(root);
  return files.sort();
}

export function hashReleaseTree(dir) {
  const root = resolve(dir);
  if (!lstatSync(root).isDirectory()) throw new Error(`Release tree is not a directory: ${root}`);
  const hash = createHash('sha256');
  for (const rel of fileEntries(root)) {
    hash
      .update(rel)
      .update('\0')
      .update(readFileSync(join(root, rel)))
      .update('\0');
  }
  return hash.digest('hex');
}

function assertKeyedManifest(dir, version) {
  const manifest = readManifest(dir);
  if (manifest.version !== version) {
    throw new Error(
      `Manifest version mismatch in ${dir}: expected ${version}, got ${manifest.version ?? 'missing'}`,
    );
  }
  if (typeof manifest.key !== 'string' || manifest.key.length === 0) {
    throw new Error(`Refusing unkeyed Store bundle: ${dir}`);
  }
}

// Cleanup is after the commit point. It must never turn a committed promotion
// into a failure that tells the caller to restore only its ZIPs.
function cleanupCommittedPath(path, options) {
  try {
    rmSync(path, options);
  } catch (error) {
    console.error(
      `WARNING: Release committed; cleanup failed at ${path}: ${error.message}. Inspect and remove this retained path when safe.`,
    );
  }
}

export function promoteUnpackedRelease({ sourceDir, destinationDir, version }) {
  return promoteUnpackedReleaseToMany({ sourceDir, destinationDirs: [destinationDir], version });
}

/** Keep every already-installed unpacked path on the same release bytes. */
export function promoteUnpackedReleaseToMany({
  sourceDir,
  destinationDirs,
  version,
  beforeCommit,
}) {
  const source = resolve(sourceDir);
  const destinations = destinationDirs.map((dir) => resolve(dir));
  if (destinations.length === 0 || new Set(destinations).size !== destinations.length) {
    throw new Error('Release destinations must be nonempty and unique');
  }
  if (destinations.includes(source)) throw new Error('Source and destinations must differ');
  assertKeyedManifest(source, version);
  const sourceHash = hashReleaseTree(source);
  const fileCount = fileEntries(source).length;
  const nonce = `${process.pid}-${Date.now()}`;
  const entries = destinations.map((destination) => {
    const parent = dirname(destination);
    mkdirSync(parent, { recursive: true });
    return {
      destination,
      staging: join(parent, `.${basename(destination)}.release-stage-${nonce}`),
      backup: join(parent, `.${basename(destination)}.release-backup-${nonce}`),
      movedExisting: false,
      promoted: false,
    };
  });
  try {
    // Prepare and verify every replacement before changing any installed path.
    for (const entry of entries) {
      cpSync(source, entry.staging, { recursive: true, dereference: false, errorOnExist: true });
      assertKeyedManifest(entry.staging, version);
      if (hashReleaseTree(entry.staging) !== sourceHash) {
        throw new Error(`Staged release tree hash differs from source: ${entry.destination}`);
      }
    }
    if (hashReleaseTree(source) !== sourceHash)
      throw new Error('Source release tree changed during staging');
    for (const entry of entries) {
      if (existsSync(entry.destination)) {
        renameSync(entry.destination, entry.backup);
        entry.movedExisting = true;
      }
      renameSync(entry.staging, entry.destination);
      entry.promoted = true;
      assertKeyedManifest(entry.destination, version);
      if (hashReleaseTree(entry.destination) !== sourceHash) {
        throw new Error(`Promoted release tree hash differs from source: ${entry.destination}`);
      }
    }
    if (hashReleaseTree(source) !== sourceHash)
      throw new Error('Source release tree changed during promotion');
    beforeCommit?.({
      source,
      destination: entries[0].destination,
      destinations,
      sourceHash,
      destinationHash: sourceHash,
      fileCount,
    });
  } catch (error) {
    const recoveryErrors = [];
    for (const entry of [...entries].reverse()) {
      // Independent destinations must still be restored if one restore fails.
      try {
        if (entry.promoted) rmSync(entry.destination, { recursive: true, force: true });
        if (entry.movedExisting) renameSync(entry.backup, entry.destination);
      } catch (recoveryError) {
        recoveryErrors.push(
          `${entry.destination}: ${recoveryError.message}; prior bundle retained at ${entry.backup}`,
        );
      }
      try {
        rmSync(entry.staging, { recursive: true, force: true });
      } catch (cleanupError) {
        recoveryErrors.push(`staging retained at ${entry.staging}: ${cleanupError.message}`);
      }
    }
    if (recoveryErrors.length) {
      throw new Error(
        `Promotion failed: ${error.message}. Recovery incomplete: ${recoveryErrors.join('; ')}`,
        { cause: error },
      );
    }
    throw new Error(`Promotion failed; prior unpacked paths restored: ${error.message}`, {
      cause: error,
    });
  }
  // Receipt and all destinations are now committed. Cleanup errors are warnings.
  for (const entry of entries) {
    if (entry.movedExisting) cleanupCommittedPath(entry.backup, { recursive: true, force: true });
  }
  return {
    source,
    destination: entries[0].destination,
    destinations,
    sourceHash,
    destinationHash: sourceHash,
    fileCount,
  };
}

export function writeReleaseReceipt({
  receiptPath,
  sourceSha,
  version,
  storeZip,
  localZip,
  promotion,
  publishState,
}) {
  const receipt = {
    sourceSha,
    version,
    publishState,
    storeZip: { path: storeZip, sha256: sha256(readFileSync(storeZip)) },
    localZip: { path: localZip, sha256: sha256(readFileSync(localZip)) },
    sourcePath: promotion.source,
    destinationPath: promotion.destination,
    ...(promotion.destinations ? { destinationPaths: promotion.destinations } : {}),
    treeSha256: promotion.sourceHash,
    fileCount: promotion.fileCount,
  };
  const stagedReceipt = `${receiptPath}.stage-${process.pid}-${Date.now()}`;
  let committed = false;
  try {
    writeFileSync(stagedReceipt, `${JSON.stringify(receipt, null, 2)}\n`);
    renameSync(stagedReceipt, receiptPath);
    committed = true;
  } finally {
    if (committed) cleanupCommittedPath(stagedReceipt, { force: true });
    else {
      try {
        rmSync(stagedReceipt, { force: true });
      } catch (error) {
        console.error(`WARNING: Receipt staging retained at ${stagedReceipt}: ${error.message}`);
      }
    }
  }
  return receipt;
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const root = option('root');
  const version = option('version');
  const sourceSha = option('source-sha');
  if (!root || !version || !sourceSha)
    throw new Error(
      'Usage: --root --version --source-sha [--source] [--destination] [--store-zip --local-zip --receipt --publish-state]',
    );
  const source = option('source') ?? join(root, '.output/chrome-mv3');
  const destination = option('destination') ?? join(root, '.output/chrome-mv3-dev');
  const alsoDestination = option('also-destination');
  const receipt = option('receipt');
  const storeZip = option('store-zip');
  const localZip = option('local-zip');
  if (receipt && (!storeZip || !localZip))
    throw new Error('--receipt requires --store-zip and --local-zip');
  const promotion = promoteUnpackedReleaseToMany({
    sourceDir: source,
    destinationDirs: alsoDestination ? [destination, alsoDestination] : [destination],
    version,
    beforeCommit: receipt
      ? (result) =>
          writeReleaseReceipt({
            receiptPath: receipt,
            sourceSha,
            version,
            storeZip,
            localZip,
            promotion: result,
            publishState: option('publish-state') ?? 'pushed',
          })
      : undefined,
  });
  process.stdout.write(`${JSON.stringify(promotion)}\n`);
}
