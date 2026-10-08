import assert from 'node:assert/strict';
import test from 'node:test';
import { GUEST_PRIVACY_SWITCHES, privacySwitchMatches } from './settings-guest-privacy-batch.mjs';

test('guest Privacy switch evidence requires actual UI and storage agreement for both values', () => {
  for (const preference of GUEST_PRIVACY_SWITCHES) {
    for (const expected of [true, false]) {
      const valid = {
        activeSettings: true,
        privacyOpen: true,
        count: 1,
        checked: expected,
        stored: preference.caseId === 'T34' ? (expected ? 'on_page' : 'quiet') : expected,
        saveError: false,
      };
      assert.equal(privacySwitchMatches(valid, preference, expected), true);
      assert.equal(
        privacySwitchMatches({ ...valid, checked: !expected }, preference, expected),
        false,
      );
      assert.equal(
        privacySwitchMatches({ ...valid, stored: 'wrong' }, preference, expected),
        false,
      );
      assert.equal(privacySwitchMatches({ ...valid, count: 0 }, preference, expected), false);
      assert.equal(
        privacySwitchMatches({ ...valid, privacyOpen: false }, preference, expected),
        false,
      );
      assert.equal(
        privacySwitchMatches({ ...valid, saveError: true }, preference, expected),
        false,
      );
    }
  }
});
