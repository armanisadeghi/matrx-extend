import { activeTabPanelExpression, evaluate } from './settings-panel-driver.mjs';

export function recorderIdleBadgeStateExpression() {
  return `(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
        style.display !== 'none' && !element.closest('[inert]');
    };
    const tools = ${activeTabPanelExpression('Tools')};
    const recorderTabs = [...(tools?.querySelectorAll('button[role="tab"]') ?? [])]
      .filter((tab) => tab.textContent.trim() === 'Recorder' && tab.dataset.state === 'active');
    const recorderId = recorderTabs.length === 1 ? recorderTabs[0].getAttribute('aria-controls') : null;
    const recorderPane = recorderId ? document.getElementById(recorderId) : null;
    const activeRecorderPane = recorderPane?.matches('[role="tabpanel"][data-state="active"]')
      ? recorderPane
      : null;
    const badges = [...(activeRecorderPane?.querySelectorAll('[role="status"]') ?? [])];
    const badge = badges.length === 1 ? badges[0] : null;
    return {
      toolsActive: Boolean(tools && visible(tools)),
      recorderTabCount: recorderTabs.length,
      recorderTabVisible: recorderTabs.length === 1 && visible(recorderTabs[0]),
      recorderPaneActive: Boolean(activeRecorderPane && visible(activeRecorderPane)),
      statusCount: badges.length,
      badgeVisible: Boolean(badge && visible(badge)),
      label: badge?.getAttribute('aria-label') ?? null,
      text: badge?.textContent.trim() ?? null,
      tone: badge?.getAttribute('data-status-tone') ?? null,
    };
  })()`;
}

export async function recorderIdleBadgeState(panel) {
  return evaluate(panel, recorderIdleBadgeStateExpression());
}

export function recorderIdleBadgeAccepted(state) {
  return (
    state?.toolsActive === true &&
    state.recorderTabCount === 1 &&
    state.recorderTabVisible === true &&
    state.recorderPaneActive === true &&
    state.statusCount === 1 &&
    state.badgeVisible === true &&
    state.label === 'Idle' &&
    state.text === 'Idle' &&
    state.tone === 'neutral'
  );
}
