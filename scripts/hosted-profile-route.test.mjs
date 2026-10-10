import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  hostedProfileRoute,
  profileOrganizationConfig,
  requireHostedAcceptanceCredential,
  stageProfileOrganizationConfig,
} from './hosted-profile-route.mjs';

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

test('hosted Profile preflight refuses before credentials or runtime setup', () => {
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
    assert.match(result.stderr, /hosted_profile_durable_recovery_unavailable/);
    assert.doesNotMatch(result.stderr, /hosted phase requires owned resource permit/);
  }
});

test('Profile organization fixture requires a private approved name', () => {
  assert.throws(() => profileOrganizationConfig({}), /hosted_profile_org_secret_required/);
  assert.deepEqual(
    profileOrganizationConfig({
      MATRX_HOSTED_PROFILE_ORGANIZATION_JSON: '{"approved_organization_name":"Matrx Org"}',
    }),
    { approved_organization_name: 'Matrx Org' },
  );
});

test('Showcase and Scrape admin routes require the approved fixture before browser setup', () => {
  const admin = {
    MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: '{"email":"admin@admin.com","password":"opaque"}',
  };
  for (const acceptanceCase of ['showcase-picker-admin', 'guest-scrape-development']) {
    const env = {
      ...admin,
      ...(acceptanceCase.startsWith('guest-scrape') ? { MATRX_SCRAPE_AUTH_MODE: 'admin' } : {}),
    };
    assert.throws(
      () => requireHostedAcceptanceCredential(acceptanceCase, env),
      /hosted_profile_org_secret_required/,
    );
    assert.doesNotThrow(() =>
      requireHostedAcceptanceCredential(acceptanceCase, {
        ...env,
        MATRX_HOSTED_PROFILE_ORGANIZATION_JSON: acceptanceCase.startsWith('showcase-')
          ? '{"approved_organization_name":"Matrx Org","approved_organization_id":"72336a38-f816-442f-ad48-18610128fb67"}'
          : '{"approved_organization_name":"Matrx Org"}',
      }),
    );
    if (acceptanceCase.startsWith('showcase-'))
      assert.throws(
        () =>
          requireHostedAcceptanceCredential(acceptanceCase, {
            ...env,
            MATRX_HOSTED_PROFILE_ORGANIZATION_JSON: '{"approved_organization_name":"Matrx Org"}',
          }),
        /hosted_profile_org_id_invalid/,
      );
    const preflight = spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
      env: {
        GITHUB_ACTIONS: 'true',
        MATRX_HOSTED_PHASE: 'preflight',
        MATRX_HOSTED_ACCEPTANCE_CASE: acceptanceCase,
        ...env,
      },
      encoding: 'utf8',
    });
    assert.notEqual(preflight.status, 0);
    assert.match(preflight.stderr, /hosted_profile_org_secret_required/);
    assert.doesNotMatch(preflight.stderr, /hosted phase requires owned resource permit/);
  }
});

