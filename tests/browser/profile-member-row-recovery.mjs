#!/usr/bin/env node
/** One-shot owner-authenticated recovery of the row created by Profile run 04. */
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verifyImportedNativeEvidence } from '../../scripts/current-test-artifact.mjs';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { assertFirstSaveOwnedRow, ownedDeleteUrl } from './profile-empty-row-restoration.mjs';
import { panelIdentity, signInSettings } from './settings-native-auth-driver.mjs';
import { evaluate } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const RUN04 =
  '/Volumes/Samsung2TB/code/.stabilization-scratch/profile-member-native-next-04/evidence/profile-native-profile-member-native-next-04.json';
const RECEIPT = process.env.PROFILE_DEV_BUILD_RECEIPT;
const OUTPUT_DIR = process.env.PROFILE_OUTPUT_DIR;
const OWNERSHIP_RECEIPT = process.env.PROFILE_PRIVATE_OWNERSHIP_RECEIPT;
const SOURCE_SHA = '9dfb5911cd7fef18f8c36b1cefd273096e866bbf';
const CI_RUN_ID = 37159097093;
const ARTIFACT_ID = 11286822448;
const report = {
  schema_version: 1,
  kind: 'profile_member_row_recovery',
  status: 'unverified',
  stage: 'preflight',
  source_run: 'profile-member-native-next-04',
  first_party_member_verified: false,
  owned_row_verified: false,
  original_absence_restored: false,
};

function envValue(source, key) {
  const line = source.split(/\r?\n/).find((item) => item.startsWith(`${key}=`));
  assert.ok(line, 'profile_api_config_missing');
  return line
    .slice(key.length + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '');
}
async function ownerRequest(panel, config, url, method = 'GET') {
  const result = await evaluate(
    panel,
    `(async () => {
    const stored = await chrome.storage.local.get('matrx.auth.accessToken');
    const token = stored['matrx.auth.accessToken'];
    if (typeof token !== 'string' || !token) return { status: 0, rows: null };
    const response = await fetch(${JSON.stringify(url)}, {
      method: ${JSON.stringify(method)},
      headers: {
        apikey: ${JSON.stringify(config.key)},
        Authorization: 'Bearer ' + token,
        'X-Organization-Id': ${JSON.stringify(config.organizationId)},
        'Accept-Profile': 'users',
        'Content-Profile': 'users',
        ...( ${JSON.stringify(method)} === 'DELETE' ? { Prefer: 'return=representation' } : {} ),
      },
    });
    return { status: response.status, rows: response.ok ? await response.json() : null };
  })()`,
  );
  assert.equal(result?.status, 200, 'recovery_owner_request_failed');
  assert.ok(Array.isArray(result.rows), 'recovery_owner_rows_invalid');
  return result.rows;
}
async function readOwnerRow(panel, config, userId) {
  const url = new URL('/rest/v1/user_form_profile', config.url);
  url.searchParams.set('select', 'user_id,organization_id,preferred_name,created_at,version');
  url.searchParams.set('user_id', `eq.${userId}`);
  const rows = await ownerRequest(panel, config, url.href);
  assert.ok(rows.length <= 1, 'recovery_owner_row_not_unique');
  return rows[0] ?? null;
}

