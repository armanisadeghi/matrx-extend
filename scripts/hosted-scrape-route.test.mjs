import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { scrapeNativeSelection } from '../tests/browser/scrape-native-selection.mjs';
import { requireHostedAcceptanceCredential } from './hosted-profile-route.mjs';
import { requireHostedScrapeRoute } from './hosted-scrape-route.mjs';

const development = { kind: 'ci_development_test', eligibleStore: false };
const store = { kind: 'published_store_zip_adapted' };

test('development Scrape requires verified CI development provenance', () => {
  assert.deepEqual(
    requireHostedScrapeRoute('guest-scrape-development', 'development', development),
    {
      driver: 'tests/browser/scrape-guest-native-acceptance.mjs',
      channel: 'development',
    },
  );
  for (const [mode, prepared] of [
    ['release', development],
    ['published-crx', development],
    ['development', store],
    ['development', { ...development, eligibleStore: true }],
    ['development', { kind: 'local_dev_unpacked', eligibleStore: false }],
  ])
    assert.throws(() => requireHostedScrapeRoute('guest-scrape-development', mode, prepared));
});

test('Store Scrape keeps its release ZIP restriction', () => {
  assert.equal(requireHostedScrapeRoute('guest-scrape', 'release', store).channel, 'store');
  for (const [mode, prepared] of [
    ['development', development],
    ['release', development],
    ['published-crx', store],
  ])
    assert.throws(() => requireHostedScrapeRoute('guest-scrape', mode, prepared));
});

test('D187 Save Source requires the exact unpublished CI development artifact', () => {
  assert.deepEqual(requireHostedScrapeRoute('scrape-save-member', 'development', development), {
    driver: 'tests/browser/scrape-save-native-acceptance.mjs',
    channel: 'development',
  });
  for (const [mode, prepared] of [
    ['release', development],
    ['published-crx', development],
    ['development', store],
    ['development', { ...development, eligibleStore: true }],
    ['development', { kind: 'local_dev_unpacked', eligibleStore: false }],
  ])
    assert.throws(() => requireHostedScrapeRoute('scrape-save-member', mode, prepared));
  assert.deepEqual(
    scrapeNativeSelection({ MATRX_SCRAPE_AUTH_MODE: 'member', MATRX_SCRAPE_WIDTH_MODE: 'narrow' }),
    { mode: 'member', widthMode: 'narrow', minimumPanelWidth: null },
  );
  assert.throws(
    () => requireHostedAcceptanceCredential('scrape-save-member', {}),
    /hosted_member_link_secret_required/,
  );
  assert.throws(
    () =>
      requireHostedAcceptanceCredential('scrape-save-member', {
        MATRX_HOSTED_MEMBER_LINK_JSON: JSON.stringify({
          email: 'admin@admin.com',
          action_link: 'https://www.aimatrx.com/auth/confirm?type=magiclink&token_hash=invalid',
        }),
      }),
    /d87_member_fingerprint_mismatch/,
  );
});

test('Scrape auth mode requires matching staged credential before browser setup', () => {
  for (const acceptanceCase of ['guest-scrape', 'guest-scrape-development']) {
    requireHostedAcceptanceCredential(acceptanceCase, { MATRX_SCRAPE_AUTH_MODE: 'guest' });
    assert.throws(
      () => requireHostedAcceptanceCredential(acceptanceCase, { MATRX_SCRAPE_AUTH_MODE: 'member' }),
      /hosted_member_link_secret_required/,
    );
    assert.throws(
      () => requireHostedAcceptanceCredential(acceptanceCase, { MATRX_SCRAPE_AUTH_MODE: 'admin' }),
      /hosted_admin_secret_required/,
    );
    assert.throws(
      () =>
        requireHostedAcceptanceCredential(acceptanceCase, {
          MATRX_SCRAPE_AUTH_MODE: 'member',
          MATRX_HOSTED_MEMBER_LINK_JSON: JSON.stringify({
            email: 'admin@admin.com',
            action_link:
              'https://www.aimatrx.com/auth/confirm?type=magiclink&token_hash=wrong-role',
          }),
        }),
      /d87_member_fingerprint_mismatch/,
    );
    const adminEnv = {
      MATRX_SCRAPE_AUTH_MODE: 'admin',
      MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: JSON.stringify({
        email: 'admin@admin.com',
        password: 'private',
      }),
    };
    assert.throws(
      () => requireHostedAcceptanceCredential(acceptanceCase, adminEnv),
      /hosted_profile_org_secret_required/,
    );
    requireHostedAcceptanceCredential(acceptanceCase, {
      ...adminEnv,
      MATRX_HOSTED_PROFILE_ORGANIZATION_JSON: JSON.stringify({
        approved_organization_name: 'Matrx Org',
      }),
    });
    assert.throws(
      () =>
        requireHostedAcceptanceCredential(acceptanceCase, {
          MATRX_SCRAPE_AUTH_MODE: 'admin',
          MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: JSON.stringify({
            email: 'wrong@invalid.test',
            password: 'private',
          }),
        }),
      /d87_admin_identity_required/,
    );
  }
});

test('workflow admits development Scrape only with one complete development selection', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /- guest-scrape-development/);
  assert.match(workflow, /- scrape-save-member/);
  assert.match(workflow, /D187 Save Source requires member auth/);
  assert.match(
    workflow,
    /\[\[ "\$ACCEPTANCE_CASE" != guest-scrape && "\$ACCEPTANCE_CASE" != guest-scrape-development && "\$ACCEPTANCE_CASE" != scrape-save-member \]\]/,
  );
  assert.match(
    workflow,
    /"\$ACCEPTANCE_CASE" == guest-scrape-development[^\n]*\n\s*\[\[ -z "\$RELEASE_RUN_ID" && -n "\$DEVELOPMENT_RUN_ID" && -n "\$DEVELOPMENT_ARTIFACT_ID" && "\$PUBLISHED_STORE_CRX" != true \]\]/,
  );
});
