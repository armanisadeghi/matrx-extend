import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { runGuestChatVersionReopen } from './settings-chat-version-reopen.mjs';

// These dependency-level guards exercise the procedure; they are not native proof.
for (const original of ['Current', 'New']) {
  test(`T93 procedure exercises both choices and restores ${original} through replacement panels`, async () => {
    const events = [];
    let selected = original;
    let stored = original === 'Current' ? 'default' : 'package';
    let generation = 0;
    let failNextDetach = false;
    const makePanel = () => ({
      generation,
      detach: async () => {
        if (failNextDetach) {
          failNextDetach = false;
          throw new Error('retired session');
        }
      },
    });
    const observe = async (panel) => {
      assert.equal(panel.generation, generation, 'reads must use the replacement session');
      return { activeSettings: true, count: 1, selected, stored, storedPresent: true };
    };
    const run = (losePersistence = false) =>
      runGuestChatVersionReopen({
        panel: makePanel(),
        settings: async () => {},
        acquireLivePanel: async () => makePanel(),
        cyclePanel: async () => {
          events.push(`cycle:${selected}`);
          generation++;
          if (losePersistence) stored = null;
          return { panel: makePanel(), evidence: { targetReplaced: true } };
        },
        record: (phase, action, _observation, passed) =>
          events.push(`${phase}:${passed}:${action}`),
        driver: {
          openSection: async () => {},
          observe,
          click: async (_panel, kind, label) => {
            if (kind !== 'option') return;
            selected = label;
            stored = label === 'Current' ? 'default' : 'package';
            events.push(`select:${label}`);
          },
          waitFor: async (_name, read, accepts) => {
            const state = await read();
            assert.equal(accepts(state), true, 'saved value must survive reopen');
            return state;
          },
        },
      });
    await run();
    assert.deepEqual(
      events.filter((entry) => entry.startsWith('cycle:')),
      ['cycle:New', 'cycle:Current', `cycle:${original}`],
    );
    assert.deepEqual(
      events.filter((entry) => entry.startsWith('select:')),
      ['select:New', 'select:Current', `select:${original}`],
    );
    assert.equal(selected, original);
    assert.equal(stored, original === 'Current' ? 'default' : 'package');
    assert.equal(
      events.filter(
        (entry) =>
          entry.startsWith('panel-reopen:true:') && entry.includes('selector and saved value'),
      ).length,
      2,
    );
    events.length = 0;
    await assert.rejects(run(true), /saved value must survive reopen/);
    assert.ok(
      events.includes(`select:${original}`),
      'restoration must still be attempted after failure',
    );
    assert.ok(events.some((entry) => entry.startsWith('preference-restoration:false:')));
    events.length = 0;
    // A retired transport must not prevent the real selector restoration attempt.
    selected = original;
    stored = original === 'Current' ? 'default' : 'package';
    failNextDetach = true;
    await assert.rejects(run(), /T93_panel_detach_failed/);
    assert.equal(selected, original);
    assert.equal(stored, original === 'Current' ? 'default' : 'package');
    assert.ok(events.some((entry) => entry.startsWith('cleanup:false:')));
    assert.ok(
      events.some(
        (entry) =>
          entry.startsWith('preference-restoration:true:') &&
          entry.includes('selector and saved value'),
      ),
    );
  });
}
import {
  GUEST_PREFERENCES,
  guestChatDefaultMatches,
  observeGuestPreference,
  preferenceMatches,
  runGuestPreferenceCase,
  runGuestThemeRenderingProbe,
} from './settings-guest-preference-batch.mjs';

