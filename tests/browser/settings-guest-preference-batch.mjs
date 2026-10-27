import assert from 'node:assert/strict';
import {
  activeTabPanelExpression,
  chatToolsCandidatesExpression,
  chatToolsContextExpression,
  click,
  evaluate,
  openSection,
  pressEscape,
  waitFor,
} from './settings-panel-driver.mjs';
import { preserveFailureDuringCleanup } from './settings-probe-cleanup.mjs';

const nativeDriver = { click, evaluate, openSection, waitFor, pressEscape };

// The three controls share one UI path, but each comparison uses its own
// fixed, external expectation. Only allowlisted preference values leave Chrome.
export const GUEST_PREFERENCES = [
  {
    caseId: 'T04',
    section: 'Appearance',
    label: 'Theme',
    key: 'theme',
    choices: [
      ['dark', 'Dark'],
      ['light', 'Light'],
      ['system', 'System'],
    ],
  },
  {
    caseId: 'T10',
    section: 'Chat',
    label: 'Default mode',
    key: 'defaultPermissionMode',
    choices: [
      ['act', 'Act without asking'],
      ['ask', 'Ask before acting'],
    ],
  },
  {
    caseId: 'T13',
    section: 'Chat',
    label: 'Default speed',
    key: 'defaultChatSpeed',
    choices: [
      ['thinking', 'Thinking'],
      ['fast', 'Fast'],
    ],
  },
];

export function preferenceMatches(observed, preference, value, label) {
  return (
    preferenceSelectionMatches(observed, value, label) &&
    (preference.key !== 'theme' ||
      (observed?.darkClass === (value === 'system' ? observed?.systemDark : value === 'dark') &&
        observed?.renderedBackgroundMatches === true))
  );
}

export function preferenceSelectionMatches(observed, value, label) {
  return (
    observed?.activeSettings === true &&
    observed?.count === 1 &&
    observed?.selected === label &&
    observed?.stored === value
  );
}

export function guestChatDefaultMatches(observed, expectedMode, expectedLabel) {
  return (
    observed?.activeChat === true &&
    observed?.newChatCount === 1 &&
    observed?.modeControlCount === 1 &&
    observed?.modeLabel === expectedLabel &&
    observed?.permissionMode === expectedMode
  );
}

export function guestChatDefaultExpression() {
  return `(() => {
    const pane = ${activeTabPanelExpression('Chat')};
    const context = ${chatToolsContextExpression()};
    const visible = (node) => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
        style.display !== 'none' && !node.closest('[inert], [hidden]');
    };
    const mode = [...new Set(context.modeRoots.flatMap((root) =>
      [...root.querySelectorAll('[role="switch"][aria-label="Ask before acting"]')]))]
      .filter((node) => visible(node) && [...(node.closest('label')?.querySelectorAll('span') ?? [])]
        .some((span) => span.textContent.trim() === 'All chats'));
    const newChat = [...(pane?.querySelectorAll('button[title="New chat"], button:not([title])[data-matrx-title="New chat"]') ?? [])];
    const activeChat = pane?.matches('[role="tabpanel"][data-state="active"]') === true;
    const composerContextObserved = activeChat && newChat.length === 1 && context.capabilities.length === 1;
    const checked = mode.length === 1 && context.modeRoots.length === 1 ? mode[0].getAttribute('aria-checked') : null;
    return { activeChat, composerContextObserved,
      newChatCount: newChat.length, capabilitiesCount: context.capabilities.length, modeControlCount: mode.length,
      optionsOpen: context.capabilities.some((button) => button.getAttribute('aria-expanded') === 'true'),
      ownedPopupOpen: context.menus.length > 0,
      composerPanelCount: context.composerPanels.length,
      optionsSheetCount: context.windows.length,
      modeLabel: checked === 'true' ? 'Ask before acting' : checked === 'false' ? 'Act without asking' : null,
      permissionMode: checked === 'true' ? 'ask' : checked === 'false' ? 'act' : null };
  })()`;
}

