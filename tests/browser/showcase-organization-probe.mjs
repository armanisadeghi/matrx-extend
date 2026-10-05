// Controlled CDP boundary for the diagnostic probe; the organization helper remains real.
const PROFILE_ID = 'e5ad951e-521d-45ea-b37e-63d4fa0be164';
const ORGANIZATION_ID = '72336a38-f816-442f-ad48-18610128fb67';

export const probeAuth = { email: 'admin@admin.com', profileId: PROFILE_ID, admin_role: true };

export function organizationProbePanel(scenario) {
  let selected = scenario === 'selected';
  let pressed = false;
  let pointerClicks = 0;
  return {
    get selectionClicks() {
      return selected && scenario === 'admin_approved' ? 1 : 0;
    },
    async send(method, parameters) {
      if (method === 'Input.dispatchMouseEvent') {
        if (scenario !== 'admin_approved') throw new Error('unexpected_probe_pointer');
        if (parameters.type === 'mousePressed') pressed = true;
        if (parameters.type === 'mouseReleased' && pressed) {
          pointerClicks += 1;
          if (pointerClicks === 2) selected = true;
          pressed = false;
        }
        return {};
      }
      if (method !== 'Runtime.evaluate') throw new Error('unexpected_probe_method');
      const { expression } = parameters;
      let value;
      if (
        expression.includes('const kind = "organization"') ||
        expression.includes('const kind = "organization-option"')
      ) {
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
          organizationId: scenario === 'storage' || !selected ? null : ORGANIZATION_ID,
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
