import { evaluate } from './settings-panel-driver.mjs';

const POINTER_CODES = new Set([
  'pointer_target_not_unique',
  'pointer_stable_hit_not_observed',
  'pointer_initial_evaluation_failed',
  'pointer_page_sample_failed',
  'pointer_followup_evaluation_failed',
  'pointer_press_dispatch_failed',
  'pointer_release_dispatch_failed',
]);
const POINTER_STAGES = new Set([
  'target_resolution',
  'visibility_filter',
  'scroll_preparation',
  'clipping_geometry',
  'hit_testing',
  'animation_observation',
]);
const safeCount = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

export function classifyReloadSettingsFailure(error, step) {
  const pointer = error?.driverFailure;
  const pointerCode = POINTER_CODES.has(pointer?.code) ? pointer.code : null;
  const message = String(error?.message ?? '');
  return {
    step: ['before_click', 'click_returned', 'guest_wait_started'].includes(step)
      ? step
      : 'unknown',
    category:
      pointerCode ??
      (message.startsWith('guest_settings_not_observed:')
        ? 'guest_state_not_observed'
        : message === 'panel_runtime_exception'
          ? 'panel_runtime_exception'
          : /Target closed|Session closed|WebSocket closed/.test(message)
            ? 'panel_transport_closed'
            : 'other'),
    pointer: pointerCode
      ? {
          sampleStage: POINTER_STAGES.has(pointer.sampleStage) ? pointer.sampleStage : null,
          matchedTargetCount: safeCount(pointer.matchedTargetCount),
          visibleMatchCount: safeCount(pointer.visibleMatchCount),
          hitTarget: typeof pointer.hitTarget === 'boolean' ? pointer.hitTarget : null,
          selectedPointAvailable:
            typeof pointer.selectedPointAvailable === 'boolean'
              ? pointer.selectedPointAvailable
              : null,
        }
      : null,
  };
}

export async function observeReloadSettingsPanel(panel, extensionId) {
  try {
    const sample = await evaluate(
      panel,
      `(() => {
      const tabs = [...document.querySelectorAll('button[role="tab"][title="Settings"]')];
      const active = tabs.filter((tab) => tab.getAttribute('data-state') === 'active');
      const text = document.body?.innerText ?? '';
      return { runtimeIdMatches: chrome.runtime.id === ${JSON.stringify(extensionId)},
        documentReady: document.readyState === 'complete',
        visible: document.visibilityState === 'visible',
        settingsTabCount: tabs.length,
        settingsActiveCount: active.length,
        guestBannerPresent: text.includes("You're using Matrx as a guest."),
        guestOrganizationGuidancePresent: text.includes('Sign in to choose') };
    })()`,
    );
    if (!sample || typeof sample !== 'object') return { sampled: false };
    return { sampled: true, ...sample };
  } catch {
    return { sampled: false };
  }
}