// One canonical cleanup boundary serves Settings restoration and popup dismissal.
export { preserveFailureDuringCleanup as withSettingsRestoration } from './settings-probe-cleanup.mjs';

export async function observeGuestNewChatDefault(
  panel,
  expectedMode,
  expectedLabel,
  driver = nativeDriver,
) {
  await driver.click(panel, 'title', 'Chat');
  const read = () => driver.evaluate(panel, guestChatDefaultExpression());
  await driver.waitFor(
    'guest_chat_default_mode_ready',
    read,
    (value) =>
      value?.composerContextObserved === true &&
      value.activeChat === true &&
      value.newChatCount === 1 &&
      value.optionsOpen === false &&
      value.ownedPopupOpen === false &&
      value.composerPanelCount === 0 &&
      value.optionsSheetCount === 0,
  );
  await driver.click(panel, 'title', 'New chat');
  return preserveFailureDuringCleanup(
    async () => {
      await driver.click(panel, 'chat-capabilities', 'Capabilities');
      await driver.waitFor(
        'guest_chat_tools_entry_ready',
        () =>
          driver.evaluate(
            panel,
            `(() => ({ toolsEntryCount: ${chatToolsCandidatesExpression()}.length }))()`,
          ),
        (value) => value?.toolsEntryCount === 1,
      );
      await driver.click(panel, 'chat-tools', 'Tools');
      await driver.waitFor(
        'guest_chat_tools_details_ready',
        () =>
          driver.evaluate(
            panel,
            `({ detailsEntryCount: (${chatToolsContextExpression()}).details.length })`,
          ),
        (value) => value?.detailsEntryCount === 1,
      );
      await driver.click(panel, 'chat-tools-details', 'Advanced or See all');
      return driver.waitFor('guest_new_chat_default_mode', read, (value) =>
        guestChatDefaultMatches(value, expectedMode, expectedLabel),
      );
    },
    async () => {
      // Escape must actually dismiss every observed composer surface.
      await driver.pressEscape(panel);
      await driver.waitFor(
        'guest_chat_options_closed',
        read,
        (value) =>
          value?.composerContextObserved === true &&
          value.modeControlCount === 0 &&
          value.optionsOpen === false &&
          value.ownedPopupOpen === false &&
          value.composerPanelCount === 0 &&
          value.optionsSheetCount === 0,
      );
    },
  );
}

// Derived from persisted settings and the explicit Ask carry-over's two stores.
// Only permission fields leave Chrome; per-agent keys are hashed in the panel.
function guestModeShadowExpression() {
  return `(async () => {
    const definitions = [
      ['settings', 'matrx.settings.v1', 'defaultPermissionMode'],
      ['chat', 'matrx.chat.v1', 'permissionMode'],
      ['pilot', 'matrx.pilot-chat.v1', 'permissionMode'],
    ];
    let values;
    try {
      values = await chrome.storage.local.get(definitions.map((entry) => entry[1]));
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error();
    } catch {
      return { status: 'unknown', stores: definitions.map(([store]) => ({ store,
        parseStatus: 'unavailable', storagePresent: null, fieldPresent: null, mode: null, fingerprint: null, count: null })) };
    }
    const stores = [];
    for (const [store, key, field] of definitions) {
      const storagePresent = Object.hasOwn(values, key);
      const result = { store, storagePresent, fieldPresent: false, parseStatus: storagePresent ? 'valid' : 'absent', mode: null, fingerprint: null, count: null };
      if (storagePresent) {
        try {
          const raw = values[key];
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
            !parsed.state || typeof parsed.state !== 'object' || Array.isArray(parsed.state)) throw new Error();
          result.fieldPresent = Object.hasOwn(parsed.state, field);
          if (result.fieldPresent) {
            const value = parsed.state[field];
            if (store === 'settings') {
              if (!['ask', 'act'].includes(value)) throw new Error();
              result.mode = value;
            } else {
              if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
              const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
              if (entries.some(([, mode]) => !['ask', 'act'].includes(mode))) throw new Error();
              const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entries)));
              result.fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
              result.count = entries.length;
            }
          }
        } catch {
          result.parseStatus = 'invalid'; result.fieldPresent = null;
          result.mode = null; result.fingerprint = null; result.count = null;
        }
      }
      stores.push(result);
    }
    return { status: stores.every((entry) => ['valid', 'absent'].includes(entry.parseStatus)) ? 'observed' : 'unknown', stores };
  })()`;
}

