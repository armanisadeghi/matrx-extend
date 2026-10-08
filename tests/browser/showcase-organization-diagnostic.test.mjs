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
  recordShowcaseOrganizationFailure,
  safeShowcaseOrganizationFailure,
  stageShowcaseOrganization,
} from './showcase-organization-diagnostic.mjs';
import {
  ORGANIZATION_ID,
  organizationProbePanel,
  probeAuth,
} from './showcase-organization-probe.mjs';

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

test('records pointer failure preserves bounded rendered counts and panel readiness', () => {
  for (const [matched, visible, active] of [
    [0, 0, false],
    [2, 2, true],
  ]) {
    const diagnostic = createShowcaseOrganizationDiagnostic();
    stageShowcaseOrganization(diagnostic, 'organization_records_click');
    recordShowcaseOrganizationFailure(diagnostic, {
      driverFailure: {
        code: 'pointer_target_not_unique',
        matchedTargetCount: matched,
        visibleMatchCount: visible,
        toolsPanelActive: active,
        privateText: 'must-never-escape',
      },
    });
    assert.equal(diagnostic.failure_code, 'pointer_target_not_unique');
    assert.equal(diagnostic.observations.records_target_match_count, matched);
    assert.equal(diagnostic.observations.records_target_visible_count, visible);
    assert.equal(diagnostic.observations.tools_panel_active, active);
    assert.equal(JSON.stringify(diagnostic).includes('must-never-escape'), false);
  }
});

test('missing Records row retains safe catalog state in the same receipt', () => {
  for (const state of ['loading', 'catalog', 'other_tab', 'unknown']) {
    const diagnostic = createShowcaseOrganizationDiagnostic();
    stageShowcaseOrganization(diagnostic, 'organization_records_click');
    recordShowcaseOrganizationFailure(diagnostic, {
      driverFailure: {
        code: 'pointer_target_not_unique',
        matchedTargetCount: 0,
        visibleMatchCount: 0,
        toolsPanelActive: true,
        toolsViewState: state,
        toolsCatalogRowCount: 47,
        toolsCatalogSearchEmpty: true,
        toolsCatalogFiltersDefault: true,
        privateText: 'must-never-escape',
      },
    });
    assert.deepEqual(diagnostic.observations, {
      records_target_match_count: 0,
      records_target_visible_count: 0,
      tools_panel_active: true,
      tools_view_state: state,
      tools_catalog_row_count: 47,
      tools_catalog_search_empty: true,
      tools_catalog_filters_default: true,
    });
    assert.equal(JSON.stringify(diagnostic).includes('must-never-escape'), false);
  }
  const diagnostic = createShowcaseOrganizationDiagnostic();
  observeShowcaseOrganization(diagnostic, {
    tools_view_state: 'private-value',
    tools_catalog_row_count: 10001,
    tools_catalog_search_empty: 'private-value',
  });
  assert.deepEqual(diagnostic.observations, {});
});

test('organization checkpoint waits for lazy Catalog mount before its trusted Records click', async () => {
  const base = organizationProbePanel('ladder');
  let catalogReads = 0;
  let pointerEvents = 0;
  let lastPointerKind = null;
  const panel = {
    on: base.on.bind(base),
    async send(method, parameters) {
      if (
        method === 'Runtime.evaluate' &&
        parameters.expression.includes("return pane.querySelector('input[placeholder=")
      ) {
        catalogReads++;
        return { result: { value: catalogReads < 3 ? 'loading' : 'catalog' } };
      }
      if (method === 'Runtime.evaluate') {
        lastPointerKind =
          /const kind = "([^"]+)"/.exec(parameters.expression)?.[1] ?? lastPointerKind;
      }
      if (method === 'Input.dispatchMouseEvent') {
        if (
          parameters.type === 'mousePressed' &&
          lastPointerKind === 'tool-row' &&
          catalogReads < 3
        ) {
          throw new Error('premature_records_pointer');
        }
        pointerEvents++;
      }
      return base.send(method, parameters);
    },
  };
  const report = {};
  await runShowcaseOrganizationCheckpoint({
    panel,
    auth: probeAuth,
    resourceAction: (action) => action(),
    report,
    requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
    requiredOrganizationId: ORGANIZATION_ID,
  });
  assert.equal(catalogReads, 3);
  assert.ok(pointerEvents > 0);
  assert.equal(report.organization_diagnostic.observations.tools_view_state, 'catalog');
  assert.equal(report.organization_diagnostic.observations.product_response_success, true);
});

test('the real organization helper completes through the shared checkpoint with a selected device org', async () => {
  const report = { organization_diagnostic: null };
  const organization = await runShowcaseOrganizationCheckpoint({
    panel: organizationProbePanel('selected'),
    auth: probeAuth,
    resourceAction: (action) => action(),
    report,
    requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
    requiredOrganizationId: ORGANIZATION_ID,
  });
  assert.equal(organization.renderedIdentity.selected_organization_matches_approved_request, true);
  assert.equal(report.organization_diagnostic.substage, 'organization_identity_compare');
  assert.equal(report.organization_diagnostic.observations.product_header_matches, true);
  assert.equal(report.organization_diagnostic.observations.product_response_success, true);
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
    requiredOrganizationId: ORGANIZATION_ID,
  });
  assert.equal(panel.selectionClicks, 1);
  assert.equal(organization.organizationName, 'Matrx Org');
  assert.equal(report.organization_diagnostic.observations.storage_name_matches, true);
  assert.equal(report.organization_diagnostic.observations.exact_visible_match_count, 1);
  assert.equal(report.organization_diagnostic.observations.target_center_hit, true);

  const wrongFixture = organizationProbePanel('admin_approved');
  const wrongReport = { organization_diagnostic: null };
  await assert.rejects(
    runShowcaseOrganizationCheckpoint({
      panel: wrongFixture,
      auth: probeAuth,
      resourceAction: (action) => action(),
      report: wrongReport,
      requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
      requiredOrganizationId: ORGANIZATION_ID,
    }),
    /d87_member_organization_option_unavailable/,
  );
  assert.equal(wrongFixture.selectionClicks, 0);
  assert.equal(wrongReport.organization_diagnostic.observations.exact_match_count, 0);
  assert.equal(wrongReport.organization_diagnostic.observations.archive_filter, 'active');
});

test('ladder-selected approved org passes only with successful authenticated product header', async () => {
  const run = async (scenario) => {
    const report = { organization_diagnostic: null };
    const result = await runShowcaseOrganizationCheckpoint({
      panel: organizationProbePanel(scenario),
      auth: probeAuth,
      resourceAction: (action) => action(),
      report,
      requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
      requiredOrganizationId: ORGANIZATION_ID,
    });
    return { result, report };
  };
  const { result, report } = await run('ladder');
  assert.equal(result.organizationId, ORGANIZATION_ID);
  assert.equal(report.organization_diagnostic.observations.storage_has_uuid, false);
  assert.equal(report.organization_diagnostic.observations.product_header_matches, true);
  assert.equal(report.organization_diagnostic.observations.product_principal_matches, true);
  for (const scenario of ['wrong_header', 'missing_header', 'wrong_bearer', 'failed_response']) {
    await assert.rejects(run(scenario), /showcase_product_/);
  }
  await assert.rejects(run('wrong_storage'), /showcase_organization_changed/);
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
    visible_option_count: -1,
    exact_match_count: 10001,
    archive_filter: 'private',
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
