import assert from 'node:assert/strict';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const STORAGE_KEY = 'matrx.settings.v1';
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

async function observeScrape(panel) {
  return evaluate(
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

export async function runGuestAutoScrapeCase(panel, reloadSettings, record) {
  await openSection(panel, 'Scrape');
  const initial = await observeScrape(panel);
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
      await click(panel, 'switch', 'Auto-scrape on load');
      const warm = await waitFor(
        `auto_scrape_${expected}_warm`,
        () => observeScrape(panel),
        (state) =>
          scrapeSwitchMatches(
            { ...state?.toggle, active: state?.active, sectionOpen: state?.sectionOpen },
            expected,
          ),
      );
      record('warm', `Auto-scrape ${expected ? 'on' : 'off'} appears and persists`, warm, true);
      await reloadSettings(panel);
      await openSection(panel, 'Scrape');
      const reloaded = await observeScrape(panel);
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
    await openSection(panel, 'Scrape');
    const current = await observeScrape(panel);
    if (current.toggle.visible !== baseline) await click(panel, 'switch', 'Auto-scrape on load');
    const restored = await waitFor(
      'auto_scrape_baseline_restored',
      () => observeScrape(panel),
      (state) =>
        scrapeSwitchMatches(
          { ...state?.toggle, active: state?.active, sectionOpen: state?.sectionOpen },
          baseline,
        ),
    );
    record('cleanup', 'Original Auto-scrape value restored in UI and storage', restored, true);
  }
}

export async function runGuestAutoScrapeModeCase(panel, reloadSettings, record) {
  await openSection(panel, 'Scrape');
  const initial = await observeScrape(panel);
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
      await click(panel, 'settings-select', 'Auto-scrape mode');
      await click(panel, 'option', labels[value]);
      const warm = await waitFor(
        `auto_scrape_mode_${value}_warm`,
        () => observeScrape(panel),
        (state) =>
          scrapeModeMatches(
            { ...state?.mode, active: state?.active, sectionOpen: state?.sectionOpen },
            value,
            labels[value],
          ),
      );
      record('warm', `${labels[value]} appears and persists`, warm, true);
      await reloadSettings(panel);
      await openSection(panel, 'Scrape');
      const reloaded = await observeScrape(panel);
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
    await openSection(panel, 'Scrape');
    const current = await observeScrape(panel);
    if (current.mode.stored !== baseline || current.mode.visible !== labels[baseline]) {
      await click(panel, 'settings-select', 'Auto-scrape mode');
      await click(panel, 'option', labels[baseline]);
    }
    const restored = await waitFor(
      'auto_scrape_mode_baseline_restored',
      () => observeScrape(panel),
      (state) =>
        scrapeModeMatches(
          { ...state?.mode, active: state?.active, sectionOpen: state?.sectionOpen },
          baseline,
          labels[baseline],
        ),
    );
    record('cleanup', 'Original Auto-scrape mode restored in UI and storage', restored, true);
  }
}

async function observeSection(panel, label) {
  return evaluate(
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
    (!['Data', 'SEO'].includes(label) || state.emptyHint === true) &&
    state?.settingsDigest === baselineDigest
  );
}

export async function runGuestSectionsCase(panel, reloadSettings, record) {
  const baseline = await observeSection(panel, 'Account');
  assert.equal(
    baseline.active && baseline.headings.length === SECTIONS.length,
    true,
    'guest_settings_sections_missing',
  );
  for (const label of SECTIONS) {
    const initial = await observeSection(panel, label);
    try {
      if (initial.expanded !== 'true') await click(panel, 'section', label);
      const open = await waitFor(
        `${label}_section_open`,
        () => observeSection(panel, label),
        (state) => sectionMatches(state, label, true, baseline.settingsDigest),
      );
      record('warm', `${label} opens with honest content`, open, true);
      await click(panel, 'section', label);
      const closed = await waitFor(
        `${label}_section_closed`,
        () => observeSection(panel, label),
        (state) => sectionMatches(state, label, false, baseline.settingsDigest),
      );
      record('warm', `${label} closes without changing preferences`, closed, true);
    } finally {
      const current = await observeSection(panel, label);
      if (current.expanded !== initial.expanded) await click(panel, 'section', label);
    }
  }
  await reloadSettings(panel);
  for (const label of SECTIONS) {
    const initial = await observeSection(panel, label);
    try {
      if (initial.expanded !== 'true') await click(panel, 'section', label);
      const open = await waitFor(
        `${label}_section_reload_open`,
        () => observeSection(panel, label),
        (state) => sectionMatches(state, label, true, baseline.settingsDigest),
      );
      record('reload', `${label} opens after reload`, open, true);
      await click(panel, 'section', label);
      const closed = await waitFor(
        `${label}_section_reload_closed`,
        () => observeSection(panel, label),
        (state) => sectionMatches(state, label, false, baseline.settingsDigest),
      );
      record('reload', `${label} closes after reload`, closed, true);
    } finally {
      const current = await observeSection(panel, label);
      if (current.expanded !== initial.expanded) await click(panel, 'section', label);
    }
  }
}
