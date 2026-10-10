import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';

// Exercise the real driver's input boundary, stopping before browser/auth side effects.
const driver = await readFile(
  new URL('./scrape-save-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const start = driver.indexOf('  const receipt = JSON.parse(');
const end = driver.indexOf('  await runNativeSidepanelQa(', start);
assert.ok(start >= 0 && end > start, 'Save Source artifact input boundary must be executable');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const validate = new AsyncFunction(
  'assert',
  'readFile',
  'join',
  'hashReleaseTree',
  'extensionDir',
  'receiptPath',
  'process',
  'report',
  driver.slice(start, end),
);

async function fixture(run, mutate = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'scrape-save-provenance-'));
  try {
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: '0.2.457' }));
    const receipt = {
      kind: 'local_dev_unpacked',
      publish_state: 'not_published',
      treeSha256: hashReleaseTree(root),
      version: '0.2.457',
    };
    const ciReceipt = {
      schema_version: 1,
      kind: 'ci_development_test',
      eligibleStore: false,
      publish_state: 'not_published',
      sourceSha: '987a3e08d811c03aa9fc2b82a92d4e51cd45d29a',
      runId: 38010000000,
      artifactId: 9001000000,
      treeSha256: receipt.treeSha256,
      version: receipt.version,
    };
    const receiptPath = join(root, '..', `${root.split('/').at(-1)}-local.json`);
    const ciReceiptPath = `${receiptPath}.ci`;
    const env = {
      GITHUB_SHA: '0d6e69aa7d5fdf9c8f819ac41a5d8f219f29299b',
      MATRX_SCRAPE_CI_RECEIPT: ciReceiptPath,
      MATRX_SCRAPE_CI_SOURCE_SHA: ciReceipt.sourceSha,
      MATRX_SCRAPE_CI_RUN_ID: String(ciReceipt.runId),
      MATRX_SCRAPE_CI_ARTIFACT_ID: String(ciReceipt.artifactId),
    };
    mutate({ receipt, ciReceipt, env });
    await writeFile(receiptPath, JSON.stringify(receipt));
    await writeFile(ciReceiptPath, JSON.stringify(ciReceipt));
    try {
      const report = {};
      await run(
        () => validate(assert, readFile, join, hashReleaseTree, root, receiptPath, { env }, report),
        report,
      );
    } finally {
      await rm(receiptPath, { force: true });
      await rm(ciReceiptPath, { force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('frozen authenticated artifact reaches acceptance when harness checkout has advanced', async () => {
  await fixture(async (validate, report) => {
    await validate();
    assert.equal(report.artifact.source_sha, '987a3e08d811c03aa9fc2b82a92d4e51cd45d29a');
    assert.equal(report.harness_checkout_sha, '0d6e69aa7d5fdf9c8f819ac41a5d8f219f29299b');
  });
});

for (const [field, value, error] of [
  ['sourceSha', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'scrape_save_ci_source_mismatch'],
  ['runId', 38010000001, 'scrape_save_ci_run_mismatch'],
  ['artifactId', 9001000001, 'scrape_save_ci_artifact_mismatch'],
  ['treeSha256', 'b'.repeat(64), 'scrape_save_ci_tree_mismatch'],
  ['version', '0.2.456', 'scrape_save_ci_version_mismatch'],
]) {
  test(`refuses mismatched CI receipt ${field} despite a valid frozen source selection`, async () => {
    await fixture(
      async (validate) => {
        await assert.rejects(validate(), { message: new RegExp(`^${error}(?:\\n|$)`) });
      },
      ({ ciReceipt }) => {
        ciReceipt[field] = value;
      },
    );
  });
}
