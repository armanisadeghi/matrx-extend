import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hostedAcceptanceRoute } from './hosted-acceptance-route.mjs';
import { requireHostedAcceptanceCredential } from './hosted-profile-route.mjs';
import { hostedScreenshotRoute } from './hosted-screenshot-route.mjs';

const sourceSha = 'a'.repeat(40);
const prepared = {
  kind: 'ci_development_test',
  sourceSha,
  runId: 38320662877,
  artifactId: 11778284430,
  ciEvidence: { sourceSha },
};
const secrets = {
  MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: JSON.stringify({
    email: 'admin@admin.com',
    password: 'private-password',
  }),
  MATRX_HOSTED_PROFILE_ORGANIZATION_JSON: JSON.stringify({
    approved_organization_name: "Matrx's Org",
  }),
};

test('D221 workflow admission allows only lane A with development run and artifact', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const admission = workflow
    .split('# BEGIN hosted lane admission')[1]
    ?.split('# END hosted lane admission')[0];
  assert.ok(admission, 'hosted admission block required');
  const base = {
    ACCEPTANCE_CASE: 'screenshots-capture-admin',
    ACCEPTANCE_LANE: 'A',
    DEVELOPMENT_RUN_ID: '38320662877',
    DEVELOPMENT_ARTIFACT_ID: '11778284430',
    RELEASE_RUN_ID: '',
    PUBLISHED_STORE_CRX: 'false',
    SCRAPE_AUTH_MODE: 'guest',
    SCRAPE_SAVE_DESTINATION: 'project',
    SCRAPE_SAVE_SCOPE: 'single',
    SCRAPE_WIDTH_MODE: 'narrow',
    SCRAPE_NORMAL_WIDTH_PX: '',
    DESKTOP_SETTINGS_CASE: 'full',
    SEO_CASE_SCOPE: 'full',
    SEO_METADATA_FIXTURE: 'none',
    SEO_RESOURCE_DIAGNOSTIC: '0',
  };
  const admitted = (changes) =>
    spawnSync('bash', ['-euo', 'pipefail', '-c', admission], {
      env: { ...base, ...changes },
      encoding: 'utf8',
    }).status;
  assert.equal(admitted({}), 0);
  assert.notEqual(admitted({ ACCEPTANCE_LANE: 'B' }), 0);
  assert.notEqual(admitted({ DEVELOPMENT_ARTIFACT_ID: '' }), 0);
  assert.notEqual(admitted({ DEVELOPMENT_RUN_ID: '', RELEASE_RUN_ID: '123' }), 0);
  assert.notEqual(admitted({ PUBLISHED_STORE_CRX: 'true' }), 0);
});

test('D221 selects original admin Screenshots driver only on lane A with verified CI evidence', () => {
  const admitted = hostedAcceptanceRoute(
    'screenshots-capture-admin',
    'development',
    prepared,
    'guest',
    { lane: 'A' },
  );
  assert.equal(admitted.acceptanceCase, 'screenshots-capture-admin');
  assert.equal(
    hostedScreenshotRoute(admitted.acceptanceCase, prepared, 'A').driver,
    'tests/browser/screenshot-capture-acceptance.mjs',
  );
  assert.equal(hostedScreenshotRoute('guest-chat', prepared, 'B'), null);
  for (const [artifact, lane] of [
    [prepared, 'B'],
    [{ ...prepared, kind: 'published_store_zip_adapted' }, 'A'],
    [{ ...prepared, ciEvidence: { sourceSha: 'b'.repeat(40) } }, 'A'],
    [{ ...prepared, sourceSha: '' }, 'A'],
  ]) {
    assert.throws(() => hostedScreenshotRoute('screenshots-capture-admin', artifact, lane));
  }
});

test('D221 admission requires existing admin and organization secrets without line-unsafe password', () => {
  assert.doesNotThrow(() =>
    requireHostedAcceptanceCredential('screenshots-capture-admin', secrets),
  );
  assert.throws(
    () =>
      requireHostedAcceptanceCredential('screenshots-capture-admin', {
        ...secrets,
        MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: undefined,
      }),
    /hosted_admin_secret_required/,
  );
  assert.throws(
    () =>
      requireHostedAcceptanceCredential('screenshots-capture-admin', {
        ...secrets,
        MATRX_HOSTED_PROFILE_ORGANIZATION_JSON: undefined,
      }),
    /hosted_profile_org_secret_required/,
  );
  assert.throws(
    () =>
      requireHostedAcceptanceCredential('screenshots-capture-admin', {
        ...secrets,
        MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: JSON.stringify({
          email: 'admin@admin.com',
          password: 'two\nlines',
        }),
      }),
    /hosted_screenshot_password_line_refused/,
  );
});