try {
  assert.ok(RECEIPT?.startsWith('/'), 'recovery_dev_receipt_required');
  assert.ok(OUTPUT_DIR?.startsWith('/'), 'recovery_output_dir_required');
  assert.ok(OWNERSHIP_RECEIPT?.startsWith('/'), 'recovery_private_receipt_required');
  const prior = JSON.parse(await readFile(RUN04, 'utf8'));
  assert.equal(prior.run_id, 'profile-member-native-next-04', 'recovery_source_run_mismatch');
  assert.equal(prior.profile_row_existed_before, false, 'recovery_prior_row_not_absent');
  assert.equal(prior.first_save?.row_created_by_ui, true, 'recovery_insert_unverified');
  assert.equal(prior.first_save?.organization_matches_device, true, 'recovery_org_unverified');
  assert.equal(prior.first_save?.owner_matches_verified_member, true, 'recovery_owner_unverified');
  assert.equal(
    prior.member_authentication?.first_party_identity_verified,
    true,
    'recovery_prior_auth_unverified',
  );
  assert.equal(
    prior.member_authentication?.canonical_nonadmin_check?.returned_rows,
    0,
    'recovery_prior_role_unverified',
  );
  assert.equal(prior.restoration?.owned_row_may_remain, true, 'recovery_prior_cleanup_unexpected');
  const started = Date.parse(prior.started_at);
  const finished = Date.parse(prior.finished_at);
  assert.ok(
    Number.isFinite(started) && Number.isFinite(finished) && started < finished,
    'recovery_run_window_invalid',
  );

  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  requireLocalDevReceipt(receipt, receipt.extensionDir);
  const imported = await verifyImportedNativeEvidence(receipt.extensionDir, RECEIPT);
  assert.equal(imported.sourceSha, SOURCE_SHA, 'recovery_source_sha_mismatch');
  assert.equal(imported.runId, CI_RUN_ID, 'recovery_ci_run_mismatch');
  assert.equal(imported.artifactId, ARTIFACT_ID, 'recovery_artifact_mismatch');
  const env = await readFile(join(REPO, '.env.production'), 'utf8');
  const config = {
    url: envValue(env, 'WXT_SUPABASE_URL'),
    key: envValue(env, 'WXT_SUPABASE_PUBLISHABLE_KEY'),
  };
  assert.equal(new URL(config.url).protocol, 'https:', 'recovery_api_url_invalid');
  report.stage = 'member_signin';
  await runNativeSidepanelQa({
    extensionDir: receipt.extensionDir,
    expectedRelease: receipt,
    localDevReceiptPath: RECEIPT,
    artifactRoot: OUTPUT_DIR,
    exercisePanel: async ({ page, panel }) => {
      const member = await signInSettings({
        mode: 'member',
        page,
        panel,
        repo: REPO,
        memberLinkFile: process.env.MATRX_REVIEWER_MAGIC_LINK_FILE,
        onStage: () => {},
      });
      const identity = await panelIdentity(panel);
      assert.equal(identity.profileId, member.profileId, 'recovery_extension_identity_changed');
      assert.equal(identity.isAdmin, false, 'recovery_member_role_changed');
      assert.ok(identity.organizationId, 'recovery_organization_missing');
      assert.equal(
        member.canonical_nonadmin_check?.returned_rows,
        0,
        'recovery_member_admin_assignment',
      );
      report.first_party_member_verified = Boolean(
        member.web_signed_in && member.extension_signed_in,
      );
      assert.equal(
        report.first_party_member_verified,
        true,
        'recovery_first_party_member_unverified',
      );
      config.organizationId = identity.organizationId;
      report.stage = 'owner_read';
      const row = await readOwnerRow(panel, config, member.profileId);
      assert.ok(row, 'recovery_owned_row_absent_already');
      assert.match(
        row.preferred_name,
        /^Profile first save [0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        'recovery_marker_invalid',
      );
      const owned = assertFirstSaveOwnedRow(
        { ...row, version: 1 },
        {
          userId: member.profileId,
          organizationId: identity.organizationId,
          marker: row.preferred_name,
        },
      );
      assert.equal(row.version, 3, 'recovery_version_not_exactly_warm_run');
      assert.ok(
        Date.parse(row.created_at) >= started && Date.parse(row.created_at) <= finished,
        'recovery_creation_outside_run04',
      );
      report.owned_row_verified = true;
      const deleteUrl = ownedDeleteUrl(config.url, owned, row, 3);
      await mkdir(resolve(OWNERSHIP_RECEIPT, '..'), { recursive: true, mode: 0o700 });
      await writeFile(
        OWNERSHIP_RECEIPT,
        `${JSON.stringify({
          source_run: prior.run_id,
          source_started_at: prior.started_at,
          source_finished_at: prior.finished_at,
          owner_id: owned.userId,
          organization_id: owned.organizationId,
          marker: owned.marker,
          created_at: owned.createdAt,
          expected_version: 3,
          observed_at: new Date().toISOString(),
          preexisting_row_absent: true,
        })}\n`,
        { mode: 0o600, flag: 'wx' },
      );
      assert.equal((await stat(OWNERSHIP_RECEIPT)).mode & 0o077, 0, 'recovery_receipt_not_private');
      report.stage = 'conditional_delete';
      const deleted = await ownerRequest(panel, config, deleteUrl, 'DELETE');
      assert.equal(deleted.length, 1, 'recovery_compare_delete_missed');
      assert.equal(deleted[0]?.user_id, owned.userId, 'recovery_deleted_wrong_owner');
      assert.equal(
        await readOwnerRow(panel, config, owned.userId),
        null,
        'recovery_absence_not_restored',
      );
      report.original_absence_restored = true;
    },
  });
  report.status = 'recovered';
  report.stage = 'complete';
} catch (error) {
  report.status = 'unverified';
  report.failure_code = String(error?.message ?? 'unknown')
    .split(':', 1)[0]
    .slice(0, 100);
}
report.finished_at = new Date().toISOString();
if (OUTPUT_DIR) {
  await mkdir(OUTPUT_DIR, { recursive: true, mode: 0o700 });
  await writeFile(
    join(OUTPUT_DIR, 'profile-member-row-recovery.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
}
process.stdout.write(
  `${report.status.toUpperCase()} profile_member_row_recovery stage=${report.stage}${report.failure_code ? ` failure=${report.failure_code}` : ''}\n`,
);
if (report.status !== 'recovered') process.exitCode = 1;
