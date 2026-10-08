import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  accountIdentity,
  panelIdentity,
  selectOrganization,
  settingsOrganizationSelectionRequired,
} from './settings-native-auth-driver.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';
import {
  createShowcaseOrganizationDiagnostic,
  observeShowcaseOrganization,
  recordShowcaseOrganizationFailure,
  stageShowcaseOrganization,
} from './showcase-organization-diagnostic.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const API_ORIGIN = 'https://server.app.matrxserver.com';

function header(headers, name) {
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1] ?? null;
}

export function observeShowcaseProductRequest(
  panel,
  expectedOrganizationId,
  expectedBearerHash,
  diagnostic,
) {
  const requests = new Map();
  const removers = [];
  const listen = (stage, event, listener) => {
    if (diagnostic) stageShowcaseOrganization(diagnostic, stage);
    removers.push(panel.on(event, listener));
  };
  const stop = () => {
    let failed = false;
    for (const remove of removers.splice(0)) {
      try {
        remove();
      } catch {
        failed = true;
      }
    }
    if (failed) throw new Error('showcase_observer_cleanup_failed');
  };
  try {
    listen(
      'organization_observer_request',
      'Network.requestWillBeSent',
      ({ requestId, request }) => {
        let url;
        try {
          url = new URL(request.url);
        } catch {
          return;
        }
        if (
          url.origin !== API_ORIGIN ||
          url.pathname !== '/tools/test/list' ||
          request.method !== 'GET'
        )
          return;
        const bearer = /^Bearer (\S+)$/i.exec(header(request.headers, 'authorization') ?? '');
        requests.set(requestId, {
          organizationMatches:
            header(request.headers, 'x-organization-id') === expectedOrganizationId,
          bearerMatches: Boolean(
            bearer && createHash('sha256').update(bearer[1]).digest('hex') === expectedBearerHash,
          ),
          status: null,
          finished: false,
          failed: false,
        });
      },
    );
    listen(
      'organization_observer_response',
      'Network.responseReceived',
      ({ requestId, response }) => {
        const request = requests.get(requestId);
        if (request) request.status = response.status;
      },
    );
    listen('organization_observer_finished', 'Network.loadingFinished', ({ requestId }) => {
      const request = requests.get(requestId);
      if (request) request.finished = true;
    });
    listen('organization_observer_failed', 'Network.loadingFailed', ({ requestId }) => {
      const request = requests.get(requestId);
      if (request) request.failed = true;
    });
  } catch (error) {
    try {
      stop();
    } catch {
      /* Preserve the registration boundary. */
    }
    throw error;
  }
  return {
    start: () => panel.send('Network.enable'),
    result: () => {
      const entries = [...requests.values()];
      return {
        exactRequestCount: entries.length,
        responseObserved: entries.some((entry) => entry.status !== null),
        loadingFailed: entries.some((entry) => entry.failed),
        productHeaderMatches: entries.length === 1 && entries[0].organizationMatches,
        authenticatedPrincipalMatches: entries.length === 1 && entries[0].bearerMatches,
        successfulResponse:
          entries.length === 1 && entries[0].status === 200 && entries[0].finished,
        responseFinished: entries.length === 1 && entries[0].finished,
      };
    },
    stop,
  };
}

async function panelBearerHash(panel) {
  return evaluate(
    panel,
    `(async () => {
    const stored = await chrome.storage.local.get('matrx.auth.accessToken');
    const token = stored['matrx.auth.accessToken'];
    if (typeof token !== 'string' || !token) return null;
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  })()`,
  );
}

