const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { test } = require('node:test');

const SOURCE_COMMIT = '4b4aafbd5e849fc30c87ee5b9207b8749858a317';
const CLEANUP_COMMIT = 'bdb78b410b7436a6e51af0d725987257bc4e72a7';
const CLEANUP_ROOT = join(
  __dirname,
  '..',
  '..',
  '..',
  '.matrx',
  'task1-active',
  `canonical-cleanup-source-${CLEANUP_COMMIT}`,
);
const ROUTER_SHA256 = '53e19fea4a7ddf57a1c8b12a0a641e9e694e8ce2527112520d5c85fd5520006c';
const SERVICE_SHA256 = 'd62944d5e9968bcb6323182487a410a600f03771942f05127df5ff1f0e1f4ff8';
const captureSaveEnv = (overrides) => ({
  PATH: process.env.PATH,
  MATRX_FIREFOX_CAPTURE_SAVE_ADMISSION: 'RUN_RECEIPT_BACKED_CAPTURE_SAVE',
  MATRX_FIREFOX_LOCAL_CANONICAL_CLEANUP: 'RUN_LOCAL_CANONICAL_CLEANUP',
  MATRX_FIREFOX_CAPTURE_SAVE_EXPECTED_COMMIT: SOURCE_COMMIT,
  MATRX_FIREFOX_LOCAL_SOURCE_ROOT: CLEANUP_ROOT,
  MATRX_FIREFOX_LOCAL_ROUTER_SHA256: ROUTER_SHA256,
  MATRX_FIREFOX_LOCAL_SERVICE_SHA256: SERVICE_SHA256,
  ...overrides,
});

test('capture-save requires explicit receipt-backed admission before custody', () => {
  const driver = join(__dirname, 'read-only-auth-driver.mjs');
  const result = spawnSync(process.execPath, [driver, '--capture-save'], {
    cwd: join(__dirname, '..', '..', '..'),
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /capture_save_admission_unarmed/);
});

test('capture-save cannot be combined with another Firefox journey', () => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'read-only-auth-driver.mjs'), '--capture-save', '--generator'],
    {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /one_firefox_journey_per_run/);
});

test('capture-save refuses a noncanonical cleanup source before credential custody', () => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'read-only-auth-driver.mjs'), '--capture-save'],
    {
      env: captureSaveEnv({ MATRX_FIREFOX_LOCAL_SOURCE_ROOT: '/tmp/not-canonical-cleanup-source' }),
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /capture_save_source_root_mismatch/);
});

test('capture-save refuses a cleanup source hash mismatch before credential custody', () => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'read-only-auth-driver.mjs'), '--capture-save'],
    {
      env: captureSaveEnv({ MATRX_FIREFOX_LOCAL_ROUTER_SHA256: '0'.repeat(64) }),
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /capture_save_router_hash_mismatch/);
});

test('capture-save cleanup kills a hung child before reporting its fixed timeout', () => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'read-only-auth-driver.mjs'), '--capture-save-cleanup-timeout-self-test'],
    {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  assert.equal(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /capture_save_cleanup_timeout_self_test_passed/);
});

test('core Update/Fill requires its own explicit admission before credential custody', () => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'read-only-auth-driver.mjs'), '--core-update-fill'],
    {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /core_update_fill_admission_unarmed/);
});

test('multi-account requires its own explicit admission before credential custody', () => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'read-only-auth-driver.mjs'), '--multi-account'],
    { env: captureSaveEnv(), encoding: 'utf8', timeout: 10_000 },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /multi_account_admission_unarmed/);
});

test('multi-account cannot be combined with another Firefox journey', () => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'read-only-auth-driver.mjs'), '--multi-account', '--generator'],
    {
      env: captureSaveEnv({
        MATRX_FIREFOX_MULTI_ACCOUNT_ADMISSION: 'RUN_RECEIPT_BACKED_MULTI_ACCOUNT',
      }),
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /one_firefox_journey_per_run/);
});
