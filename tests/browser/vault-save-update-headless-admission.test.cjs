/* The receipt-backed Save/Update mode must reject unsafe admission before it
 * creates a disposable profile, launches Chrome, or reaches authentication. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const runner = path.join(__dirname, 'vault-realbrowser-acceptance.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-save-update-admission-'));
const frozenCommit = 'a2b5aa7e1082330ab6658b07477b31ea3705ca72';
const localReleaseZipCommit = '3bad3aaea3d8906caff1f05504570145eb813c04';
const localReleaseZipManifestSha256 =
  'c395a10b2b8d6dfc42dc045f553a9098781eab3d33634e5a0a1a947f0bec8b9b';
const localReleaseZipKind = 'local-release-zip-artifact';
const localReleaseZipVersion = '0.2.38';
const localSourceCommit = 'dee5e6bb047f2ef3d3d726183faba5b7a21b7593';
const localSourceManifestSha256 =
  'b8fc7872dd88dc79a7137d68b0d76743a6944d2fc72ed449ca1816e900652130';
const reviewedLocalSourceArtifact = {
  path: path.join(
    __dirname,
    '../../.matrx/realbrowser-vault/2026-09-26T07-27-29-927Z-6a4d7bdc-c2f8-46e2-9e55-3b90d62eb3d1/artifact-manifest.json',
  ),
  sourceCommit: 'dee5e6bb047f2ef3d3d726183faba5b7a21b7593',
  manifestSha256: 'b8fc7872dd88dc79a7137d68b0d76743a6944d2fc72ed449ca1816e900652130',
  version: '0.2.54',
  kind: 'local-multi-repo-source-artifact',
};
const cleanupSourceRoot = path.join(
  __dirname,
  '../../.matrx/task1-active/cleanup-source-b20c757670f5',
);
const cleanupAdapter = path.join(__dirname, 'cleanup-vault-canary.py');
const cleanupSourceCommit = 'b20c757670f5348f5d198f3a1c64d25a1343f5c3';
const cleanupSourceGitTree = 'dbe91a70fbc62eb3c7496eb3fc8445c6f52ea54e';
const cleanupSourceTreeSha256 =
  '8a473cca03f5c9b8b464faee102091c8967ac08a2b97ed7a1418177dc9f17f58';
const routerHash = '22be9386e3a8cb9cddb51c8b2dfe78883242967d6cf94d06e23dec10fa658f6f';
const serviceHash = '0dd2347f4637b8f7787a34ba98af6767aa90eca7b3827d610147f29d6211e174';

try {
  const rejectBeforeCustody = (name, expectedCode, env) => {
    const stateRoot = path.join(root, name, 'state');
    const result = spawnSync(process.execPath, [runner], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        MATRX_REALBROWSER_VAULT_CANARY: 'RUN_UNDER_REVIEW',
        MATRX_VAULT_CANARY_STATE_ROOT: stateRoot,
        MATRX_VAULT_CANARY_ADMISSION: 'RUN_RECEIPT_BACKED_SAVE_UPDATE',
        ...env,
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.notEqual(result.status, 0, `${name} unexpectedly ran`);
    assert.match(`${result.stderr}${result.stdout}`, new RegExp(expectedCode));
    assert.equal(fs.existsSync(stateRoot), false, `${name} created durable run state`);
  };
  const strictReceiptEnv = {
    MATRX_VAULT_CANARY_DISPLAY: 'HEADLESS_NO_CLIPBOARD',
    MATRX_VAULT_CANARY_LOCAL_CANONICAL_CLEANUP: 'RUN_LOCAL_CANONICAL_CLEANUP',
    MATRX_VAULT_CANARY_LOCAL_SOURCE_ROOT: cleanupSourceRoot,
    MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256: routerHash,
    MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256: serviceHash,
    MATRX_VAULT_CANARY_EXPECTED_COMMIT: frozenCommit,
  };
  const verifySource = (command, sourceRoot, treeDigest = cleanupSourceTreeSha256) => {
    const result = spawnSync(
      '/Users/armanisadeghi/code/aidream/.venv/bin/python',
      [
        cleanupAdapter,
        command,
        sourceRoot,
        routerHash,
        serviceHash,
        treeDigest,
        cleanupSourceGitTree,
        cleanupSourceCommit,
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(result.error, undefined, `source verifier subprocess error: ${result.error?.code || 'unknown'}`);
    return { result, body: JSON.parse(result.stdout) };
  };
  const calculateSourceTreeDigest = (sourceRoot) => {
    const result = spawnSync(
      '/Users/armanisadeghi/code/aidream/.venv/bin/python',
      [cleanupAdapter, '--source-tree-digest', sourceRoot],
      { encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(result.status, 0, `source digest failed: ${result.stdout}`);
    return JSON.parse(result.stdout).sourceTreeSha256;
  };
  const proveArchivePreflightAndPackageClosure = () => {
    const source = verifySource('--verify-source-root', cleanupSourceRoot);
    assert.equal(source.result.status, 0, source.result.stdout);
    assert.deepEqual(source.body.source, {
      router: routerHash,
      service: serviceHash,
      sourceCommit: cleanupSourceCommit,
      sourceGitTree: cleanupSourceGitTree,
      sourceTreeSha256: cleanupSourceTreeSha256,
    });
    const closure = verifySource('--verify-import-closure', cleanupSourceRoot);
    assert.equal(closure.result.status, 0, closure.result.stdout);
  };
  const rejectUnrelatedArchiveMutationBeforeCustody = () => {
    const mutatedSource = path.join(root, 'unrelated-archive-mutation');
    fs.cpSync(cleanupSourceRoot, mutatedSource, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
    fs.chmodSync(mutatedSource, 0o755);
    const readme = path.join(mutatedSource, 'README.md');
    fs.chmodSync(readme, 0o644);
    fs.appendFileSync(readme, '\narchive mutation must refuse\n');
    rejectBeforeCustody('unrelated-archive-mutation', 'local_cleanup_source_tree_hash_mismatch', {
      ...strictReceiptEnv,
      MATRX_VAULT_CANARY_LOCAL_SOURCE_ROOT: mutatedSource,
    });
  };
  const rejectFallbackToCheckoutPackage = () => {
    const fallbackSource = path.join(root, 'package-origin-fallback');
    fs.cpSync(cleanupSourceRoot, fallbackSource, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
    fs.chmodSync(path.join(fallbackSource, 'packages'), 0o755);
    fs.chmodSync(path.join(fallbackSource, 'packages/matrx-connect'), 0o755);
    fs.renameSync(
      path.join(fallbackSource, 'packages/matrx-connect/matrx_connect'),
      path.join(fallbackSource, 'packages/matrx-connect/matrx_connect.withheld'),
    );
    const result = verifySource(
      '--verify-import-closure',
      fallbackSource,
      calculateSourceTreeDigest(fallbackSource),
    );
    assert.notEqual(result.result.status, 0, 'checkout package fallback unexpectedly passed');
    assert.equal(result.body.ok, false);
    assert.equal(result.body.code, 'required_import_origin_refused');
  };
  const receiptZeroWriteProof = {
    schema: 3,
    mode: 'receipt_backed_save_update',
    vaultMutationRequests: 0,
    vaultItemPosts: {
      total: 0,
      withIdempotencyHeader: 0,
      missingIdempotencyHeader: 0,
      invalidIdempotencyHeader: 0,
    },
    ownedCreateMutationKeys: [],
    ownedFixtureIds: [],
    cleanup: { browserClosed: true, profileRemoved: true, localFixtureServerClosed: 'not_started' },
  };
  const checkPriorRun = (name, prior, expectedCode) => {
    const stateRoot = path.join(root, name, 'state');
    const previous = path.join(stateRoot, 'prior');
    fs.mkdirSync(previous, { recursive: true });
    fs.writeFileSync(path.join(previous, 'proof.json'), JSON.stringify(prior));
    const result = spawnSync(process.execPath, [runner], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        MATRX_REALBROWSER_VAULT_CANARY: 'RUN_UNDER_REVIEW',
        MATRX_VAULT_CANARY_STATE_ROOT: stateRoot,
        MATRX_VAULT_CANARY_ADMISSION: 'RUN_RECEIPT_BACKED_SAVE_UPDATE',
        ...strictReceiptEnv,
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.notEqual(result.status, 0, `${name} unexpectedly ran`);
    assert.match(`${result.stderr}${result.stdout}`, new RegExp(expectedCode));
  };
  const rejectSourceDriftBeforeCustody = () => {
    const fixtureRoot = path.join(root, 'source-drift');
    const extension = path.join(fixtureRoot, 'artifact', 'extension');
    const sourceRoot = path.join(fixtureRoot, 'source');
    fs.mkdirSync(extension, { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, 'aidream/api/routers'), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, 'aidream/services/user_secrets'), { recursive: true });
    const extensionManifest = JSON.stringify({ manifest_version: 3 });
    fs.writeFileSync(path.join(extension, 'manifest.json'), extensionManifest);
    const manifest = {
      schema: 2,
      extensionDirectory: 'extension',
      kind: 'frozen',
      sourceCommit: frozenCommit,
      extensionFiles: [
        {
          path: 'manifest.json',
          sha256: crypto.createHash('sha256').update(extensionManifest).digest('hex'),
        },
      ],
    };
    const manifestPath = path.join(fixtureRoot, 'artifact', 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    fs.writeFileSync(path.join(sourceRoot, 'aidream/api/routers/vault.py'), 'drifted router');
    fs.writeFileSync(
      path.join(sourceRoot, 'aidream/services/user_secrets/vault.py'),
      'drifted service',
    );
    const stateRoot = path.join(fixtureRoot, 'state');
    const result = spawnSync(process.execPath, [runner], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        MATRX_REALBROWSER_VAULT_CANARY: 'RUN_UNDER_REVIEW',
        MATRX_VAULT_CANARY_STATE_ROOT: stateRoot,
        MATRX_VAULT_CANARY_ADMISSION: 'RUN_RECEIPT_BACKED_SAVE_UPDATE',
        MATRX_VAULT_CANARY_MANIFEST: manifestPath,
        MATRX_VAULT_CANARY_ARTIFACT_KIND: 'frozen',
        ...strictReceiptEnv,
        MATRX_VAULT_CANARY_LOCAL_SOURCE_ROOT: sourceRoot,
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.notEqual(result.status, 0, 'source drift unexpectedly ran');
    assert.equal(
      result.error,
      undefined,
      `source drift subprocess error: ${result.error?.code || 'unknown'}`,
    );
    assert.match(`${result.stderr}${result.stdout}`, /local_cleanup_router_hash_mismatch/);
    assert.equal(fs.existsSync(stateRoot), false, 'source drift created durable run state');
  };
  const rejectNearMatchLocalReleaseManifestBeforeCustody = () => {
    const fixtureRoot = path.join(root, 'local-release-manifest');
    const extension = path.join(fixtureRoot, 'artifact', 'extension');
    fs.mkdirSync(extension, { recursive: true });
    const extensionManifest = JSON.stringify({ manifest_version: 3 });
    fs.writeFileSync(path.join(extension, 'manifest.json'), extensionManifest);
    const manifestPath = path.join(fixtureRoot, 'artifact', 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        schema: 2,
        extensionDirectory: 'extension',
        kind: localReleaseZipKind,
        manifestVersion: localReleaseZipVersion,
        sourceCommit: localReleaseZipCommit,
        extensionFiles: [
          {
            path: 'manifest.json',
            sha256: crypto.createHash('sha256').update(extensionManifest).digest('hex'),
          },
        ],
      }),
    );
    const stateRoot = path.join(fixtureRoot, 'state');
    const result = spawnSync(process.execPath, [runner], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        MATRX_REALBROWSER_VAULT_CANARY: 'RUN_UNDER_REVIEW',
        MATRX_VAULT_CANARY_STATE_ROOT: stateRoot,
        MATRX_VAULT_CANARY_ADMISSION: 'RUN_RECEIPT_BACKED_SAVE_UPDATE',
        MATRX_VAULT_CANARY_DISPLAY: 'HEADLESS_NO_CLIPBOARD',
        MATRX_VAULT_CANARY_LOCAL_CANONICAL_CLEANUP: 'RUN_LOCAL_CANONICAL_CLEANUP',
        MATRX_VAULT_CANARY_LOCAL_SOURCE_ROOT: cleanupSourceRoot,
        MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256: routerHash,
        MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256: serviceHash,
        MATRX_VAULT_CANARY_EXPECTED_COMMIT: localReleaseZipCommit,
        MATRX_VAULT_CANARY_MANIFEST: manifestPath,
        MATRX_VAULT_CANARY_ARTIFACT_KIND: localReleaseZipKind,
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.notEqual(result.status, 0, 'near-match local release manifest unexpectedly ran');
    assert.match(
      `${result.stderr}${result.stdout}`,
      /receipt_backed_local_release_manifest_mismatch/,
    );
    assert.notEqual(
      crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex'),
      localReleaseZipManifestSha256,
      'near-match fixture unexpectedly matched the reviewed release manifest',
    );
    assert.equal(
      fs.existsSync(stateRoot),
      false,
      'near-match local release created durable run state',
    );
  };
  const rejectNearMatchLocalSourceManifestBeforeCustody = () => {
    const fixtureRoot = path.join(root, 'local-source-manifest');
    const extension = path.join(fixtureRoot, 'artifact', 'extension');
    fs.mkdirSync(extension, { recursive: true });
    const extensionManifest = JSON.stringify({ manifest_version: 3 });
    fs.writeFileSync(path.join(extension, 'manifest.json'), extensionManifest);
    const manifestPath = path.join(fixtureRoot, 'artifact', 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        schema: 2,
        extensionDirectory: 'extension',
        kind: 'local-multi-repo-source-artifact',
        manifestVersion: '0.2.54',
        sourceCommit: localSourceCommit,
        extensionFiles: [
          {
            path: 'manifest.json',
            sha256: crypto.createHash('sha256').update(extensionManifest).digest('hex'),
          },
        ],
      }),
    );
    const stateRoot = path.join(fixtureRoot, 'state');
    const result = spawnSync(process.execPath, [runner], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        MATRX_REALBROWSER_VAULT_CANARY: 'RUN_UNDER_REVIEW',
        MATRX_VAULT_CANARY_STATE_ROOT: stateRoot,
        MATRX_VAULT_CANARY_ADMISSION: 'RUN_RECEIPT_BACKED_SAVE_UPDATE',
        MATRX_VAULT_CANARY_DISPLAY: 'HEADLESS_NO_CLIPBOARD',
        MATRX_VAULT_CANARY_LOCAL_CANONICAL_CLEANUP: 'RUN_LOCAL_CANONICAL_CLEANUP',
        MATRX_VAULT_CANARY_LOCAL_SOURCE_ROOT: cleanupSourceRoot,
        MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256: routerHash,
        MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256: serviceHash,
        MATRX_VAULT_CANARY_EXPECTED_COMMIT: localSourceCommit,
        MATRX_VAULT_CANARY_MANIFEST: manifestPath,
        MATRX_VAULT_CANARY_ARTIFACT_KIND: 'local-multi-repo-source-artifact',
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.notEqual(result.status, 0, 'near-match local source manifest unexpectedly ran');
    assert.match(
      `${result.stderr}${result.stdout}`,
      /receipt_backed_local_source_manifest_mismatch/,
    );
    assert.notEqual(
      crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex'),
      localSourceManifestSha256,
      'near-match fixture unexpectedly matched the reviewed source manifest',
    );
    assert.equal(
      fs.existsSync(stateRoot),
      false,
      'near-match local source created durable run state',
    );
  };
  const assertReviewedLocalSourceArtifactAdmission = () => {
    const manifest = JSON.parse(fs.readFileSync(reviewedLocalSourceArtifact.path, 'utf8'));
    assert.equal(manifest.sourceCommit, reviewedLocalSourceArtifact.sourceCommit);
    assert.equal(manifest.manifestVersion, reviewedLocalSourceArtifact.version);
    assert.equal(manifest.kind, reviewedLocalSourceArtifact.kind);
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(reviewedLocalSourceArtifact.path)).digest('hex'),
      reviewedLocalSourceArtifact.manifestSha256,
    );
    assert.match(
      fs.readFileSync(runner, 'utf8'),
      new RegExp(
        `${reviewedLocalSourceArtifact.sourceCommit}[\\s\\S]*?manifestSha256: '${reviewedLocalSourceArtifact.manifestSha256}'[\\s\\S]*?version: '${reviewedLocalSourceArtifact.version}'`,
      ),
    );
  };
  const rejectWrongSourceBeforeCustody = () => {
    const fixtureRoot = path.join(root, 'wrong-source');
    const extension = path.join(fixtureRoot, 'artifact', 'extension');
    fs.mkdirSync(extension, { recursive: true });
    const extensionManifest = JSON.stringify({ manifest_version: 3 });
    fs.writeFileSync(path.join(extension, 'manifest.json'), extensionManifest);
    const manifestPath = path.join(fixtureRoot, 'artifact', 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        schema: 2,
        extensionDirectory: 'extension',
        kind: reviewedLocalSourceArtifact.kind,
        manifestVersion: reviewedLocalSourceArtifact.version,
        sourceCommit: frozenCommit,
        extensionFiles: [
          {
            path: 'manifest.json',
            sha256: crypto.createHash('sha256').update(extensionManifest).digest('hex'),
          },
        ],
      }),
    );
    const stateRoot = path.join(fixtureRoot, 'state');
    const result = spawnSync(process.execPath, [runner], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        MATRX_REALBROWSER_VAULT_CANARY: 'RUN_UNDER_REVIEW',
        MATRX_VAULT_CANARY_STATE_ROOT: stateRoot,
        MATRX_VAULT_CANARY_ADMISSION: 'RUN_RECEIPT_BACKED_SAVE_UPDATE',
        MATRX_VAULT_CANARY_DISPLAY: 'HEADLESS_NO_CLIPBOARD',
        MATRX_VAULT_CANARY_LOCAL_CANONICAL_CLEANUP: 'RUN_LOCAL_CANONICAL_CLEANUP',
        MATRX_VAULT_CANARY_LOCAL_SOURCE_ROOT: cleanupSourceRoot,
        MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256: routerHash,
        MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256: serviceHash,
        MATRX_VAULT_CANARY_EXPECTED_COMMIT: reviewedLocalSourceArtifact.sourceCommit,
        MATRX_VAULT_CANARY_MANIFEST: manifestPath,
        MATRX_VAULT_CANARY_ARTIFACT_KIND: reviewedLocalSourceArtifact.kind,
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.notEqual(result.status, 0, 'wrong source unexpectedly ran');
    assert.match(`${result.stderr}${result.stdout}`, /artifact_commit_mismatch/);
    assert.equal(fs.existsSync(stateRoot), false, 'wrong source created durable run state');
  };

  rejectBeforeCustody('headed', 'receipt_backed_requires_headless_no_clipboard', {
    MATRX_VAULT_CANARY_DISPLAY: 'HEADED',
    MATRX_VAULT_CANARY_FOREGROUND: 'ALLOW_FOREGROUND_TEST',
  });
  rejectBeforeCustody('cleanup-unarmed', 'receipt_backed_requires_local_canonical_cleanup', {
    MATRX_VAULT_CANARY_DISPLAY: 'HEADLESS_NO_CLIPBOARD',
  });
  rejectBeforeCustody('artifact-unpinned', 'receipt_backed_requires_frozen_artifact', {
    ...strictReceiptEnv,
    MATRX_VAULT_CANARY_EXPECTED_COMMIT: 'not-the-frozen-artifact',
  });
  rejectBeforeCustody('router-unpinned', 'receipt_backed_requires_frozen_router', {
    ...strictReceiptEnv,
    MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256: 'a'.repeat(64),
  });
  rejectBeforeCustody('service-unpinned', 'receipt_backed_requires_frozen_service', {
    ...strictReceiptEnv,
    MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256: 'b'.repeat(64),
  });
  for (const [key, value] of [
    ['MATRX_VAULT_CANARY_GENERATOR', ''],
    ['MATRX_VAULT_CANARY_GENERATOR_PANEL_CLOSE', 'malformed'],
    ['MATRX_VAULT_CANARY_GENERATOR_WORKER_RESTART', ''],
    ['MATRX_VAULT_CANARY_GENERATOR_WINDOW_SWITCH', 'malformed'],
  ])
    rejectBeforeCustody(`flag-${key}`, 'receipt_backed_refuses_generator_or_lifecycle_flag', {
      ...strictReceiptEnv,
      [key]: value,
    });
  // With every receipt-mode gate satisfied, admission reaches immutable artifact
  // validation before profile/browser/auth custody. The missing manifest is the
  // forcing boundary for this source-level test.
  rejectBeforeCustody('valid-gates-reach-artifact', 'missing_matrx_vault_canary_manifest', {
    ...strictReceiptEnv,
  });
  rejectSourceDriftBeforeCustody();
  proveArchivePreflightAndPackageClosure();
  rejectUnrelatedArchiveMutationBeforeCustody();
  rejectFallbackToCheckoutPackage();
  rejectNearMatchLocalReleaseManifestBeforeCustody();
  rejectNearMatchLocalSourceManifestBeforeCustody();
  assertReviewedLocalSourceArtifactAdmission();
  rejectWrongSourceBeforeCustody();
  checkPriorRun(
    'receipt-generic-ok-is-not-a-shortcut',
    {
      ...receiptZeroWriteProof,
      ok: true,
      authenticationAttempted: true,
      cleanup: {
        ...receiptZeroWriteProof.cleanup,
        receiptReconciled: true,
        createdItemsGone: true,
      },
    },
    'previous_run_unreconciled',
  );
  checkPriorRun(
    'receipt-zero-write-retries',
    receiptZeroWriteProof,
    'missing_matrx_vault_canary_manifest',
  );
  checkPriorRun(
    'receipt-baseline-id-set-required',
    {
      ...receiptZeroWriteProof,
      baselineMetadataSha256: 'baseline',
      cleanup: {
        ...receiptZeroWriteProof.cleanup,
        finalBaselineIdSetMatches: false,
        finalBaselineMetadataMatches: true,
      },
    },
    'previous_run_unreconciled',
  );
  checkPriorRun(
    'receipt-baseline-digest-required',
    {
      ...receiptZeroWriteProof,
      baselineMetadataSha256: 'baseline',
      cleanup: {
        ...receiptZeroWriteProof.cleanup,
        finalBaselineIdSetMatches: true,
        finalBaselineMetadataMatches: false,
      },
    },
    'previous_run_unreconciled',
  );
  checkPriorRun(
    'receipt-started-server-must-close',
    {
      ...receiptZeroWriteProof,
      cleanup: { ...receiptZeroWriteProof.cleanup, localFixtureServerClosed: false },
    },
    'previous_run_unreconciled',
  );
  process.stdout.write(
    'PASS: receipt-backed Save/Update admission refuses unsafe modes before custody\n',
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
