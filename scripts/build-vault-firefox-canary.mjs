import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

/* Builds only a declared, committed Firefox MV3 artifact. No source from the
 * caller checkout is copied into the build; both repositories enter through
 * git archives at their resolved commits. */
const repo = resolve(new URL('..', import.meta.url).pathname);
const publicKeys = new Set([
  'WXT_SUPABASE_URL',
  'WXT_SUPABASE_PUBLISHABLE_KEY',
  'WXT_EXTENSION_OAUTH_CLIENT_ID',
  'WXT_FRONTEND_URL',
  'WXT_DESKTOP_LOCAL_URL',
  'WXT_DESKTOP_NATIVE_HOST',
]);
const fail = (message) => {
  throw new Error(`Vault Firefox canary build refused: ${message}`);
};

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
          size: (await stat(file)).size,
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

if (process.argv.includes('--help')) {
  process.stdout.write(
    `${[
      'Build a frozen Firefox MV3 Vault canary artifact.',
      'Required: MATRX_REALBROWSER_VAULT_BUILD=BUILD_UNDER_REVIEW',
      'Required: MATRX_CANARY_AIDREAM_COMMIT=<committed aidream revision>',
      'Optional: MATRX_CANARY_COMMIT=<committed matrx-extend revision; defaults to HEAD>',
      'Optional: MATRX_CANARY_PUBLIC_ENV_FILE=<allowlisted WXT public env file>',
      'The script archives committed source only, installs offline locked dependencies, and writes a local artifact receipt.',
    ].join('\n')}\n`,
  );
  process.exit(0);
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
const artifactParent = join(repo, '.matrx', 'task1-active', 'firefox-current-build');
const artifactRoot = join(artifactParent, `artifact-${runId}`);
const artifactStage = join(artifactParent, `.artifact-${runId}.tmp`);
const scratch = await mkdtemp(join(tmpdir(), 'matrx-vault-firefox-canary-'));
let artifactPublished = false;
let artifactStageOwned = false;

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
  await run('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'], {
    cwd: recordsRoot,
    env,
  });
  await run('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'], {
    cwd: source,
    env,
  });
  await run('pnpm', ['exec', 'wxt', 'prepare'], { cwd: source, env });
  await run('pnpm', ['run', 'build:firefox'], { cwd: source, env });
  const extension = join(source, '.output', 'firefox-mv3');
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) fail('build did not produce an MV3 extension');
  const addonId = manifest.browser_specific_settings?.gecko?.id;
  if (addonId !== 'matrx-extend@aimatrx.com')
    fail(`unexpected Firefox add-on id ${addonId ?? 'missing'}`);
  const extensionFiles = await filesWithHashes(extension);
  if (!extensionFiles.length) fail('artifact has no files');
  await mkdir(artifactParent, { recursive: true, mode: 0o700 });
  await mkdir(artifactStage, { mode: 0o700 });
  artifactStageOwned = true;
  await cp(extension, join(artifactStage, 'extension'), { recursive: true });
  const xpiPath = join(artifactStage, 'matrx-extend-firefox-mv3.xpi');
  await run('zip', ['-q', '-r', xpiPath, '.'], { cwd: join(artifactStage, 'extension') });
  const xpiExtract = join(scratch, 'xpi-extract');
  await mkdir(xpiExtract);
  await run('unzip', ['-q', xpiPath, '-d', xpiExtract]);
  const xpiFiles = await filesWithHashes(xpiExtract);
  if (JSON.stringify(xpiFiles) !== JSON.stringify(extensionFiles))
    fail('XPI inventory does not exactly match extension inventory');
  const nodeVersion = (await run('node', ['--version'], { env })).stdout.trim();
  const pnpmVersion = (await run('pnpm', ['--version'], { env })).stdout.trim();
  const receipt = {
    schema: 2,
    kind: 'local-multi-repo-source-artifact',
    runId,
    sourceCommit,
    lockfileSha256: createHash('sha256').update(locked).digest('hex'),
    extensionDirectory: 'extension',
    extensionFiles,
    extensionVersion: manifest.version ?? null,
    manifestVersion: manifest.manifest_version,
    addonId,
    xpi: {
      path: 'matrx-extend-firefox-mv3.xpi',
      sha256: createHash('sha256')
        .update(await readFile(xpiPath))
        .digest('hex'),
    },
    aidream: {
      sourceCommit: aidreamCommit,
      sourcePath: 'apps/shared/records',
      files: recordsFiles,
    },
    toolchain: {
      node: nodeVersion,
      pnpm: pnpmVersion,
      buildCommand: 'pnpm run build:firefox',
      dependencyInstall: 'pnpm install --offline --frozen-lockfile --ignore-scripts',
    },
    publicEnvKeys: Object.keys(env)
      .filter((key) => publicKeys.has(key))
      .sort(),
    distributionProvenance: 'local-multi-repo-source-artifact; not a Store/release claim',
  };
  const manifestPath = join(artifactStage, 'artifact-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  await writeFile(
    join(artifactStage, 'build-log.txt'),
    `Frozen source archive created from ${sourceCommit}\nFrozen aidream records archive created from ${aidreamCommit}\nrecords: pnpm install --offline --frozen-lockfile --ignore-scripts: exit 0\nextension: pnpm install --offline --frozen-lockfile --ignore-scripts: exit 0\nextension: pnpm exec wxt prepare: exit 0\nextension: pnpm run build:firefox: exit 0\nmanifest: MV${manifest.manifest_version}; gecko id ${addonId}\npackage: XPI inventory exactly matches extension files: verified separately\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(artifactStage, 'REPORT.md'),
    `# Frozen Firefox MV3 build\n\nSource: ${sourceCommit}\nRecords source: aidream ${aidreamCommit}, apps/shared/records\nBuild: pnpm run build:firefox after offline locked installs.\nFirefox MV3 add-on ID: ${addonId}\nPackaged XPI: ${receipt.xpi.path} (SHA-256: ${receipt.xpi.sha256})\nExtension files: ${extensionFiles.length}; their size and SHA-256 values are in artifact-manifest.json.\nXPI inventory: every extension file path, size, and SHA-256 exactly matches.\nProvenance: local frozen source artifact, not a Store or release claim.\n`,
    { mode: 0o600 },
  );
  await rename(artifactStage, artifactRoot);
  artifactPublished = true;
  process.stdout.write(`${join(artifactRoot, 'artifact-manifest.json')}\n`);
} finally {
  if (!artifactPublished && artifactStageOwned)
    await rm(artifactStage, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
}
