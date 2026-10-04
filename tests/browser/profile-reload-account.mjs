import { waitFor } from './settings-panel-driver.mjs';

export function reloadAccountReady(sample) {
  return (
    sample?.signed_in_account_count === 1 &&
    sample.guest_account_count === 0 &&
    sample.persisted_identity_matches === true &&
    sample.persisted_organization_matches === true &&
    sample.access_token_present === true
  );
}

// Record the state before waiting so a later ready panel proves a hydration
// gap. On failure, retain the last content-free sample for session diagnosis.
export async function observeReloadAccountReady(report, read, timeoutMs = 30000) {
  const before = await read();
  report.reload_auth = { before, last: before, status: 'observing' };
  if (reloadAccountReady(before)) {
    report.reload_auth = { before, after: before, status: 'ready_without_wait' };
    return before;
  }
  try {
    const after = await waitFor(
      'profile_reload_authenticated_menu_ready',
      async () => {
        const sample = await read();
        report.reload_auth.last = sample;
        return sample;
      },
      reloadAccountReady,
      timeoutMs,
    );
    report.reload_auth = { before, after, status: 'ready_after_wait' };
    return after;
  } catch (error) {
    report.reload_auth.status = 'not_ready';
    throw error;
  }
}
