// Controlled CDP boundary for the diagnostic probe; the organization helper remains real.
const PROFILE_ID = 'e5ad951e-521d-45ea-b37e-63d4fa0be164';
const ORGANIZATION_ID = '72336a38-f816-442f-ad48-18610128fb67';

export const probeAuth = { email: 'admin@admin.com', profileId: PROFILE_ID, admin_role: true };

export function organizationProbePanel(scenario) {
  return {
    async send(method, { expression }) {
      if (method !== 'Runtime.evaluate') throw new Error('unexpected_probe_method');
      let value;
      if (expression.includes('const buttons = [...document.querySelectorAll')) {
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
          organizationSelected: scenario !== 'picker',
          organizationLabel: scenario !== 'picker' ? "Matrx's Org" : null,
          organizationPickerAvailable: scenario !== 'picker',
        };
      } else if (expression.includes('chrome.storage.local.get')) {
        value = {
          profileId: PROFILE_ID,
          accessTokenPresent: true,
          isAdmin: true,
          organizationId: scenario === 'storage' ? null : ORGANIZATION_ID,
          organizationName: scenario === 'storage' ? null : "Matrx's Org",
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
