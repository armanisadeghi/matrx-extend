import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertGuestScrapeRecoveryEvidence } from './scrape-error-recovery-guest-oracle.mjs';

function validEvidence() {
  return {
    case_id: 'EXT-F-1007-T14',
    auth_mode: 'guest',
    requested_mode: 'deep',
    browser_configuration: {
      enabled_feature: 'ExtensionsMenuAccessControl',
      flag_observed: true,
      default_chrome: false,
    },
    denial: {
      host_access: 'ON_ALL_SITES',
      site_restricted: true,
      effective_injection_access: 'denied',
      page_reloaded_without_access: true,
      error_visible: true,
      permission_message_visible: true,
      try_again_visible: true,
      reload_visible: false,
    },
    retry: {
      host_access: 'ON_ALL_SITES',
      site_restricted: false,
      clicked: true,
      error_cleared: true,
      deep_only_marker_visible: true,
    },
    dismiss: {
      host_access: 'ON_ALL_SITES',
      site_restricted: true,
      effective_injection_access: 'denied',
      error_visible: true,
      permission_message_visible: true,
      clicked: true,
      error_cleared: true,
    },
    cleanup: {
      original_site_restricted: false,
      site_restricted: false,
      site_permitted: false,
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
    [
      (e) => {
        e.browser_configuration.default_chrome = true;
      },
      'scrape_recovery_browser_configuration_missing',
    ],
    [
      (e) => {
        e.denial.effective_injection_access = 'unknown';
      },
      'scrape_recovery_effective_denial_missing',
    ],
    [
      (e) => {
        e.denial.site_restricted = false;
      },
      'scrape_recovery_denial_not_observed',
    ],
    [
      (e) => {
        e.dismiss.effective_injection_access = 'available';
      },
      'scrape_recovery_second_effective_denial_missing',
    ],
    [
      (e) => {
        e.dismiss.site_restricted = false;
      },
      'scrape_recovery_second_denial_missing',
    ],
    [
      (e) => {
        e.retry.site_restricted = true;
      },
      'scrape_recovery_retry_site_restriction_not_removed',
    ],
    [
      (e) => {
        e.cleanup.site_restricted = true;
      },
      'scrape_recovery_site_cleanup_unverified',
    ],
    [
      (e) => {
        e.cleanup.site_permitted = true;
      },
      'scrape_recovery_site_cleanup_unverified',
    ],
    [
      (evidence) => {
        evidence.case_id = 'EXT-F-OTHER';
      },
      'scrape_recovery_case_id_required',
    ],
    [
      (evidence) => {
        evidence.auth_mode = 'member';
      },
      'scrape_recovery_guest_required',
    ],
    [
      (evidence) => {
        evidence.requested_mode = 'fast';
      },
      'scrape_recovery_deep_mode_required',
    ],
    [
      (evidence) => {
        evidence.denial.host_access = 'ON_CLICK';
      },
      'scrape_recovery_denial_not_observed',
    ],
    [
      (evidence) => {
        evidence.denial.page_reloaded_without_access = false;
      },
      'scrape_recovery_denied_reload_missing',
    ],
    [
      (evidence) => {
        evidence.denial.error_visible = false;
      },
      'scrape_recovery_error_missing',
    ],
    [
      (evidence) => {
        evidence.denial.permission_message_visible = false;
      },
      'scrape_recovery_permission_error_not_observed',
    ],
    [
      (evidence) => {
        evidence.denial.try_again_visible = false;
      },
      'scrape_recovery_try_again_missing',
    ],
    [
      (evidence) => {
        evidence.denial.reload_visible = true;
      },
      'scrape_recovery_reload_claim_mismatch',
    ],
    [
      (evidence) => {
        evidence.retry.host_access = 'ON_CLICK';
      },
      'scrape_recovery_access_not_restored',
    ],
    [
      (evidence) => {
        evidence.retry.clicked = false;
      },
      'scrape_recovery_try_again_not_clicked',
    ],
    [
      (evidence) => {
        evidence.retry.error_cleared = false;
      },
      'scrape_recovery_try_again_did_not_clear_error',
    ],
    [
      (evidence) => {
        evidence.retry.deep_only_marker_visible = false;
      },
      'scrape_recovery_deep_retry_not_proven',
    ],
    [
      (evidence) => {
        evidence.dismiss.host_access = 'ON_CLICK';
      },
      'scrape_recovery_second_denial_missing',
    ],
    [
      (evidence) => {
        evidence.dismiss.error_visible = false;
      },
      'scrape_recovery_dismiss_error_missing',
    ],
    [
      (evidence) => {
        evidence.dismiss.permission_message_visible = false;
      },
      'scrape_recovery_dismiss_permission_error_missing',
    ],
    [
      (evidence) => {
        evidence.dismiss.clicked = false;
      },
      'scrape_recovery_dismiss_not_clicked',
    ],
    [
      (evidence) => {
        evidence.dismiss.error_cleared = false;
      },
      'scrape_recovery_dismiss_did_not_clear_error',
    ],
    [
      (evidence) => {
        evidence.cleanup.original_host_access = 'ON_CLICK';
      },
      'scrape_recovery_original_access_not_recorded',
    ],
    [
      (evidence) => {
        evidence.cleanup.host_access = 'ON_CLICK';
      },
      'scrape_recovery_access_not_restored_finally',
    ],
    [
      (evidence) => {
        evidence.cleanup.restored = false;
      },
      'scrape_recovery_cleanup_unverified',
    ],
    [
      (evidence) => {
        evidence.reload_page = 'passed';
      },
      'scrape_recovery_reload_must_remain_unverified',
    ],
  ];

  for (const [mutate, code] of cases) {
    const evidence = validEvidence();
    mutate(evidence);
    assert.throws(() => assertGuestScrapeRecoveryEvidence(evidence), new RegExp(code));
  }
});