test('hosted Profile stages an exclusive private organization fixture for the native driver', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hosted-profile-org-'));
  const path = join(dir, 'notes-private-config.json');
  const env = {
    MATRX_HOSTED_PROFILE_ORGANIZATION_JSON: '{"approved_organization_name":"Matrx Org"}',
  };
  try {
    await stageProfileOrganizationConfig(path, env);
    assert.equal((await stat(path)).mode & 0o077, 0);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
      approved_organization_name: 'Matrx Org',
    });
    await assert.rejects(() => stageProfileOrganizationConfig(path, env), { code: 'EEXIST' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('every hosted Profile phase refuses before browser setup with valid private inputs', () => {
  for (const acceptanceCase of ['profile-admin', 'profile-member']) {
    for (const phase of ['preflight', 'package', 'browser', 'acceptance']) {
      const result = spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
        env: {
          GITHUB_ACTIONS: 'true',
          MATRX_HOSTED_PHASE: phase,
          MATRX_HOSTED_ACCEPTANCE_CASE: acceptanceCase,
          MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: '{"email":"admin@admin.com","password":"opaque"}',
          MATRX_HOSTED_MEMBER_LINK_JSON: '{"url":"https://example.test/private-link"}',
          MATRX_HOSTED_PROFILE_ORGANIZATION_JSON: '{"approved_organization_name":"Matrx Org"}',
        },
        encoding: 'utf8',
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /hosted_profile_durable_recovery_unavailable/);
      assert.doesNotMatch(result.stderr, /hosted phase requires owned resource permit/);
      assert.doesNotMatch(result.stderr, /Matrx Org|opaque|private-link/);
      assert.doesNotMatch(result.stdout, /HOSTED_(PACKAGE|BROWSER)_READY/);
    }
  }
});

test('other hosted acceptance still passes credential preflight without runtime setup', () => {
  const result = spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
    env: {
      GITHUB_ACTIONS: 'true',
      MATRX_HOSTED_PHASE: 'preflight',
      MATRX_HOSTED_ACCEPTANCE_CASE: 'guest-chat',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HOSTED_CREDENTIAL_PREFLIGHT_READY/);
});

test('member Data is restricted to the shared-credential lane and validates the member link', () => {
  assert.throws(
    () => requireHostedAcceptanceCredential('member-data', {}),
    /hosted_member_link_secret_required/,
  );
  assert.throws(
    () =>
      requireHostedAcceptanceCredential('member-data', {
        MATRX_HOSTED_MEMBER_LINK_JSON: '{"email":"unapproved@example.test"}',
      }),
    /d87_member_fingerprint_mismatch/,
  );
});

test('hosted credential preflight executes from a fresh checkout without installed packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hosted-preflight-fresh-'));
  try {
    await cp('scripts', join(root, 'scripts'), { recursive: true });
    await cp('tests/browser', join(root, 'tests/browser'), { recursive: true });
    await cp('docs/stabilization', join(root, 'docs/stabilization'), { recursive: true });
    const run = (acceptanceCase, extraEnv = {}) =>
      spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
        cwd: root,
        env: {
          GITHUB_ACTIONS: 'true',
          MATRX_HOSTED_PHASE: 'preflight',
          MATRX_HOSTED_ACCEPTANCE_CASE: acceptanceCase,
          ...extraEnv,
        },
        encoding: 'utf8',
      });
    const guest = run('guest-chat');
    assert.equal(guest.status, 0, guest.stderr);
    assert.match(guest.stdout, /HOSTED_CREDENTIAL_PREFLIGHT_READY/);

    const showcaseEnv = {
      MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: '{"email":"admin@admin.com","password":"opaque"}',
      MATRX_HOSTED_PROFILE_ORGANIZATION_JSON:
        '{"approved_organization_name":"Matrx Org","approved_organization_id":"72336a38-f816-442f-ad48-18610128fb67"}',
    };
    const showcase = run('showcase-d47-public-admin', showcaseEnv);
    assert.equal(showcase.status, 0, showcase.stderr);
    assert.match(showcase.stdout, /HOSTED_CREDENTIAL_PREFLIGHT_READY/);

    const invalid = run('showcase-d47-public-admin', {
      ...showcaseEnv,
      MATRX_HOSTED_PROFILE_ORGANIZATION_JSON:
        '{"approved_organization_name":"Matrx Org","approved_organization_id":"invalid"}',
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /hosted_profile_org_id_invalid/);
    assert.doesNotMatch(invalid.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('non-Profile package and browser phases retain resource admission', () => {
  for (const phase of ['package', 'browser']) {
    const result = spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
      env: {
        MATRX_HOSTED_PHASE: phase,
        MATRX_HOSTED_ACCEPTANCE_CASE: 'guest-chat',
      },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /hosted phase requires owned resource permit/);
    assert.doesNotMatch(result.stderr, /hosted_profile_durable_recovery_unavailable/);
  }
});
