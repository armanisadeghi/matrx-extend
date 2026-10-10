import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { hostedDesktopSettingsCase } from './hosted-desktop-settings-route.mjs';

test('hosted Desktop Settings selects remaining only for guest', () => {
  assert.equal(hostedDesktopSettingsCase('desktop-settings-guest', 'remaining'), 'remaining');
  assert.equal(hostedDesktopSettingsCase('desktop-settings-member', 'full'), 'full');
  assert.equal(hostedDesktopSettingsCase('desktop-settings-admin', undefined), 'full');
  for (const acceptanceCase of ['desktop-settings-member', 'desktop-settings-admin', 'guest-chat'])
    assert.throws(
      () => hostedDesktopSettingsCase(acceptanceCase, 'remaining'),
      /hosted_desktop_remaining_guest_only/,
    );
  assert.throws(
    () => hostedDesktopSettingsCase('desktop-settings-guest', 'reset-census'),
    /hosted_desktop_settings_case_refused/,
  );
});

test('hosted Desktop Settings selects the bounded pair-forget case only for guest', () => {
  assert.equal(hostedDesktopSettingsCase('desktop-settings-guest', 'pair-forget'), 'pair-forget');
  for (const acceptanceCase of ['desktop-settings-member', 'desktop-settings-admin', 'guest-chat'])
    assert.throws(
      () => hostedDesktopSettingsCase(acceptanceCase, 'pair-forget'),
      /hosted_desktop_pair_forget_guest_only/,
    );
});

test('hosted preflight rejects invalid Desktop Settings selection before setup', () => {
  for (const [acceptanceCase, selectedCase, error] of [
    ['desktop-settings-member', 'remaining', 'hosted_desktop_remaining_guest_only'],
    ['desktop-settings-member', 'pair-forget', 'hosted_desktop_pair_forget_guest_only'],
    ['desktop-settings-guest', 'reset-census', 'hosted_desktop_settings_case_refused'],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
      env: {
        GITHUB_ACTIONS: 'true',
        MATRX_HOSTED_PHASE: 'preflight',
        MATRX_HOSTED_ACCEPTANCE_CASE: acceptanceCase,
        MATRX_HOSTED_DESKTOP_SETTINGS_CASE: selectedCase,
      },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(error));
    assert.doesNotMatch(result.stderr, /hosted phase requires owned resource permit/);
  }
});

test('hosted guest pair-forget passes preflight without member or admin credentials', () => {
  const result = spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
    env: {
      GITHUB_ACTIONS: 'true',
      MATRX_HOSTED_PHASE: 'preflight',
      MATRX_HOSTED_ACCEPTANCE_CASE: 'desktop-settings-guest',
      MATRX_HOSTED_DESKTOP_SETTINGS_CASE: 'pair-forget',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HOSTED_CREDENTIAL_PREFLIGHT_READY/);
});

test('hosted guest remaining passes preflight without a member or admin credential', () => {
  const result = spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
    env: {
      GITHUB_ACTIONS: 'true',
      MATRX_HOSTED_PHASE: 'preflight',
      MATRX_HOSTED_ACCEPTANCE_CASE: 'desktop-settings-guest',
      MATRX_HOSTED_DESKTOP_SETTINGS_CASE: 'remaining',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HOSTED_CREDENTIAL_PREFLIGHT_READY/);
});