export function guestModeShadowMatches(observed, baseline) {
  const valid = (value) =>
    value?.status === 'observed' &&
    Array.isArray(value.stores) &&
    value.stores.length === 3 &&
    value.stores.every(
      (entry, index) =>
        entry.store === ['settings', 'chat', 'pilot'][index] &&
        ['valid', 'absent'].includes(entry.parseStatus) &&
        typeof entry.storagePresent === 'boolean' &&
        typeof entry.fieldPresent === 'boolean',
    );
  return (
    valid(observed) && valid(baseline) && JSON.stringify(observed) === JSON.stringify(baseline)
  );
}

export async function observeGuestPreference(panel, preference, driver = nativeDriver) {
  return driver.evaluate(
    panel,
    `(async () => {
    const pane = ${activeTabPanelExpression('Settings')};
    const rows = [...(pane?.querySelectorAll('span') ?? [])]
      .filter((node) => node.textContent.trim() === ${JSON.stringify(preference.label)});
    const triggers = rows.flatMap((row) => [...row.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
    const shadowFootprint = ${JSON.stringify(preference.caseId)} === 'T10' ? await ${guestModeShadowExpression()} : null;
    const raw = shadowFootprint ? null : (await chrome.storage.local.get('matrx.settings.v1'))['matrx.settings.v1'];
    let value = null;
    let storedPresent = false;
    try {
      const state = JSON.parse(raw).state;
      storedPresent = Object.hasOwn(state ?? {}, ${JSON.stringify(preference.key)});
      value = state?.[${JSON.stringify(preference.key)}] ?? null;
    } catch {}
    if (shadowFootprint) {
      value = shadowFootprint.stores[0].mode;
      storedPresent = shadowFootprint.stores[0].fieldPresent;
    }
    const allowed = ${JSON.stringify(preference.choices.map(([value]) => value))};
    const rendered = (() => {
      const probe = document.createElement('div');
      probe.style.position = 'fixed';
      probe.style.visibility = 'hidden';
      probe.style.pointerEvents = 'none';
      probe.style.backgroundColor = 'hsl(var(--background))';
      document.body.appendChild(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      const body = getComputedStyle(document.body).backgroundColor;
      const root = document.querySelector('#root');
      const activePanel = document.querySelector('[role="tabpanel"][data-state="active"]');
      const backgrounds = {
        token: expected,
        body,
        root: root ? getComputedStyle(root).backgroundColor : null,
        activePanel: activePanel ? getComputedStyle(activePanel).backgroundColor : null,
      };
      probe.remove();
      return {
        matches: Boolean(expected && expected !== 'rgba(0, 0, 0, 0)' && body === expected),
        backgrounds,
      };
    })();
    return { activeSettings: pane?.matches('[role="tabpanel"][data-state="active"]') === true,
      count: triggers.length,
      selected: ${JSON.stringify(preference.choices.map(([, label]) => label))}.includes(triggers[0]?.textContent.trim())
        ? triggers[0].textContent.trim() : null,
      stored: allowed.includes(value) ? value : null,
      storedPresent,
      storagePresent: shadowFootprint ? shadowFootprint.stores[0].storagePresent : typeof raw === 'string',
      ...(shadowFootprint && { shadowFootprint }),
      saveRefusal: ${JSON.stringify(preference.caseId)} === 'T10' &&
        [...(pane?.querySelectorAll('[role="alert"]') ?? [])]
          .some((node) => node.textContent.trim() === 'Sign in to save Default mode.'),
      darkClass: document.documentElement.classList.contains('dark'),
      systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      renderedBackgroundMatches: rendered.matches,
      renderedBackgrounds: rendered.backgrounds };
  })()`,
  );
}

