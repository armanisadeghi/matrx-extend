import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GUEST_PREFERENCES,
  guestChatDefaultMatches,
  preferenceMatches,
} from './settings-guest-preference-batch.mjs';

test('guest Settings preference evidence requires matching visible and persisted values', () => {
  for (const preference of GUEST_PREFERENCES) {
    for (const [value, label] of preference.choices) {
      const valid = {
        activeSettings: true,
        count: 1,
        selected: label,
        stored: value,
        systemDark: false,
        darkClass: value === 'dark',
        renderedBackgroundMatches: true,
      };
      assert.equal(preferenceMatches(valid, preference, value, label), true);
      assert.equal(
        preferenceMatches({ ...valid, stored: 'wrong' }, preference, value, label),
        false,
      );
      assert.equal(
        preferenceMatches({ ...valid, selected: 'wrong' }, preference, value, label),
        false,
      );
      assert.equal(
        preferenceMatches({ ...valid, activeSettings: false }, preference, value, label),
        false,
      );
      assert.equal(preferenceMatches({ ...valid, count: 2 }, preference, value, label), false);
      if (preference.key === 'theme')
        assert.equal(
          preferenceMatches({ ...valid, darkClass: !valid.darkClass }, preference, value, label),
          false,
        );
      if (preference.key === 'theme')
        assert.equal(
          preferenceMatches(
            { ...valid, renderedBackgroundMatches: false },
            preference,
            value,
            label,
          ),
          false,
          'theme preference must reach the rendered page background',
        );
    }
  }
});

test('guest new chat exposes both selected default modes through their real mode controls', () => {
  for (const [mode, modeLabel, icon] of [
    ['act', 'Act without asking', 'act'],
    ['ask', 'Ask before acting', 'ask'],
  ]) {
    const observed = {
      activeChat: true,
      newChatCount: 1,
      modeControlCount: 1,
      modeLabel,
      modeIcon: icon,
    };
    assert.equal(guestChatDefaultMatches(observed, mode, modeLabel), true);
    assert.equal(
      guestChatDefaultMatches(
        { ...observed, modeIcon: icon === 'act' ? 'ask' : 'act' },
        mode,
        modeLabel,
      ),
      false,
      `mode icon must match ${mode}`,
    );
    assert.equal(
      guestChatDefaultMatches(
        { ...observed, modeLabel: mode === 'act' ? 'Ask before acting' : 'Act without asking' },
        mode,
        modeLabel,
      ),
      false,
      `mode label must match ${mode}`,
    );
  }
  assert.equal(guestChatDefaultMatches({ activeChat: false }, 'ask', 'Ask before acting'), false);
  assert.equal(
    guestChatDefaultMatches({ activeChat: true, newChatCount: 0 }, 'ask', 'Ask before acting'),
    false,
  );
});
