import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  activeTabPanelExpression,
  click,
  evaluate,
  guestSettingsChecks,
  guestSettingsState,
  openSection,
  waitFor,
} from './settings-panel-driver.mjs';

export const GUEST_PRIVACY_SWITCHES = [
  { caseId: 'T16', label: 'Share page identity & email content', key: 'sharePageIdentity' },
  { caseId: 'T19', label: 'Offer to save logins to the Vault', key: 'captureLoginsEnabled' },
  { caseId: 'T31', label: 'Offer saved logins on sign-in forms', key: 'offerSavedLoginsEnabled' },
  {
    caseId: 'T34',
    label: 'Show password suggestions on websites',
    key: 'credentialAssistancePresentation',
  },
];
const PRIVACY_DEFAULTS = JSON.parse(
  readFileSync(new URL('../../src/lib/settings/privacy-defaults.json', import.meta.url), 'utf8'),
);

function storedValue(preference, value) {
  return preference.caseId === 'T34' ? (value ? 'on_page' : 'quiet') : value;
}

export function privacySwitchMatches(state, preference, expected) {
  return (
    state?.activeSettings === true &&
    state?.privacyOpen === true &&
    state?.count === 1 &&
    state?.checked === expected &&
    state?.stored === storedValue(preference, expected) &&
    state?.saveError === false
  );
}

export function privacyBaselineMatches(state, preference, before) {
  return (
    state?.activeSettings === true &&
    state?.privacyOpen === true &&
    state?.count === 1 &&
    state?.checked === before.checked &&
    state?.saveError === false &&
    state?.fieldPresent === before.fieldPresent &&
    state?.storagePresent === before.storagePresent &&
    (before.fieldPresent
      ? state.stored === storedValue(preference, before.checked)
      : state.stored === null &&
        before.checked ===
          (preference.caseId === 'T34'
            ? PRIVACY_DEFAULTS[preference.key] === 'on_page'
            : PRIVACY_DEFAULTS[preference.key]))
  );
}

export function nextPrivacyRestoreClick(state, preference, original) {
  if (privacySwitchMatches(state, preference, original)) return null;
  if (state?.checked === original) return !original;
  if (state?.checked === !original) return original;
  throw new Error(`${preference.caseId}_cleanup_switch_unreadable`);
}

async function observe(panel, preference) {
  return evaluate(
    panel,
    `(async () => {
    const pane = ${activeTabPanelExpression('Settings')};
    const sections = [...(pane?.querySelectorAll('button[aria-expanded]') ?? [])]
      .filter((node) => node.textContent.trim() === 'Privacy');
    const privacy = sections.length === 1 ? document.getElementById(sections[0].getAttribute('aria-controls') ?? '') : null;
    const switches = [...(privacy?.querySelectorAll('[role="switch"][aria-label]') ?? [])]
      .filter((node) => node.getAttribute('aria-label') === ${JSON.stringify(preference.label)});
    const raw = (await chrome.storage.local.get('matrx.settings.v1'))['matrx.settings.v1'];
    let stored = null;
    let fieldPresent = false;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      fieldPresent = Object.hasOwn(parsed?.state ?? {}, ${JSON.stringify(preference.key)});
      const value = parsed?.state?.[${JSON.stringify(preference.key)}];
      if (typeof value === 'boolean' || value === 'on_page' || value === 'quiet') stored = value;
    } catch {}
    const checked = switches[0]?.getAttribute('aria-checked');
    return { activeSettings: pane?.matches('[role="tabpanel"][data-state="active"]') === true,
      privacyOpen: sections.length === 1 && sections[0].getAttribute('aria-expanded') === 'true',
      count: switches.length, checked: checked === 'true' ? true : checked === 'false' ? false : null,
      stored, fieldPresent, storagePresent: typeof raw === 'string',
      saveError: [...(pane?.querySelectorAll('[role="alert"]') ?? [])]
        .some((node) => node.textContent.includes('Could not save preferences')) };
  })()`,
  );
}

