import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { hostedProfileRoute } from './hosted-profile-route.mjs';

const artifact = {
  kind: 'ci_development_test',
  relocatedReceipt: '/private/ci/local-dev-receipt.json',
  sourceSha: 'a'.repeat(40),
  runId: 37159097093,
  artifactId: 11286822448,
};

test('Profile route passes exact CI artifact identity and extended admin mode to the native driver', () => {
  const route = hostedProfileRoute(
    'profile-admin',
    artifact,
    '/private/results',
    'hosted-profile-42-1',
  );
  assert.equal(route.driver, 'tests/browser/profile-native-acceptance.mjs');
  assert.deepEqual(route.env, {
    PROFILE_DEV_BUILD_RECEIPT: artifact.relocatedReceipt,
    PROFILE_OUTPUT_DIR: '/private/results',
    PROFILE_RUN_ID: 'hosted-profile-42-1',
    PROFILE_EXPECTED_SOURCE_SHA: artifact.sourceSha,
    PROFILE_EXPECTED_CI_RUN_ID: String(artifact.runId),
    PROFILE_EXPECTED_ARTIFACT_ID: String(artifact.artifactId),
    PROFILE_AUTH_MODE: 'admin',
    PROFILE_EXTENDED_CASES: '1',
    PROFILE_PRIVATE_OWNERSHIP_RECEIPT:
      '/private/results/profile-ownership-hosted-profile-42-1.json',
  });
  assert.equal(
    hostedProfileRoute('profile-member', artifact, '/private/results', 'hosted-profile-42-1').env
      .PROFILE_AUTH_MODE,
    'member',
  );
});

test('Profile route refuses absent or wrong case and non-CI evidence', () => {
  for (const acceptanceCase of [undefined, '', 'guest-chat', 'settings-persistence-admin']) {
    assert.throws(
      () => hostedProfileRoute(acceptanceCase, artifact, '/private/results', 'hosted-profile-42-1'),
      /hosted_profile_case_refused/,
    );
  }
  assert.throws(
    () =>
      hostedProfileRoute(
        'profile-admin',
        { ...artifact, kind: 'published_release' },
        '/private/results',
        'hosted-profile-42-1',
      ),
    /hosted_profile_ci_artifact_required/,
  );
});

test('hosted credential preflight refuses missing authenticated secret before runtime setup', () => {
  for (const acceptanceCase of ['profile-admin', 'profile-member']) {
    const result = spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
      env: {
        GITHUB_ACTIONS: 'true',
        MATRX_HOSTED_PHASE: 'preflight',
        MATRX_HOSTED_ACCEPTANCE_CASE: acceptanceCase,
      },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      acceptanceCase === 'profile-admin'
        ? /hosted_admin_secret_required/
        : /hosted_member_link_secret_required/,
    );
    assert.doesNotMatch(result.stderr, /hosted phase requires owned resource permit/);
  }
});

test('hosted credential preflight accepts selected secret without starting runtime', () => {
  const result = spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
    env: {
      GITHUB_ACTIONS: 'true',
      MATRX_HOSTED_PHASE: 'preflight',
      MATRX_HOSTED_ACCEPTANCE_CASE: 'profile-admin',
      MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: '{"email":"admin@admin.com","password":"opaque"}',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HOSTED_CREDENTIAL_PREFLIGHT_READY/);
  assert.doesNotMatch(result.stdout, /opaque/);
});