function themeProbeFixture({
  failOptionOnce,
  unpersistedBaseline = false,
  storagePresent = true,
  accurateAppearance = false,
} = {}) {
  const preference = GUEST_PREFERENCES.find((candidate) => candidate.caseId === 'T04');
  const settingsStorage = storagePresent
    ? { 'matrx.settings.v1': JSON.stringify({ state: { sentinel: 'keep-me' } }) }
    : {};
  let current = themeObservation(
    unpersistedBaseline ? 'system' : 'light',
    !unpersistedBaseline,
    storagePresent,
    accurateAppearance,
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
      current = themeObservation(value, true, true, accurateAppearance);
    },
    evaluate: async (_panel, script) => {
      if (script.includes('const originalStoragePresent =')) {
        await runInNewContext(script, {
          chrome: {
            storage: {
              local: {
                get: async (key) => ({ [key]: settingsStorage[key] }),
                set: async (values) => Object.assign(settingsStorage, values),
                remove: async (keys) => {
                  for (const key of Array.isArray(keys) ? keys : [keys])
                    delete settingsStorage[key];
                },
              },
            },
          },
        });
        const serialized = settingsStorage['matrx.settings.v1'];
        const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : null;
        const storedPresent = Object.hasOwn(parsed?.state ?? {}, 'theme');
        current = themeObservation(
          current.value,
          storedPresent,
          typeof serialized === 'string',
          accurateAppearance,
        );
        return true;
      }
      return current;
    },
    waitFor: async (_label, read, accept) => {
      const observed = await read();
      if (!accept(observed)) throw new Error('theme_probe_wait_not_observed');
      return observed;
    },
    reload: async () => {
      const raw = settingsStorage['matrx.settings.v1'];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : null;
      const storedPresent = Object.hasOwn(parsed?.state ?? {}, 'theme');
      const value = storedPresent ? parsed.state.theme : current.value;
      current = themeObservation(value, storedPresent, typeof raw === 'string', accurateAppearance);
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

function themeObservation(
  value,
  storedPresent = true,
  storagePresent = true,
  accurateAppearance = false,
) {
  const dark = value === 'dark';
  return {
    activeSettings: true,
    count: 1,
    selected: { dark: 'Dark', light: 'Light', system: 'System' }[value],
    value,
    stored: storedPresent ? value : null,
    storedPresent,
    storagePresent,
    darkClass: dark,
    systemDark: false,
    renderedBackgroundMatches: accurateAppearance || !dark,
    renderedBackgrounds: {
      token: dark ? 'rgb(24, 24, 27)' : 'rgb(255, 255, 255)',
      body:
        dark && !accurateAppearance
          ? 'rgb(250, 250, 250)'
          : dark
            ? 'rgb(24, 24, 27)'
            : 'rgb(255, 255, 255)',
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

test('theme appearance probe resolves the product HSL channel token as a CSS color', async () => {
  const preference = GUEST_PREFERENCES.find((candidate) => candidate.key === 'theme');
  let script;
  await observeGuestPreference({}, preference, {
    evaluate: async (_panel, expression) => {
      script = expression;
      return null;
    },
  });

  const backgroundColor = script.match(/probe\.style\.backgroundColor = '([^']+)'/)?.[1];
  assert.equal(backgroundColor, 'hsl(var(--background))');
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

test('T04 restores the case-entry theme and rendered appearance after panel reload', async () => {
  const f = themeProbeFixture({ accurateAppearance: true });
  const observations = [];
  let reloads = 0;
  await runGuestPreferenceCase(
    {},
    async () => {
      reloads += 1;
      await f.driver.reload();
    },
    f.preference,
    (...entry) => observations.push(entry),
    async () => {},
    f.driver,
  );

  assert.equal(reloads, 4, 'three choice reloads plus the original-baseline reload');
  assert.deepEqual(f.optionClicks, ['Dark', 'Light', 'System', 'Light']);
  assert.equal(f.read().selected, 'Light');
  assert.equal(f.read().stored, 'light');
  assert.equal(f.read().renderedBackgroundMatches, true);
  assert.equal(
    observations.find(
      ([name]) => name === 'Original theme baseline restored after panel reload',
    )[2],
    true,
  );
});

test('T04 restores an originally implicit System value and absent theme key after panel reload', async () => {
  const f = themeProbeFixture({
    unpersistedBaseline: true,
    storagePresent: true,
    accurateAppearance: true,
  });
  const observations = [];
  let reloads = 0;
  await runGuestPreferenceCase(
    {},
    async () => {
      reloads += 1;
      await f.driver.reload();
    },
    f.preference,
    (...entry) => observations.push(entry),
    async () => {},
    f.driver,
  );

  assert.equal(reloads, 4, 'three choice reloads plus the original-baseline reload');
  assert.deepEqual(f.optionClicks, ['Dark', 'Light', 'System']);
  assert.equal(f.read().selected, 'System');
  assert.equal(f.read().stored, null);
  assert.equal(f.read().storedPresent, false);
  assert.equal(f.read().storagePresent, true);
  assert.equal(f.readStoredSettings().state.sentinel, 'keep-me');
  assert.equal(
    observations.find(
      ([name]) => name === 'Original theme baseline restored after panel reload',
    )[2],
    true,
  );
});

test('T04 restores the case-entry theme after a choice failure and preserves that failure', async () => {
  const f = themeProbeFixture({ failOptionOnce: 'Light', accurateAppearance: true });
  const observations = [];
  let reloads = 0;
  await assert.rejects(
    runGuestPreferenceCase(
      {},
      async () => {
        reloads += 1;
        await f.driver.reload();
      },
      f.preference,
      (...entry) => observations.push(entry),
      async () => {},
      f.driver,
    ),
    /simulated_theme_option_failure/,
  );

  assert.equal(reloads, 2, 'one completed choice reload plus baseline restoration reload');
  assert.deepEqual(f.optionClicks, ['Dark', 'Light', 'Light']);
  assert.equal(f.read().selected, 'Light');
  assert.equal(f.read().stored, 'light');
  assert.equal(f.read().renderedBackgroundMatches, true);
  assert.equal(
    observations.find(
      ([name]) => name === 'Original theme baseline restored after panel reload',
    )[2],
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

import { captureGuestPreferenceBaselines } from './settings-full-extension-rechecks.mjs';
import { runGuestChoicesAcrossExtensionRestarts } from './settings-guest-extension-rechecks.mjs';
import {
  preferenceBaseline,
  preferenceBaselineMatches,
  restoreGuestPreferenceBaseline,
} from './settings-guest-preference-batch.mjs';

test('T10 baseline is captured after T04 restores its original absent settings container', async () => {
  const theme = GUEST_PREFERENCES.find((item) => item.caseId === 'T04');
  const mode = GUEST_PREFERENCES.find((item) => item.caseId === 'T10');
  const state = {
    T04: {
      activeSettings: true,
      count: 1,
      selected: 'System',
      stored: 'system',
      storedPresent: true,
      storagePresent: true,
    },
    T10: {
      activeSettings: true,
      count: 1,
      selected: 'Ask before acting',
      stored: 'ask',
      storedPresent: true,
      storagePresent: true,
    },
  };
  const originalTheme = preferenceBaseline(
    {
      ...state.T04,
      stored: null,
      storedPresent: false,
      storagePresent: false,
      darkClass: false,
      systemDark: false,
      renderedBackgroundMatches: true,
    },
    theme,
  );
  const baselines = await captureGuestPreferenceBaselines({
    panel: {},
    preferences: [theme, mode],
    settings: async () => {},
    openSection: async () => {},
    observePreference: async (_panel, preference) => ({ ...state[preference.caseId] }),
    preferenceBaseline,
    caseEntryBaselines: { T04: originalTheme },
    restorePreferenceBaseline: async () => {
      state.T04 = { ...state.T04, stored: null, storedPresent: false, storagePresent: false };
      state.T10 = { ...state.T10, stored: null, storedPresent: false, storagePresent: false };
    },
  });
  assert.equal(baselines.T10.value, 'ask');
  assert.equal(baselines.T10.storedPresent, false);
  assert.equal(baselines.T10.storagePresent, false);
  assert.equal(preferenceBaselineMatches(state.T10, mode, baselines.T10), true);
  assert.equal(
    preferenceBaselineMatches(
      { ...state.T10, stored: 'ask', storedPresent: true, storagePresent: true },
      mode,
      baselines.T10,
    ),
    false,
  );
});

// The harness owns baseline capture/restoration/comparison; only browser I/O is a fixture.
for (const storagePresent of [false, true]) {
  for (const corruptReload of [false, true]) {
    test(`T04 carries absent-key case entry across late writes and full reload (container=${storagePresent}, corrupt=${corruptReload})`, async () => {
      const f = themeProbeFixture({
        unpersistedBaseline: true,
        storagePresent,
        accurateAppearance: true,
      });
      const entry = await runGuestPreferenceCase(
        {},
        () => f.driver.reload(),
        f.preference,
        () => {},
        async () => {},
        f.driver,
      );
      // A later Settings control can persist all defaults, including implicit System.
      await f.driver.click({}, 'option', 'System');
      const events = [];
      const baselines = await captureGuestPreferenceBaselines({
        panel: {},
        preferences: [f.preference],
        settings: async () => {},
        openSection: f.driver.openSection,
        observePreference: (panel, preference) =>
          observeGuestPreference(panel, preference, f.driver),
        preferenceBaseline,
        caseEntryBaselines: { T04: entry },
        restorePreferenceBaseline: (panel, preference, baseline) =>
          restoreGuestPreferenceBaseline(panel, preference, baseline, () => {}, f.driver),
      });
      assert.equal(baselines.T04.storedPresent, false);
      assert.equal(baselines.T04.storagePresent, storagePresent);
      assert.equal(f.read().storedPresent, false);
      let generation = 0;
      let panel = { targetId: 'initial' };
      const run = () =>
        runGuestChoicesAcrossExtensionRestarts({
          panel,
          section: 'Appearance',
          controlLabel: 'Theme',
          choices: f.preference.choices,
          baseline: baselines.T04,
          settings: async () => {},
          openSection: f.driver.openSection,
          read: (target) => observeGuestPreference(target, f.preference, f.driver),
          matches: (state, value, label) => preferenceMatches(state, f.preference, value, label),
          matchesBaseline: (state) => preferenceBaselineMatches(state, f.preference, baselines.T04),
          restoreBaseline: (target) =>
            restoreGuestPreferenceBaseline(target, f.preference, baselines.T04, () => {}, f.driver),
          driver: f.driver,
          record: (name, status, observation) => events.push({ name, status, observation }),
          reloadExtension: async () => {
            const absentBefore = f.read().storedPresent === false;
            await f.driver.reload();
            if (corruptReload && absentBefore) await f.driver.click({}, 'option', 'System');
            panel = { targetId: `replacement-${++generation}` };
            return {
              panel,
              management_reload_clicked: true,
              old_targets_retired: true,
              worker_replaced: true,
              panel_replaced: true,
              retirement_evidence: { timeline: { final_predicate: true } },
            };
          },
        });
      if (corruptReload) {
        await assert.rejects(run(), /full_extension_preference_or_restore_failed/);
        assert.equal(
          events.some(({ name }) => name === 'original preference restored after extension reload'),
          false,
        );
      } else {
        await run();
        assert.equal(generation, 3);
        const final = events.find(
          ({ name }) => name === 'original preference restored after extension reload',
        );
        assert.equal(final.status, 'pass');
        assert.equal(final.observation.selected, 'System');
        assert.equal(final.observation.stored, null);
        assert.equal(final.observation.storedPresent, false);
        assert.equal(final.observation.storagePresent, storagePresent);
        if (storagePresent) assert.equal(f.readStoredSettings().state.sentinel, 'keep-me');
      }
    });
  }
}
