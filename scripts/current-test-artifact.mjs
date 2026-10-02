#!/usr/bin/env node
/** A GitHub Actions development build, never a Store release candidate. */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, lstatSync } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { recordLocalDevBuild, requireLocalDevReceipt } from './record-local-dev-build.mjs';
import { hashReleaseTree } from './sync-unpacked-release.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'armanisadeghi/matrx-extend';
const DEV_ID = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DECIMAL = /^[1-9]\d*$/;
const PREFIX = 'matrx-extend-development-test';
const OUTPUT = join(REPO, '.output', 'chrome-mv3');
const RESULTS = join(REPO, 'test-results');

function fail(code) {
  throw new Error(code);
}
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function json(path) {
  return readFile(path, 'utf8').then(JSON.parse);
}
function git(...args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
}
function ghJson(endpoint) {
  return JSON.parse(
    execFileSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }),
  );
}
function devId(key) {
  if (typeof key !== 'string' || !key) fail('test_artifact_dev_key_missing');
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length < 200 || bytes.toString('base64').replace(/=+$/, '') !== key.replace(/=+$/, ''))
    fail('test_artifact_dev_key_invalid');
  return [...createHash('sha256').update(bytes).digest().subarray(0, 16)]
    .map(
      (byte) => `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 15))}`,
    )
    .join('');
}
function publicConfig() {
  const url = process.env.WXT_SUPABASE_URL;
  const key = process.env.WXT_SUPABASE_PUBLISHABLE_KEY;
  const client = process.env.WXT_EXTENSION_OAUTH_CLIENT_ID;
  if (url !== 'https://db.matrxserver.com') fail('test_artifact_public_url_refused');
  if (typeof key !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))
    fail('test_artifact_public_key_refused');
  if (typeof client !== 'string' || !/^[A-Za-z0-9_-]{8,}$/.test(client))
    fail('test_artifact_public_oauth_client_refused');
  return { url, key, client };
}
async function assertManifest(tree, version) {
  const manifest = await json(join(tree, 'manifest.json'));
  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== version ||
    devId(manifest.key) !== DEV_ID
  )
    fail('test_artifact_manifest_refused');
  return manifest;
}
async function containsInBuiltJs(tree, value) {
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) fail('test_artifact_tree_symlink_refused');
      if (entry.isDirectory()) {
        if (await walk(path)) return true;
      } else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) {
        if ((await readFile(path)).includes(Buffer.from(value))) return true;
      }
    }
    return false;
  };
  return walk(tree);
}
async function produce() {
  const config = publicConfig();
  const sha = process.env.GITHUB_SHA;
  const runId = process.env.GITHUB_RUN_ID;
  const attempt = process.env.GITHUB_RUN_ATTEMPT;
  if (
    process.env.GITHUB_EVENT_NAME !== 'push' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.GITHUB_REPOSITORY !== OWNER ||
    !SHA.test(sha ?? '') ||
    !DECIMAL.test(runId ?? '') ||
    !DECIMAL.test(attempt ?? '') ||
    git('rev-parse', 'HEAD') !== sha
  )
    fail('test_artifact_ci_context_refused');
  const version = (await json(join(REPO, 'package.json'))).version;
  await assertManifest(OUTPUT, version);
  for (const value of Object.values(config)) {
    if (!(await containsInBuiltJs(OUTPUT, value))) fail('test_artifact_bundled_config_refused');
  }
  await mkdir(RESULTS, { recursive: true, mode: 0o700 });
  const receiptPath = join(RESULTS, 'ci-build-receipt.json');
  const receipt = await recordLocalDevBuild({ extensionDir: OUTPUT, outputPath: receiptPath });
  const provenance = {
    schema_version: 1,
    kind: 'ci_development_test',
    eligibleStore: false,
    publish_state: 'not_published',
    repository: OWNER,
    workflow: '.github/workflows/ci.yml',
    event: 'push',
    ref: 'refs/heads/main',
    sourceSha: sha,
    runId: Number(runId),
    runAttempt: Number(attempt),
    version,
    expectedExtensionId: DEV_ID,
    treeSha256: receipt.treeSha256,
  };
  await writeFile(
    join(RESULTS, 'ci-build-provenance.json'),
    `${JSON.stringify(provenance, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(`DEVELOPMENT_TEST_ARTIFACT_READY ${sha} ${receipt.treeSha256}\n`);
}
function ghDownload(endpoint, output) {
  const child = spawn('gh', ['api', endpoint], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.resume();
  const exited = new Promise((resolveDownload, rejectDownload) => {
    child.on('error', rejectDownload);
    child.on('close', (code) =>
      code === 0
        ? resolveDownload()
        : rejectDownload(new Error(`test_artifact_download_failed_${code}`)),
    );
  });
  return Promise.all([
    exited,
    pipeline(child.stdout, createWriteStream(output, { flags: 'wx', mode: 0o600 })),
  ]);
}
function checkZipPaths(zip) {
  const names = execFileSync('unzip', ['-Z', '-1', zip], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
    .trim()
    .split('\n');
  if (!names.length) fail('test_artifact_archive_empty');
  for (const name of names) {
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..'))
      fail('test_artifact_archive_path_refused');
  }
}
function assertNoSymlinkParents(path) {
  let cursor = path;
  while (cursor !== dirname(cursor)) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) fail('test_artifact_import_symlink_refused');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    cursor = dirname(cursor);
  }
}
export async function reserveImportTarget(sha, runId, attempt) {
  if (!SHA.test(sha) || !DECIMAL.test(String(runId)) || !DECIMAL.test(String(attempt)))
    fail('test_artifact_target_refused');
  const parent = join(RESULTS, 'ci-artifacts', sha);
  const target = join(parent, `${runId}-${attempt}`);
  assertNoSymlinkParents(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await mkdir(target, { mode: 0o700 }); // Exclusive: never replace another agent's artifact.
  return target;
}
export async function withReservedImportTarget(sha, runId, attempt, writeImport) {
  const target = await reserveImportTarget(sha, runId, attempt);
  try {
    await writeImport(target);
    return target;
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}
async function sourceState(sha) {
  execFileSync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: REPO });
  const originMain = git('rev-parse', 'origin/main');
  const localHead = git('rev-parse', 'HEAD');
  const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
  const untrackedRunnerInputs = git(
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    'tests/browser',
    'scripts',
  )
    .split('\n')
    .filter(Boolean);
  return {
    originMain,
    localHead,
    trackedDirty: dirty,
    untrackedRunnerInputs,
    claim:
      originMain === sha && localHead === sha && !dirty && untrackedRunnerInputs.length === 0
        ? 'current_pushed_source'
        : 'exact_pushed_commit_only',
  };
}

export function verifyGitHubMetadata(run, workflow, artifact, runId, artifactId) {
  if (
    run.id !== Number(runId) ||
    run.repository?.full_name !== OWNER ||
    run.head_repository?.full_name !== OWNER ||
    run.workflow_id !== workflow.id ||
    run.path !== '.github/workflows/ci.yml' ||
    run.event !== 'push' ||
    run.head_branch !== 'main' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    !SHA.test(run.head_sha ?? '') ||
    !DECIMAL.test(String(run.run_attempt ?? ''))
  )
    fail('test_artifact_run_refused');
  const expectedName = `${PREFIX}-${run.head_sha}-${run.id}-${run.run_attempt}`;
  const digest = /^sha256:([a-f0-9]{64})$/.exec(artifact.digest ?? '');
  if (
    artifact.id !== Number(artifactId) ||
    artifact.name !== expectedName ||
    artifact.expired ||
    artifact.workflow_run?.id !== run.id ||
    artifact.workflow_run?.head_sha !== run.head_sha ||
    !digest
  )
    fail('test_artifact_github_metadata_refused');
  return digest[1];
}

export async function verifyDownloadedTree(build, receipt, provenance, run, version) {
  const ciBuildPath =
    typeof receipt?.extensionDir === 'string' &&
    /^\/[^\0]+\/matrx-extend\/\.output\/chrome-mv3$/.test(receipt.extensionDir) &&
    !receipt.extensionDir.split('/').includes('..');
  if (
    provenance.kind !== 'ci_development_test' ||
    provenance.eligibleStore !== false ||
    provenance.publish_state !== 'not_published' ||
    provenance.repository !== OWNER ||
    provenance.workflow !== '.github/workflows/ci.yml' ||
    provenance.event !== 'push' ||
    provenance.ref !== 'refs/heads/main' ||
    provenance.sourceSha !== run.head_sha ||
    provenance.runId !== run.id ||
    provenance.runAttempt !== run.run_attempt ||
    provenance.expectedExtensionId !== DEV_ID ||
    provenance.version !== version ||
    provenance.treeSha256 !== receipt.treeSha256 ||
    receipt.schema_version !== 1 ||
    receipt.kind !== 'local_dev_unpacked' ||
    receipt.publish_state !== 'not_published' ||
    receipt.version !== version ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(receipt.observedAt ?? '') ||
    !Number.isFinite(Date.parse(receipt.observedAt)) ||
    !ciBuildPath ||
    !SHA256.test(receipt.treeSha256 ?? '')
  )
    fail('test_artifact_provenance_refused');
  await assertManifest(build, version);
  if (hashReleaseTree(build) !== receipt.treeSha256) fail('test_artifact_tree_refused');
}

export async function verifyImportedNativeEvidence(extensionDir, localReceiptPath) {
  const build = resolve(extensionDir);
  const relative = build.startsWith(`${REPO}/`) ? build.slice(REPO.length + 1) : '';
  const match =
    /^test-results\/ci-artifacts\/([a-f0-9]{40})\/([1-9]\d*)-([1-9]\d*)\/chrome-mv3$/.exec(
      relative,
    );
  if (!match) fail('test_artifact_native_path_refused');
  const [, sourceSha, runId, runAttempt] = match;
  const target = dirname(build);
  if (resolve(localReceiptPath) !== join(target, 'local-dev-receipt.json'))
    fail('test_artifact_native_receipt_path_refused');
  assertNoSymlinkParents(build);
  const [localReceipt, ciReceiptBytes, provenanceBytes, status] = await Promise.all([
    json(localReceiptPath),
    readFile(join(target, 'ci-receipt.json')),
    readFile(join(target, 'provenance.json')),
    json(join(target, 'import-status.json')),
  ]);
  requireLocalDevReceipt(localReceipt, build);
  if (
    status.schema_version !== 1 ||
    status.eligibleStore !== false ||
    status.sourceSha !== sourceSha ||
    status.runId !== Number(runId) ||
    status.runAttempt !== Number(runAttempt) ||
    !DECIMAL.test(String(status.artifactId ?? '')) ||
    !/^sha256:[a-f0-9]{64}$/.test(status.githubArtifactDigest ?? '') ||
    status.treeSha256 !== localReceipt.treeSha256 ||
    status.ciReceiptSha256 !== sha256(ciReceiptBytes) ||
    status.provenanceSha256 !== sha256(provenanceBytes)
  )
    fail('test_artifact_native_evidence_refused');
  const ciReceipt = JSON.parse(ciReceiptBytes);
  const provenance = JSON.parse(provenanceBytes);
  const version = (await json(join(REPO, 'package.json'))).version;
  if (localReceipt.version !== version) fail('test_artifact_native_version_refused');
  await verifyDownloadedTree(
    build,
    ciReceipt,
    provenance,
    { head_sha: sourceSha, id: status.runId, run_attempt: status.runAttempt },
    version,
  );
  const source = await sourceState(sourceSha);
  return {
    schema_version: 1,
    kind: 'ci_development_test',
    eligibleStore: false,
    publish_state: 'not_published',
    repository: OWNER,
    workflow: '.github/workflows/ci.yml',
    sourceSha,
    runId: status.runId,
    runAttempt: status.runAttempt,
    artifactId: status.artifactId,
    githubArtifactDigest: status.githubArtifactDigest,
    treeSha256: status.treeSha256,
    source,
  };
}

async function importArtifact(runId, artifactId) {
  if (!DECIMAL.test(runId ?? '') || !DECIMAL.test(artifactId ?? ''))
    fail('test_artifact_selector_refused');
  const root = `/repos/${OWNER}`;
  const [run, workflow, artifact] = [
    ghJson(`${root}/actions/runs/${runId}`),
    ghJson(`${root}/actions/workflows/ci.yml`),
    ghJson(`${root}/actions/artifacts/${artifactId}`),
  ];
  const digest = verifyGitHubMetadata(run, workflow, artifact, runId, artifactId);
  const scratch = await mkdtemp(join(tmpdir(), 'matrx-ci-test-import-'));
  try {
    const zip = join(scratch, 'github-artifact.zip');
    await ghDownload(`${root}/actions/artifacts/${artifactId}/zip`, zip);
    const bytes = await readFile(zip);
    const actualDigest = createHash('sha256').update(bytes).digest('hex');
    if (actualDigest !== digest) fail('test_artifact_github_digest_refused');
    checkZipPaths(zip);
    const extracted = join(scratch, 'extracted');
    await mkdir(extracted);
    execFileSync('unzip', ['-q', zip, '-d', extracted], { stdio: 'ignore' });
    const build = join(extracted, '.output', 'chrome-mv3');
    const ciReceiptPath = join(extracted, 'test-results', 'ci-build-receipt.json');
    const provenancePath = join(extracted, 'test-results', 'ci-build-provenance.json');
    if (lstatSync(ciReceiptPath).isSymbolicLink() || lstatSync(provenancePath).isSymbolicLink())
      fail('test_artifact_evidence_symlink_refused');
    const ciReceiptBytes = await readFile(ciReceiptPath);
    const provenanceBytes = await readFile(provenancePath);
    const receipt = JSON.parse(ciReceiptBytes);
    const provenance = JSON.parse(provenanceBytes);
    const version = (await json(join(REPO, 'package.json'))).version;
    await verifyDownloadedTree(build, receipt, provenance, run, version);
    const state = await sourceState(run.head_sha);
    const target = await withReservedImportTarget(
      run.head_sha,
      run.id,
      run.run_attempt,
      async (target) => {
        const imported = join(target, 'chrome-mv3');
        await cp(build, imported, { recursive: true, errorOnExist: true, force: false });
        if (hashReleaseTree(imported) !== receipt.treeSha256)
          fail('test_artifact_import_tree_refused');
        await copyFile(ciReceiptPath, join(target, 'ci-receipt.json'));
        await copyFile(provenancePath, join(target, 'provenance.json'));
        await recordLocalDevBuild({
          extensionDir: imported,
          outputPath: join(target, 'local-dev-receipt.json'),
        });
        await writeFile(
          join(target, 'import-status.json'),
          `${JSON.stringify(
            {
              schema_version: 1,
              eligibleStore: false,
              sourceSha: run.head_sha,
              runId: run.id,
              runAttempt: run.run_attempt,
              artifactId: artifact.id,
              githubArtifactDigest: artifact.digest,
              treeSha256: receipt.treeSha256,
              ciReceiptSha256: sha256(ciReceiptBytes),
              provenanceSha256: sha256(provenanceBytes),
              source: state,
            },
            null,
            2,
          )}\n`,
          { flag: 'wx', mode: 0o600 },
        );
      },
    );
    process.stdout.write(`DEVELOPMENT_TEST_IMPORTED ${target} ${state.claim}\n`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , command, ...args] = process.argv;
    if (command === 'validate-config' && args.length === 0) {
      publicConfig();
      process.stdout.write('PUBLIC_RUNTIME_CONFIG_VALID\n');
    } else if (command === 'produce' && args.length === 0) await produce();
    else if (command === 'import' && args.length === 2) await importArtifact(args[0], args[1]);
    else fail('test_artifact_arguments_refused');
  } catch (error) {
    process.stderr.write(
      `${/^test_artifact_|^local_dev_/.test(error.message) ? error.message : 'test_artifact_operation_failed'}\n`,
    );
    process.exitCode = 1;
  }
}
