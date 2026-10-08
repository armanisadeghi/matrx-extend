import assert from 'node:assert/strict';
import {
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
    const active = [...document.querySelectorAll('button[role="tab"][data-state="active"]')]
      .filter((node) => node.title === 'Settings');
    const pane = active.length === 1 ? document.getElementById(active[0].getAttribute('aria-controls') ?? '') : null;
    const sections = [...(pane?.querySelectorAll('button[aria-expanded]') ?? [])]
      .filter((node) => node.textContent.trim() === 'Privacy');
    const privacy = sections.length === 1 ? document.getElementById(sections[0].getAttribute('aria-controls') ?? '') : null;
    const switches = [...(privacy?.querySelectorAll('[role="switch"][aria-label]') ?? [])]
      .filter((node) => node.getAttribute('aria-label') === ${JSON.stringify(preference.label)});
    const raw = (await chrome.storage.local.get('matrx.settings.v1'))['matrx.settings.v1'];
    let stored = null;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const value = parsed?.state?.[${JSON.stringify(preference.key)}];
      if (typeof value === 'boolean' || value === 'on_page' || value === 'quiet') stored = value;
    } catch {}
    const checked = switches[0]?.getAttribute('aria-checked');
    return { activeSettings: pane?.matches('[role="tabpanel"][data-state="active"]') === true,
      privacyOpen: sections.length === 1 && sections[0].getAttribute('aria-expanded') === 'true',
      count: switches.length, checked: checked === 'true' ? true : checked === 'false' ? false : null,
      stored, saveError: [...(pane?.querySelectorAll('[role="alert"]') ?? [])]
        .some((node) => node.textContent.includes('Could not save preferences')) };
  })()`,
  );
}

export async function runGuestPrivacySwitchCase(panel, reloadSettings, preference, record) {
  assert.equal(
    guestSettingsChecks(await guestSettingsState(panel), 0).signedOut,
    true,
    `${preference.caseId}_requires_signed_out_guest`,
  );
  await openSection(panel, 'Privacy');
  const before = await observe(panel, preference);
  assert.equal(before.count, 1, `${preference.caseId}_requires_unique_switch`);
  assert.equal(typeof before.checked, 'boolean', `${preference.caseId}_requires_readable_switch`);
  assert.equal(
    privacySwitchMatches(before, preference, before.checked),
    true,
    `${preference.caseId}_requires_matching_ui_and_persisted_baseline`,
  );
  const original = before.checked;
  try {
    for (const expected of [!original, original]) {
      await click(panel, 'switch', preference.label);
      const warm = await waitFor(
        `${preference.caseId}_${expected}_warm`,
        () => observe(panel, preference),
        (state) => privacySwitchMatches(state, preference, expected),
      );
      record(
        'warm',
        `Switch ${expected ? 'on' : 'off'} changes visible and stored values`,
        warm,
        'pass',
      );
      await reloadSettings(panel);
      await openSection(panel, 'Privacy');
      const reloaded = await observe(panel, preference);
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
    await reloadSettings(panel);
    await openSection(panel, 'Privacy');
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await observe(panel, preference);
      const target = nextPrivacyRestoreClick(current, preference, original);
      if (target === null) break;
      await click(panel, 'switch', preference.label);
      await waitFor(
        `${preference.caseId}_cleanup_${target}`,
        () => observe(panel, preference),
        (state) => privacySwitchMatches(state, preference, target),
      );
    }
    const settled = await observe(panel, preference);
    assert.equal(
      privacySwitchMatches(settled, preference, original),
      true,
      `${preference.caseId}_restoration_failed`,
    );
    await reloadSettings(panel);
    await openSection(panel, 'Privacy');
    const restored = await observe(panel, preference);
    assert.equal(
      privacySwitchMatches(restored, preference, original),
      true,
      `${preference.caseId}_restoration_not_persisted_after_reload`,
    );
  }
}
