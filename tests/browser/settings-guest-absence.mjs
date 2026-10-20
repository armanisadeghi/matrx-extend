import { activeTabPanelExpression, evaluate } from './settings-panel-driver.mjs';

export async function guestSections(panel, read = evaluate) {
  return read(
    panel,
    `(() => {
    const pane = ${activeTabPanelExpression('Settings')};
    const text = pane?.innerText ?? '';
    const buttons = [...(pane?.querySelectorAll('button') ?? [])];
    return { active: !!pane,
      guest: buttons.filter((button) => button.textContent.trim() === 'Sign in').length === 1 &&
        buttons.every((button) => button.textContent.trim() !== 'Sign out'),
      sections: [...(pane?.querySelectorAll('button[aria-expanded]') ?? [])].map((b) => b.textContent.trim()),
      advancedText: text.includes('Advanced agent capabilities'),
      adminControls: ['Audit key', 'Permission gate'].filter((s) => text.includes(s)),
      permissionControlCount: pane?.querySelectorAll('[aria-label="DevTools Protocol permission"]').length ?? 0 };
  })()`,
  );
}

// A negative control check only counts after the real guest Settings surface
// has rendered. An empty or wrong panel must never prove absence.
export function guestAdminControlsAbsent(state) {
  return (
    state?.active === true &&
    state.guest === true &&
    Array.isArray(state.sections) &&
    ['Account', 'Organization', 'Appearance'].every((section) =>
      state.sections.includes(section),
    ) &&
    !state.sections.includes('Advanced agent capabilities') &&
    state.advancedText === false &&
    Array.isArray(state.adminControls) &&
    state.adminControls.length === 0 &&
    state.permissionControlCount === 0
  );
}

export async function recordGuestAdminAbsence({
  panel,
  caseRecord,
  phase,
  action,
  criterionName,
  criterion,
  signedOut = true,
  read = evaluate,
}) {
  const state = await guestSections(panel, read);
  const passed = signedOut && guestAdminControlsAbsent(state);
  const evidence = { signedOut, ...state };
  caseRecord.steps.push({ phase, action, observation: evidence });
  criterion(caseRecord, criterionName, passed ? 'pass' : 'fail', evidence);
  return passed;
}
