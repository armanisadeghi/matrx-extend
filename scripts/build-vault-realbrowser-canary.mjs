import { spawn } from 'node:child_process';
/**
 * Builds the Vault real-browser canary from an exact committed tree.
 *
 * This is deliberately separate from the runner: no browser, credential, API,
 * or database operation occurs here.  It accepts only public WXT build inputs,
 * archives the requested revision, and records hashes for every archived file.
 *
 * Run only when the reviewer has explicitly armed the canary build:
 *   MATRX_REALBROWSER_VAULT_BUILD=BUILD_UNDER_REVIEW node scripts/build-vault-realbrowser-canary.mjs
 */
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const repo = resolve(new URL('..', import.meta.url).pathname);
const acceptedBase = '22e9a3c006480df6f71a2098f1ca01e123e3d686';
const publicKeys = new Set([
  'WXT_SUPABASE_URL',
  'WXT_SUPABASE_PUBLISHABLE_KEY',
  'WXT_EXTENSION_OAUTH_CLIENT_ID',
  'WXT_FRONTEND_URL',
  'WXT_DESKTOP_LOCAL_URL',
  'WXT_DESKTOP_NATIVE_HOST',
]);

function fail(message) {
  throw new Error(`Vault real-browser build refused: ${message}`);
}
function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else {
        const diagnostic = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
        reject(new Error(`${command} ${args.join(' ')} failed (${code}): ${diagnostic}`));
      }
    });
  });
}
async function git(...args) {
  return (await run('git', ['-C', repo, ...args])).stdout.trim();
}
async function gitFile(revision, file) {
  // Git output is bytes, including a final newline.  Do not use git(), whose
  // trimming is correct for revisions but corrupts an exact lock comparison.
  return (await run('git', ['-C', repo, 'show', `${revision}:${file}`])).stdout;
}
async function filesWithHashes(root) {
  const results = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const body = await readFile(path);
        results.push({
          path: relative(root, path),
          sha256: createHash('sha256').update(body).digest('hex'),
        });
      }
    }
  }
  await visit(root);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}
async function readPublicBuildEnv() {
  const configured = process.env.MATRX_CANARY_PUBLIC_ENV_FILE;
  const candidates = configured
    ? [resolve(configured)]
    : [join(repo, '.env.development.local'), join(repo, '.env.development'), join(repo, '.env')];
  let text = '';
  for (const candidate of candidates) {
    text = await readFile(candidate, 'utf8').catch(() => '');
    if (text) break;
  }
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^(WXT_[A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    if (!publicKeys.has(match[1])) fail(`public env file contains unallowlisted ${match[1]}`);
    values[match[1]] = match[2];
  }
  for (const key of publicKeys) if (process.env[key]) values[key] = process.env[key];
  for (const key of [
    'WXT_SUPABASE_URL',
    'WXT_SUPABASE_PUBLISHABLE_KEY',
    'WXT_EXTENSION_OAUTH_CLIENT_ID',
  ]) {
    if (!values[key]) fail(`missing required public build input ${key}`);
  }
  return values;
}

if (process.env.MATRX_REALBROWSER_VAULT_BUILD !== 'BUILD_UNDER_REVIEW') {
  fail('set MATRX_REALBROWSER_VAULT_BUILD=BUILD_UNDER_REVIEW; this script never builds implicitly');
}
const commit = process.env.MATRX_CANARY_COMMIT ?? 'HEAD';
const resolvedCommit = await git('rev-parse', '--verify', `${commit}^{commit}`);
await git('merge-base', '--is-ancestor', acceptedBase, resolvedCommit).catch(() =>
  fail(`requested revision must contain accepted base ${acceptedBase.slice(0, 12)}`),
);
const lockAtCommit = await gitFile(resolvedCommit, 'pnpm-lock.yaml').catch(() =>
  fail('requested revision has no pnpm-lock.yaml'),
);
if (!lockAtCommit.includes('lockfileVersion:')) fail('pnpm lockfile is malformed');

const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
const evidenceDir = join(repo, '.matrx', 'realbrowser-vault', runId);
const scratch = await mkdtemp(join(tmpdir(), 'matrx-vault-realbrowser-'));
const source = join(scratch, 'source');
await mkdir(source);
const archivePath = join(scratch, 'source.tar');
await run('git', [
  '-C',
  repo,
  'archive',
  '--format=tar',
  `--output=${archivePath}`,
  resolvedCommit,
]);
await run('tar', ['-x', '-f', archivePath, '-C', source]);
// Several repository gates enumerate tracked source with git ls-files.  The
// archive intentionally has no .git directory, so give the isolated archive a
// throwaway index before dependency installation; it never becomes a commit or
// affects the caller checkout.
await run('git', ['init', '--quiet'], { cwd: source });
await run('git', ['add', '--all'], { cwd: source });
const archiveLock = await readFile(join(source, 'pnpm-lock.yaml'), 'utf8');
if (archiveLock !== lockAtCommit)
  fail('archive lockfile differs from the exact committed lockfile');
const publicEnv = await readPublicBuildEnv();
const safeEnv = {
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  TMPDIR: process.env.TMPDIR ?? tmpdir(),
  CI: '1',
  ...publicEnv,
};
await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], {
  cwd: source,
  env: safeEnv,
});
// install deliberately ignores lifecycle scripts.  WXT generation is the one
// required deterministic preparation step; invoking it explicitly avoids
// arbitrary package hooks while producing the checked-in TypeScript config.
await run('pnpm', ['exec', 'wxt', 'prepare'], { cwd: source, env: safeEnv });
await run('pnpm', ['build'], { cwd: source, env: safeEnv });
const extensionDir = join(source, '.output', 'chrome-mv3');
const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) fail('build did not produce an MV3 extension');
const fileHashes = await filesWithHashes(source);
await mkdir(evidenceDir, { recursive: true });
await cp(extensionDir, join(evidenceDir, 'extension'), { recursive: true });
const evidence = {
  schema: 1,
  runId,
  sourceCommit: resolvedCommit,
  acceptedBase,
  lockfileSha256: createHash('sha256').update(archiveLock).digest('hex'),
  archivedFileCount: fileHashes.length,
  archivedFiles: fileHashes,
  extensionDirectory: 'extension',
  publicEnvKeys: Object.keys(publicEnv).sort(),
  note: 'No credential, API, browser, or database action occurred during this build.',
};
await writeFile(
  join(evidenceDir, 'artifact-manifest.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`${join(evidenceDir, 'artifact-manifest.json')}\n`);
