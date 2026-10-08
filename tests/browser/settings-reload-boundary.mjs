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
const TRANSPORT_CLOSED = /Target closed|Session closed|WebSocket closed/;

function guestWaitFailureCategory(message) {
  const prefix = 'guest_settings_not_observed:';
  if (!message.startsWith(prefix)) return null;
  try {
    const last = JSON.parse(message.slice(prefix.length));
    if (typeof last?.transient === 'string') {
      if (TRANSPORT_CLOSED.test(last.transient)) return 'panel_transport_closed';
      if (last.transient === 'panel_runtime_exception') return 'panel_runtime_exception';
      return 'guest_observation_unavailable';
    }
    return 'guest_state_not_observed';
  } catch {
    return 'guest_observation_unavailable';
  }
}

export function sanitizeReloadSettingsSample(sample) {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return { sampled: false };
  const booleanKeys = [
    'runtimeIdMatches',
    'documentReady',
    'visible',
    'guestBannerPresent',
    'guestOrganizationGuidancePresent',
  ];
  if (
    booleanKeys.some((key) => typeof sample[key] !== 'boolean') ||
    safeCount(sample.settingsTabCount) === null ||
    safeCount(sample.settingsActiveCount) === null
  )
    return { sampled: false };
  return {
    sampled: true,
    runtimeIdMatches: sample.runtimeIdMatches,
    documentReady: sample.documentReady,
    visible: sample.visible,
    settingsTabCount: sample.settingsTabCount,
    settingsActiveCount: sample.settingsActiveCount,
    guestBannerPresent: sample.guestBannerPresent,
    guestOrganizationGuidancePresent: sample.guestOrganizationGuidancePresent,
  };
}

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
      guestWaitFailureCategory(message) ??
      (message === 'panel_runtime_exception'
        ? 'panel_runtime_exception'
        : TRANSPORT_CLOSED.test(message)
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
    return sanitizeReloadSettingsSample(sample);
  } catch {
    return { sampled: false };
  }
}
