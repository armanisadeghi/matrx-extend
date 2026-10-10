import assert from 'node:assert/strict';

const failure = (condition, code) => assert.equal(condition, true, code);

export function assertGuestScrapeRecoveryEvidence(evidence) {
  assert.equal(evidence?.case_id, 'EXT-F-1007-T14', 'scrape_recovery_case_id_required');
  assert.equal(evidence?.auth_mode, 'guest', 'scrape_recovery_guest_required');
  assert.equal(evidence?.requested_mode, 'deep', 'scrape_recovery_deep_mode_required');

  failure(evidence.denial?.host_access === 'ON_CLICK', 'scrape_recovery_denial_not_observed');
  failure(evidence.denial?.page_reloaded_without_access, 'scrape_recovery_denied_reload_missing');
  failure(evidence.denial?.error_visible, 'scrape_recovery_error_missing');
  failure(
    evidence.denial?.permission_message_visible,
    'scrape_recovery_permission_error_not_observed',
  );
  failure(evidence.denial?.try_again_visible, 'scrape_recovery_try_again_missing');
  failure(evidence.denial?.reload_visible === false, 'scrape_recovery_reload_claim_mismatch');

  failure(evidence.retry?.host_access === 'ON_ALL_SITES', 'scrape_recovery_access_not_restored');
  failure(evidence.retry?.clicked, 'scrape_recovery_try_again_not_clicked');
  failure(evidence.retry?.error_cleared, 'scrape_recovery_try_again_did_not_clear_error');
  failure(evidence.retry?.deep_only_marker_visible, 'scrape_recovery_deep_retry_not_proven');

  failure(evidence.dismiss?.host_access === 'ON_CLICK', 'scrape_recovery_second_denial_missing');
  failure(evidence.dismiss?.error_visible, 'scrape_recovery_dismiss_error_missing');
  failure(
    evidence.dismiss?.permission_message_visible,
    'scrape_recovery_dismiss_permission_error_missing',
  );
  failure(evidence.dismiss?.clicked, 'scrape_recovery_dismiss_not_clicked');
  failure(evidence.dismiss?.error_cleared, 'scrape_recovery_dismiss_did_not_clear_error');

  failure(
    evidence.cleanup?.original_host_access === 'ON_ALL_SITES',
    'scrape_recovery_original_access_not_recorded',
  );
  failure(
    evidence.cleanup?.host_access === evidence.cleanup?.original_host_access,
    'scrape_recovery_access_not_restored_finally',
  );
  failure(evidence.cleanup?.restored, 'scrape_recovery_cleanup_unverified');
  assert.equal(evidence.reload_page, 'unverified', 'scrape_recovery_reload_must_remain_unverified');
  return {
    status: 'partial',
    covered: 'guest permission-denial Try again and Dismiss; deep retry',
    reload_page: 'unverified',
  };
}
