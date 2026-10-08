// Controlled CDP boundary for the diagnostic probe; the organization helper remains real.
const PROFILE_ID = 'e5ad951e-521d-45ea-b37e-63d4fa0be164';
export const ORGANIZATION_ID = '72336a38-f816-442f-ad48-18610128fb67';

export const probeAuth = { email: 'admin@admin.com', profileId: PROFILE_ID, admin_role: true };

export function organizationProbePanel(scenario) {
  let selected = [
    'selected',
    'ladder',
    'wrong_header',
    'missing_header',
    'wrong_bearer',
    'failed_response',
    'wrong_storage',
  ].includes(scenario);
  let pressed = false;
  let pointerClicks = 0;
  let lastKind = null;
  const listeners = new Map();
  const emit = (event, payload) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  return {
    get selectionClicks() {
      return selected && scenario === 'admin_approved' ? 1 : 0;
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return () => listeners.get(event).delete(listener);
    },
    async send(method, parameters) {
      if (method === 'Network.enable') return {};
      if (method === 'Input.dispatchMouseEvent') {
        if (parameters.type === 'mousePressed') pressed = true;
        if (parameters.type === 'mouseReleased' && pressed) {
          pointerClicks += 1;
          if (scenario === 'admin_approved' && pointerClicks === 2) selected = true;
          if (lastKind === 'tool-row') {
            const headers = {
              Authorization:
                scenario === 'wrong_bearer' ? 'Bearer wrong-token' : 'Bearer opaque-test-token',
              ...(scenario === 'missing_header'
                ? {}
                : {
                    'X-Organization-Id':
                      scenario === 'wrong_header'
                        ? '33333333-3333-4333-8333-333333333333'
                        : ORGANIZATION_ID,
                  }),
            };
            emit('Network.requestWillBeSent', {
              requestId: 'tools-1',
              request: {
                url: 'https://server.app.matrxserver.com/tools/test/list',
                method: 'GET',
                headers,
              },
            });
            emit('Network.responseReceived', {
              requestId: 'tools-1',
              response: {
                status: scenario === 'failed_response' ? 500 : 200,
              },
            });
            emit('Network.loadingFinished', { requestId: 'tools-1' });
          }
          pressed = false;
        }
        return {};
      }
      if (method !== 'Runtime.evaluate') throw new Error('unexpected_probe_method');
      const { expression } = parameters;
      let value;
      if (expression.includes('crypto.subtle.digest')) {
        value = 'b315e9825a0975c1785d769396ac4a6e0d701eb63d15ae035aa15ea540f9ae54';
      } else if (
        expression.includes('const kind = "organization"') ||
        expression.includes('const kind = "organization-option"') ||
        expression.includes('const kind = "title"') ||
        expression.includes('const kind = "tool-row"')
      ) {
        lastKind = /const kind = "([^"]+)"/.exec(expression)?.[1] ?? null;
        value = {
          count: 1,
          matchedCount: 1,
          x: 120,
          y: 150,
          hitTarget: true,
          animating: false,
          pointerDiagnostic: {},
        };
      } else if (expression.includes('const buttons = [...document.querySelectorAll')) {
        value = { count: 1, expanded: 'true' };
      } else if (expression.includes("?.getAttribute('aria-expanded'))()")) {
        value = 'true';
      } else if (expression.includes('const account = [...document.querySelectorAll')) {
        if (scenario === 'picker_unknown') throw new Error('private@example.invalid');
        value = {
          emailMatches: true,
          adminRole: true,
          roleAbsent: false,
          signOutVisible: true,
          signInEnabled: false,
          organizationSelected: selected || scenario === 'storage',
          organizationLabel: selected
            ? scenario === 'admin_approved'
              ? 'Matrx Org'
              : "Matrx's Org"
            : scenario === 'storage'
              ? "Matrx's Org"
              : null,
          organizationPickerAvailable: scenario !== 'picker',
        };
      } else if (expression.includes('const visibleExact = exact.filter(visible)')) {
        value =
          scenario === 'admin_approved' && expression.includes('"Matrx Org"')
            ? {
                menu_open: true,
                visible_option_count: 2,
                exact_match_count: 1,
                exact_visible_match_count: 1,
                target_in_viewport: true,
                target_center_hit: true,
                archive_filter: 'active',
                point: { x: 120, y: 150 },
                candidate: { x: 120, y: 150 },
              }
            : {
                menu_open: true,
                visible_option_count: 1,
                exact_match_count: 0,
                exact_visible_match_count: 0,
                target_in_viewport: null,
                target_center_hit: null,
                archive_filter: 'active',
                point: null,
                candidate: null,
              };
      } else if (expression.includes('chrome.storage.local.get')) {
        value = {
          profileId: PROFILE_ID,
          accessTokenPresent: true,
          isAdmin: true,
          organizationId:
            scenario === 'storage' ||
            !selected ||
            [
              'ladder',
              'wrong_header',
              'missing_header',
              'wrong_bearer',
              'failed_response',
            ].includes(scenario)
              ? null
              : scenario === 'wrong_storage'
                ? '33333333-3333-4333-8333-333333333333'
                : ORGANIZATION_ID,
          organizationName: !selected
            ? null
            : scenario === 'admin_approved'
              ? 'Matrx Org'
              : "Matrx's Org",
        };
      } else {
        throw new Error('unexpected_probe_expression');
      }
      return { result: { value } };
    },
  };
}

export async function withFastProbeClock(action) {
  const original = Date.now;
  let next = original();
  Date.now = () => {
    next += 31_000;
    return next;
  };
  try {
    return await action();
  } finally {
    Date.now = original;
  }
}
