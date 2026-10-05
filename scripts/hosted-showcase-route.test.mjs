import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { hostedShowcaseRoute } from './hosted-showcase-route.mjs';

const prepared = {
  kind: 'ci_development_test',
  extensionDir: '/private/ci/chrome-mv3',
  relocatedReceipt: '/private/ci/local-dev-receipt.json',
  sourceSha: 'a'.repeat(40),
  runId: 37159097093,
  artifactId: 11286822448,
};
const runner = { temp: '/private/results', runId: '42', attempt: '1' };
const credentials = {
  MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: '{"email":"admin@admin.com","password":"opaque"}',
  MATRX_HOSTED_PROFILE_ORGANIZATION_JSON: '{"approved_organization_name":"Matrx Org"}',
};

test('explicit stale case dispatches the native driver with opt-in and exact artifact identity', () => {
  const route = hostedShowcaseRoute('showcase-stale-admin', prepared, runner);
  assert.equal(route.driver, 'tests/browser/showcase-picker-native-acceptance.mjs');
  assert.deepEqual(route.env, {
    MATRX_SHOWCASE_EXTENSION_DIR: prepared.extensionDir,
    MATRX_SHOWCASE_RECEIPT: prepared.relocatedReceipt,
    MATRX_SHOWCASE_CI_SOURCE_SHA: prepared.sourceSha,
    MATRX_SHOWCASE_CI_RUN_ID: String(prepared.runId),
    MATRX_SHOWCASE_CI_ARTIFACT_ID: String(prepared.artifactId),
    MATRX_SHOWCASE_OUTPUT: '/private/results/showcase-picker-native-42-1.json',
    MATRX_SHOWCASE_STALE_BOUNDARY: '1',
  });
});

test('ordinary case clears inherited stale opt-in and unrelated cases have no showcase route', () => {
  const route = hostedShowcaseRoute('showcase-picker-admin', prepared, runner);
  const childEnv = { MATRX_SHOWCASE_STALE_BOUNDARY: '1', ...route.env };
  assert.equal(childEnv.MATRX_SHOWCASE_STALE_BOUNDARY, undefined);
  assert.equal(hostedShowcaseRoute('guest-chat', prepared, runner), null);
});

test('stale route refuses wrong artifact identity before child dispatch', () => {
  for (const change of [
    { kind: 'published_store_crx_unpacked' },
    { sourceSha: '' },
    { runId: 0 },
    { artifactId: undefined },
    { relocatedReceipt: '' },
  ]) {
    assert.throws(() =>
      hostedShowcaseRoute('showcase-stale-admin', { ...prepared, ...change }, runner),
    );
  }
});

test('stale preflight refuses missing approved fixture before resource admission', () => {
  for (const [removed, expected] of [
    ['MATRX_HOSTED_ADMIN_CREDENTIALS_JSON', /hosted_admin_secret_required/],
    ['MATRX_HOSTED_PROFILE_ORGANIZATION_JSON', /hosted_profile_org_secret_required/],
  ]) {
    const env = { ...credentials };
    delete env[removed];
    const result = spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
      env: {
        GITHUB_ACTIONS: 'true',
        MATRX_HOSTED_PHASE: 'preflight',
        MATRX_HOSTED_ACCEPTANCE_CASE: 'showcase-stale-admin',
        ...env,
      },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stderr, /hosted phase requires owned resource permit/);
  }
});

test('approved stale preflight reaches credential-ready without resource or browser setup', () => {
  const result = spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
    env: {
      GITHUB_ACTIONS: 'true',
      MATRX_HOSTED_PHASE: 'preflight',
      MATRX_HOSTED_ACCEPTANCE_CASE: 'showcase-stale-admin',
      ...credentials,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HOSTED_CREDENTIAL_PREFLIGHT_READY/);
});