export function guestModeRefusalMatches(state, baseline = state) {
  return (
    state?.activeSettings === true &&
    state?.count === 1 &&
    state.selected === 'Act without asking' &&
    state.saveRefusal === true &&
    guestModeShadowMatches(state.shadowFootprint, baseline?.shadowFootprint)
  );
}

export async function runGuestModeRefusalCase(
  panel,
  reloadSettings,
  preference,
  record,
  afterReload = async () => {},
  driver = nativeDriver,
  onStage = () => {},
  expectedBaseline = undefined,
  onBaseline = () => {},
) {
  const at = async (stage, action) => {
    onStage(stage, 'started');
    try {
      const value = await action();
      onStage(stage, 'completed', value);
      return value;
    } catch (error) {
      onStage(stage, 'failed');
      throw error;
    }
  };
  assert.equal(preference.caseId, 'T10');
  await at('initial_baseline_section', () => driver.openSection(panel, preference.section));
  const initial = await at('initial_baseline_observation', () =>
    observeGuestPreference(panel, preference, driver),
  );
  assert.equal(initial?.selected, 'Act without asking', 'guest_mode_requires_effective_act');
  const baseline = expectedBaseline ?? preferenceBaseline(initial, preference);
  assert.equal(baseline?.matched, true, 'T10_shadow_baseline_unobserved');
  assert.equal(
    preferenceBaselineMatches(initial, preference, baseline),
    true,
    'T10_shadow_baseline_mismatch',
  );
  onBaseline(baseline);
  await at('choice_control', () => driver.click(panel, 'settings-select', preference.label));
  await at('choice_option', () => driver.click(panel, 'option', 'Ask before acting'));
  const refused = await at('choice_observation', () =>
    driver.waitFor(
      'T10_guest_ask_refused',
      async () => {
        const sample = await observeGuestPreference(panel, preference, driver);
        onStage('choice_observation', 'sample', sample);
        return sample;
      },
      (state) => guestModeRefusalMatches(state, baseline.observation),
    ),
  );
  record('Guest Ask choice is refused and Act restored with sign-in guidance', refused, true);
  await at('choice_panel_reload', () => reloadSettings(panel));
  await at('choice_section_reopen', () => driver.openSection(panel, preference.section));
  const reloaded = await at('choice_preference_observation', () =>
    observeGuestPreference(panel, preference, driver),
  );
  const restored =
    reloaded?.activeSettings === true &&
    reloaded?.count === 1 &&
    reloaded.selected === 'Act without asking' &&
    preferenceBaselineMatches(reloaded, preference, baseline);
  record('Guest mode remains Act after panel reload', reloaded, restored);
  assert.equal(restored, true, 'T10_guest_mode_reload_mismatch');
  await at('choice_after_reload_callback', () =>
    afterReload({
      panel,
      preference,
      value: 'act',
      label: 'Act without asking',
      observation: reloaded,
    }),
  );
  return {
    value: 'act',
    label: 'Act without asking',
    storedPresent: reloaded.storedPresent,
    storagePresent: reloaded.storagePresent,
    shadowFootprint: reloaded.shadowFootprint,
    matched: restored,
    observation: reloaded,
  };
}

