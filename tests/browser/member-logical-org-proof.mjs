import assert from 'node:assert/strict';
import { observeShowcaseProductRequest, panelBearerHash } from './organization-product-request.mjs';
import { openOrganizationRecords } from './organization-records-navigation.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PRODUCTION_BACKEND_ORIGIN = 'https://server.app.matrxserver.com';

/** Hosted member fixtures use the production backend; refuse another runtime route. */
export async function requireProductionBackendOrigin(panel) {
  const configured = await evaluate(
    panel,
    `(() => chrome.storage.local.get(['matrx.backend.env', 'matrx.backend.urlOverride'])
      .then((stored) => ({
        production: stored['matrx.backend.env'] == null || stored['matrx.backend.env'] === 'prod',
        override_absent: !stored['matrx.backend.urlOverride'],
      })))()`,
  );
  assert.equal(configured?.production, true, 'member_logical_org_backend_not_production');
  assert.equal(configured?.override_absent, true, 'member_logical_org_backend_override_present');
  return PRODUCTION_BACKEND_ORIGIN;
}

/** Use the existing read-only Records product door; PackageChat has no legacy Compute picker. */
export async function refreshMemberLogicalOrganizationGet(
  panel,
  observer,
  clickControl = click,
  onDiagnostic = () => {},
) {
  let target = 'organization_tools_gate';
  try {
    await openOrganizationRecords(panel, {
      clickControl,
      beforeRecords: () => observer.arm(),
      onStage: (stage) => {
        target = stage;
        onDiagnostic({ phase: 'logical_organization_request', target });
      },
    });
  } catch (error) {
    const count = (value) =>
      Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : null;
    onDiagnostic({
      phase: 'logical_organization_request',
      target,
      matched_target_count: count(error?.driverFailure?.matchedTargetCount),
      visible_target_count: count(error?.driverFailure?.visibleMatchCount),
    });
    throw error;
  }
}

/** Observe the extension's own authenticated, read-only active-org request. */
export function observeMemberLogicalOrganizationGet(panel, expectedOrganizationId, serverOrigin) {
  assert.ok(UUID.test(expectedOrganizationId ?? ''), 'd87_member_expected_organization_unverified');
  assert.ok(/^https:\/\/[^/]+$/.test(serverOrigin ?? ''), 'd87_member_backend_origin_unverified');
  assert.equal(
    serverOrigin,
    PRODUCTION_BACKEND_ORIGIN,
    'member_logical_org_backend_not_production',
  );
  let observer = null;
  let bearerHash = null;
  const snapshot = () => {
    const result = observer?.result();
    return {
      exact_get_count: result?.exactRequestCount ?? 0,
      complete:
        result?.responseFinished === true ||
        result?.loadingFailed === true ||
        (result?.exactRequestCount ?? 0) > 1,
      authenticated: result?.authenticatedPrincipalMatches === true,
      organization_matches_expected: result?.productHeaderMatches === true,
      response_ok: result?.successfulResponse === true,
    };
  };
  return {
    async start() {
      bearerHash = await panelBearerHash(panel);
      assert.match(
        bearerHash ?? '',
        /^[0-9a-f]{64}$/,
        'd87_member_logical_organization_unauthenticated',
      );
      await panel.send('Network.enable');
    },
    arm() {
      assert.ok(bearerHash, 'd87_member_logical_organization_unauthenticated');
      observer?.stop();
      observer = observeShowcaseProductRequest(panel, expectedOrganizationId, bearerHash);
    },
    snapshot,
    async verify(timeoutMs = 30_000) {
      assert.ok(observer, 'd87_member_logical_organization_not_armed');
      const result = await waitFor(
        'd87_member_logical_organization_get',
        snapshot,
        (value) => value.exact_get_count > 0 && value.complete,
        timeoutMs,
      );
      assert.equal(result.exact_get_count, 1, 'd87_member_logical_organization_ambiguous');
      assert.equal(result.authenticated, true, 'd87_member_logical_organization_unauthenticated');
      assert.equal(
        result.organization_matches_expected,
        true,
        'd87_member_logical_organization_mismatch',
      );
      assert.equal(result.response_ok, true, 'd87_member_logical_organization_get_failed');
      return {
        request_observed: true,
        authenticated: true,
        organization_matches_expected: true,
        http_status: 200,
      };
    },
    stop() {
      observer?.stop();
    },
  };
}
