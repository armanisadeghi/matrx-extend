import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MEMBER_TEST_ORGANIZATION_NAME } from './settings-native-auth-driver.mjs';
import { runShowcaseOrganizationCheckpoint } from './showcase-organization-checkpoint.mjs';
import {
  createShowcaseOrganizationDiagnostic,
  observeShowcaseOrganization,
  safeShowcaseOrganizationFailure,
  stageShowcaseOrganization,
} from './showcase-organization-diagnostic.mjs';
import { organizationProbePanel, probeAuth } from './showcase-organization-probe.mjs';

// Hosted picker setup must retain its exact safe substage/reason through the real receipt writer.
test('organization failures persist bounded diagnostics through the native driver catch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'showcase-org-diagnostic-'));
  try {
    for (const [probe, substage, code, observations] of [
      [
        'picker',
        'organization_picker',
        'd87_required_organization_picker_not_observed',
        { admin_role_verified: true, picker_available: false, picker_has_selection: false },
      ],
      [
        'picker_unknown',
        'organization_picker',
        'd87_required_organization_picker_not_observed',
        { admin_role_verified: true, picker_available: null, picker_has_selection: null },
      ],
      [
        'storage',
        'organization_storage',
        'd87_required_organization_storage_not_observed',
        {
          admin_role_verified: true,
          picker_available: true,
          picker_has_selection: true,
          selection_required: false,
          storage_has_uuid: false,
          storage_name_matches: false,
        },
      ],
    ]) {
      const output = join(directory, `${probe}.json`);
      const result = spawnSync(
        process.execPath,
        [new URL('./showcase-picker-native-acceptance.mjs', import.meta.url).pathname],
        {
          env: {
            ...process.env,
            MATRX_SHOWCASE_DIAGNOSTIC_PROBE: probe,
            MATRX_SHOWCASE_OUTPUT: output,
          },
          encoding: 'utf8',
        },
      );
      assert.equal(result.status, 1, `${probe} should be unverified`);
      const raw = readFileSync(output, 'utf8');
      const report = JSON.parse(raw);
      assert.equal(report.stage, 'organization');
      assert.equal(report.failure_code, code);
      assert.deepEqual(report.organization_diagnostic, {
        substage,
        observations,
      });
      assert.equal(raw.includes('private'), false);
      assert.equal(raw.includes('hidden'), false);
      assert.equal(raw.includes('token'), false);
    }
    const unknown = join(directory, 'unknown.json');
    const result = spawnSync(
      process.execPath,
      [new URL('./showcase-picker-native-acceptance.mjs', import.meta.url).pathname],
      {
        env: {
          ...process.env,
          MATRX_SHOWCASE_DIAGNOSTIC_PROBE: 'unknown',
          MATRX_SHOWCASE_OUTPUT: unknown,
        },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 1);
    const raw = readFileSync(unknown, 'utf8');
    assert.equal(JSON.parse(raw).failure_code, 'organization_unclassified_failure');
    assert.equal(raw.includes('private'), false);
    assert.equal(raw.includes('token'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the real organization helper completes through the shared checkpoint with a selected device org', async () => {
  const report = { organization_diagnostic: null };
  const organization = await runShowcaseOrganizationCheckpoint({
    panel: organizationProbePanel('selected'),
    auth: probeAuth,
    resourceAction: (action) => action(),
    report,
    requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
  });
  assert.equal(
    organization.renderedIdentity.selected_organization_matches_stored_uuid_and_name,
    true,
  );
  assert.deepEqual(report.organization_diagnostic, {
    substage: 'organization_identity_compare',
    observations: {
      admin_role_verified: true,
      picker_available: true,
      picker_has_selection: true,
      selection_required: false,
      storage_has_uuid: true,
      storage_name_matches: true,
      rendered_email_matches: true,
      rendered_role_matches: true,
      rendered_profile_matches: true,
      rendered_organization_matches: true,
    },
  });
});

test('admin selection uses the approved fixture name and verifies the stored organization', async () => {
  const panel = organizationProbePanel('admin_approved');
  const report = { organization_diagnostic: null };
  const organization = await runShowcaseOrganizationCheckpoint({
    panel,
    auth: probeAuth,
    resourceAction: (action) => action(),
    report,
    requiredOrganizationName: 'Matrx Org',
  });
  assert.equal(panel.selectionClicks, 1);
  assert.equal(organization.organizationName, 'Matrx Org');
  assert.equal(report.organization_diagnostic.observations.storage_name_matches, true);

  const wrongFixture = organizationProbePanel('admin_approved');
  await assert.rejects(
    runShowcaseOrganizationCheckpoint({
      panel: wrongFixture,
      auth: probeAuth,
      resourceAction: (action) => action(),
      report: { organization_diagnostic: null },
      requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
    }),
    /d87_member_organization_option_unavailable/,
  );
  assert.equal(wrongFixture.selectionClicks, 0);
});

test('admin selection refuses an absent approved fixture before opening Settings', async () => {
  const panel = organizationProbePanel('admin_approved');
  await assert.rejects(
    runShowcaseOrganizationCheckpoint({
      panel,
      auth: probeAuth,
      resourceAction: (action) => action(),
      report: { organization_diagnostic: null },
    }),
    /d87_approved_organization_required/,
  );
  assert.equal(panel.selectionClicks, 0);
});

test('the checkpoint cannot claim an admin role from an unverified auth result', async () => {
  const report = { organization_diagnostic: null };
  await assert.rejects(
    runShowcaseOrganizationCheckpoint({
      panel: organizationProbePanel('selected'),
      auth: { ...probeAuth, admin_role: false },
      resourceAction: (action) => action(),
      report,
      requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
    }),
    /showcase_admin_role_unverified/,
  );
  assert.deepEqual(report.organization_diagnostic.observations, {});
});

test('bounded callbacks reject unknown fields, arbitrary stages and raw error messages', () => {
  const diagnostic = createShowcaseOrganizationDiagnostic();
  stageShowcaseOrganization(diagnostic, 'https://private.invalid');
  observeShowcaseOrganization(diagnostic, {
    picker_available: true,
    email: 'private@example.invalid',
    storage_has_uuid: 'private',
  });
  assert.deepEqual(diagnostic, {
    substage: 'resource_gate',
    observations: { picker_available: true },
  });
  observeShowcaseOrganization(diagnostic, { storage_has_uuid: null });
  assert.equal(diagnostic.observations.storage_has_uuid, null);
  assert.equal(
    safeShowcaseOrganizationFailure({ message: 'private@example.invalid' }),
    'organization_unclassified_failure',
  );
  assert.equal(
    safeShowcaseOrganizationFailure({ driverFailure: { code: 'pointer_target_not_unique' } }),
    'pointer_target_not_unique',
  );
});