export async function runGuestPreferenceCase(
  panel,
  reloadSettings,
  preference,
  record,
  afterReload = async () => {},
  driver = nativeDriver,
  onBaseline = () => {},
) {
  if (preference.caseId === 'T10')
    return runGuestModeRefusalCase(
      panel,
      reloadSettings,
      preference,
      record,
      afterReload,
      driver,
      undefined,
      undefined,
      onBaseline,
    );
  await driver.openSection(panel, preference.section);
  const initial = await observeGuestPreference(panel, preference, driver);
  const baselineChoice =
    initial &&
    (preference.choices.find(
      ([value, label]) => value === initial.stored && label === initial.selected,
    ) ??
      (initial.storedPresent === false
        ? preference.choices.find(([, label]) => label === initial.selected)
        : undefined));
  if (preference.key === 'theme') {
    assert.ok(baselineChoice, 'theme_case_requires_visible_baseline');
    onBaseline(preferenceBaseline(initial, preference));
  }

  let primaryError;
  try {
    // Selecting the already rendered implicit default does not fire a native change.
    // Visit another option first so the default choice must perform a real write.
    const choices =
      preference.key !== 'theme' &&
      initial.storedPresent === false &&
      initial.selected === preference.choices[0][1]
        ? [...preference.choices.slice(1), preference.choices[0]]
        : preference.choices;
    for (const [value, label] of choices) {
      await driver.click(panel, 'settings-select', preference.label);
      await driver.click(panel, 'option', label);
      const warm = await driver.waitFor(
        `${preference.caseId}_${value}_warm`,
        () => observeGuestPreference(panel, preference, driver),
        (state) => preferenceMatches(state, preference, value, label),
      );
      record(
        `${label} changes UI, persisted preference${preference.key === 'theme' ? ', and applied appearance' : ''}`,
        warm,
        true,
      );
      await reloadSettings(panel);
      await driver.openSection(panel, preference.section);
      const reloaded = await observeGuestPreference(panel, preference, driver);
      record(
        `${label} survives panel reload`,
        reloaded,
        preferenceMatches(reloaded, preference, value, label),
      );
      await afterReload({ panel, preference, value, label, observation: reloaded });
    }
  } catch (error) {
    primaryError = error;
  }

  if (preference.key === 'theme') {
    const [baselineValue, baselineLabel] = baselineChoice;
    const baselineWasStored = initial.storedPresent === true;
    try {
      await driver.openSection(panel, preference.section);
      let current = await observeGuestPreference(panel, preference, driver);
      if (
        !baselineSelectionMatches(
          current,
          baselineValue,
          baselineLabel,
          baselineWasStored,
          initial.storagePresent,
        )
      ) {
        if (baselineWasStored) {
          await driver.click(panel, 'settings-select', preference.label);
          await driver.click(panel, 'option', baselineLabel);
        } else {
          await restoreAbsentPreference(panel, preference, initial.storagePresent, driver);
        }
      }
      await reloadSettings(panel);
      await driver.openSection(panel, preference.section);
      current = await driver.waitFor(
        'T04_original_baseline_after_panel_reload',
        () => observeGuestPreference(panel, preference, driver),
        (state) =>
          baselineSelectionMatches(
            state,
            baselineValue,
            baselineLabel,
            baselineWasStored,
            initial.storagePresent,
          ) && themeAppearanceMatches(state, baselineValue),
      );
      const restored =
        baselineSelectionMatches(
          current,
          baselineValue,
          baselineLabel,
          baselineWasStored,
          initial.storagePresent,
        ) && themeAppearanceMatches(current, baselineValue);
      record('Original theme baseline restored after panel reload', current, restored);
      if (!restored) throw new Error('T04_original_baseline_restore_failed');
    } catch (error) {
      record('Original theme baseline restored after panel reload', { status: 'failed' }, false);
      if (!primaryError) primaryError = error;
    }
  }

  if (preference.key !== 'theme' && initial.storedPresent === false) {
    try {
      await restoreGuestPreferenceBaseline(
        panel,
        preference,
        preferenceBaseline(initial, preference),
        (name, observation, passed) => record(name, observation, passed),
        driver,
      );
      await reloadSettings(panel);
      await driver.openSection(panel, preference.section);
      const restored = await observeGuestPreference(panel, preference, driver);
      const passed = preferenceBaselineMatches(
        restored,
        preference,
        preferenceBaseline(initial, preference),
      );
      record(`Original ${preference.label} baseline restored after panel reload`, restored, passed);
      if (!passed) throw new Error(`${preference.caseId}_original_baseline_restore_failed`);
    } catch (error) {
      if (!primaryError) primaryError = error;
    }
  }

  if (primaryError) throw primaryError;
  return initial ? preferenceBaseline(initial, preference) : null;
}

