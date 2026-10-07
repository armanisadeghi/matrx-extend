import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireSettingsCredential } from '../tests/browser/settings-native-auth-driver.mjs';

export function hostedProfileRoute(acceptanceCase, prepared, outputDir, runId) {
  assert.ok(
    acceptanceCase === 'profile-admin' || acceptanceCase === 'profile-member',
    'hosted_profile_case_refused',
  );
  assert.equal(prepared.kind, 'ci_development_test', 'hosted_profile_ci_artifact_required');
  assert.match(prepared.sourceSha ?? '', /^[a-f0-9]{40}$/, 'hosted_profile_source_required');
  assert.match(String(prepared.runId ?? ''), /^[1-9][0-9]*$/, 'hosted_profile_run_required');
  assert.match(
    String(prepared.artifactId ?? ''),
    /^[1-9][0-9]*$/,
    'hosted_profile_artifact_required',
  );
  assert.ok(prepared.relocatedReceipt?.startsWith('/'), 'hosted_profile_receipt_required');
  assert.ok(outputDir?.startsWith('/'), 'hosted_profile_output_required');
  assert.match(runId ?? '', /^[a-zA-Z0-9_-]+$/, 'hosted_profile_id_required');
  return {
    driver: 'tests/browser/profile-native-acceptance.mjs',
    env: {
      PROFILE_DEV_BUILD_RECEIPT: prepared.relocatedReceipt,
      PROFILE_OUTPUT_DIR: outputDir,
      PROFILE_RUN_ID: runId,
      PROFILE_EXPECTED_SOURCE_SHA: prepared.sourceSha,
      PROFILE_EXPECTED_CI_RUN_ID: String(prepared.runId),
      PROFILE_EXPECTED_ARTIFACT_ID: String(prepared.artifactId),
      PROFILE_AUTH_MODE: acceptanceCase.slice('profile-'.length),
      PROFILE_EXTENDED_CASES: '1',
      PROFILE_PRIVATE_OWNERSHIP_RECEIPT: join(outputDir, `profile-ownership-${runId}.json`),
    },
  };
}

export function requireHostedAcceptanceCredential(acceptanceCase, env) {
  assert.ok(acceptanceCase, 'hosted_acceptance_case_required');
  const scrapeMode = acceptanceCase.startsWith('guest-scrape')
    ? (env.MATRX_SCRAPE_AUTH_MODE ?? 'guest')
    : null;
  if (
    [
      'member-chat',
      'settings-persistence-member',
      'desktop-settings-member',
      'profile-member',
    ].includes(acceptanceCase) ||
    scrapeMode === 'member'
  ) {
    assert.ok(env.MATRX_HOSTED_MEMBER_LINK_JSON, 'hosted_member_link_secret_required');
    if (scrapeMode === 'member')
      requireSettingsCredential('member', env.MATRX_HOSTED_MEMBER_LINK_JSON);
  }
  if (
    [
      'prepare-stale-results',
      'settings-persistence-admin',
      'desktop-settings-admin',
      'audit-key-admin',
      'showcase-picker-admin',
      'showcase-stale-admin',
      'showcase-d47-admin',
      'showcase-d47-public-admin',
      'profile-admin',
    ].includes(acceptanceCase) ||
    scrapeMode === 'admin'
  ) {
    assert.ok(env.MATRX_HOSTED_ADMIN_CREDENTIALS_JSON, 'hosted_admin_secret_required');
    if (scrapeMode === 'admin' || acceptanceCase.startsWith('showcase-'))
      requireSettingsCredential('admin', env.MATRX_HOSTED_ADMIN_CREDENTIALS_JSON);
  }
  if (
    acceptanceCase === 'profile-admin' ||
    acceptanceCase.startsWith('showcase-') ||
    scrapeMode === 'admin'
  )
    profileOrganizationConfig(env);
  // The native journal is private and fsynced, but its hosted VM is disposable.
  // A write cannot start until each intent is durably recoverable elsewhere.
  if (acceptanceCase === 'profile-admin' || acceptanceCase === 'profile-member')
    throw new Error('hosted_profile_durable_recovery_unavailable');
}

export function profileOrganizationConfig(env) {
  assert.ok(env.MATRX_HOSTED_PROFILE_ORGANIZATION_JSON, 'hosted_profile_org_secret_required');
  let config;
  try {
    config = JSON.parse(env.MATRX_HOSTED_PROFILE_ORGANIZATION_JSON);
  } catch {
    throw new Error('hosted_profile_org_secret_invalid');
  }
  const name = config?.approved_organization_name;
  assert.ok(
    typeof name === 'string' && name.trim() && name === name.trim(),
    'hosted_profile_org_name_invalid',
  );
  return { approved_organization_name: name };
}

export async function stageProfileOrganizationConfig(path, env) {
  const config = profileOrganizationConfig(env);
  await writeFile(path, `${JSON.stringify(config)}\n`, { flag: 'wx', mode: 0o600 });
}
