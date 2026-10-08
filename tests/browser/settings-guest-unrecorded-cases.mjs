import assert from 'node:assert/strict';
import {
  click,
  evaluate,
  guestSettingsChecks,
  guestSettingsState,
  openSection,
  waitFor,
} from './settings-panel-driver.mjs';

const KEY = 'matrx.credentials.captureNeverOrigins';
const FIRST = 'http://127.0.0.1:65001';
const SECOND = 'http://127.0.0.1:65002';

export function askAgainMatches(state, expected) {
  return (
    state?.guest === true &&
    state?.privacyOpen === true &&
    state?.rowCount === expected.count &&
    state?.storageCount === expected.count &&
    state?.firstRow === expected.first &&
    state?.firstStored === expected.first &&
    state?.secondRow === expected.second &&
    state?.secondStored === expected.second &&
    state?.headingVisible === expected.count > 0 &&
    state?.otherStored === false
  );
}

async function observe(panel) {
  const state = await evaluate(
    panel,
    `(async () => {
    const tab = [...document.querySelectorAll('button[role="tab"][data-state="active"]')]
      .filter((node) => node.title === 'Settings');
    const pane = tab.length === 1 ? document.getElementById(tab[0].getAttribute('aria-controls') ?? '') : null;
    const privacy = [...(pane?.querySelectorAll('button[aria-expanded]') ?? [])]
      .filter((node) => node.textContent.trim() === 'Privacy');
    const content = privacy.length === 1 ? document.getElementById(privacy[0].getAttribute('aria-controls') ?? '') : null;
    const rows = [...(content?.querySelectorAll('li') ?? [])]
      .filter((row) => row.querySelector('button')?.textContent.trim() === 'Ask again');
    const labels = rows.map((row) => row.querySelector('span')?.textContent.trim());
    const raw = (await chrome.storage.local.get(${JSON.stringify(KEY)}))[${JSON.stringify(KEY)}];
    const stored = Array.isArray(raw) ? raw : [];
    return { privacyOpen: privacy.length === 1 && privacy[0].getAttribute('aria-expanded') === 'true',
      rowCount: rows.length, storageCount: stored.length,
      firstRow: labels.includes(${JSON.stringify(FIRST.replace(/^https?:\/\//, ''))}),
      secondRow: labels.includes(${JSON.stringify(SECOND.replace(/^https?:\/\//, ''))}),
      firstStored: stored.includes(${JSON.stringify(FIRST)}),
      secondStored: stored.includes(${JSON.stringify(SECOND)}),
      otherStored: stored.some((origin) => origin !== ${JSON.stringify(FIRST)} && origin !== ${JSON.stringify(SECOND)}),
      headingVisible: [...(content?.querySelectorAll('p') ?? [])]
        .some((node) => node.textContent.trim() === 'Never ask on these sites') };
  })()`,
  );
  const auth = await guestSettingsState(panel);
  return { ...state, guest: guestSettingsChecks(auth, 0).signedOut };
}

export async function runGuestAskAgainCase(panel, reloadSettings, record) {
  assert.equal(
    guestSettingsChecks(await guestSettingsState(panel), 0).signedOut,
    true,
    'owned_never_capture_fixture_requires_signed_out_guest',
  );
  // This isolated profile is disposable. Refuse to overwrite a pre-existing
  // preference so no account or another worker's fixture can be replaced.
  const baseline = await evaluate(
    panel,
    `(async () => {
    const raw = (await chrome.storage.local.get(${JSON.stringify(KEY)}))[${JSON.stringify(KEY)}];
    return { empty: raw === undefined || (Array.isArray(raw) && raw.length === 0) };
  })()`,
  );
  assert.equal(baseline.empty, true, 'owned_never_capture_fixture_requires_empty_profile');
  await evaluate(
    panel,
    `(async () => {
    await chrome.storage.local.set({ [${JSON.stringify(KEY)}]: ${JSON.stringify([FIRST, SECOND])} });
  })()`,
  );
  try {
    await reloadSettings(panel);
    await openSection(panel, 'Privacy');
    const both = await waitFor(
      'owned_never_capture_both_visible',
      () => observe(panel),
      (state) => askAgainMatches(state, { count: 2, first: true, second: true }),
    );
    record('Two disposable loopback origins are visible and stored', both, true);

    await click(panel, 'settings-ask-again', FIRST.replace(/^https?:\/\//, ''));
    const one = await waitFor(
      'first_ask_again_removes_only_selected_origin',
      () => observe(panel),
      (state) => askAgainMatches(state, { count: 1, first: false, second: true }),
    );
    record('First Ask again removes only selected origin', one, true);
    await reloadSettings(panel);
    await openSection(panel, 'Privacy');
    const oneAfterReload = await observe(panel);
    record(
      'Unrelated origin remains after panel reload',
      oneAfterReload,
      askAgainMatches(oneAfterReload, { count: 1, first: false, second: true }),
    );

    await click(panel, 'settings-ask-again', SECOND.replace(/^https?:\/\//, ''));
    const empty = await waitFor(
      'last_ask_again_hides_empty_list',
      () => observe(panel),
      (state) => askAgainMatches(state, { count: 0, first: false, second: false }),
    );
    record('Last Ask again hides the empty list', empty, true);
    await reloadSettings(panel);
    await openSection(panel, 'Privacy');
    const emptyAfterReload = await observe(panel);
    record(
      'Empty list remains hidden after panel reload',
      emptyAfterReload,
      askAgainMatches(emptyAfterReload, { count: 0, first: false, second: false }),
    );
  } finally {
    // Remove only the disposable entries, including after a failed assertion.
    // Any unrelated value introduced during the run remains untouched.
    await evaluate(
      panel,
      `(async () => {
      const raw = (await chrome.storage.local.get(${JSON.stringify(KEY)}))[${JSON.stringify(KEY)}];
      if (!Array.isArray(raw)) return;
      const remaining = raw.filter((origin) => origin !== ${JSON.stringify(FIRST)} && origin !== ${JSON.stringify(SECOND)});
      if (remaining.length) await chrome.storage.local.set({ [${JSON.stringify(KEY)}]: remaining });
      else await chrome.storage.local.remove(${JSON.stringify(KEY)});
    })()`,
    );
  }
}
