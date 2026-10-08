import assert from 'node:assert/strict';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const STORAGE_KEY = 'matrx.settings.v1';
const nativeDriver = { click, evaluate, openSection, waitFor };
const SECTIONS = [
  'Account',
  'Organization',
  'Appearance',
  'Chat',
  'Privacy',
  'Scrape',
  'Data',
  'SEO',
  'Desktop bridge',
  'Data & reset',
  'About',
];

export function scrapeSwitchMatches(state, expected) {
  return (
    state?.active === true &&
    state?.sectionOpen === true &&
    state?.count === 1 &&
    state?.visible === expected &&
    state?.stored === expected
  );
}

export function scrapeModeMatches(state, value, label) {
  return (
    state?.active === true &&
    state?.sectionOpen === true &&
    state?.count === 1 &&
    state?.visible === label &&
    state?.stored === value
  );
}

async function observeScrape(panel, driver = nativeDriver) {
  return driver.evaluate(
    panel,
    `(async () => {
    const tab = [...document.querySelectorAll('button[role="tab"][title="Settings"][data-state="active"]')];
    const pane = tab.length === 1 ? document.getElementById(tab[0].getAttribute('aria-controls') ?? '') : null;
    const section = [...(pane?.querySelectorAll('button[aria-expanded]') ?? [])]
      .filter((node) => node.textContent.trim() === 'Scrape');
    const content = section.length === 1 ? document.getElementById(section[0].getAttribute('aria-controls') ?? '') : null;
    const toggle = [...(content?.querySelectorAll('[role="switch"][aria-label="Auto-scrape on load"]') ?? [])];
    const rows = [...(content?.querySelectorAll('span') ?? [])]
      .filter((node) => node.textContent.trim() === 'Auto-scrape mode');
    const picker = rows.flatMap((row) => [...row.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
    const raw = (await chrome.storage.local.get(${JSON.stringify(STORAGE_KEY)}))[${JSON.stringify(STORAGE_KEY)}];
    let stored = {};
    try { stored = JSON.parse(raw).state ?? {}; } catch {}
    return { active: pane?.matches('[role="tabpanel"][data-state="active"]') === true,
      sectionOpen: section.length === 1 && section[0].getAttribute('aria-expanded') === 'true',
      toggle: { count: toggle.length,
        visible: toggle[0]?.getAttribute('aria-checked') === 'true',
        stored: typeof stored.scrapeAutoOnLoad === 'boolean' ? stored.scrapeAutoOnLoad : null },
      mode: { count: picker.length, visible: picker[0]?.textContent.trim() ?? null,
        stored: ['capture', 'scroll-capture'].includes(stored.scrapeAutoMode) ? stored.scrapeAutoMode : null } };
  })()`,
  );
}

export async function runGuestAutoScrapeCase(panel, reloadSettings, record, driver = nativeDriver) {
  await driver.openSection(panel, 'Scrape');
  const initial = await observeScrape(panel, driver);
  assert.equal(
    initial.active && initial.sectionOpen && initial.toggle.count === 1,
    true,
    'auto_scrape_requires_visible_guest_control',
  );
  assert.equal(
    initial.toggle.visible,
    initial.toggle.stored,
    'auto_scrape_initial_ui_storage_disagree',
  );
  const baseline = initial.toggle.visible;
  try {
    for (const expected of [!baseline, baseline]) {
      await driver.click(panel, 'switch', 'Auto-scrape on load');
      const warm = await driver.waitFor(
        `auto_scrape_${expected}_warm`,
        () => observeScrape(panel, driver),
        (state) =>
          scrapeSwitchMatches(
            { ...state?.toggle, active: state?.active, sectionOpen: state?.sectionOpen },
            expected,
          ),
      );
      record('warm', `Auto-scrape ${expected ? 'on' : 'off'} appears and persists`, warm, true);
      await reloadSettings(panel);
      await driver.openSection(panel, 'Scrape');
      const reloaded = await observeScrape(panel, driver);
      record(
        'reload',
        `Auto-scrape ${expected ? 'on' : 'off'} survives reload`,
        reloaded,
        scrapeSwitchMatches(
          { ...reloaded.toggle, active: reloaded.active, sectionOpen: reloaded.sectionOpen },
          expected,
        ),
      );
    }
  } finally {
    await driver.openSection(panel, 'Scrape');
    const current = await observeScrape(panel, driver);
    // A stale UI can already show the baseline while storage still holds the other value.
    // Drive away and back so the baseline write is exercised by a real control click.
    if (current.toggle.visible === baseline && current.toggle.stored !== baseline) {
      await driver.click(panel, 'switch', 'Auto-scrape on load');
    }
    if ((await observeScrape(panel, driver)).toggle.visible !== baseline)
      await driver.click(panel, 'switch', 'Auto-scrape on load');
    const restored = await driver.waitFor(
      'auto_scrape_baseline_restored',
      () => observeScrape(panel, driver),
      (state) =>
        scrapeSwitchMatches(
          { ...state?.toggle, active: state?.active, sectionOpen: state?.sectionOpen },
          baseline,
        ),
    );
    await reloadSettings(panel);
    await driver.openSection(panel, 'Scrape');
    const persisted = await observeScrape(panel, driver);
    assert.equal(
      scrapeSwitchMatches(
        { ...persisted.toggle, active: persisted.active, sectionOpen: persisted.sectionOpen },
        baseline,
      ),
      true,
      'auto_scrape_baseline_not_restored_after_reload',
    );
    record('cleanup', 'Original Auto-scrape value restored in UI and storage', restored, true);
  }
}

