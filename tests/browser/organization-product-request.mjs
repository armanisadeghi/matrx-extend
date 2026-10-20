import { createHash } from 'node:crypto';
import { nativeOAuthBearerExpression } from './native-oauth-session.mjs';
import { evaluate } from './settings-panel-driver.mjs';
import { stageShowcaseOrganization } from './showcase-organization-diagnostic.mjs';
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

export async function panelBearerHash(panel) {
  return evaluate(
    panel,
    `(async () => {
    const token = ${nativeOAuthBearerExpression};
    if (typeof token !== 'string' || !token) return null;
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  })()`,
  );
}
