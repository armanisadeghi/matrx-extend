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
const routerHash = '53e19fea4a7ddf57a1c8b12a0a641e9e694e8ce2527112520d5c85fd5520006c';
const serviceHash = 'd62944d5e9968bcb6323182487a410a600f03771942f05127df5ff1f0e1f4ff8';

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
      timeout: 10000,
    });
    assert.notEqual(result.status, 0, `${name} unexpectedly ran`);
    assert.match(`${result.stderr}${result.stdout}`, new RegExp(expectedCode));
    assert.equal(fs.existsSync(stateRoot), false, `${name} created durable run state`);
  };
  const strictReceiptEnv = {
    MATRX_VAULT_CANARY_DISPLAY: 'HEADLESS_NO_CLIPBOARD',
    MATRX_VAULT_CANARY_LOCAL_CANONICAL_CLEANUP: 'RUN_LOCAL_CANONICAL_CLEANUP',
    MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256: routerHash,
    MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256: serviceHash,
    MATRX_VAULT_CANARY_EXPECTED_COMMIT: frozenCommit,
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
      timeout: 10000,
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
        MATRX_VAULT_CANARY_LOCAL_SOURCE_ROOT: sourceRoot,
        ...strictReceiptEnv,
      },
      encoding: 'utf8',
      timeout: 10000,
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
        MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256: routerHash,
        MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256: serviceHash,
        MATRX_VAULT_CANARY_EXPECTED_COMMIT: localReleaseZipCommit,
        MATRX_VAULT_CANARY_MANIFEST: manifestPath,
        MATRX_VAULT_CANARY_ARTIFACT_KIND: localReleaseZipKind,
      },
      encoding: 'utf8',
      timeout: 10000,
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
    assert.equal(fs.existsSync(stateRoot), false, 'near-match local release created durable run state');
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
  rejectNearMatchLocalReleaseManifestBeforeCustody();
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
