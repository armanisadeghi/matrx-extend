import assert from 'node:assert/strict';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const nativeDriver = { click, evaluate, openSection, waitFor };

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
    observed?.modeIcon === expectedMode
  );
}

export async function observeGuestNewChatDefault(panel, expectedMode, expectedLabel) {
  await click(panel, 'title', 'Chat');
  const read = () =>
    evaluate(
      panel,
      `(() => {
        const tabs = [...document.querySelectorAll('button[role="tab"][data-state="active"]')]
          .filter((node) => node.title === 'Chat');
        const pane = tabs.length === 1
          ? document.getElementById(tabs[0].getAttribute('aria-controls') ?? '')
          : null;
        const mode = [...(pane?.querySelectorAll('button[title="Tool permission mode"]') ?? [])];
        const newChat = [...(pane?.querySelectorAll('button[title="New chat"]') ?? [])];
        const icon = mode.length === 1 ? mode[0].querySelector('svg') : null;
        return { activeChat: pane?.matches('[role="tabpanel"][data-state="active"]') === true,
          newChatCount: newChat.length, modeControlCount: mode.length,
          modeLabel: mode.length === 1 ? mode[0].textContent.trim() : null,
          modeIcon: icon?.classList.contains('lucide-zap') ? 'act'
            : icon?.classList.contains('lucide-hand') ? 'ask' : null };
      })()`,
    );
  await waitFor('guest_chat_default_mode_ready', read, (value) => value?.activeChat === true);
  await click(panel, 'title', 'New chat');
  return waitFor('guest_new_chat_default_mode', read, (value) =>
    guestChatDefaultMatches(value, expectedMode, expectedLabel),
  );
}

export async function observeGuestPreference(panel, preference, driver = nativeDriver) {
  return driver.evaluate(
    panel,
    `(async () => {
    const active = [...document.querySelectorAll('button[role="tab"][data-state="active"]')]
      .filter((node) => node.title === 'Settings');
    const pane = active.length === 1 ? document.getElementById(active[0].getAttribute('aria-controls') ?? '') : null;
    const rows = [...(pane?.querySelectorAll('span') ?? [])]
      .filter((node) => node.textContent.trim() === ${JSON.stringify(preference.label)});
    const triggers = rows.flatMap((row) => [...row.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
    const raw = (await chrome.storage.local.get('matrx.settings.v1'))['matrx.settings.v1'];
    let value = null;
    try { value = JSON.parse(raw).state?.[${JSON.stringify(preference.key)}] ?? null; } catch {}
    const allowed = ${JSON.stringify(preference.choices.map(([value]) => value))};
    const rendered = (() => {
      const probe = document.createElement('div');
      probe.style.position = 'fixed';
      probe.style.visibility = 'hidden';
      probe.style.pointerEvents = 'none';
      probe.style.backgroundColor = 'var(--background)';
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
      darkClass: document.documentElement.classList.contains('dark'),
      systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      renderedBackgroundMatches: rendered.matches,
      renderedBackgrounds: rendered.backgrounds };
  })()`,
  );
}

export async function runGuestPreferenceCase(
  panel,
  reloadSettings,
  preference,
  record,
  afterReload = async () => {},
) {
  await openSection(panel, preference.section);
  for (const [value, label] of preference.choices) {
    await click(panel, 'settings-select', preference.label);
    await click(panel, 'option', label);
    const warm = await waitFor(
      `${preference.caseId}_${value}_warm`,
      () => observeGuestPreference(panel, preference),
      (state) => preferenceMatches(state, preference, value, label),
    );
    record(
      `${label} changes UI, persisted preference${preference.key === 'theme' ? ', and applied appearance' : ''}`,
      warm,
      true,
    );
    await reloadSettings(panel);
    await openSection(panel, preference.section);
    const reloaded = await observeGuestPreference(panel, preference);
    record(
      `${label} survives panel reload`,
      reloaded,
      preferenceMatches(reloaded, preference, value, label),
    );
    await afterReload({ panel, preference, value, label, observation: reloaded });
  }
}

export async function runGuestThemeRenderingProbe(
  panel,
  preference,
  record,
  driver = nativeDriver,
) {
  assert.equal(preference?.key, 'theme', 'theme_probe_requires_theme_preference');
  const initial = await observeGuestPreference(panel, preference, driver);
  const baselineChoice = preference.choices.find(
    ([value, label]) => value === initial?.stored && label === initial?.selected,
  );
  assert.ok(baselineChoice, 'theme_probe_requires_visible_persisted_baseline');
  const [baselineValue, baselineLabel] = baselineChoice;
  const baselineMatches = preferenceSelectionMatches(initial, baselineValue, baselineLabel);
  record('Original theme selection and storage observed', initial, baselineMatches);
  record(
    'Original theme rendering observed',
    initial,
    preferenceMatches(initial, preference, baselineValue, baselineLabel),
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
    if (!preferenceSelectionMatches(observed, baselineValue, baselineLabel)) {
      await driver.click(panel, 'settings-select', preference.label);
      await driver.click(panel, 'option', baselineLabel);
      observed = await driver.waitFor(
        'theme_probe_original_baseline_restored',
        () => observeGuestPreference(panel, preference, driver),
        (state) => preferenceSelectionMatches(state, baselineValue, baselineLabel),
      );
    }
    const restored = preferenceSelectionMatches(observed, baselineValue, baselineLabel);
    record('Original theme selection and storage restored', observed, restored);
    record(
      'Original theme rendering restored',
      observed,
      preferenceMatches(observed, preference, baselineValue, baselineLabel),
    );
    if (!restored) throw new Error('theme_probe_baseline_restore_failed');
  } catch (error) {
    record('Original theme selection and storage restored', { status: 'failed' }, false);
    if (!primaryError) primaryError = error;
  }

  if (primaryError) throw primaryError;
}

export function preferenceBaseline(observation, preference) {
  const byStored = preference.choices.find(([value]) => value === observation?.stored);
  const bySelected = preference.choices.find(([, label]) => label === observation?.selected);
  const value = byStored?.[0] ?? bySelected?.[0] ?? null;
  const choice = preference.choices.find(([candidate]) => candidate === value);
  return {
    value,
    label: choice?.[1] ?? null,
    observation,
    matched: !!choice && preferenceMatches(observation, preference, value, choice[1]),
  };
}

export async function restoreGuestPreferenceBaseline(
  panel,
  preference,
  baseline,
  record,
  driver = nativeDriver,
) {
  const choice = preference.choices.find(([value]) => value === baseline?.value);
  assertPreferenceBaseline(choice, preference);
  const [value, label] = choice;
  await driver.openSection(panel, preference.section);
  const current = await observeGuestPreference(panel, preference, driver);
  if (!preferenceMatches(current, preference, value, label)) {
    await driver.click(panel, 'settings-select', preference.label);
    await driver.click(panel, 'option', label);
  }
  const restored = await driver.waitFor(
    `${preference.caseId}_full_extension_baseline_restored`,
    () => observeGuestPreference(panel, preference, driver),
    (state) => preferenceMatches(state, preference, value, label),
  );
  const passed = preferenceMatches(restored, preference, value, label);
  record(`original ${preference.label} preference restored`, restored, passed);
  if (!passed) throw new Error(`${preference.caseId}_full_extension_baseline_restore_failed`);
  return restored;
}

function assertPreferenceBaseline(choice, preference) {
  if (!choice) throw new Error(`${preference.caseId}_full_extension_baseline_unavailable`);
}
