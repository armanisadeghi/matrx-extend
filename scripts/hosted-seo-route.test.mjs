import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { hostedGuestSeoRoute } from './hosted-seo-route.mjs';

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
    },
  });
  assert.equal(hostedGuestSeoRoute('guest-chat', 'development', selected), null);
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
});
