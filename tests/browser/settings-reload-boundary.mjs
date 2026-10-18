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
  const prefix = [
    'guest_settings_not_observed:',
    'replacement_settings_tab_ready_not_observed:',
  ].find((candidate) => message.startsWith(candidate));
  if (!prefix) return null;
  try {
    const last = JSON.parse(message.slice(prefix.length));
    if (typeof last?.transient === 'string') {
      if (TRANSPORT_CLOSED.test(last.transient)) return 'panel_transport_closed';
      if (last.transient === 'panel_runtime_exception') return 'panel_runtime_exception';
      return 'guest_observation_unavailable';
    }
    return prefix === 'replacement_settings_tab_ready_not_observed:'
      ? 'settings_tab_not_ready'
      : 'guest_state_not_observed';
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
    step: [
      'settings_tab_wait_started',
      'before_click',
      'click_returned',
      'guest_wait_started',
    ].includes(step)
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

// Failure-only probe for the same-panel Page.reload path. Raw target IDs,
// URLs, page text, and CDP errors stay inside this function.
export async function observeSettingsReacquisition(panel, extensionId) {
  const expectedUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  const result = {
    target: { sampled: false },
    frame: { sampled: false },
    renderer: { sampled: false },
  };
  try {
    const { targetInfo } = await panel.send('Target.getTargetInfo');
    if (targetInfo) {
      result.target = {
        sampled: true,
        sameAsBefore: null,
        expectedPanelUrl: targetInfo.url === expectedUrl,
        typePage: targetInfo.type === 'page',
      };
    }
  } catch {}
  try {
    const { frameTree } = await panel.send('Page.getFrameTree');
    if (frameTree?.frame)
      result.frame = {
        sampled: true,
        expectedPanelUrl: frameTree.frame.url === expectedUrl,
        navigationError: Boolean(frameTree.frame.unreachableUrl),
      };
  } catch {}
  try {
    const sample = await evaluate(
      panel,
      `(async () => {
        const expectedUrl = ${JSON.stringify(expectedUrl)};
        const expectedId = ${JSON.stringify(extensionId)};
        const runtime = globalThis.chrome?.runtime;
        let contexts = null;
        let contextQueryFailed = false;
        if (typeof runtime?.getContexts === 'function') {
          try { contexts = await runtime.getContexts({ contextTypes: ['SIDE_PANEL', 'BACKGROUND'] }); }
          catch { contextQueryFailed = true; }
        }
        const bounded = (value) => Math.min(100, value);
        const roots = [...document.querySelectorAll('#app')];
        return {
          rootChildElementCount: bounded(roots.reduce((count, root) => count + (root.childElementCount ?? 0), 0)),
          reactRootAttached: roots.some((root) => Object.keys(root).some((key) => key.startsWith('__reactContainer$'))),
          // No public store marker exists. Do not claim hydration from DOM presence.
          hydrationStateObservable: false,
          tabTriggerCount: bounded(document.querySelectorAll('button[role="tab"]').length),
          activePaneCount: bounded(document.querySelectorAll('[role="tabpanel"][data-state="active"]').length),
          loadingIndicatorCount: bounded(document.querySelectorAll('#app .animate-spin, #app .animate-pulse').length),
          renderErrorPresent: [...document.querySelectorAll('#app p')].some((node) => node.textContent?.trim() === 'The panel hit a render error'),
          serviceWorkerContextCount: contexts === null ? null : bounded(contexts.filter((entry) => entry.contextType === 'BACKGROUND' && entry.contextId).length),
          expectedPanelUrl: document.URL === expectedUrl,
          readyState: document.readyState,
          visible: document.visibilityState === 'visible',
          runtimeIdMatches: runtime?.id === expectedId,
          rootCount: bounded(roots.length),
          settingsTabCount: bounded(document.querySelectorAll('button[role="tab"][title="Settings"]').length),
          contextQueryAvailable: typeof runtime?.getContexts === 'function',
          contextQueryFailed,
          exactSidePanelContextCount: contexts === null ? null : bounded(contexts.filter((entry) =>
            entry.contextType === 'SIDE_PANEL' && entry.documentUrl === expectedUrl &&
            entry.tabId === -1).length),
        };
      })()`,
    );
    if (
      typeof sample?.expectedPanelUrl === 'boolean' &&
      ['loading', 'interactive', 'complete'].includes(sample.readyState) &&
      typeof sample.visible === 'boolean' &&
      typeof sample.runtimeIdMatches === 'boolean' &&
      [
        'rootCount',
        'settingsTabCount',
        'rootChildElementCount',
        'tabTriggerCount',
        'activePaneCount',
        'loadingIndicatorCount',
      ].every((key) => safeCount(sample[key]) !== null && sample[key] <= 100) &&
      ['reactRootAttached', 'hydrationStateObservable', 'renderErrorPresent'].every(
        (key) => typeof sample[key] === 'boolean',
      ) &&
      (sample.serviceWorkerContextCount === null ||
        (safeCount(sample.serviceWorkerContextCount) !== null &&
          sample.serviceWorkerContextCount <= 100)) &&
      typeof sample.contextQueryAvailable === 'boolean' &&
      typeof sample.contextQueryFailed === 'boolean' &&
      (sample.exactSidePanelContextCount === null ||
        (safeCount(sample.exactSidePanelContextCount) !== null &&
          sample.exactSidePanelContextCount <= 100))
    ) {
      result.renderer = {
        sampled: true,
        expectedPanelUrl: sample.expectedPanelUrl,
        readyState: sample.readyState,
        visible: sample.visible,
        runtimeIdMatches: sample.runtimeIdMatches,
        rootCount: sample.rootCount,
        rootChildElementCount: sample.rootChildElementCount,
        reactRootAttached: sample.reactRootAttached,
        hydrationStateObservable: sample.hydrationStateObservable,
        tabTriggerCount: sample.tabTriggerCount,
        activePaneCount: sample.activePaneCount,
        loadingIndicatorCount: sample.loadingIndicatorCount,
        renderErrorPresent: sample.renderErrorPresent,
        serviceWorkerContextCount: sample.serviceWorkerContextCount,
        settingsTabCount: sample.settingsTabCount,
        contextQueryAvailable: sample.contextQueryAvailable,
        contextQueryFailed: sample.contextQueryFailed,
        exactSidePanelContextCount: sample.exactSidePanelContextCount,
      };
    }
  } catch {}
  return result;
}