export async function runShowcaseOrganizationCheckpoint({
  panel,
  auth,
  resourceAction,
  report,
  requiredOrganizationName,
  requiredOrganizationId,
}) {
  report.organization_diagnostic = createShowcaseOrganizationDiagnostic();
  const diagnostic = report.organization_diagnostic;
  assert.equal(auth.admin_role, true, 'showcase_admin_role_unverified');
  assert.ok(
    typeof requiredOrganizationName === 'string' &&
      requiredOrganizationName.trim() === requiredOrganizationName &&
      requiredOrganizationName,
    'd87_approved_organization_required',
  );
  assert.match(requiredOrganizationId ?? '', UUID, 'd87_approved_organization_id_required');
  observeShowcaseOrganization(diagnostic, { admin_role_verified: true });
  stageShowcaseOrganization(diagnostic, 'organization_section');
  await resourceAction(() => openSection(panel, 'Organization'));
  stageShowcaseOrganization(diagnostic, 'organization_picker');
  observeShowcaseOrganization(diagnostic, { picker_available: null, picker_has_selection: null });
  const initial = await waitFor(
    'd87_required_organization_picker',
    async () => {
      const value = await accountIdentity(panel, auth.email);
      observeShowcaseOrganization(diagnostic, {
        picker_available: value?.organizationPickerAvailable ?? null,
        picker_has_selection: value?.organizationSelected ?? null,
      });
      return value;
    },
    (value) => value?.organizationSelected || value?.organizationPickerAvailable,
    30_000,
  );
  const selectionRequired = settingsOrganizationSelectionRequired(
    initial,
    requiredOrganizationName,
  );
  observeShowcaseOrganization(diagnostic, {
    picker_available: initial.organizationPickerAvailable,
    picker_has_selection: initial.organizationSelected,
    selection_required: selectionRequired,
  });
  stageShowcaseOrganization(
    diagnostic,
    selectionRequired ? 'organization_select' : 'organization_skip',
  );
  if (selectionRequired)
    await resourceAction(() =>
      selectOrganization(panel, requiredOrganizationName, (value) =>
        observeShowcaseOrganization(diagnostic, value),
      ),
    );
  stageShowcaseOrganization(diagnostic, 'organization_rendered_identity');
  const selected = await waitFor(
    'd87_rendered_identity',
    async () => ({
      ...(await accountIdentity(panel, auth.email)),
      ...(await panelIdentity(panel)),
    }),
    (value) =>
      value?.emailMatches &&
      value.adminRole &&
      value.signOutVisible &&
      value.accessTokenPresent &&
      value.isAdmin === true &&
      value.profileId === auth.profileId &&
      value.organizationSelected &&
      value.organizationLabel === requiredOrganizationName &&
      (!selectionRequired || value.organizationId === requiredOrganizationId),
    30_000,
  );
  observeShowcaseOrganization(diagnostic, {
    storage_has_uuid: UUID.test(selected.organizationId ?? ''),
    storage_name_matches: selected.organizationName === requiredOrganizationName,
    rendered_email_matches: selected.emailMatches,
    rendered_role_matches: selected.adminRole && selected.isAdmin === true,
    rendered_profile_matches: selected.profileId === auth.profileId,
    rendered_organization_matches: selected.organizationLabel === requiredOrganizationName,
  });
  // A device choice, when present, must agree. A load-ladder choice need not create one.
  assert.ok(
    selected.organizationId === null || selected.organizationId === requiredOrganizationId,
    'showcase_organization_changed',
  );
  if (selected.organizationId !== null)
    assert.equal(
      selected.organizationName,
      requiredOrganizationName,
      'showcase_organization_changed',
    );
  let observer;
  let primary;
  const observeNetwork = () => {
    const network = observer.result();
    observeShowcaseOrganization(diagnostic, {
      product_request_observed: network.exactRequestCount > 0,
      product_request_duplicate: network.exactRequestCount > 1,
      product_response_observed: network.responseObserved,
      product_response_finished: network.responseFinished,
      product_loading_failed: network.loadingFailed,
      product_response_success: network.successfulResponse,
      product_header_matches: network.productHeaderMatches,
      product_principal_matches: network.authenticatedPrincipalMatches,
    });
    return network;
  };
  try {
    stageShowcaseOrganization(diagnostic, 'organization_bearer_read');
    const bearerHash = await panelBearerHash(panel);
    assert.match(bearerHash ?? '', /^[0-9a-f]{64}$/, 'showcase_authenticated_token_unavailable');
    stageShowcaseOrganization(diagnostic, 'organization_product_request');
    observer = observeShowcaseProductRequest(panel, requiredOrganizationId, bearerHash, diagnostic);
    stageShowcaseOrganization(diagnostic, 'organization_observer_enable');
    await observer.start();
    stageShowcaseOrganization(diagnostic, 'organization_tools_gate');
    await resourceAction(() => {
      stageShowcaseOrganization(diagnostic, 'organization_tools_click');
      return click(panel, 'title', 'Tools');
    });
    stageShowcaseOrganization(diagnostic, 'organization_records_gate');
    await resourceAction(() => {
      stageShowcaseOrganization(diagnostic, 'organization_records_click');
      return click(panel, 'tool-row', 'records');
    });
    stageShowcaseOrganization(diagnostic, 'organization_request_wait');
    const network = await waitFor(
      'showcase_product_organization_request',
      observeNetwork,
      (value) => value.exactRequestCount === 1 && value.responseFinished,
      30_000,
    );
    stageShowcaseOrganization(diagnostic, 'organization_request_validate');
    assert.equal(
      network.productHeaderMatches,
      true,
      'showcase_product_organization_header_mismatch',
    );
    assert.equal(
      network.authenticatedPrincipalMatches,
      true,
      'showcase_product_principal_mismatch',
    );
    assert.equal(network.successfulResponse, true, 'showcase_product_response_failed');
  } catch (error) {
    primary = error;
    recordShowcaseOrganizationFailure(diagnostic, error);
  } finally {
    if (observer) {
      observeNetwork();
      if (!primary) stageShowcaseOrganization(diagnostic, 'organization_observer_cleanup');
      try {
        observer.stop();
        observeShowcaseOrganization(diagnostic, { observer_cleanup_success: true });
      } catch (error) {
        observeShowcaseOrganization(diagnostic, { observer_cleanup_success: false });
        if (!primary) {
          recordShowcaseOrganizationFailure(diagnostic, error);
          primary = error;
        }
      }
    }
  }
  // Public driver sanitizers accept this fixed fallback without raw CDP text.
  if (primary)
    throw new Error(
      diagnostic.failure_code.startsWith('pointer_')
        ? 'showcase_organization_pointer_failed'
        : diagnostic.failure_code === 'organization_resource_boundary_refused'
          ? 'organization_resource_boundary_failed'
          : diagnostic.failure_code,
    );
  stageShowcaseOrganization(diagnostic, 'organization_identity_compare');
  return {
    organizationId: requiredOrganizationId,
    organizationName: requiredOrganizationName,
    renderedIdentity: {
      rendered_email_matches_first_party: selected.emailMatches,
      rendered_role_matches_mode: selected.adminRole && selected.isAdmin === true,
      profile_matches_first_party: selected.profileId === auth.profileId,
      selected_organization_matches_approved_request: true,
    },
  };
}