test('T14 Chrome site restriction transitions affect only the owned origin and reject non-neutral baseline', async () => {
  const { runInNewContext } = await import('node:vm');
  const { readSiteRestriction, setSiteRestriction } = await import('./scrape-site-restriction.mjs');
  const owned = 'http://localhost:32123';
  const existing = 'https://unrelated.example';
  const restrictedSites = new Set([existing]);
  const permittedSites = new Set();
  let attempts = 0;
  let mutations = 0;
  const details = {
    evaluate(fn, arg) {
      return runInNewContext(`(${fn.toString()})(${JSON.stringify(arg)})`, {
        chrome: {
          developerPrivate: {
            getUserSiteSettings: async () => ({
              restrictedSites: [...restrictedSites],
              permittedSites: [...permittedSites],
            }),
            addUserSpecifiedSites: async ({ siteSet, hosts }) => {
              assert.equal(siteSet, 'USER_RESTRICTED');
              assert.deepEqual([...hosts], [owned]);
              mutations++;
              restrictedSites.add(hosts[0]);
            },
            removeUserSpecifiedSites: async ({ siteSet, hosts }) => {
              assert.equal(siteSet, 'USER_RESTRICTED');
              assert.deepEqual([...hosts], [owned]);
              mutations++;
              restrictedSites.delete(hosts[0]);
            },
          },
        },
      });
    },
  };
  assert.equal((await readSiteRestriction(details, owned)).restricted, false);
  assert.equal(
    (await setSiteRestriction(details, owned, true, false, () => attempts++)).restricted,
    true,
  );
  await assert.rejects(setSiteRestriction(details, owned, true, false), /precondition_failed/);
  assert.equal((await setSiteRestriction(details, owned, false, null)).restricted, false);
  assert.deepEqual([...restrictedSites], [existing]);
  assert.equal(attempts, 1);
  assert.equal(mutations, 2);
  permittedSites.add(owned);
  await assert.rejects(setSiteRestriction(details, owned, true, false), /precondition_failed/);
  assert.equal(mutations, 2);
});

test('T14 a rejected Chrome site mutation still records ownership for exact-origin cleanup', async () => {
  const { runInNewContext } = await import('node:vm');
  const { setSiteRestriction } = await import('./scrape-site-restriction.mjs');
  const origin = 'http://localhost:32124';
  let restricted = false;
  let attempted = false;
  const details = {
    evaluate(fn, arg) {
      return runInNewContext(`(${fn.toString()})(${JSON.stringify(arg)})`, {
        chrome: {
          developerPrivate: {
            getUserSiteSettings: async () => ({
              restrictedSites: restricted ? [origin] : [],
              permittedSites: [],
            }),
            addUserSpecifiedSites: async () => {
              restricted = true;
              throw new Error('operation reply lost');
            },
            removeUserSpecifiedSites: async () => {
              restricted = false;
            },
          },
        },
      });
    },
  };
  try {
    await assert.rejects(
      setSiteRestriction(details, origin, true, false, () => {
        attempted = true;
      }),
      /reply lost/,
    );
  } finally {
    if (attempted) await setSiteRestriction(details, origin, false, null);
  }
  assert.equal(attempted, true);
  assert.equal(restricted, false);
});
