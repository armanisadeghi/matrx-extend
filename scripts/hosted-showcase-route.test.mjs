import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

test('hosted artifact upload preserves every routed showcase native receipt', () => {
  const workflow = readFileSync('.github/workflows/hosted-guest-acceptance.yml', 'utf8');
  const uploadPaths = workflow.match(/ {10}path: \|\n((?: {12}[^\n]+\n)+)/g) ?? [];
  const patterns = uploadPaths.flatMap((block) =>
    block
      .split('\n')
      .slice(1)
      .filter(Boolean)
      .map((line) => line.trim().replace('${{ runner.temp }}', runner.temp)),
  );
  for (const acceptanceCase of [
    'showcase-picker-admin',
    'showcase-stale-admin',
    'showcase-d47-admin',
    'showcase-d47-public-admin',
  ]) {
    const output = hostedShowcaseRoute(acceptanceCase, prepared, runner).env.MATRX_SHOWCASE_OUTPUT;
    assert.ok(
      patterns.some((pattern) =>
        new RegExp(
          `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^/]*')}$`,
        ).test(output),
      ),
      `${acceptanceCase} receipt ${output} is absent from hosted upload paths`,
    );
  }
});

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
    MATRX_D47_RESPONSE_ORDER: undefined,
  });
});

test('ordinary case clears inherited stale opt-in and unrelated cases have no showcase route', () => {
  const route = hostedShowcaseRoute('showcase-picker-admin', prepared, runner);
  const childEnv = { MATRX_SHOWCASE_STALE_BOUNDARY: '1', ...route.env };
  assert.equal(childEnv.MATRX_SHOWCASE_STALE_BOUNDARY, undefined);
  assert.equal(hostedShowcaseRoute('guest-chat', prepared, runner), null);
});

test('D47 route binds the exact CI development artifact to its own native result', () => {
  const route = hostedShowcaseRoute('showcase-d47-admin', prepared, runner);
  assert.equal(route.driver, 'tests/browser/showcase-d47-document-lifecycle.mjs');
  assert.equal(route.env.MATRX_SHOWCASE_OUTPUT, '/private/results/showcase-d47-native-42-1.json');
  assert.equal(route.env.MATRX_SHOWCASE_CI_SOURCE_SHA, prepared.sourceSha);
  assert.equal(route.env.MATRX_SHOWCASE_STALE_BOUNDARY, undefined);
  assert.equal(route.env.MATRX_D47_RESPONSE_ORDER, 'current-first');
  assert.equal(route.env.MATRX_SHOWCASE_EXTENSION_DIR, prepared.extensionDir);
});

test('D47 route propagates only an explicit supported inverse order', () => {
  const inverse = hostedShowcaseRoute('showcase-d47-admin', prepared, runner, 'old-first');
  assert.equal(inverse.env.MATRX_D47_RESPONSE_ORDER, 'old-first');
  assert.throws(
    () => hostedShowcaseRoute('showcase-d47-admin', prepared, runner, 'old-first-extra'),
    /d47_response_order_invalid/,
  );
  assert.equal(
    hostedShowcaseRoute('showcase-picker-admin', prepared, runner, 'old-first').env
      .MATRX_D47_RESPONSE_ORDER,
    undefined,
  );
});

test('D47 stale-only route keeps the exact artifact and isolated native output', () => {
  const route = hostedShowcaseRoute('showcase-d47-admin', prepared, runner, 'stale-only');
  assert.equal(route.driver, 'tests/browser/showcase-d47-document-lifecycle.mjs');
  assert.equal(route.env.MATRX_D47_RESPONSE_ORDER, 'stale-only');
  assert.equal(route.env.MATRX_SHOWCASE_OUTPUT, '/private/results/showcase-d47-native-42-1.json');
  assert.equal(route.env.MATRX_SHOWCASE_CI_ARTIFACT_ID, String(prepared.artifactId));
  assert.equal(route.env.MATRX_SHOWCASE_CI_SOURCE_SHA, prepared.sourceSha);
  assert.throws(
    () => hostedShowcaseRoute('showcase-d47-admin', prepared, runner, 'stale-only-extra'),
    /d47_response_order_invalid/,
  );
});

test('D47 manual-prior route selects the existing saved replay driver', () => {
  const route = hostedShowcaseRoute('showcase-d47-admin', prepared, runner, 'manual-prior');
  assert.equal(route.driver, 'tests/browser/showcase-d47-document-lifecycle.mjs');
  assert.equal(route.env.MATRX_D47_RESPONSE_ORDER, 'manual-prior');
});

test('public D47 route uses its own exact-artifact native receipt and never inherits fixture ordering', () => {
  const route = hostedShowcaseRoute('showcase-d47-public-admin', prepared, runner, 'old-first');
  assert.equal(route.driver, 'tests/browser/showcase-d47-public-initial-load.mjs');
  assert.equal(
    route.env.MATRX_SHOWCASE_OUTPUT,
    '/private/results/showcase-d47-public-native-42-1.json',
  );
  assert.equal(route.env.MATRX_SHOWCASE_CI_SOURCE_SHA, prepared.sourceSha);
  assert.equal(route.env.MATRX_SHOWCASE_RECEIPT, prepared.relocatedReceipt);
  assert.equal(route.env.MATRX_D47_RESPONSE_ORDER, undefined);
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

test('D47 preflight requires real admin credentials and device organization', () => {
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
        MATRX_HOSTED_ACCEPTANCE_CASE: 'showcase-d47-admin',
        ...env,
      },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stderr, /hosted phase requires owned resource permit/);
  }
});