export async function runGuestPrivacySwitchCase(
  panel,
  reloadSettings,
  preference,
  record,
  operations = {},
) {
  const read = operations.observe ?? observe;
  const tap = operations.click ?? click;
  const expand = operations.openSection ?? openSection;
  const poll = operations.waitFor ?? waitFor;
  const refresh = operations.reloadSettings ?? reloadSettings;
  const signedOut =
    operations.signedOut ??
    (async () => guestSettingsChecks(await guestSettingsState(panel), 0).signedOut);
  assert.equal(await signedOut(panel), true, `${preference.caseId}_requires_signed_out_guest`);
  await expand(panel, 'Privacy');
  const before = await read(panel, preference);
  assert.equal(before.count, 1, `${preference.caseId}_requires_unique_switch`);
  assert.equal(typeof before.checked, 'boolean', `${preference.caseId}_requires_readable_switch`);
  assert.equal(
    privacyBaselineMatches(before, preference, before),
    true,
    `${preference.caseId}_requires_matching_ui_and_persisted_baseline`,
  );
  const original = before.checked;
  try {
    for (const expected of [!original, original]) {
      await tap(panel, 'switch', preference.label);
      const warm = await poll(
        `${preference.caseId}_${expected}_warm`,
        () => read(panel, preference),
        (state) => privacySwitchMatches(state, preference, expected),
      );
      record(
        'warm',
        `Switch ${expected ? 'on' : 'off'} changes visible and stored values`,
        warm,
        'pass',
      );
      await refresh(panel);
      await expand(panel, 'Privacy');
      const reloaded = await read(panel, preference);
      record(
        'reload',
        `Switch ${expected ? 'on' : 'off'} survives panel reload`,
        reloaded,
        privacySwitchMatches(reloaded, preference, expected) ? 'pass' : 'fail',
      );
      assert.equal(
        privacySwitchMatches(reloaded, preference, expected),
        true,
        `${preference.caseId}_${expected}_reload_mismatch`,
      );
    }
  } finally {
    // A failed reload can leave the old panel document gone. Reenter before
    // cleanup, then use actual clicks to restore both the UI and storage.
    await refresh(panel);
    await expand(panel, 'Privacy');
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await read(panel, preference);
      const target = nextPrivacyRestoreClick(current, preference, original);
      if (target === null) break;
      await tap(panel, 'switch', preference.label);
      await poll(
        `${preference.caseId}_cleanup_${target}`,
        () => read(panel, preference),
        (state) => privacySwitchMatches(state, preference, target),
      );
    }
    if (!before.fieldPresent) {
      await evaluate(
        panel,
        `(async () => {
          const key = 'matrx.settings.v1';
          if (!${JSON.stringify(before.storagePresent)}) {
            await chrome.storage.local.remove(key);
            return;
          }
          const raw = (await chrome.storage.local.get(key))[key];
          if (typeof raw !== 'string') throw new Error('privacy_settings_container_missing');
          const parsed = JSON.parse(raw);
          if (!parsed.state || typeof parsed.state !== 'object')
            throw new Error('privacy_settings_state_missing');
          delete parsed.state[${JSON.stringify(preference.key)}];
          await chrome.storage.local.set({ [key]: JSON.stringify(parsed) });
        })()`,
      );
    }
    const settled = await read(panel, preference);
    assert.equal(
      before.fieldPresent
        ? privacySwitchMatches(settled, preference, original)
        : settled.checked === original,
      true,
      `${preference.caseId}_restoration_failed`,
    );
    await refresh(panel);
    await expand(panel, 'Privacy');
    const restored = await read(panel, preference);
    assert.equal(
      privacyBaselineMatches(restored, preference, before),
      true,
      `${preference.caseId}_restoration_not_persisted_after_reload`,
    );
  }
}
