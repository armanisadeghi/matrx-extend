import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GUEST_PRIVACY_SWITCHES,
  nextPrivacyRestoreClick,
  privacySwitchMatches,
  runGuestPrivacySwitchCase,
} from './settings-guest-privacy-batch.mjs';

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
      assert.equal(nextPrivacyRestoreClick(valid, preference, expected), null);
      assert.equal(
        nextPrivacyRestoreClick({ ...valid, checked: !expected }, preference, expected),
        expected,
      );
      assert.equal(
        nextPrivacyRestoreClick({ ...valid, stored: 'wrong' }, preference, expected),
        !expected,
      );
      assert.throws(
        () => nextPrivacyRestoreClick({ ...valid, checked: null }, preference, expected),
        /cleanup_switch_unreadable/,
      );
    }
  }
});

function panelBoundary(
  preference,
  { baselineMismatch = false, ignoreClick = false, ignoreClickAt = 0, failReloadOnce = false } = {},
) {
  let checked = true;
  let stored = baselineMismatch ? false : preference.caseId === 'T34' ? 'on_page' : true;
  let reloads = 0;
  const clicks = [];
  const records = [];
  const operations = {
    signedOut: async () => true,
    openSection: async (_panel, label) => assert.equal(label, 'Privacy'),
    observe: async () => ({
      activeSettings: true,
      privacyOpen: true,
      count: 1,
      checked,
      stored,
      saveError: false,
    }),
    click: async (_panel, kind, label) => {
      assert.equal(kind, 'switch');
      assert.equal(label, preference.label, 'a wrong switch target must fail');
      clicks.push(label);
      if (!ignoreClick && clicks.length !== ignoreClickAt) {
        checked = !checked;
        stored = preference.caseId === 'T34' ? (checked ? 'on_page' : 'quiet') : checked;
      }
    },
    reloadSettings: async () => {
      reloads++;
      if (failReloadOnce && reloads === 1) throw new Error('controlled_reload_failure');
    },
    waitFor: async (label, read, accept) => {
      const value = await read();
      assert.equal(accept(value), true, `${label}_condition_not_met`);
      return value;
    },
  };
  return {
    operations,
    record: (...entry) => records.push(entry),
    snapshot: () => ({ checked, stored, reloads, clicks, records }),
  };
}

test('native Privacy runner clicks both states, reloads each, and restores the original setting', async () => {
  for (const preference of [GUEST_PRIVACY_SWITCHES[0], GUEST_PRIVACY_SWITCHES[3]]) {
    const boundary = panelBoundary(preference);
    await runGuestPrivacySwitchCase(
      null,
      async () => {},
      preference,
      boundary.record,
      boundary.operations,
    );
    const result = boundary.snapshot();
    assert.equal(result.checked, true);
    assert.equal(result.stored, preference.caseId === 'T34' ? 'on_page' : true);
    assert.equal(result.clicks.length, 2);
    assert.equal(result.reloads, 4, 'two behavior reloads plus cleanup reentry and verification');
    assert.deepEqual(
      result.records.map(([phase]) => phase),
      ['warm', 'reload', 'warm', 'reload'],
    );
  }
});

test('native Privacy runner refuses a mismatched baseline before any click', async () => {
  const preference = GUEST_PRIVACY_SWITCHES[0];
  const boundary = panelBoundary(preference, { baselineMismatch: true });
  await assert.rejects(
    runGuestPrivacySwitchCase(
      null,
      async () => {},
      preference,
      boundary.record,
      boundary.operations,
    ),
    /requires_matching_ui_and_persisted_baseline/,
  );
  assert.equal(boundary.snapshot().clicks.length, 0);
});

test('native Privacy runner rejects an ignored click instead of recording a pass', async () => {
  const preference = GUEST_PRIVACY_SWITCHES[0];
  const boundary = panelBoundary(preference, { ignoreClick: true });
  await assert.rejects(
    runGuestPrivacySwitchCase(
      null,
      async () => {},
      preference,
      boundary.record,
      boundary.operations,
    ),
    /condition_not_met/,
  );
  assert.equal(boundary.snapshot().records.length, 0);
  assert.equal(boundary.snapshot().checked, true);
});

test('native Privacy runner reenters after reload failure and restores stored value', async () => {
  const preference = GUEST_PRIVACY_SWITCHES[3];
  const boundary = panelBoundary(preference, { failReloadOnce: true });
  await assert.rejects(
    runGuestPrivacySwitchCase(
      null,
      async () => {},
      preference,
      boundary.record,
      boundary.operations,
    ),
    /controlled_reload_failure/,
  );
  const result = boundary.snapshot();
  assert.equal(result.checked, true);
  assert.equal(result.stored, 'on_page');
  assert.equal(result.reloads, 3);
  assert.equal(result.clicks.length, 2);
});

test('native Privacy runner fails when the cleanup click cannot restore storage', async () => {
  const preference = GUEST_PRIVACY_SWITCHES[3];
  const boundary = panelBoundary(preference, { failReloadOnce: true, ignoreClickAt: 2 });
  await assert.rejects(
    runGuestPrivacySwitchCase(
      null,
      async () => {},
      preference,
      boundary.record,
      boundary.operations,
    ),
    /cleanup_true_condition_not_met/,
  );
  assert.equal(boundary.snapshot().stored, 'quiet');
});
