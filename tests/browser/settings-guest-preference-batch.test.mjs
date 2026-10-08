import assert from 'node:assert/strict';
import test from 'node:test';
import { GUEST_PREFERENCES, preferenceMatches } from './settings-guest-preference-batch.mjs';

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
    }
  }
});
