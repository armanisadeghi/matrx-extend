import assert from 'node:assert/strict';
import test from 'node:test';
import {
  recordSettingsIdentityFailure,
  settingsIdentityDiagnostic,
} from './settings-identity-diagnostic.mjs';

const profileId = '3e26f91c-6654-4ab8-b554-13e404918d3b';
const organizationId = 'a4152086-c3e5-44e8-a853-8e3da9918dd8';
const expected = { mode: 'member', profileId, organizationId };
const observed = {
  emailMatches: true,
  signOutVisible: true,
  accessTokenPresent: true,
  profileId,
  roleAbsent: true,
  adminRole: false,
  isAdmin: false,
  organizationId,
  organizationName: 'private organization',
  organizationLabel: 'private organization',
  organizationSelected: true,
};

test('identity diagnostic distinguishes each failed Settings readiness boundary without exposing identity', () => {
  const ready = settingsIdentityDiagnostic(observed, expected);
  assert.equal(ready.identity_ready, true);
  for (const [change, failedCheck] of [
    [{ emailMatches: false }, 'email_matches'],
    [{ signOutVisible: false }, 'sign_out_visible'],
    [{ accessTokenPresent: false }, 'access_token_present'],
    [{ profileId: 'wrong private ID' }, 'profile_matches'],
    [{ roleAbsent: false }, 'role_matches'],
    [{ organizationId: profileId }, 'stored_organization_matches_expected'],
    [{ organizationSelected: false }, 'rendered_organization_selected'],
    [
      { organizationLabel: 'another private organization' },
      'rendered_organization_matches_storage',
    ],
  ]) {
    const checks = settingsIdentityDiagnostic({ ...observed, ...change }, expected);
    assert.equal(checks.identity_ready, false);
    assert.equal(checks[failedCheck], false);
    assert.ok(Object.values(checks).every((value) => typeof value === 'boolean'));
    assert.equal(JSON.stringify(checks).includes('private'), false);
    assert.equal(JSON.stringify(checks).includes(profileId), false);
    assert.equal(JSON.stringify(checks).includes(organizationId), false);
  }
});

test('load-ladder selection is allowed without a stored device choice', () => {
  const checks = settingsIdentityDiagnostic(
    { ...observed, organizationId: null, organizationName: null },
    { ...expected, organizationId: null },
  );
  assert.equal(checks.identity_ready, true);
  assert.equal(checks.expected_device_choice_absent, true);
  assert.equal(checks.stored_device_choice_absent, true);
  assert.equal(checks.rendered_organization_selected, true);
  assert.equal(checks.organization_matches, true);
});

test('only the member rendered-identity timeout records the caller diagnostic', async () => {
  let reads = 0;
  const panel = {};
  const readDiagnostic = async (actualPanel, actualExpected) => {
    reads += 1;
    assert.equal(actualPanel, panel);
    assert.equal(actualExpected, expected);
    return { identity_ready: false, email_matches: false };
  };
  const input = {
    panel,
    mode: 'member',
    operation: 'settings_ready',
    failureCode: 'd87_rendered_identity_not_observed',
    expected,
    readDiagnostic,
  };
  for (const rejected of [
    { failureCode: 'd87_settings_ready_not_observed' },
    { failureCode: 'd87_assertion_failed' },
    { operation: 'settings_click' },
    { mode: 'guest' },
  ]) {
    const report = {};
    await recordSettingsIdentityFailure({ ...input, ...rejected, report });
    assert.equal(reads, 0);
    assert.equal(Object.hasOwn(report, 'failure_identity_checks'), false);
  }
  const report = {};
  await recordSettingsIdentityFailure({ ...input, report });
  assert.equal(reads, 1);
  assert.deepEqual(report.failure_identity_checks, {
    identity_ready: false,
    email_matches: false,
  });
});
