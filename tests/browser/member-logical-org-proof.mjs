import assert from 'node:assert/strict';
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

/** Trigger a fresh read after the hidden force-mounted Chat view has settled. */
export async function refreshMemberLogicalOrganizationGet(panel, observer, clickControl = click) {
  await clickControl(panel, 'title', 'Chat');
  await clickControl(panel, 'chat-compute-trigger', 'Compute');
  await waitFor(
    'member_compute_refresh_ready',
    () =>
      evaluate(
        panel,
        `(() => {
          const dialogs = [...document.querySelectorAll('[role="dialog"][data-state="open"]')]
            .filter((dialog) => [...dialog.querySelectorAll('div')]
              .some((node) => node.textContent.trim() === 'Agent compute target'));
          const buttons = dialogs.flatMap((dialog) => [...dialog.querySelectorAll('button[title="Refresh"]')]);
          return buttons.length === 1 && !buttons[0].disabled;
        })()`,
      ),
    (ready) => ready === true,
  );
  observer.arm();
  await clickControl(panel, 'chat-compute-refresh', 'Refresh');
}

/** Observe the extension's own authenticated, read-only active-org request. */
export function observeMemberLogicalOrganizationGet(panel, expectedOrganizationId, serverOrigin) {
  assert.ok(UUID.test(expectedOrganizationId ?? ''), 'd87_member_expected_organization_unverified');
  assert.ok(/^https:\/\/[^/]+$/.test(serverOrigin ?? ''), 'd87_member_backend_origin_unverified');
  const requests = new Map();
  let armed = false;
  const header = (headers, name) =>
    Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (!armed) return;
    try {
      const url = new URL(request?.url);
      if (
        url.origin !== serverOrigin ||
        url.pathname !== '/api/compute-targets/' ||
        url.search !== '' ||
        request?.method !== 'GET'
      )
        return;
      requests.set(requestId, {
        authenticated: /^Bearer \S+$/.test(header(request.headers, 'authorization') ?? ''),
        organization_matches_expected:
          header(request.headers, 'x-organization-id') === expectedOrganizationId,
        response_ok: false,
        finished: false,
        failed: false,
      });
    } catch {
      // Unrelated requests cannot establish the logical organization.
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const request = requests.get(requestId);
    if (request) request.response_ok = response?.status === 200;
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    const request = requests.get(requestId);
    if (request) request.finished = true;
  });
  const offFailed = panel.on('Network.loadingFailed', ({ requestId }) => {
    const request = requests.get(requestId);
    if (request) request.failed = true;
  });
  const snapshot = () => ({
    exact_get_count: requests.size,
    complete: [...requests.values()].every((request) => request.finished || request.failed),
    authenticated: requests.size === 1 && [...requests.values()][0].authenticated,
    organization_matches_expected:
      requests.size === 1 && [...requests.values()][0].organization_matches_expected,
    response_ok: requests.size === 1 && [...requests.values()][0].response_ok,
  });
  return {
    start: () => panel.send('Network.enable'),
    arm() {
      requests.clear();
      armed = true;
    },
    snapshot,
    async verify(timeoutMs = 30_000) {
      assert.equal(armed, true, 'd87_member_logical_organization_not_armed');
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
      offRequest();
      offResponse();
      offFinished();
      offFailed();
    },
  };
}
