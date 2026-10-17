import assert from 'node:assert/strict';
import test from 'node:test';
import {
  recordIdentityWaitFailure,
  verifyReviewerRole,
} from './reviewer-chat-identity-diagnostic.mjs';
import { waitFor } from './settings-panel-driver.mjs';

test('identity wait keeps its symbolic failure and observations when screenshot fails', async () => {
  const report = { account: { web_signed_in: true }, screenshots: null };
  let screenshotAttempted = false;
  await assert.rejects(
    () =>
      recordIdentityWaitFailure({
        report,
        waitError: new Error(
          'reviewer_non_admin_identity_not_observed:{"transient":"Target closed private-token"}',
        ),
        observeAccount: async () => ({
          emailMatchesReviewer: false,
          signInVisible: true,
          raw: 'private-token',
        }),
        observeStorage: async () => ({
          accessTokenPresent: false,
          profilePresent: false,
          raw: 'private-token',
        }),
        captureScreenshot: async () => {
          screenshotAttempted = true;
          throw new Error('private screenshot failure');
        },
        observationTimeoutMs: 20,
      }),
    /reviewer_extension_identity_unverified/,
  );
  assert.equal(screenshotAttempted, true);
  assert.equal(report.account.identity_wait_failure_category, 'panel_target_unavailable');
  assert.deepEqual(report.account.timeout_observation, {
    emailMatchesReviewer: false,
    signInVisible: true,
  });
  assert.deepEqual(report.account.storage_shape, {
    accessTokenPresent: false,
    profilePresent: false,
  });
  assert.equal(report.screenshots.timeout_panel, null);
  assert.equal(report.screenshots.timeout_panel_status, 'unavailable');
  assert.equal(JSON.stringify(report).includes('private-token'), false);
});

test('detached panel observation has a safe category and bounded completion', async () => {
  const report = { account: {}, screenshots: null };
  const started = Date.now();
  await assert.rejects(
    () =>
      recordIdentityWaitFailure({
        report,
        waitError: new Error(
          'reviewer_non_admin_identity_not_observed:{"transient":"panel_runtime_exception"}',
        ),
        observeAccount: async () => {
          throw new Error('Target closed private-link');
        },
        observeStorage: async () => new Promise(() => {}),
        captureScreenshot: async () => {
          throw new Error('Session closed private-link');
        },
        observationTimeoutMs: 20,
      }),
    /reviewer_extension_identity_unverified/,
  );
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(report.account.timeout_observation, {
    status: 'unavailable',
    category: 'panel_target_unavailable',
  });
  assert.deepEqual(report.account.storage_shape, {
    status: 'unavailable',
    category: 'observation_timeout',
  });
  assert.equal(report.account.identity_wait_failure_category, 'panel_runtime_unavailable');
  assert.equal(JSON.stringify(report).includes('private-link'), false);
});

test('rendered identity mismatch preserves observed state and an available screenshot', async () => {
  const report = { account: { web_signed_in: true }, screenshots: null };
  await assert.rejects(
    () =>
      recordIdentityWaitFailure({
        report,
        waitError: new Error('reviewer_non_admin_identity_not_observed:{}'),
        observeAccount: async () => ({
          emailMatchesReviewer: false,
          signOutVisible: true,
          observedRoleCategory: 'non_admin',
          organizationPickerAvailable: true,
        }),
        observeStorage: async () => ({ accessTokenPresent: true, profilePresent: true }),
        captureScreenshot: async () => '/tmp/panel.png',
        observationTimeoutMs: 20,
      }),
    /reviewer_extension_identity_unverified/,
  );
  assert.equal(report.account.identity_wait_failure_category, 'identity_not_observed');
  assert.deepEqual(report.account.timeout_observation, {
    emailMatchesReviewer: false,
    signOutVisible: true,
    organizationPickerAvailable: true,
    observedRoleCategory: 'non_admin',
  });
  assert.deepEqual(report.screenshots, {
    timeout_panel: '/tmp/panel.png',
    timeout_panel_status: 'captured',
  });
});

test('waitFor detached target retains safe category without relaxing acceptance', async () => {
  await assert.rejects(
    () =>
      waitFor(
        'reviewer_non_admin_identity',
        async () => {
          throw new Error('Target closed private-token');
        },
        () => false,
        1,
      ),
    (error) => {
      assert.match(error.message, /^reviewer_non_admin_identity_not_observed:/);
      assert.equal(error.waitFailureCategory, 'panel_target_unavailable');
      return true;
    },
  );
});

test('role failure captures final panel state while retaining role refusal', async () => {
  for (const available of [true, false]) {
    const report = { account: {}, screenshots: null };
    await assert.rejects(
      verifyReviewerRole({
        report,
        onStage() {},
        userId: 'opaque-member',
        adminCheck: {
          verify: async () => {
            throw new Error('private-secret');
          },
          networkSnapshot: () => ({ total_requests: 0 }),
        },
        failureObservations: {
          observeAccount: async () => ({ organizationLoading: available, raw: 'private-secret' }),
          observeStorage: async () =>
            available ? { accessTokenPresent: true } : new Promise(() => {}),
          captureScreenshot: async () => {
            if (!available) throw new Error('private-secret');
            return '/tmp/panel.png';
          },
          observationTimeoutMs: 10,
        },
      }),
      { message: 'reviewer_canonical_role_unverified' },
    );
    assert.deepEqual(report.account.timeout_observation, { organizationLoading: available });
    assert.deepEqual(
      report.account.storage_shape,
      available
        ? { accessTokenPresent: true }
        : { status: 'unavailable', category: 'observation_timeout' },
    );
    assert.equal(report.screenshots.timeout_panel_status, available ? 'captured' : 'unavailable');
    assert.deepEqual(report.account.canonical_role_network, { total_requests: 0 });
    assert.equal(report.account.identity_wait_failure_category, undefined);
    assert.equal(JSON.stringify(report).includes('private-secret'), false);
  }
});
