import assert from 'node:assert/strict';
import {
  observeGuestPreference,
  preferenceSelectionMatches,
} from './settings-guest-preference-batch.mjs';
import { click, openSection, waitFor } from './settings-panel-driver.mjs';

export const CHAT_VERSION = {
  caseId: 'T93',
  section: 'Chat',
  label: 'Chat version',
  key: 'chatSurface',
  choices: [
    ['package', 'New'],
    ['default', 'Current'],
  ],
};
const nativeDriver = { click, openSection, waitFor, observe: observeGuestPreference };

export async function runGuestChatVersionReopen({
  panel,
  cyclePanel,
  acquireLivePanel,
  settings,
  record,
  driver = nativeDriver,
}) {
  let live = panel;
  let stage = 'baseline';
  let primaryError;
  let baseline;
  const detach = async () => {
    try {
      await live.detach();
    } catch {
      record('cleanup', 'Panel session detach failed', { stage }, false);
      primaryError ??= new Error('T93_panel_detach_failed');
    }
  };
  const select = async (value, label) => {
    await settings(live);
    await driver.openSection(live, 'Chat');
    await driver.click(live, 'settings-select', 'Chat version');
    await driver.click(live, 'option', label);
    return driver.waitFor(
      `T93_${value}_saved`,
      () => driver.observe(live, CHAT_VERSION),
      (state) => preferenceSelectionMatches(state, value, label),
    );
  };
  const reopen = async (value, label, phase) => {
    const replacement = await cyclePanel(live);
    live = replacement.panel;
    record(phase, 'Actual native panel retired and replaced', replacement.evidence, true);
    await settings(live);
    await driver.openSection(live, 'Chat');
    const observation = await driver.waitFor(
      `T93_${value}_reopened`,
      () => driver.observe(live, CHAT_VERSION),
      (state) => preferenceSelectionMatches(state, value, label),
    );
    record(
      phase,
      `${label} selector and saved value survive native reopen`,
      observation,
      preferenceSelectionMatches(observation, value, label),
    );
  };
  try {
    await settings(live);
    await driver.openSection(live, 'Chat');
    const initial = await driver.observe(live, CHAT_VERSION);
    baseline = CHAT_VERSION.choices.find(
      ([value, label]) =>
        initial?.selected === label &&
        (initial.stored === value || initial.storedPresent === false),
    );
    assert.ok(
      initial?.activeSettings && initial.count === 1 && baseline,
      'T93_visible_baseline_missing',
    );
    record('baseline', 'Original Chat version observed', initial, true);
    for (const [value, label] of CHAT_VERSION.choices) {
      stage = `${value}_save`;
      record('warm', `${label} saved through selector`, await select(value, label), true);
      stage = `${value}_reopen`;
      await reopen(value, label, 'panel-reopen');
    }
  } catch (error) {
    primaryError = error;
    record(
      'failure',
      'Chat version persistence procedure failed',
      { stage, lifecycle: error?.panelReopenDiagnostic ?? null },
      false,
    );
  } finally {
    if (baseline) {
      try {
        // A failed close/open may have retired the last session. Reacquire only
        // from the owned profile; restoration still uses the real selector.
        await detach();
        live = await acquireLivePanel();
        stage = 'restoration_save';
        await select(...baseline);
        stage = 'restoration_reopen';
        await reopen(...baseline, 'preference-restoration');
      } catch (error) {
        record(
          'preference-restoration',
          'Original Chat version restoration failed',
          { stage, lifecycle: error?.panelReopenDiagnostic ?? null },
          false,
        );
        primaryError ??= error;
      }
    }
    if (live !== panel) await detach();
  }
  if (primaryError) throw primaryError;
}
