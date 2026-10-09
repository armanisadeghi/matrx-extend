import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  GUEST_PREFERENCES,
  guestChatDefaultMatches,
  preferenceMatches,
  runGuestThemeRenderingProbe,
} from './settings-guest-preference-batch.mjs';

function themeProbeFixture({
  failOptionOnce,
  unpersistedBaseline = false,
  storagePresent = true,
} = {}) {
  const preference = GUEST_PREFERENCES.find((candidate) => candidate.caseId === 'T04');
  const settingsStorage = storagePresent
    ? { 'matrx.settings.v1': JSON.stringify({ state: { sentinel: 'keep-me' } }) }
    : {};
  let current = themeObservation(
    unpersistedBaseline ? 'system' : 'light',
    !unpersistedBaseline,
    storagePresent,
  );
  let failed = false;
  const optionClicks = [];
  const driver = {
    openSection: async (_panel, section) => assert.equal(section, 'Appearance'),
    click: async (_panel, kind, label) => {
      if (kind !== 'option') return;
      optionClicks.push(label);
      if (!failed && label === failOptionOnce) {
        failed = true;
        throw new Error('simulated_theme_option_failure');
      }
      const value = { Dark: 'dark', Light: 'light', System: 'system' }[label];
      const serialized = settingsStorage['matrx.settings.v1'];
      const saved = typeof serialized === 'string' ? JSON.parse(serialized) : { state: {} };
      saved.state.theme = value;
      settingsStorage['matrx.settings.v1'] = JSON.stringify(saved);
      current = themeObservation(value, true, true);
    },
    evaluate: async (_panel, script) => {
      if (script.includes('const originalStoragePresent =')) {
        await runInNewContext(script, {
          chrome: {
            storage: {
              local: {
                get: async (key) => ({ [key]: settingsStorage[key] }),
                set: async (values) => Object.assign(settingsStorage, values),
                remove: async (keys) =>
                  (Array.isArray(keys) ? keys : [keys]).forEach(
                    (key) => delete settingsStorage[key],
                  ),
              },
            },
          },
        });
        const serialized = settingsStorage['matrx.settings.v1'];
        const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : null;
        const storedPresent = Object.hasOwn(parsed?.state ?? {}, 'theme');
        current = themeObservation(current.value, storedPresent, typeof serialized === 'string');
        return true;
      }
      return current;
    },
    waitFor: async (_label, read, accept) => {
      const observed = await read();
      if (!accept(observed)) throw new Error('theme_probe_wait_not_observed');
      return observed;
    },
  };
  return {
    preference,
    driver,
    optionClicks,
    read: () => current,
    readStoredSettings: () => {
      const raw = settingsStorage['matrx.settings.v1'];
      return typeof raw === 'string' ? JSON.parse(raw) : undefined;
    },
  };
}

function themeObservation(value, storedPresent = true, storagePresent = true) {
  return {
    activeSettings: true,
    count: 1,
    selected: { dark: 'Dark', light: 'Light', system: 'System' }[value],
    value,
    stored: storedPresent ? value : null,
    storedPresent,
    storagePresent,
    darkClass: value === 'dark',
    systemDark: false,
    renderedBackgroundMatches: value !== 'dark',
    renderedBackgrounds: {
      token: value === 'dark' ? 'rgb(24, 24, 27)' : 'rgb(255, 255, 255)',
      body: value === 'dark' ? 'rgb(250, 250, 250)' : 'rgb(255, 255, 255)',
      root: 'rgba(0, 0, 0, 0)',
      activePanel: 'rgba(0, 0, 0, 0)',
    },
  };
}

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

test('isolated guest theme probe captures appearance mismatch and restores without reloading extension', async () => {
  const f = themeProbeFixture();
  const observations = [];
  await runGuestThemeRenderingProbe(
    {},
    f.preference,
    (...entry) => observations.push(entry),
    f.driver,
  );

  assert.deepEqual(f.optionClicks, ['Dark', 'Light', 'System', 'Light']);
  assert.equal(f.read().stored, 'light');
  assert.equal(f.read().selected, 'Light');
  assert.equal(
    observations.find(([name]) => name === 'Dark theme and computed appearance observed')[2],
    false,
  );
  assert.equal(
    observations.find(([name]) => name === 'Original theme selection and storage restored')[2],
    true,
  );
  assert.deepEqual(
    observations.find(([name]) => name === 'Dark theme and computed appearance observed')[1]
      .renderedBackgrounds,
    {
      token: 'rgb(24, 24, 27)',
      body: 'rgb(250, 250, 250)',
      root: 'rgba(0, 0, 0, 0)',
      activePanel: 'rgba(0, 0, 0, 0)',
    },
  );
});

test('isolated guest theme probe restores its baseline after a theme option driver error', async () => {
  const f = themeProbeFixture({ failOptionOnce: 'Light' });
  const observations = [];
  await assert.rejects(
    runGuestThemeRenderingProbe({}, f.preference, (...entry) => observations.push(entry), f.driver),
    /simulated_theme_option_failure/,
  );

  assert.deepEqual(f.optionClicks, ['Dark', 'Light', 'Light']);
  assert.equal(f.read().stored, 'light');
  assert.equal(f.read().selected, 'Light');
  assert.equal(
    observations.find(([name]) => name === 'Original theme selection and storage restored')[2],
    true,
  );
});

test('isolated guest theme probe restores a visible implicit baseline with no stored theme', async () => {
  const f = themeProbeFixture({ unpersistedBaseline: true, storagePresent: false });
  const observations = [];
  await runGuestThemeRenderingProbe(
    {},
    f.preference,
    (...entry) => observations.push(entry),
    f.driver,
  );

  assert.deepEqual(f.optionClicks, ['Dark', 'Light', 'System']);
  assert.equal(f.read().selected, 'System');
  assert.equal(f.read().stored, null);
  assert.equal(f.read().storedPresent, false);
  assert.equal(f.read().storagePresent, false);
  assert.equal(f.readStoredSettings(), undefined);
  assert.equal(
    observations.find(([name]) => name === 'Original theme selection and storage restored')[2],
    true,
  );
});

test('isolated guest theme probe preserves other stored settings when theme was never persisted', async () => {
  const f = themeProbeFixture({ unpersistedBaseline: true, storagePresent: true });
  const observations = [];
  await runGuestThemeRenderingProbe(
    {},
    f.preference,
    (...entry) => observations.push(entry),
    f.driver,
  );

  assert.equal(f.read().stored, null);
  assert.equal(f.read().storedPresent, false);
  assert.equal(f.read().storagePresent, true);
  assert.equal(f.readStoredSettings().state.sentinel, 'keep-me');
  assert.equal(Object.hasOwn(f.readStoredSettings().state, 'theme'), false);
  assert.equal(
    observations.find(([name]) => name === 'Original theme selection and storage restored')[2],
    true,
  );
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