export async function runGuestAutoScrapeModeCase(
  panel,
  reloadSettings,
  record,
  driver = nativeDriver,
) {
  await driver.openSection(panel, 'Scrape');
  const initial = await observeScrape(panel, driver);
  const labels = { capture: 'Capture', 'scroll-capture': 'Scroll & capture' };
  const baseline = initial.mode.stored;
  assert.ok(Object.hasOwn(labels, baseline), 'auto_scrape_mode_requires_saved_baseline');
  assert.equal(
    initial.mode.visible,
    labels[baseline],
    'auto_scrape_mode_initial_ui_storage_disagree',
  );
  try {
    for (const value of Object.keys(labels)
      .filter((choice) => choice !== baseline)
      .concat(baseline)) {
      await driver.click(panel, 'settings-select', 'Auto-scrape mode');
      await driver.click(panel, 'option', labels[value]);
      const warm = await driver.waitFor(
        `auto_scrape_mode_${value}_warm`,
        () => observeScrape(panel, driver),
        (state) =>
          scrapeModeMatches(
            { ...state?.mode, active: state?.active, sectionOpen: state?.sectionOpen },
            value,
            labels[value],
          ),
      );
      record('warm', `${labels[value]} appears and persists`, warm, true);
      await reloadSettings(panel);
      await driver.openSection(panel, 'Scrape');
      const reloaded = await observeScrape(panel, driver);
      record(
        'reload',
        `${labels[value]} survives reload`,
        reloaded,
        scrapeModeMatches(
          { ...reloaded.mode, active: reloaded.active, sectionOpen: reloaded.sectionOpen },
          value,
          labels[value],
        ),
      );
    }
  } finally {
    await driver.openSection(panel, 'Scrape');
    const current = await observeScrape(panel, driver);
    if (current.mode.visible === labels[baseline] && current.mode.stored !== baseline) {
      const alternate = Object.keys(labels).find((value) => value !== baseline);
      await driver.click(panel, 'settings-select', 'Auto-scrape mode');
      await driver.click(panel, 'option', labels[alternate]);
    }
    if ((await observeScrape(panel, driver)).mode.visible !== labels[baseline]) {
      await driver.click(panel, 'settings-select', 'Auto-scrape mode');
      await driver.click(panel, 'option', labels[baseline]);
    }
    const restored = await driver.waitFor(
      'auto_scrape_mode_baseline_restored',
      () => observeScrape(panel, driver),
      (state) =>
        scrapeModeMatches(
          { ...state?.mode, active: state?.active, sectionOpen: state?.sectionOpen },
          baseline,
          labels[baseline],
        ),
    );
    await reloadSettings(panel);
    await driver.openSection(panel, 'Scrape');
    const persisted = await observeScrape(panel, driver);
    assert.equal(
      scrapeModeMatches(
        { ...persisted.mode, active: persisted.active, sectionOpen: persisted.sectionOpen },
        baseline,
        labels[baseline],
      ),
      true,
      'auto_scrape_mode_baseline_not_restored_after_reload',
    );
    record('cleanup', 'Original Auto-scrape mode restored in UI and storage', restored, true);
  }
}