export async function runGuestThemeRenderingProbe(
  panel,
  preference,
  record,
  driver = nativeDriver,
) {
  assert.equal(preference?.key, 'theme', 'theme_probe_requires_theme_preference');
  const initial = await observeGuestPreference(panel, preference, driver);
  const persistedBaselineChoice = preference.choices.find(
    ([value, label]) => value === initial?.stored && label === initial?.selected,
  );
  const implicitBaselineChoice =
    initial?.storedPresent === false
      ? preference.choices.find(([, label]) => label === initial?.selected)
      : undefined;
  const baselineChoice = persistedBaselineChoice ?? implicitBaselineChoice;
  assert.ok(baselineChoice, 'theme_probe_requires_visible_baseline');
  const [baselineValue, baselineLabel] = baselineChoice;
  const baselineWasStored = initial.storedPresent === true;
  const baselineMatches = baselineSelectionMatches(
    initial,
    baselineValue,
    baselineLabel,
    baselineWasStored,
    initial.storagePresent,
  );
  record('Original theme selection and storage observed', initial, baselineMatches);
  record(
    'Original theme rendering observed',
    initial,
    themeAppearanceMatches(initial, baselineValue),
  );

  let primaryError;
  try {
    await driver.openSection(panel, preference.section);
    for (const [value, label] of [
      ['dark', 'Dark'],
      ['light', 'Light'],
      ['system', 'System'],
    ]) {
      assert.ok(
        preference.choices.some(
          ([choiceValue, choiceLabel]) => choiceValue === value && choiceLabel === label,
        ),
        'theme_probe_choice_missing_from_canonical_preference',
      );
      await driver.click(panel, 'settings-select', preference.label);
      await driver.click(panel, 'option', label);
      const observed = await driver.waitFor(
        `theme_probe_${value}_selection_and_storage`,
        () => observeGuestPreference(panel, preference, driver),
        (state) => preferenceSelectionMatches(state, value, label),
      );
      record(
        `${label} theme and computed appearance observed`,
        observed,
        preferenceMatches(observed, preference, value, label),
      );
    }
  } catch (error) {
    primaryError = error;
  }

  try {
    await driver.openSection(panel, preference.section);
    let observed = await observeGuestPreference(panel, preference, driver);
    if (
      baselineWasStored &&
      !baselineSelectionMatches(
        observed,
        baselineValue,
        baselineLabel,
        true,
        initial.storagePresent,
      )
    ) {
      await driver.click(panel, 'settings-select', preference.label);
      await driver.click(panel, 'option', baselineLabel);
      observed = await driver.waitFor(
        'theme_probe_original_baseline_restored',
        () => observeGuestPreference(panel, preference, driver),
        (state) =>
          baselineSelectionMatches(
            state,
            baselineValue,
            baselineLabel,
            true,
            initial.storagePresent,
          ),
      );
    } else if (!baselineWasStored) {
      await restoreAbsentPreference(panel, preference, initial.storagePresent, driver);
      observed = await driver.waitFor(
        'theme_probe_original_unpersisted_baseline_restored',
        () => observeGuestPreference(panel, preference, driver),
        (state) =>
          baselineSelectionMatches(
            state,
            baselineValue,
            baselineLabel,
            false,
            initial.storagePresent,
          ),
      );
    }
    const restored = baselineSelectionMatches(
      observed,
      baselineValue,
      baselineLabel,
      baselineWasStored,
      initial.storagePresent,
    );
    record('Original theme selection and storage restored', observed, restored);
    record(
      'Original theme rendering restored',
      observed,
      themeAppearanceMatches(observed, baselineValue),
    );
    if (!restored) throw new Error('theme_probe_baseline_restore_failed');
  } catch (error) {
    record('Original theme selection and storage restored', { status: 'failed' }, false);
    if (!primaryError) primaryError = error;
  }

  if (primaryError) throw primaryError;
}

