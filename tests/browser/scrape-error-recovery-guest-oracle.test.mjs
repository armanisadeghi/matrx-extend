import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertGuestScrapeRecoveryEvidence } from './scrape-error-recovery-guest-oracle.mjs';
import { updateHostAccessIfExpected } from './scrape-host-access-transition.mjs';

function validEvidence() {
  return {
    case_id: 'EXT-F-1007-T14',
    auth_mode: 'guest',
    requested_mode: 'deep',
    denial: {
      host_access: 'ON_CLICK',
      page_reloaded_without_access: true,
      error_visible: true,
      permission_message_visible: true,
      try_again_visible: true,
      reload_visible: false,
    },
    retry: {
      host_access: 'ON_ALL_SITES',
      clicked: true,
      error_cleared: true,
      deep_only_marker_visible: true,
    },
    dismiss: {
      host_access: 'ON_CLICK',
      error_visible: true,
      permission_message_visible: true,
      clicked: true,
      error_cleared: true,
    },
    cleanup: {
      original_host_access: 'ON_ALL_SITES',
      host_access: 'ON_ALL_SITES',
      restored: true,
    },
    reload_page: 'unverified',
  };
}

test('T14 evidence admits only real guest retry, deep-mode, dismiss, and permission restoration', () => {
  assert.deepEqual(assertGuestScrapeRecoveryEvidence(validEvidence()), {
    status: 'partial',
    covered: 'guest permission-denial Try again and Dismiss; deep retry',
    reload_page: 'unverified',
  });
});

test('T14 forcing guard rejects each missing or contradictory native observation', () => {
  const cases = [
    [(evidence) => (evidence.case_id = 'EXT-F-OTHER'), 'scrape_recovery_case_id_required'],
    [(evidence) => (evidence.auth_mode = 'member'), 'scrape_recovery_guest_required'],
    [(evidence) => (evidence.requested_mode = 'fast'), 'scrape_recovery_deep_mode_required'],
    [
      (evidence) => (evidence.denial.host_access = 'ON_ALL_SITES'),
      'scrape_recovery_denial_not_observed',
    ],
    [
      (evidence) => (evidence.denial.page_reloaded_without_access = false),
      'scrape_recovery_denied_reload_missing',
    ],
    [(evidence) => (evidence.denial.error_visible = false), 'scrape_recovery_error_missing'],
    [
      (evidence) => (evidence.denial.permission_message_visible = false),
      'scrape_recovery_permission_error_not_observed',
    ],
    [
      (evidence) => (evidence.denial.try_again_visible = false),
      'scrape_recovery_try_again_missing',
    ],
    [
      (evidence) => (evidence.denial.reload_visible = true),
      'scrape_recovery_reload_claim_mismatch',
    ],
    [
      (evidence) => (evidence.retry.host_access = 'ON_CLICK'),
      'scrape_recovery_access_not_restored',
    ],
    [(evidence) => (evidence.retry.clicked = false), 'scrape_recovery_try_again_not_clicked'],
    [
      (evidence) => (evidence.retry.error_cleared = false),
      'scrape_recovery_try_again_did_not_clear_error',
    ],
    [
      (evidence) => (evidence.retry.deep_only_marker_visible = false),
      'scrape_recovery_deep_retry_not_proven',
    ],
    [
      (evidence) => (evidence.dismiss.host_access = 'ON_ALL_SITES'),
      'scrape_recovery_second_denial_missing',
    ],
    [
      (evidence) => (evidence.dismiss.error_visible = false),
      'scrape_recovery_dismiss_error_missing',
    ],
    [
      (evidence) => (evidence.dismiss.permission_message_visible = false),
      'scrape_recovery_dismiss_permission_error_missing',
    ],
    [(evidence) => (evidence.dismiss.clicked = false), 'scrape_recovery_dismiss_not_clicked'],
    [
      (evidence) => (evidence.dismiss.error_cleared = false),
      'scrape_recovery_dismiss_did_not_clear_error',
    ],
    [
      (evidence) => (evidence.cleanup.original_host_access = 'ON_CLICK'),
      'scrape_recovery_original_access_not_recorded',
    ],
    [
      (evidence) => (evidence.cleanup.host_access = 'ON_CLICK'),
      'scrape_recovery_access_not_restored_finally',
    ],
    [(evidence) => (evidence.cleanup.restored = false), 'scrape_recovery_cleanup_unverified'],
    [
      (evidence) => (evidence.reload_page = 'passed'),
      'scrape_recovery_reload_must_remain_unverified',
    ],
  ];

  for (const [mutate, code] of cases) {
    const evidence = validEvidence();
    mutate(evidence);
    assert.throws(() => assertGuestScrapeRecoveryEvidence(evidence), new RegExp(code));
  }
});

test('T14 refuses a stale host-access baseline before invoking the browser mutation', async () => {
  let mutationInvoked = false;
  await assert.rejects(
    updateHostAccessIfExpected('ON_CLICK', 'ON_CLICK', 'ON_ALL_SITES', async () => {
      mutationInvoked = true;
    }),
    /scrape_recovery_host_access_precondition_failed/,
  );
  assert.equal(mutationInvoked, false);
});
