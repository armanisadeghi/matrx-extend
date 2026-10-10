import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyDataGuestArtifact } from './data-guest-artifact-contract.mjs';

const localReceipt = {
  schema_version: 1,
  kind: 'local_dev_unpacked',
  publish_state: 'not_published',
  version: '0.2.456',
  treeSha256: 'b'.repeat(64),
};
const ciReceipt = {
  schema_version: 1,
  kind: 'ci_development_test',
  eligibleStore: false,
  publish_state: 'not_published',
  sourceSha: 'a'.repeat(40),
  runId: 37986090931,
  artifactId: 11643292724,
  version: localReceipt.version,
  treeSha256: localReceipt.treeSha256,
};
const env = {
  MATRX_DATA_CI_SOURCE_SHA: ciReceipt.sourceSha,
  MATRX_DATA_CI_RUN_ID: String(ciReceipt.runId),
  MATRX_DATA_CI_ARTIFACT_ID: String(ciReceipt.artifactId),
};

test('accepts the imported local receipt when its separately verified CI receipt matches', () => {
  assert.deepEqual(
    verifyDataGuestArtifact({
      localReceipt,
      ciReceipt,
      env,
      treeSha256: localReceipt.treeSha256,
      manifestVersion: localReceipt.version,
    }),
    {
      source_sha: ciReceipt.sourceSha,
      run_id: ciReceipt.runId,
      artifact_id: ciReceipt.artifactId,
      tree_sha256: localReceipt.treeSha256,
      version: localReceipt.version,
    },
  );
});

test('refuses altered source, run, or artifact provenance before starting the browser', () => {
  for (const [key, value, code] of [
    ['MATRX_DATA_CI_SOURCE_SHA', 'c'.repeat(40), 'data_guest_ci_source_mismatch'],
    ['MATRX_DATA_CI_RUN_ID', '37986090932', 'data_guest_ci_run_mismatch'],
    ['MATRX_DATA_CI_ARTIFACT_ID', '11643292725', 'data_guest_ci_artifact_mismatch'],
  ]) {
    assert.throws(
      () =>
        verifyDataGuestArtifact({
          localReceipt,
          ciReceipt,
          env: { ...env, [key]: value },
          treeSha256: localReceipt.treeSha256,
          manifestVersion: localReceipt.version,
        }),
      new RegExp(code),
    );
  }
});

test('refuses a CI proof in place of the imported unpacked build receipt', () => {
  assert.throws(
    () =>
      verifyDataGuestArtifact({
        localReceipt: { ...localReceipt, kind: 'ci_development_test' },
        ciReceipt,
        env,
        treeSha256: localReceipt.treeSha256,
        manifestVersion: localReceipt.version,
      }),
    /data_guest_local_receipt_required/,
  );
});

test('release selection accepts only matching adapted Store provenance', () => {
  const storeReceipt = {
    kind: 'native_store_zip_candidate_key_adapted',
    publishState: 'pushed',
    sourceSha: 'd'.repeat(40),
    version: '0.2.469',
    treeSha256: 'e'.repeat(64),
    storeZip: { sha256: 'f'.repeat(64) },
    artifactSelection: {
      source: 'release_receipt_store_zip',
      selectedZipSha256: 'f'.repeat(64),
      runtimeTreeSha256: 'e'.repeat(64),
      runtimeExtensionDir: '/tmp/store-candidate/chrome-mv3-store',
      modifiedPaths: ['manifest.json'],
    },
  };
  const releaseEnv = {
    MATRX_DATA_ARTIFACT_MODE: 'release',
    MATRX_DATA_RELEASE_SOURCE_SHA: 'd'.repeat(40),
    MATRX_DATA_EXTENSION_DIR: '/tmp/store-candidate/chrome-mv3-store',
  };
  const verify = (receipt = storeReceipt, selectedEnv = releaseEnv) =>
    verifyDataGuestArtifact({
      localReceipt: receipt,
      env: selectedEnv,
      treeSha256: 'e'.repeat(64),
      manifestVersion: '0.2.469',
    });
  assert.deepEqual(verify(), {
    kind: 'native_store_zip_candidate_key_adapted',
    source_sha: 'd'.repeat(40),
    version: '0.2.469',
    tree_sha256: 'e'.repeat(64),
    store_zip_sha256: 'f'.repeat(64),
  });
  for (const changed of [
    { ...storeReceipt, sourceSha: 'a'.repeat(40) },
    { ...storeReceipt, treeSha256: 'a'.repeat(64) },
    { ...storeReceipt, version: '0.2.468' },
    { ...storeReceipt, kind: 'local_dev_unpacked' },
    {
      ...storeReceipt,
      artifactSelection: { ...storeReceipt.artifactSelection, source: 'release_receipt_local_zip' },
    },
    {
      ...storeReceipt,
      artifactSelection: { ...storeReceipt.artifactSelection, modifiedPaths: ['background.js'] },
    },
  ])
    assert.throws(() => verify(changed));
  assert.throws(() =>
    verify(storeReceipt, { ...releaseEnv, MATRX_DATA_ARTIFACT_MODE: 'published-crx' }),
  );
});
