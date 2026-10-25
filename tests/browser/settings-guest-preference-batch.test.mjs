import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import {
  GUEST_PREFERENCES,
  guestChatDefaultExpression,
  guestChatDefaultMatches,
  observeGuestNewChatDefault,
  observeGuestPreference,
  preferenceMatches,
  runGuestPreferenceCase,
  runGuestThemeRenderingProbe,
} from './settings-guest-preference-batch.mjs';
import { chatToolsCandidatesExpression } from './settings-panel-driver.mjs';

// SUT owns traversal and DOM observation; browser layout/input are external seams.
// Captured semantics: chat 0.8.370 DeviceToolsModeRow / PicksSwitchRow.
function chatModeFixture(checked = 'false') {
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" data-matrx-title="Chat"
    data-state="active" aria-controls="chat-pane"></button>
    <div id="chat-pane" role="tabpanel" data-state="active">
      <button title="New chat"></button><button title="Chat Options" aria-controls="fixture-options" aria-expanded="true"></button>
    </div><div id="fixture-options"><button aria-expanded="true">Tools</button></div><div data-composer-panel><label>Ask before acting<span>All chats</span>
      <button role="switch" aria-label="Ask before acting" aria-checked="${checked}"></button>
    </label></div>`;
  const read = () =>
    runInNewContext(guestChatDefaultExpression(), {
      document: window.document,
      getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    });
  for (const node of window.document.querySelectorAll('*'))
    node.getBoundingClientRect = () => ({ width: 100, height: 30 });
  return { window, read };
}

test('Tools traversal selects package portal doors and excludes outer navigation and hidden copies', async () => {
  const f = chatModeFixture();
  try {
    const document = f.window.document;
    const read = () =>
      runInNewContext(chatToolsCandidatesExpression(), {
        document,
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
      });
    document.getElementById('fixture-options').remove();
    document.body.innerHTML += `<button role="tab">Tools</button>
      <div role="dialog" aria-label="Add to chat" id="options"><button><span><span>Tools</span></span><span>3</span></button></div>
      <div role="dialog" aria-label="Unrelated"><button>Tools</button></div>
      <div role="dialog" aria-label="Tools" hidden><button>Tools</button></div>`;
    document.querySelector('[title="Chat Options"]').setAttribute('aria-controls', 'options');
    for (const node of document.querySelectorAll('*'))
      node.getBoundingClientRect = () => ({ width: 100, height: 30 });
    assert.equal(read().length, 1);
    document.getElementById('options').remove();
    assert.equal(read().length, 0);
    document.body.innerHTML +=
      '<div id="options"><div role="tablist" aria-label="Run controls"><button role="tab">Tools</button></div></div>';
    for (const node of document.querySelectorAll('*'))
      node.getBoundingClientRect = () => ({ width: 100, height: 30 });
    assert.equal(read().length, 1);
  } finally {
    await f.window.happyDOM.abort();
  }
});

test('Chat default observes actual Ask switch for both values and rejects stale or ambiguous controls', async () => {
  const f = chatModeFixture();
  try {
    const control = f.window.document.querySelector('[role="switch"]');
    assert.deepEqual(
      Array.from(
        ['activeChat', 'newChatCount', 'modeControlCount', 'permissionMode'],
        (key) => f.read()[key],
      ),
      [true, 1, 1, 'act'],
    );
    control.setAttribute('aria-checked', 'true');
    assert.equal(f.read().permissionMode, 'ask');
    control.setAttribute('aria-checked', 'mixed');
    assert.equal(f.read().permissionMode, null);
    control.setAttribute('aria-checked', 'false');
    const duplicate = control.cloneNode(true);
    duplicate.getBoundingClientRect = () => ({ width: 100, height: 30 });
    control.parentElement.appendChild(duplicate);
    assert.equal(f.read().modeControlCount, 2);
    assert.equal(f.read().permissionMode, null);
    control.parentElement.lastElementChild.remove();
    f.window.document
      .querySelector('#fixture-options button')
      .setAttribute('aria-expanded', 'false');
    assert.equal(f.read().modeControlCount, 0, 'stale singleton without opened Tools is refused');
    f.window.document
      .querySelector('#fixture-options button')
      .setAttribute('aria-expanded', 'true');
    control.setAttribute('hidden', '');
    assert.equal(f.read().modeControlCount, 0);
    control.removeAttribute('hidden');
    f.window.document.getElementById('chat-pane').setAttribute('data-state', 'inactive');
    assert.equal(f.read().activeChat, false);
    f.window.document.getElementById('chat-pane').setAttribute('data-state', 'active');
    control.parentElement.parentElement.removeAttribute('data-composer-panel');
    assert.equal(f.read().modeControlCount, 0, 'unrelated singleton switch is not Tools evidence');
    control.remove();
    f.window.document.getElementById('chat-pane').innerHTML +=
      '<button title="Tool permission mode"><svg class="lucide-zap"></svg>Act without asking</button>';
    assert.equal(f.read().modeControlCount, 0);
    assert.equal(f.read().permissionMode, null);
    f.window.document.querySelector('[role="tab"]').setAttribute('aria-controls', 'wrong-pane');
    assert.equal(f.read().activeChat, false);
  } finally {
    await f.window.happyDOM.abort();
  }
});

test('mode observation assertions reject constant and inverted checked-state mutants', async () => {
  const f = chatModeFixture();
  try {
    const control = f.window.document.querySelector('[role="switch"]');
    const verify = (expression) => {
      const read = () =>
        runInNewContext(expression, {
          document: f.window.document,
          getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
        });
      control.setAttribute('aria-checked', 'false');
      assert.equal(read().permissionMode, 'act');
      control.setAttribute('aria-checked', 'true');
      assert.equal(read().permissionMode, 'ask');
    };
    verify(guestChatDefaultExpression());
    assert.throws(() => verify(`({ permissionMode: 'act' })`), assert.AssertionError);
    assert.throws(
      () =>
        verify(
          guestChatDefaultExpression().replace(
            "permissionMode: checked === 'true' ? 'ask' : checked === 'false' ? 'act'",
            "permissionMode: checked === 'true' ? 'act' : checked === 'false' ? 'ask'",
          ),
        ),
      assert.AssertionError,
    );
  } finally {
    await f.window.happyDOM.abort();
  }
});

test('fresh Chat default traverses Chat Options and Tools without clicking the mode switch', async () => {
  const f = chatModeFixture();
  try {
    const events = [];
    let toolsOpen = false;
    let optionsOpen = false;
    const driver = {
      pressEscape: async () => {
        toolsOpen = false;
        optionsOpen = false;
        events.push(['key', 'Escape']);
      },
      click: async (_panel, kind, label) => {
        events.push([kind, label]);
        if (label === 'Chat Options') optionsOpen = true;
        if (kind === 'chat-tools') toolsOpen = true;
      },
      evaluate: async (_panel, script) =>
        script.includes('toolsEntryCount')
          ? { toolsEntryCount: 1 }
          : {
              ...f.read(),
              modeControlCount: toolsOpen ? 1 : 0,
              optionsOpen,
              ownedPopupOpen: optionsOpen,
              composerPanelCount: toolsOpen ? 1 : 0,
              optionsSheetCount: 0,
            },
      waitFor: async (label, read, accept) => {
        const value = await read();
        assert.equal(accept(value), true, label);
        return value;
      },
    };
    assert.equal(
      (await observeGuestNewChatDefault({}, 'act', 'Act without asking', driver)).permissionMode,
      'act',
    );
    assert.deepEqual(events, [
      ['title', 'Chat'],
      ['title', 'New chat'],
      ['title', 'Chat Options'],
      ['chat-tools', 'Tools'],
      ['key', 'Escape'],
    ]);
    await assert.rejects(
      observeGuestNewChatDefault({}, 'ask', 'Ask before acting', driver),
      /guest_new_chat_default_mode/,
    );
    assert.equal(toolsOpen, false, 'mismatch still closes Tools');
    const entryFailure = {
      ...driver,
      evaluate: async (_panel, script) =>
        script.includes('toolsEntryCount')
          ? { toolsEntryCount: 0 }
          : driver.evaluate(_panel, script),
    };
    await assert.rejects(
      observeGuestNewChatDefault({}, 'act', 'Act without asking', entryFailure),
      /guest_chat_tools_entry_ready/,
    );
    assert.equal(
      optionsOpen,
      false,
      'missing Tools entry closes parent menu even without a switch',
    );
    const openingFailure = {
      ...driver,
      click: async (panel, kind, label) => {
        await driver.click(panel, kind, label);
        if (label === 'Chat Options') throw new Error('options_open_dispatch_failed');
      },
    };
    await assert.rejects(
      observeGuestNewChatDefault({}, 'act', 'Act without asking', openingFailure),
      /options_open_dispatch_failed/,
    );
    assert.equal(optionsOpen, false, 'opening dispatch failure still dismisses its menu');
    for (const field of [
      'optionsOpen',
      'ownedPopupOpen',
      'composerPanelCount',
      'optionsSheetCount',
    ]) {
      const noOpEscape = {
        ...entryFailure,
        pressEscape: async () => {},
        evaluate: async (_panel, script) =>
          script.includes('toolsEntryCount')
            ? { toolsEntryCount: 0 }
            : {
                ...f.read(),
                modeControlCount: 0,
                optionsOpen: false,
                ownedPopupOpen: false,
                composerPanelCount: 0,
                optionsSheetCount: 0,
                [field]: optionsOpen
                  ? field.endsWith('Count')
                    ? 1
                    : true
                  : field.endsWith('Count')
                    ? 0
                    : false,
              },
      };
      await assert.rejects(
        observeGuestNewChatDefault({}, 'act', 'Act without asking', noOpEscape),
        (error) =>
          error.message.includes('guest_chat_tools_entry_ready') && error.cleanupFailed === true,
        `no-op Escape must detect remaining ${field} even with no switch`,
      );
      optionsOpen = false;
    }
    const cleanupDriver = {
      ...driver,
      pressEscape: async () => {
        throw new Error('escape_failed');
      },
    };
    await assert.rejects(
      observeGuestNewChatDefault({}, 'ask', 'Ask before acting', cleanupDriver),
      (error) =>
        error.message.includes('guest_new_chat_default_mode') && error.cleanupFailed === true,
    );
    toolsOpen = false;
    optionsOpen = false;
    await assert.rejects(
      observeGuestNewChatDefault({}, 'act', 'Act without asking', cleanupDriver),
      /escape_failed/,
    );
  } finally {
    await f.window.happyDOM.abort();
  }
});

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
      permissionMode: icon,
    };
    assert.equal(guestChatDefaultMatches(observed, mode, modeLabel), true);
    assert.equal(
      guestChatDefaultMatches(
        { ...observed, permissionMode: icon === 'act' ? 'ask' : 'act' },
        mode,
        modeLabel,
      ),
      false,
      `switch mode must match ${mode}`,
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

test('T10 guest Ask is refused, visibly reverted, and remains Act after panel reload', async () => {
  const preference = GUEST_PREFERENCES.find((item) => item.caseId === 'T10');
  const state = {
    activeSettings: true,
    count: 1,
    selected: 'Act without asking',
    stored: null,
    storedPresent: false,
    storagePresent: false,
    saveRefusal: false,
  };
  const clicks = [];
  const driver = {
    openSection: async () => {},
    click: async (_panel, kind, label) => {
      if (kind !== 'option') return;
      clicks.push(label);
      state.saveRefusal = true;
    },
    evaluate: async (_panel, script) => {
      return { ...state };
    },
    waitFor: async (label, read, accept) => {
      const value = await read();
      if (!accept(value)) throw new Error(`${label}_not_observed`);
      return value;
    },
  };
  await runGuestPreferenceCase(
    null,
    async () => {},
    preference,
    () => {},
    async () => {},
    driver,
  );
  assert.deepEqual(clicks, ['Ask before acting']);
  assert.equal(state.saveRefusal, true);
  assert.deepEqual(
    [state.selected, state.stored, state.storedPresent, state.storagePresent],
    ['Act without asking', null, false, false],
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
      selected: 'Act without asking',
      stored: null,
      storedPresent: false,
      storagePresent: false,
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
  assert.equal(baselines.T10.value, 'act');
  assert.equal(baselines.T10.storedPresent, false);
  assert.equal(baselines.T10.storagePresent, false);
  assert.equal(preferenceBaselineMatches(state.T10, mode, baselines.T10), true);
  assert.equal(
    preferenceBaselineMatches(
      {
        ...state.T10,
        stored: 'ask',
        selected: 'Ask before acting',
        storedPresent: true,
        storagePresent: true,
      },
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
