import { evaluate } from './settings-panel-driver.mjs';

// Only Booleans and bounded counts cross from CDP into the acceptance report.
// Target identity and URL stay in memory for comparison, never in evidence.
export async function captureSettingsShellDiagnostic({
  panel,
  browserSession,
  expectedTargetId,
  expectedPanelUrl,
}) {
  let target = {
    target_query_available: false,
    original_target_present: false,
    original_target_url_matches: false,
    replacement_panel_present: false,
    owned_panel_target_count: null,
  };
  try {
    const targets = (await browserSession.send('Target.getTargets')).targetInfos;
    if (!Array.isArray(targets)) throw new Error('target_query_unavailable');
    const owned = targets.filter((item) => item.url === expectedPanelUrl);
    const original = targets.find((item) => item.targetId === expectedTargetId);
    target = {
      target_query_available: true,
      original_target_present: Boolean(original),
      original_target_url_matches: original?.url === expectedPanelUrl,
      replacement_panel_present: owned.some((item) => item.targetId !== expectedTargetId),
      owned_panel_target_count: Math.min(owned.length, 100),
    };
  } catch {
    // A missing target query is evidence of no observation, never continuity.
  }
  let document = {
    document_observed: false,
    owned_sidepanel_url_matches: false,
    ready_state_complete: false,
    visibility_visible: false,
    role_tab_count: null,
    settings_button_count: null,
    settings_button_disabled: null,
    settings_button_visible: null,
  };
  try {
    const state = await evaluate(
      panel,
      `(() => {
        const settings=[...document.querySelectorAll('button[title="Settings"]')];
        const button=settings.length===1?settings[0]:null;
        const rect=button?.getBoundingClientRect();
        const style=button?getComputedStyle(button):null;
        return {
          owned_sidepanel_url_matches:location.href===${JSON.stringify(expectedPanelUrl)},
          ready_state_complete:document.readyState==='complete',
          visibility_visible:document.visibilityState==='visible',
          role_tab_count:document.querySelectorAll('[role="tab"]').length,
          settings_button_count:settings.length,
          settings_button_disabled:button?button.disabled:null,
          settings_button_visible:button?Boolean(rect.width>0&&rect.height>0&&
            style.display!=='none'&&style.visibility!=='hidden'):null,
        };
      })()`,
    );
    if (!state || typeof state !== 'object') throw new Error('panel_document_unavailable');
    const count = (value) =>
      Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 100) : null;
    document = {
      document_observed: true,
      owned_sidepanel_url_matches: state?.owned_sidepanel_url_matches === true,
      ready_state_complete: state?.ready_state_complete === true,
      visibility_visible: state?.visibility_visible === true,
      role_tab_count: count(state?.role_tab_count),
      settings_button_count: count(state?.settings_button_count),
      settings_button_disabled:
        typeof state?.settings_button_disabled === 'boolean'
          ? state.settings_button_disabled
          : null,
      settings_button_visible:
        typeof state?.settings_button_visible === 'boolean' ? state.settings_button_visible : null,
    };
  } catch {
    // A destroyed execution context remains unobserved, not a blank shell.
  }
  return { ...target, ...document };
}
