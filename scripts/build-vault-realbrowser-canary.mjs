import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

/* Build an explicitly requested current artifact. The runner accepts only the
 * manifest it emits (or a separately verified release ZIP), never guessed
 * Store provenance from this development artifact. */
const repo = resolve(new URL('..', import.meta.url).pathname);
const publicKeys = new Set([
  'WXT_SUPABASE_URL',
  'WXT_SUPABASE_PUBLISHABLE_KEY',
  'WXT_EXTENSION_OAUTH_CLIENT_ID',
  'WXT_SAFARI_OAUTH_CLIENT_ID',
  'WXT_FRONTEND_URL',
  'WXT_DESKTOP_NATIVE_HOST',
]);
const fail = (message) => {
  throw new Error(`Vault real-browser build refused: ${message}`);
};
function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolveRun({ stdout, stderr })
        : reject(
            new Error(
              `${command} failed (${code}): ${[stderr.trim(), stdout.trim()].filter(Boolean).join('\n')}`,
            ),
          ),
    );
  });
}
async function filesWithHashes(root) {
  const results = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile())
        results.push({
          path: relative(root, file),
          sha256: createHash('sha256')
            .update(await readFile(file))
            .digest('hex'),
        });
      else fail(`unsupported artifact entry ${relative(root, file)}`);
    }
  }
  await visit(root);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}
async function publicBuildEnv() {
  const configured = process.env.MATRX_CANARY_PUBLIC_ENV_FILE;
  const candidates = configured
    ? [resolve(configured)]
    : [join(repo, '.env.development.local'), join(repo, '.env.development'), join(repo, '.env')];
  const values = {};
  for (const file of candidates) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      const match = /^(WXT_[A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      if (!publicKeys.has(match[1])) fail(`public env file contains unallowlisted ${match[1]}`);
      values[match[1]] = match[2];
    }
    break;
  }
  for (const key of publicKeys) if (process.env[key]) values[key] = process.env[key];
  for (const key of [
    'WXT_SUPABASE_URL',
    'WXT_SUPABASE_PUBLISHABLE_KEY',
    'WXT_EXTENSION_OAUTH_CLIENT_ID',
  ])
    if (!values[key]) fail(`missing required public build input ${key}`);
  return values;
}

if (process.env.MATRX_REALBROWSER_VAULT_BUILD !== 'BUILD_UNDER_REVIEW')
  fail('set MATRX_REALBROWSER_VAULT_BUILD=BUILD_UNDER_REVIEW; this script never builds implicitly');
const revision = process.env.MATRX_CANARY_COMMIT ?? 'HEAD';
const sourceCommit = (
  await run('git', ['-C', repo, 'rev-parse', '--verify', `${revision}^{commit}`])
).stdout.trim();
const aidreamRepo = resolve(repo, '../aidream');
const aidreamRevision = process.env.MATRX_CANARY_AIDREAM_COMMIT;
if (!aidreamRevision)
  fail('set MATRX_CANARY_AIDREAM_COMMIT to the committed records-source revision');
const aidreamCommit = (
  await run('git', ['-C', aidreamRepo, 'rev-parse', '--verify', `${aidreamRevision}^{commit}`])
).stdout.trim();
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
const artifactRoot = join(repo, '.matrx', 'realbrowser-vault', runId);
const scratch = await mkdtemp(join(tmpdir(), 'matrx-vault-realbrowser-'));
try {
  const source = join(scratch, 'source');
  const aidreamSource = join(scratch, 'aidream');
  const archive = join(scratch, 'source.tar');
  const recordsArchive = join(scratch, 'records.tar');
  await mkdir(source);
  await mkdir(aidreamSource);
  await run('git', ['-C', repo, 'archive', '--format=tar', `--output=${archive}`, sourceCommit]);
  await run('tar', ['-x', '-f', archive, '-C', source]);
  // Repository gates enumerate tracked source. This disposable index represents
  // only the frozen archive and never touches the caller checkout.
  await run('git', ['init', '--quiet'], { cwd: source });
  await run('git', ['add', '--all'], { cwd: source });
  // tsconfig deliberately resolves this unpublished workspace source through
  // ../aidream. Archive only its committed records package, never live WIP.
  await run('git', [
    '-C',
    aidreamRepo,
    'archive',
    '--format=tar',
    `--output=${recordsArchive}`,
    aidreamCommit,
    'apps/shared/records',
  ]);
  await run('tar', ['-x', '-f', recordsArchive, '-C', aidreamSource]);
  const recordsRoot = join(aidreamSource, 'apps', 'shared', 'records');
  const recordsFiles = await filesWithHashes(recordsRoot).catch(() =>
    fail('committed records source missing'),
  );
  if (!recordsFiles.length) fail('committed records source empty');
  const locked = await readFile(join(source, 'pnpm-lock.yaml'), 'utf8').catch(() =>
    fail('revision has no lockfile'),
  );
  if (!locked.includes('lockfileVersion:')) fail('lockfile is malformed');
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    TMPDIR: tmpdir(),
    CI: '1',
    ...(await publicBuildEnv()),
  };
  // Use the records package's own committed lockfile to materialize only its
  // declared dependencies for TypeScript's source alias; no package metadata
  // or extension dependency contract is changed.
  await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], {
    cwd: recordsRoot,
    env,
  });
  await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: source, env });
  await run('pnpm', ['exec', 'wxt', 'prepare'], { cwd: source, env });
  await run('pnpm', ['build'], { cwd: source, env });
  const extension = join(source, '.output', 'chrome-mv3');
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) fail('build did not produce an MV3 extension');
  const extensionFiles = await filesWithHashes(extension);
  if (!extensionFiles.length) fail('artifact has no files');
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  await cp(extension, join(artifactRoot, 'extension'), { recursive: true });
  const receipt = {
    schema: 2,
    kind: 'local-multi-repo-source-artifact',
    runId,
    sourceCommit,
    lockfileSha256: createHash('sha256').update(locked).digest('hex'),
    extensionDirectory: 'extension',
    extensionFiles,
    manifestVersion: manifest.version ?? null,
    aidream: {
      sourceCommit: aidreamCommit,
      sourcePath: 'apps/shared/records',
      files: recordsFiles,
    },
    publicEnvKeys: Object.keys(env)
      .filter((key) => publicKeys.has(key))
      .sort(),
    distributionProvenance: 'local-multi-repo-source-artifact; not a Store/release claim',
  };
  const manifestPath = join(artifactRoot, 'artifact-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${manifestPath}\n`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