function baselineSelectionMatches(observed, value, label, stored, storagePresent) {
  return (
    observed?.activeSettings === true &&
    observed?.count === 1 &&
    observed?.selected === label &&
    observed?.storedPresent === stored &&
    observed?.storagePresent === storagePresent &&
    (stored ? observed?.stored === value : observed?.stored === null)
  );
}

function themeAppearanceMatches(observed, value) {
  const expectedDark = value === 'system' ? observed?.systemDark : value === 'dark';
  return observed?.darkClass === expectedDark && observed?.renderedBackgroundMatches === true;
}

async function restoreAbsentPreference(panel, preference, storagePresent, driver) {
  const key = JSON.stringify('matrx.settings.v1');
  const field = JSON.stringify(preference.key);
  const originalStoragePresent = JSON.stringify(storagePresent);
  await driver.evaluate(
    panel,
    `(async () => {
      const originalStoragePresent = ${originalStoragePresent};
      if (!originalStoragePresent) {
        await chrome.storage.local.remove(${key});
        return;
      }
      const current = await chrome.storage.local.get(${key});
      const raw = current[${key}];
      if (typeof raw !== 'string') {
        await chrome.storage.local.remove(${key});
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed.state || typeof parsed.state !== 'object')
        throw new Error('preference_settings_state_missing');
      delete parsed.state[${field}];
      await chrome.storage.local.set({ [${key}]: JSON.stringify(parsed) });
    })()`,
  );
}

export function preferenceBaseline(observation, preference) {
  if (preference.caseId === 'T10') {
    const choice = preference.choices.find(([, label]) => label === observation?.selected);
    const baseline = {
      value: choice?.[0] ?? null,
      label: choice?.[1] ?? null,
      storedPresent: observation?.storedPresent,
      storagePresent: observation?.storagePresent,
      observation: observation ? JSON.parse(JSON.stringify(observation)) : null,
    };
    return {
      ...baseline,
      matched:
        !!choice &&
        choice[0] === 'act' &&
        preferenceBaselineMatches(observation, preference, baseline),
    };
  }
  const byStored = preference.choices.find(([value]) => value === observation?.stored);
  const bySelected = preference.choices.find(([, label]) => label === observation?.selected);
  const value = byStored?.[0] ?? bySelected?.[0] ?? null;
  const choice = preference.choices.find(([candidate]) => candidate === value);
  return {
    value,
    label: choice?.[1] ?? null,
    storedPresent: observation?.storedPresent,
    storagePresent: observation?.storagePresent,
    observation,
    matched:
      !!choice &&
      preferenceBaselineMatches(observation, preference, {
        value,
        label: choice[1],
        storedPresent: observation?.storedPresent,
        storagePresent: observation?.storagePresent,
      }),
  };
}

export function preferenceBaselineMatches(observed, preference, baseline) {
  if (preference.caseId === 'T10')
    return (
      observed?.activeSettings === true &&
      observed?.count === 1 &&
      observed.selected === 'Act without asking' &&
      baseline?.value === 'act' &&
      guestModeShadowMatches(observed.shadowFootprint, baseline?.observation?.shadowFootprint)
    );
  if (baseline?.storedPresent === undefined)
    return preferenceMatches(observed, preference, baseline?.value, baseline?.label);
  return (
    baselineSelectionMatches(
      observed,
      baseline.value,
      baseline.label,
      baseline.storedPresent,
      baseline.storagePresent,
    ) &&
    (preference.key !== 'theme' || themeAppearanceMatches(observed, baseline.value))
  );
}