async function observeSection(panel, label, driver = nativeDriver) {
  return driver.evaluate(
    panel,
    `(async () => {
    const tab = [...document.querySelectorAll('button[role="tab"][title="Settings"][data-state="active"]')];
    const pane = tab.length === 1 ? document.getElementById(tab[0].getAttribute('aria-controls') ?? '') : null;
    const headings = [...(pane?.querySelectorAll('button[aria-expanded]') ?? [])].map((node) => node.textContent.trim());
    const matches = [...(pane?.querySelectorAll('button[aria-expanded]') ?? [])].filter((node) => node.textContent.trim() === ${JSON.stringify(label)});
    const content = matches.length === 1 ? document.getElementById(matches[0].getAttribute('aria-controls') ?? '') : null;
    const raw = (await chrome.storage.local.get(${JSON.stringify(STORAGE_KEY)}))[${JSON.stringify(STORAGE_KEY)}];
    const digest = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(String(value))))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return { active: pane?.matches('[role="tabpanel"][data-state="active"]') === true,
      headings, count: matches.length, expanded: matches[0]?.getAttribute('aria-expanded') ?? null,
      contentAriaHidden: content?.getAttribute('aria-hidden') ?? null, contentInert: content?.inert ?? null,
      contentNonempty: !!content?.textContent.trim(),
      contentRendered: !!content && content.getBoundingClientRect().height > 1 &&
        getComputedStyle(content).visibility !== 'hidden' && getComputedStyle(content).display !== 'none',
      emptyHint: ['Data', 'SEO'].includes(${JSON.stringify(label)}) ? content?.textContent.trim() === 'No options yet' : null,
      settingsDigest: await digest(raw) };
  })()`,
  );
}

export function sectionMatches(state, label, expanded, baselineDigest) {
  return (
    state?.active === true &&
    state?.count === 1 &&
    state?.headings?.length === SECTIONS.length &&
    SECTIONS.every((name, index) => state.headings[index] === name) &&
    state?.expanded === String(expanded) &&
    state?.contentAriaHidden === String(!expanded) &&
    state?.contentInert === !expanded &&
    state?.contentNonempty === true &&
    state?.contentRendered === expanded &&
    (!['Data', 'SEO'].includes(label) || state.emptyHint === true) &&
    state?.settingsDigest === baselineDigest
  );
}

export async function runGuestSectionsCase(panel, reloadSettings, record, driver = nativeDriver) {
  const baseline = await observeSection(panel, 'Account', driver);
  assert.equal(
    baseline.active && baseline.headings.length === SECTIONS.length,
    true,
    'guest_settings_sections_missing',
  );
  for (const label of SECTIONS) {
    const initial = await observeSection(panel, label, driver);
    try {
      if (initial.expanded !== 'true') await driver.click(panel, 'section', label);
      const open = await driver.waitFor(
        `${label}_section_open`,
        () => observeSection(panel, label, driver),
        (state) => sectionMatches(state, label, true, baseline.settingsDigest),
      );
      record('warm', `${label} opens with honest content`, open, true);
      await driver.click(panel, 'section', label);
      const closed = await driver.waitFor(
        `${label}_section_closed`,
        () => observeSection(panel, label, driver),
        (state) => sectionMatches(state, label, false, baseline.settingsDigest),
      );
      record('warm', `${label} closes without changing preferences`, closed, true);
    } finally {
      const current = await observeSection(panel, label, driver);
      if (current.expanded !== initial.expanded) await driver.click(panel, 'section', label);
      await driver.waitFor(
        `${label}_section_restored`,
        () => observeSection(panel, label, driver),
        (state) =>
          sectionMatches(state, label, initial.expanded === 'true', baseline.settingsDigest),
      );
    }
  }
  await reloadSettings(panel);
  for (const label of SECTIONS) {
    const initial = await observeSection(panel, label, driver);
    try {
      if (initial.expanded !== 'true') await driver.click(panel, 'section', label);
      const open = await driver.waitFor(
        `${label}_section_reload_open`,
        () => observeSection(panel, label, driver),
        (state) => sectionMatches(state, label, true, baseline.settingsDigest),
      );
      record('reload', `${label} opens after reload`, open, true);
      await driver.click(panel, 'section', label);
      const closed = await driver.waitFor(
        `${label}_section_reload_closed`,
        () => observeSection(panel, label, driver),
        (state) => sectionMatches(state, label, false, baseline.settingsDigest),
      );
      record('reload', `${label} closes after reload`, closed, true);
    } finally {
      const current = await observeSection(panel, label, driver);
      if (current.expanded !== initial.expanded) await driver.click(panel, 'section', label);
      await driver.waitFor(
        `${label}_section_reload_restored`,
        () => observeSection(panel, label, driver),
        (state) =>
          sectionMatches(state, label, initial.expanded === 'true', baseline.settingsDigest),
      );
    }
  }
}
