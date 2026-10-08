import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { hostedGuestSeoRoute, hostedSeoMetadataFixture } from './hosted-seo-route.mjs';

const selected = {
  kind: 'ci_development_test',
  eligibleStore: false,
  extensionDir: '/tmp/ci-artifacts/42/77/chrome-mv3',
  relocatedReceipt: '/tmp/ci-artifacts/42/77/local-dev-receipt.json',
};

test('guest SEO passes the selected development artifact and receipt to the existing driver', () => {
  assert.deepEqual(hostedGuestSeoRoute('guest-seo', 'development', selected), {
    driver: 'tests/browser/seo-guest-acceptance.mjs',
    env: {
      SEO_GUEST_EXTENSION_DIR: selected.extensionDir,
      SEO_GUEST_DEV_BUILD_RECEIPT: selected.relocatedReceipt,
      SEO_GUEST_CASE_SCOPE: 'full',
      SEO_GUEST_METADATA_FIXTURE: undefined,
    },
  });
  assert.equal(hostedGuestSeoRoute('guest-chat', 'development', selected), null);
});

test('metadata fixture is explicit, SEO-only, and full-scope', () => {
  assert.equal(hostedSeoMetadataFixture('guest-seo', 'full', 'airbnb'), 'airbnb');
  assert.equal(hostedSeoMetadataFixture('guest-seo', 'full', 'none'), undefined);
  assert.equal(hostedSeoMetadataFixture('guest-seo', 'full', undefined), undefined);
  for (const [acceptanceCase, scope, fixture] of [
    ['guest-chat', 'full', 'airbnb'],
    ['guest-seo', 'controlled', 'airbnb'],
    ['guest-seo', 'full', 'unknown'],
  ])
    assert.throws(() => hostedSeoMetadataFixture(acceptanceCase, scope, fixture));
  assert.equal(
    hostedGuestSeoRoute('guest-seo', 'development', selected, 'full', 'airbnb').env
      .SEO_GUEST_METADATA_FIXTURE,
    'airbnb',
  );
  assert.throws(() => hostedGuestSeoRoute('guest-chat', 'development', selected, 'full', 'airbnb'));
  assert.throws(() => hostedGuestSeoRoute('guest-seo', 'development', selected, 'full', 'bad'));
  assert.throws(() =>
    hostedGuestSeoRoute('guest-seo', 'development', selected, 'controlled', 'airbnb'),
  );
});

test('hosted preflight rejects invalid metadata selection before browser setup', () => {
  const preflight = (acceptanceCase, scope, fixture) =>
    spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        MATRX_HOSTED_PHASE: 'preflight',
        MATRX_HOSTED_ACCEPTANCE_CASE: acceptanceCase,
        MATRX_HOSTED_SEO_CASE_SCOPE: scope,
        MATRX_HOSTED_SEO_METADATA_FIXTURE: fixture,
      },
    });
  assert.equal(preflight('guest-seo', 'full', undefined).status, 0);
  assert.equal(preflight('guest-seo', 'full', 'airbnb').status, 0);
  for (const [acceptanceCase, scope, fixture] of [
    ['guest-seo', 'full', 'invalid'],
    ['guest-seo', 'controlled', 'airbnb'],
    ['guest-chat', 'full', 'airbnb'],
  ])
    assert.notEqual(preflight(acceptanceCase, scope, fixture).status, 0);
});

test('guest SEO controlled scope reaches the native driver and unknown scope fails', () => {
  assert.equal(
    hostedGuestSeoRoute('guest-seo', 'development', selected, 'controlled').env
      .SEO_GUEST_CASE_SCOPE,
    'controlled',
  );
  assert.throws(
    () => hostedGuestSeoRoute('guest-seo', 'development', selected, 'unknown'),
    /unknown_seo_case_scope/,
  );
});

test('guest SEO refuses release, Store, and mismatched development selection', () => {
  for (const [mode, prepared] of [
    ['release', selected],
    ['published-crx', selected],
    ['development', { ...selected, kind: 'published_release' }],
    ['development', { ...selected, eligibleStore: true }],
    ['development', { ...selected, extensionDir: '/tmp/other/chrome-mv3' }],
    ['development', { ...selected, relocatedReceipt: '/tmp/other/local-dev-receipt.json' }],
  ])
    assert.throws(() => hostedGuestSeoRoute('guest-seo', mode, prepared));
});

test('hosted workflow admits guest SEO on lane B with one exact development artifact', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /- guest-seo\n/);
  assert.match(workflow, /guest-chat\|guest-seo\|guest-scrape/);
  assert.match(
    workflow,
    /"\$ACCEPTANCE_CASE" == guest-seo[^\n]*\n\s*\[\[ -z "\$RELEASE_RUN_ID" && -n "\$DEVELOPMENT_RUN_ID" && -n "\$DEVELOPMENT_ARTIFACT_ID" && "\$PUBLISHED_STORE_CRX" != true \]\]/,
  );
  assert.match(workflow, /test-results\/seo-guest-acceptance\.json/);
  assert.match(workflow, /MATRX_HOSTED_SEO_CASE_SCOPE: \$\{\{ inputs\.seo_case_scope \}\}/);
  assert.equal(
    (
      workflow.match(
        /MATRX_HOSTED_SEO_METADATA_FIXTURE: \$\{\{ inputs\.seo_metadata_fixture \|\| 'none' \}\}/g,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    workflow,
    /SEO_METADATA_FIXTURE: \$\{\{ inputs\.seo_metadata_fixture \|\| 'none' \}\}/,
  );
});
