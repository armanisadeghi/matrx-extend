import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createShowcaseOrganizationDiagnostic,
  observeShowcaseOrganization,
  safeShowcaseOrganizationFailure,
  stageShowcaseOrganization,
} from './showcase-organization-diagnostic.mjs';

// Hosted picker setup must retain its exact safe substage/reason through the real receipt writer.
test('organization failures persist bounded diagnostics through the native driver catch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'showcase-org-diagnostic-'));
  try {
    for (const [probe, substage, code, pickerAvailable] of [
      ['picker', 'organization_picker', 'd87_required_organization_picker_not_observed', false],
      ['storage', 'organization_storage', 'd87_required_organization_storage_not_observed', true],
      ['unknown', 'organization_picker', 'organization_unclassified_failure', true],
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
        observations: { admin_role_verified: true, picker_available: pickerAvailable },
      });
      assert.equal(raw.includes('private'), false);
      assert.equal(raw.includes('hidden'), false);
      assert.equal(raw.includes('token'), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    observations: { admin_role_verified: true, picker_available: true },
  });
  assert.equal(
    safeShowcaseOrganizationFailure({ message: 'private@example.invalid' }),
    'organization_unclassified_failure',
  );
  assert.equal(
    safeShowcaseOrganizationFailure({ driverFailure: { code: 'pointer_target_not_unique' } }),
    'pointer_target_not_unique',
  );
});
