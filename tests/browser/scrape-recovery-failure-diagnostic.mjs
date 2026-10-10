import { waitFor } from './settings-panel-driver.mjs';

const hostCategory = (value) =>
  value === 'ON_CLICK' || value === 'ON_ALL_SITES' ? value : 'unknown';
const flag = (value) => (typeof value === 'boolean' ? value : null);

export function safeRecoveryFailureSnapshot(state, expectedHostAccess, observedHostAccess) {
  return {
    phase: 'permission_denial_or_capture_wait',
    scrape_tab_active: flag(state?.scrapeTabActive),
    scrape_pane_active: flag(state?.scrapePaneActive),
    error_present: flag(state?.error),
    permission_message_present: flag(state?.permissionMessage),
    try_again_present: Number.isInteger(state?.tryAgain) ? state.tryAgain > 0 : null,
    reload_page_present: Number.isInteger(state?.reloadPage) ? state.reloadPage > 0 : null,
    deep_control_present: Array.isArray(state?.deepTitles) ? state.deepTitles.length > 0 : null,
    deep_capture_in_progress: flag(state?.deepCaptureInProgress),
    result_present: flag(state?.resultPresent),
    expected_host_access: hostCategory(expectedHostAccess),
    observed_host_access: hostCategory(observedHostAccess),
  };
}

export async function waitForRecoveryOutcome({
  readState,
  readObservedHostAccess,
  onFailure,
  wait = waitFor,
}) {
  let lastState = null;
  try {
    return await wait(
      'scrape_recovery_permission_denial_or_capture',
      async () => {
        lastState = await readState();
        return lastState;
      },
      (value) => value?.ready && (value.error || value.resultPresent),
    );
  } catch (error) {
    const observedHostAccess = await readObservedHostAccess().catch(() => 'unknown');
    onFailure(safeRecoveryFailureSnapshot(lastState, 'ON_CLICK', observedHostAccess));
    throw error;
  }
}
