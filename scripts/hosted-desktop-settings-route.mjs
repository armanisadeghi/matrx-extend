import assert from 'node:assert/strict';

export function hostedDesktopSettingsCase(acceptanceCase, selectedCase) {
  const value = selectedCase || 'full';
  assert.ok(['full', 'remaining'].includes(value), 'hosted_desktop_settings_case_refused');
  if (value === 'remaining')
    assert.equal(acceptanceCase, 'desktop-settings-guest', 'hosted_desktop_remaining_guest_only');
  return value;
}