export const PREFERENCE_BASELINE_RESTORE_STAGES = Object.freeze([
  'validate_baseline',
  'open_section',
  'observe_before_selection',
  'open_control',
  'select_option',
  'remove_absent_key',
  'observe_restored_baseline',
  'record_restored_baseline',
]);

export function safePreferenceBaselineRestoration(value) {
  if (!PREFERENCE_BASELINE_RESTORE_STAGES.includes(value?.stage)) return null;
  const names = ['AssertionError', 'Error', 'RangeError', 'TimeoutError', 'TypeError'];
  const boolean = (field) => (typeof field === 'boolean' ? field : null);
  return {
    stage: value.stage,
    errorName: names.includes(value.errorName) ? value.errorName : 'OtherError',
    observation: value.observation
      ? Object.fromEntries(
          [
            'settingsActive',
            'controlUnique',
            'selectedMatches',
            'storedMatches',
            'storedPresent',
            'storagePresent',
            'appearanceMatches',
            'baselineMatches',
          ].map((key) => [key, boolean(value.observation[key])]),
        )
      : null,
  };
}

export async function restoreGuestPreferenceBaseline(
  panel,
  preference,
  baseline,
  record,
  driver = nativeDriver,
) {
  if (preference.caseId === 'T10') {
    await driver.openSection(panel, preference.section);
    const observed = await observeGuestPreference(panel, preference, driver);
    assert.equal(
      preferenceBaselineMatches(observed, preference, baseline),
      true,
      'T10_shadow_baseline_mismatch',
    );
    record('Original Default mode footprint remains unchanged', observed, true);
    return observed;
  }
  let stage = 'validate_baseline';
  let last;
  try {
    const choice = preference.choices.find(([value]) => value === baseline?.value);
    assertPreferenceBaseline(choice, preference);
    const [value, label] = choice;
    stage = 'open_section';
    await driver.openSection(panel, preference.section);
    stage = 'observe_before_selection';
    last = await observeGuestPreference(panel, preference, driver);
    if (!preferenceMatches(last, preference, value, label)) {
      stage = 'open_control';
      await driver.click(panel, 'settings-select', preference.label);
      stage = 'select_option';
      await driver.click(panel, 'option', label);
    }
    if (baseline.storedPresent === false) {
      stage = 'remove_absent_key';
      await restoreAbsentPreference(panel, preference, baseline.storagePresent, driver);
    }
    stage = 'observe_restored_baseline';
    const restored = await driver.waitFor(
      `${preference.caseId}_full_extension_baseline_restored`,
      async () => {
        last = await observeGuestPreference(panel, preference, driver);
        return last;
      },
      (state) => preferenceBaselineMatches(state, preference, baseline),
    );
    const passed = preferenceBaselineMatches(restored, preference, baseline);
    stage = 'record_restored_baseline';
    record(`original ${preference.label} preference restored`, restored, passed);
    if (!passed) throw new Error(`${preference.caseId}_full_extension_baseline_restore_failed`);
    return restored;
  } catch (caught) {
    const error =
      caught instanceof Error ? caught : new Error('preference_baseline_restore_failed');
    error.safeBaselineRestoration = safePreferenceBaselineRestoration({
      stage,
      errorName: error.name,
      observation: last
        ? {
            settingsActive: last.activeSettings,
            controlUnique: last.count === 1,
            selectedMatches: last.selected === baseline?.label,
            storedMatches: last.stored === baseline?.value,
            storedPresent: last.storedPresent,
            storagePresent: last.storagePresent,
            appearanceMatches:
              preference.key === 'theme' ? themeAppearanceMatches(last, baseline?.value) : null,
            baselineMatches: preferenceBaselineMatches(last, preference, baseline),
          }
        : null,
    });
    throw error;
  }
}

function assertPreferenceBaseline(choice, preference) {
  if (!choice) throw new Error(`${preference.caseId}_full_extension_baseline_unavailable`);
}
