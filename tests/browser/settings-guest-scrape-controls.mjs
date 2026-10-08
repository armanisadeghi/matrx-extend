import assert from 'node:assert/strict';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const STORAGE_KEY = 'matrx.settings.v1';
const nativeDriver = { click, evaluate, openSection, waitFor };
export const AUTO_SCRAPE_MODE_FAILURE_STAGES = Object.freeze([
  'initial_open',
  'initial_observe',
  'initial_validate',
  'choice_select',
  'choice_wait',
  'choice_record',
  'panel_reload',
  'panel_reopen',
  'panel_observe',
  'panel_record',
  'restore_open',
  'restore_observe',
  'restore_alternate_choice',
  'restore_baseline_choice',
  'restore_wait',
  'restore_reload',
  'restore_reopen',
  'restore_observe_after_reload',
  'restore_verify',
  'restore_record',
  'initial_baseline',
  'choice_select',
  'extension_reload',
  'restore_panel',
  'restore_choice',
  'restore_extension_reload',
]);
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

export async function observeGuestAutoScrapeMode(panel, driver = nativeDriver) {
  return observeScrape(panel, driver);
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
  const labels = { capture: 'Capture', 'scroll-capture': 'Scroll & capture' };
  let stage = 'initial_open';
  let baseline;
  try {
    await driver.openSection(panel, 'Scrape');
    stage = 'initial_observe';
    const initial = await observeScrape(panel, driver);
    baseline = initial.mode.stored;
    stage = 'initial_validate';
    assert.ok(Object.hasOwn(labels, baseline), 'auto_scrape_mode_requires_saved_baseline');
    assert.equal(
      initial.mode.visible,
      labels[baseline],
      'auto_scrape_mode_initial_ui_storage_disagree',
    );
  } catch {
    throw autoScrapeModeFailure(stage, 'case');
  }

  let caseFailureStage = null;
  let restoreFailureStage = null;
  try {
    for (const value of Object.keys(labels)
      .filter((choice) => choice !== baseline)
      .concat(baseline)) {
      stage = 'choice_select';
      await driver.click(panel, 'settings-select', 'Auto-scrape mode');
      await driver.click(panel, 'option', labels[value]);
      stage = 'choice_wait';
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
      stage = 'choice_record';
      record('warm', `${labels[value]} appears and persists`, warm, true);
      stage = 'panel_reload';
      await reloadSettings(panel);
      stage = 'panel_reopen';
      await driver.openSection(panel, 'Scrape');
      stage = 'panel_observe';
      const reloaded = await observeScrape(panel, driver);
      stage = 'panel_record';
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
  } catch {
    caseFailureStage = stage;
  }

  try {
    stage = 'restore_open';
    await driver.openSection(panel, 'Scrape');
    stage = 'restore_observe';
    const current = await observeScrape(panel, driver);
    if (current.mode.visible === labels[baseline] && current.mode.stored !== baseline) {
      const alternate = Object.keys(labels).find((value) => value !== baseline);
      stage = 'restore_alternate_choice';
      await driver.click(panel, 'settings-select', 'Auto-scrape mode');
      await driver.click(panel, 'option', labels[alternate]);
    }
    stage = 'restore_observe';
    if ((await observeScrape(panel, driver)).mode.visible !== labels[baseline]) {
      stage = 'restore_baseline_choice';
      await driver.click(panel, 'settings-select', 'Auto-scrape mode');
      await driver.click(panel, 'option', labels[baseline]);
    }
    stage = 'restore_wait';
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
    stage = 'restore_reload';
    await reloadSettings(panel);
    stage = 'restore_reopen';
    await driver.openSection(panel, 'Scrape');
    stage = 'restore_observe_after_reload';
    const persisted = await observeScrape(panel, driver);
    stage = 'restore_verify';
    assert.equal(
      scrapeModeMatches(
        { ...persisted.mode, active: persisted.active, sectionOpen: persisted.sectionOpen },
        baseline,
        labels[baseline],
      ),
      true,
      'auto_scrape_mode_baseline_not_restored_after_reload',
    );
    stage = 'restore_record';
    record('cleanup', 'Original Auto-scrape mode restored in UI and storage', restored, true);
  } catch {
    restoreFailureStage = stage;
  }

  if (caseFailureStage || restoreFailureStage) {
    const error = autoScrapeModeFailure(
      restoreFailureStage ?? caseFailureStage,
      caseFailureStage && restoreFailureStage
        ? 'case_and_restore'
        : restoreFailureStage
          ? 'restore'
          : 'case',
    );
    if (caseFailureStage && restoreFailureStage) error.safeOriginalStage = caseFailureStage;
    throw error;
  }
}

function autoScrapeModeFailure(stage, kind) {
  const error = new Error('auto_scrape_mode_recheck_failed');
  error.safeCategory = 'auto_scrape_mode_recheck_failed';
  error.safeStage = stage;
  error.safeFailureKind = kind;
  return error;
}

export function settingsSectionObservationExpression(label) {
  return `(async () => {
    const tab = [...document.querySelectorAll('button[role="tab"][title="Settings"][data-state="active"]')];
    const pane = tab.length === 1 ? document.getElementById(tab[0].getAttribute('aria-controls') ?? '') : null;
    const settingsRoot = pane?.firstElementChild;
    const scrollContainers = [...(settingsRoot?.children ?? [])]
      .filter((node) => node.classList.contains('overflow-y-auto'));
    const sectionList = scrollContainers.length === 1 ? scrollContainers[0].firstElementChild : null;
    const sections = [...(sectionList?.children ?? [])].map((wrapper) => {
      const header = wrapper.firstElementChild;
      const trigger = header?.firstElementChild;
      const content = wrapper.children[1] ?? null;
      return wrapper.children.length === 2 && header?.classList.contains('flex') &&
        trigger?.matches('button[aria-expanded][aria-controls]') &&
        content?.id === trigger.getAttribute('aria-controls') && content.hasAttribute('aria-hidden')
        ? trigger : null;
    }).filter((trigger) => trigger !== null);
    const expandedControls = [...(pane?.querySelectorAll('button[aria-expanded]') ?? [])];
    const headings = sections.map((node) => node.textContent.trim());
    const matches = sections.filter((node) => node.textContent.trim() === ${JSON.stringify(label)});
    const content = matches.length === 1 ? document.getElementById(matches[0].getAttribute('aria-controls') ?? '') : null;
    const raw = (await chrome.storage.local.get(${JSON.stringify(STORAGE_KEY)}))[${JSON.stringify(STORAGE_KEY)}];
    const digest = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(String(value))))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return { active: pane?.matches('[role="tabpanel"][data-state="active"]') === true,
      headings, count: matches.length, expanded: matches[0]?.getAttribute('aria-expanded') ?? null,
      expandedControlCount: expandedControls.length,
      nonSectionExpandedControlCount: expandedControls.length - sections.length,
      contentAriaHidden: content?.getAttribute('aria-hidden') ?? null, contentInert: content?.inert ?? null,
      contentNonempty: !!content?.textContent.trim(),
      contentRendered: !!content && content.getBoundingClientRect().height > 1 &&
        getComputedStyle(content).visibility !== 'hidden' && getComputedStyle(content).display !== 'none',
      emptyHint: ['Data', 'SEO'].includes(${JSON.stringify(label)}) ? content?.textContent.trim() === 'No options yet' : null,
      settingsDigest: await digest(raw) };
  })()`;
}

async function observeSection(panel, label, driver = nativeDriver) {
  return driver.evaluate(panel, settingsSectionObservationExpression(label));
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

function sectionCensusDiagnostic(state) {
  const headings = Array.isArray(state?.headings) ? state.headings : [];
  const knownHeadings = headings.filter((heading) => SECTIONS.includes(heading));
  return JSON.stringify({
    active: state?.active === true,
    count: headings.length,
    headings: knownHeadings,
    unrecognizedHeadingCount: headings.length - knownHeadings.length,
    expandedControlCount: Number.isInteger(state?.expandedControlCount)
      ? state.expandedControlCount
      : null,
    nonSectionExpandedControlCount: Number.isInteger(state?.nonSectionExpandedControlCount)
      ? state.nonSectionExpandedControlCount
      : null,
  });
}

export async function runGuestSectionsCase(panel, reloadSettings, record, driver = nativeDriver) {
  const baseline = await observeSection(panel, 'Account', driver);
  assert.equal(
    baseline.active &&
      Array.isArray(baseline.headings) &&
      baseline.headings.length === SECTIONS.length &&
      SECTIONS.every((name, index) => baseline.headings[index] === name),
    true,
    `guest_settings_sections_missing:${sectionCensusDiagnostic(baseline)}`,
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
