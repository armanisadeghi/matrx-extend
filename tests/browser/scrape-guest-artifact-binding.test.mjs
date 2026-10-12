import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { verifyImportedNativeEvidence } from '../../scripts/current-test-artifact.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';

// SUT: the real driver's artifact boundary, stopping before native browser launch.
const repo = resolve(import.meta.dirname, '../..');
const driver = await readFile(
  new URL('./scrape-guest-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const start = driver.indexOf('  const receipt = JSON.parse(await readFile(RECEIPT');
const end = driver.indexOf('  await runNativeSidepanelQa(', start);
assert.ok(start >= 0 && end > start, 'Scrape artifact boundary must be executable');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const validate = new AsyncFunction(
  'assert',
  'readFile',
  'join',
  'resolve',
  'hashReleaseTree',
  'verifyImportedNativeEvidence',
  'REPO',
  'EXTENSION_DIR',
  'RECEIPT',
  'ARTIFACT_CHANNEL',
  'process',
  'report',
  driver.slice(start, end),
);
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const version = JSON.parse(
  execFileSync('git', ['show', `${sha}:package.json`], { cwd: repo, encoding: 'utf8' }),
).version;
const config = await readFile(join(repo, 'wxt.config.ts'), 'utf8');
const key = /const devExtensionKey =\s*'([^']+)'/.exec(config)?.[1];
assert.ok(key);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(work, mutate = () => {}) {
  const runId = String(Number.parseInt(randomBytes(5).toString('hex'), 16));
  const root = join(repo, 'test-results', 'ci-artifacts', sha, `${runId}-2`);
  const build = join(root, 'chrome-mv3');
  await mkdir(build, { recursive: true });
  try {
    await writeFile(
      join(build, 'manifest.json'),
      JSON.stringify({ manifest_version: 3, version, key }),
    );
    await writeFile(join(build, 'sidepanel.js'), 'Harbor Dental page capture');
    const receipt = {
      schema_version: 1,
      kind: 'local_dev_unpacked',
      publish_state: 'not_published',
      observedAt: new Date().toISOString(),
      extensionDir: build,
      version,
      treeSha256: hashReleaseTree(build),
    };
    const ciReceipt = {
      ...receipt,
      extensionDir: '/home/runner/work/matrx-extend/matrx-extend/.output/chrome-mv3',
    };
    const provenance = {
      schema_version: 1,
      kind: 'ci_development_test',
      eligibleStore: false,
      publish_state: 'not_published',
      repository: 'armanisadeghi/matrx-extend',
      workflow: '.github/workflows/ci.yml',
      event: 'push',
      ref: 'refs/heads/main',
      sourceSha: sha,
      runId: Number(runId),
      runAttempt: 2,
      version,
      expectedExtensionId: 'cihdmkcdjjckfhjpgoedmgfpoljebaml',
      treeSha256: receipt.treeSha256,
    };
    const ciBytes = JSON.stringify(ciReceipt);
    const provenanceBytes = JSON.stringify(provenance);
    const status = {
      schema_version: 1,
      eligibleStore: false,
      sourceSha: sha,
      runId: Number(runId),
      runAttempt: 2,
      artifactId: 9001000000,
      githubArtifactDigest: `sha256:${'a'.repeat(64)}`,
      treeSha256: receipt.treeSha256,
      ciReceiptSha256: digest(ciBytes),
      provenanceSha256: digest(provenanceBytes),
    };
    const env = {
      MATRX_SCRAPE_CI_SOURCE_SHA: sha,
      MATRX_SCRAPE_CI_RUN_ID: runId,
      MATRX_SCRAPE_CI_RUN_ATTEMPT: '2',
      MATRX_SCRAPE_CI_ARTIFACT_ID: '9001000000',
    };
    const inputs = {
      build,
      receiptPath: join(root, 'local-dev-receipt.json'),
      receipt,
      status,
      env,
    };
    await mutate(inputs);
    await writeFile(inputs.receiptPath, JSON.stringify(receipt));
    await writeFile(join(root, 'ci-receipt.json'), ciBytes);
    await writeFile(join(root, 'provenance.json'), provenanceBytes);
    await writeFile(join(root, 'import-status.json'), JSON.stringify(status));
    const report = {};
    await work(
      () =>
        validate(
          assert,
          readFile,
          join,
          resolve,
          hashReleaseTree,
          verifyImportedNativeEvidence,
          repo,
          inputs.build,
          inputs.receiptPath,
          'development',
          { env },
          report,
        ),
      report,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('binds browser attribution to the exact imported CI evidence', async () => {
  await fixture(async (validate, report) => {
    await validate();
    assert.equal(report.artifact.source_sha, sha);
    assert.equal(report.artifact.run_attempt, 2);
    assert.equal(report.artifact.artifact_id, 9001000000);
    assert.equal(report.imported_artifact.kind, 'ci_development_test');
  });
});
for (const [field, value, error] of [
  ['MATRX_SCRAPE_CI_SOURCE_SHA', 'a'.repeat(40), 'scrape_ci_source_mismatch'],
  ['MATRX_SCRAPE_CI_RUN_ID', '38010000001', 'scrape_ci_run_mismatch'],
  ['MATRX_SCRAPE_CI_RUN_ATTEMPT', '3', 'scrape_ci_attempt_mismatch'],
  ['MATRX_SCRAPE_CI_ARTIFACT_ID', '9001000001', 'scrape_ci_artifact_mismatch'],
  ['MATRX_SCRAPE_CI_RUN_ATTEMPT', undefined, 'scrape_ci_run_attempt_required'],
])
  test(`refuses unrelated nominated ${field}`, async () => {
    await fixture(
      async (validate) => assert.rejects(validate(), new RegExp(error)),
      ({ env }) => {
        env[field] = value;
      },
    );
  });
test('refuses imported metadata with a different source identity', async () => {
  await fixture(
    async (validate) => assert.rejects(validate(), /test_artifact_native_evidence_refused/),
    ({ status }) => {
      status.sourceSha = 'b'.repeat(40);
    },
  );
});
test('refuses a receipt outside the exact import directory', async () => {
  await fixture(
    async (validate) => assert.rejects(validate(), /test_artifact_native_receipt_path_refused/),
    (inputs) => {
      inputs.receiptPath = join(dirname(inputs.build), 'copied-receipt.json');
    },
  );
});
test('refuses mutable .output even with a matching local receipt and valid CI labels', async () => {
  const mutable = join(repo, '.output', `scrape-binding-${randomBytes(6).toString('hex')}`);
  try {
    await mkdir(mutable, { recursive: true });
    await fixture(
      async (validate) => assert.rejects(validate(), /test_artifact_native_path_refused/),
      async (inputs) => {
        await writeFile(join(mutable, 'manifest.json'), JSON.stringify({ version }));
        inputs.build = mutable;
        inputs.receipt.extensionDir = mutable;
        inputs.receipt.treeSha256 = hashReleaseTree(mutable);
      },
    );
  } finally {
    await rm(mutable, { recursive: true, force: true });
  }
});
test('refuses changed imported bytes before browser launch', async () => {
  await fixture(
    async (validate) =>
      assert.rejects(validate(), /local_dev_tree_hash_mismatch|test_artifact_tree_refused/),
    async ({ build }) => {
      await writeFile(join(build, 'sidepanel.js'), 'changed capture');
    },
  );
});

const finalStart = driver.indexOf(
  'if (report.artifact) {',
  driver.indexOf('} catch (error) {', start),
);
const finalEnd = driver.indexOf('await writeFile(OUTPUT,', finalStart);
assert.ok(finalStart > end && finalEnd > finalStart);
const verifyAfter = new AsyncFunction(
  'assert',
  'hashReleaseTree',
  'EXTENSION_DIR',
  'report',
  'process',
  driver.slice(finalStart, finalEnd),
);
for (const changed of [false, true])
  test(`final artifact check ${changed ? 'refuses mutation after browser failure' : 'retains unchanged failure evidence'}`, async () => {
    await fixture(async (validate, report) => {
      await validate();
      const build = join(
        repo,
        'test-results',
        'ci-artifacts',
        report.artifact.source_sha,
        `${report.artifact.run_id}-${report.artifact.run_attempt}`,
        'chrome-mv3',
      );
      report.status = 'partial';
      if (changed) await writeFile(join(build, 'sidepanel.js'), 'changed during browser run');
      const processState = {};
      await verifyAfter(assert, hashReleaseTree, build, report, processState);
      assert.equal(report.status, changed ? 'unverified' : 'partial');
      assert.equal(processState.exitCode, changed ? 1 : undefined);
      if (changed) assert.match(report.failure.code, /scrape_artifact_changed_during_native_run/);
      else assert.equal(report.artifact.unchanged_after_run, true);
    });
  });
