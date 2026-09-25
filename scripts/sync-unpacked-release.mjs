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

export function promoteUnpackedRelease({ sourceDir, destinationDir, version }) {
  const source = resolve(sourceDir);
  const destination = resolve(destinationDir);
  if (source === destination) throw new Error('Source and destination must differ');
  assertKeyedManifest(source, version);
  const sourceHash = hashReleaseTree(source);
  const parent = dirname(destination);
  mkdirSync(parent, { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`;
  const staging = join(parent, `.${basename(destination)}.release-stage-${nonce}`);
  const backup = join(parent, `.${basename(destination)}.release-backup-${nonce}`);
  let movedExisting = false;
  try {
    cpSync(source, staging, { recursive: true, dereference: false, errorOnExist: true });
    assertKeyedManifest(staging, version);
    const stagedHash = hashReleaseTree(staging);
    if (stagedHash !== sourceHash) throw new Error('Staged release tree hash differs from source');
    if (existsSync(destination)) {
      renameSync(destination, backup);
      movedExisting = true;
    }
    renameSync(staging, destination);
    assertKeyedManifest(destination, version);
    const destinationHash = hashReleaseTree(destination);
    if (destinationHash !== sourceHash)
      throw new Error('Promoted release tree hash differs from source');
    if (hashReleaseTree(source) !== sourceHash)
      throw new Error('Source release tree changed during promotion');
    if (movedExisting) rmSync(backup, { recursive: true, force: true });
    return {
      source,
      destination,
      sourceHash,
      destinationHash,
      fileCount: fileEntries(source).length,
    };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (movedExisting && existsSync(backup)) {
      if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
      renameSync(backup, destination);
    }
    throw error;
  }
}

/** Keep every already-installed unpacked path on the same release bytes. */
export function promoteUnpackedReleaseToMany({ sourceDir, destinationDirs, version }) {
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
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      rmSync(entry.staging, { recursive: true, force: true });
      if (entry.promoted) rmSync(entry.destination, { recursive: true, force: true });
      if (entry.movedExisting && existsSync(entry.backup))
        renameSync(entry.backup, entry.destination);
    }
    throw error;
  }
  // Both replacements are committed and verified. Cleanup failure must not
  // attempt to roll back a destination whose old backup was already removed.
  for (const entry of entries) {
    if (entry.movedExisting) rmSync(entry.backup, { recursive: true, force: true });
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
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
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
  const promotion = alsoDestination
    ? promoteUnpackedReleaseToMany({
        sourceDir: source,
        destinationDirs: [destination, alsoDestination],
        version,
      })
    : promoteUnpackedRelease({ sourceDir: source, destinationDir: destination, version });
  const receipt = option('receipt');
  if (receipt) {
    const storeZip = option('store-zip');
    const localZip = option('local-zip');
    if (!storeZip || !localZip) throw new Error('--receipt requires --store-zip and --local-zip');
    writeReleaseReceipt({
      receiptPath: receipt,
      sourceSha,
      version,
      storeZip,
      localZip,
      promotion,
      publishState: option('publish-state') ?? 'pushed',
    });
  }
  process.stdout.write(`${JSON.stringify(promotion)}\n`);
}
