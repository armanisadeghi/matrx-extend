import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FULL_EXTENSION_RECHECK_IDS,
  captureGuestPreferenceBaselines,
  enforceFullExtensionRechecks,
  initializeFullExtensionRechecks,
  rerunGuestSettingsAfterExtensionReload,
  runFullExtensionRecheck,
  snapshotPanelDocumentReload,
} from './settings-full-extension-rechecks.mjs';
import {
  GUEST_PREFERENCES,
  preferenceBaseline,
  restoreGuestPreferenceBaseline,
} from './settings-guest-preference-batch.mjs';

function cases() {
  return FULL_EXTENSION_RECHECK_IDS.map((id) => ({
    id: `EXT-F-1003-${id}`,
    status: 'pass',
    steps: [],
    criteria: [
      { name: 'panel-document reload check', status: 'pass', evidence: { visible: true } },
    ],
  }));
}

test('missing or failed full-extension rechecks force the individual case to fail', async () => {
  const reportCases = cases();
  initializeFullExtensionRechecks(reportCases);
  const [theme, mode, sections, autoScrape, scrapeMode] = reportCases;

  await runFullExtensionRecheck(theme, async (record) => {
    record('theme visible, stored, and rendered after extension reload', 'pass', {
      selected: 'Dark',
      stored: 'dark',
      rendered: true,
    });
  });
  await runFullExtensionRecheck(mode, async (record) => {
    record('mode visible and stored after extension reload', 'pass', {
      selected: 'Act without asking',
      stored: 'act',
    });
    record('new chat inherits mode after extension reload', 'pass', {
      modeLabel: 'Act without asking',
      modeIcon: 'act',
    });
  });
  await runFullExtensionRecheck(sections, async (record) => {
    record('all section open/close assertions after extension reload', 'pass', { count: 44 });
  });
  await runFullExtensionRecheck(autoScrape, async (record, result) => {
    record('switch and stored value after extension reload; cleanup restored', 'pass', {
      visible: false,
      stored: false,
    });
    result.downstreamCapture = { status: 'unverified' };
  });
  await runFullExtensionRecheck(scrapeMode, async (record, result) => {
    record('mode picker and stored value after extension reload; cleanup restored', 'pass', {
      visible: 'Capture',
      stored: 'capture',
    });
    result.downstreamCapture = { status: 'unverified' };
  });

  const [fullTheme, fullMode, fullSections, fullAutoScrape, fullScrapeMode] = reportCases;
  snapshotPanelDocumentReload(fullTheme);
  assert.equal(fullTheme.panelDocumentReload.status, 'pass');
  assert.equal(fullTheme.fullExtensionReload.status, 'pass');
  assert.equal(fullMode.fullExtensionReload.criteria.length, 2);
  assert.equal(fullSections.fullExtensionReload.status, 'pass');
  assert.equal(fullAutoScrape.fullExtensionReload.downstreamCapture.status, 'unverified');
  assert.equal(fullScrapeMode.fullExtensionReload.downstreamCapture.status, 'unverified');

  const missing = { id: 'EXT-F-1003-T04', status: 'pass', criteria: [] };
  const failed = { id: 'EXT-F-1003-T10', status: 'pass', steps: [], criteria: [] };
  initializeFullExtensionRechecks([missing, failed]);
  await runFullExtensionRecheck(failed, async () => {
    throw new Error('injected_full_extension_failure');
  });
  enforceFullExtensionRechecks([missing, failed]);
  assert.equal(missing.fullExtensionReload.status, 'missing');
  assert.equal(missing.status, 'fail');
  assert.equal(failed.fullExtensionReload.status, 'fail');
  assert.equal(failed.status, 'fail');
  assert.equal(failed.fullExtensionReload.error, 'full_extension_recheck_exception');
  assert.equal(JSON.stringify(failed).includes('injected_full_extension_failure'), false);
});

test('actual full-extension orchestration uses the replacement panel and restores T04/T10 baselines after failure', async () => {
  const reportCases = cases();
  initializeFullExtensionRechecks(reportCases);
  const replacementPanel = { role: 'replacement-panel' };
  const themes = {
    selected: 'System',
    stored: 'system',
    activeSettings: true,
    count: 1,
    darkClass: false,
    systemDark: false,
    renderedBackgroundMatches: true,
  };
  const modes = {
    selected: 'Act without asking',
    stored: 'act',
    activeSettings: true,
    count: 1,
    darkClass: false,
    systemDark: false,
    renderedBackgroundMatches: true,
  };
  const calls = [];
  let activePreference;
  let pendingChoice = null;
  const preferenceFor = (expression) =>
    expression.includes('"theme"') ? GUEST_PREFERENCES[0] : GUEST_PREFERENCES[1];
  const driver = {
    async evaluate(panel, expression) {
      assert.equal(panel, replacementPanel);
      activePreference = preferenceFor(expression);
      return activePreference.caseId === 'T04' ? themes : modes;
    },
    async openSection(panel, label) {
      assert.equal(panel, replacementPanel);
      calls.push([activePreference?.caseId, 'section', label]);
    },
    async click(panel, kind, label) {
      assert.equal(panel, replacementPanel);
      calls.push([activePreference?.caseId, kind, label]);
      if (kind === 'settings-select') pendingChoice = activePreference;
      if (kind === 'option' && pendingChoice) {
        const [value] = pendingChoice.choices.find(([, choiceLabel]) => choiceLabel === label);
        const state = pendingChoice.caseId === 'T04' ? themes : modes;
        state.selected = label;
        state.stored = value;
        if (pendingChoice.caseId === 'T04') state.darkClass = value === 'dark';
        pendingChoice = null;
      }
    },
    async waitFor(_label, read, accept) {
      const state = await read();
      assert.equal(accept(state), true);
      return state;
    },
  };
  const observe = async (panel, preference) => {
    activePreference = preference;
    return driver.evaluate(panel, JSON.stringify(preference.key));
  };
  const recordBaselineRestore = (panel, preference, baseline, record) =>
    restoreGuestPreferenceBaseline(panel, preference, baseline, record, driver);
  const preExtensionBaselines = {
    T04: preferenceBaseline({ ...themes }, GUEST_PREFERENCES[0]),
    T10: preferenceBaseline({ ...modes }, GUEST_PREFERENCES[1]),
  };
  for (const item of reportCases) snapshotPanelDocumentReload(item);

  await rerunGuestSettingsAfterExtensionReload({
    panel: replacementPanel,
    cases: reportCases,
    preferences: GUEST_PREFERENCES,
    reloadSettings: async (panel) => assert.equal(panel, replacementPanel),
    settings: async (panel) => assert.equal(panel, replacementPanel),
    openSection: driver.openSection,
    observeNewChatDefault: async (panel, mode, label) => {
      assert.equal(panel, replacementPanel);
      return { modeLabel: label, modeIcon: mode };
    },
    runPreferenceCase: async (panel, _reload, preference, record, afterReload) => {
      assert.equal(panel, replacementPanel);
      calls.push([preference.caseId, 'run']);
      if (preference.caseId === 'T04') {
        themes.selected = 'Light';
        themes.stored = 'light';
        themes.darkClass = false;
        throw new Error('injected_theme_case_failure');
      }
      for (const [value, label] of preference.choices) {
        await driver.click(panel, 'settings-select', preference.label);
        await driver.click(panel, 'option', label);
        record(`${label} changes UI/storage`, await observe(panel, preference), true);
        await afterReload({ value, label });
      }
    },
    observePreference: observe,
    preferenceBaseline,
    preExtensionBaselines,
    restorePreferenceBaseline: recordBaselineRestore,
    runSectionsCase: async (panel, _reload, record) => {
      assert.equal(panel, replacementPanel);
      calls.push(['T28', 'run']);
      record('full extension section census/open/close', 'warm', { count: 44 }, true);
    },
    runAutoScrapeCase: async (panel, _reload, record) => {
      assert.equal(panel, replacementPanel);
      calls.push(['T40', 'run']);
      record('full extension Auto-scrape; baseline restored', 'reload', { restored: true }, true);
    },
    runAutoScrapeModeCase: async (panel, _reload, record) => {
      assert.equal(panel, replacementPanel);
      calls.push(['T67', 'run']);
      record('full extension capture mode; baseline restored', 'reload', { restored: true }, true);
    },
  });

  enforceFullExtensionRechecks(reportCases);
  assert.deepEqual(
    calls.filter(([, kind]) => kind === 'run').map(([id]) => id),
    ['T04', 'T10', 'T28', 'T40', 'T67'],
  );
  assert.equal(themes.selected, 'System');
  assert.equal(themes.stored, 'system');
  assert.equal(modes.selected, 'Act without asking');
  assert.equal(modes.stored, 'act');
  assert.deepEqual(
    calls.filter(([id, kind]) => id === 'T10' && kind === 'option').map(([, , label]) => label),
    ['Act without asking', 'Ask before acting', 'Act without asking'],
  );
  assert.equal(reportCases[0].fullExtensionReload.status, 'fail');
  assert.equal(
    reportCases[0].fullExtensionReload.error,
    'full_extension_preference_or_restore_failed',
  );
  assert.equal(JSON.stringify(reportCases).includes('injected_theme_case_failure'), false);
  assert.equal(reportCases[1].fullExtensionReload.status, 'pass');
  assert.equal(reportCases[1].panelDocumentReload.status, 'pass');
  assert.equal(reportCases[0].panelDocumentReload.status, 'pass');
  assert.equal(reportCases[0].status, 'fail');
  assert.equal(reportCases[3].fullExtensionReload.downstreamCapture.status, 'unverified');
  assert.equal(reportCases[4].fullExtensionReload.downstreamCapture.status, 'unverified');
});

test('pre-extension baseline survives Chat failure, drift and failed restoration without private error text', async () => {
  for (const mode of ['chat_failure', 'restore_failure', 'baseline_drift']) {
    const reportCases = cases();
    initializeFullExtensionRechecks(reportCases);
    reportCases[2].criteria.push({ name: 'prior warm failure', status: 'fail', evidence: null });
    const warmPanel = { role: 'warm' };
    const replacementPanel = { role: 'replacement' };
    const states = {
      T04: {
        activeSettings: true,
        count: 1,
        selected: 'System',
        stored: 'system',
        darkClass: false,
        systemDark: false,
        renderedBackgroundMatches: true,
      },
      T10: { activeSettings: true, count: 1, selected: 'Act without asking', stored: 'act' },
    };
    const events = [];
    let settingsActive = true;
    const preExtensionBaselines = await captureGuestPreferenceBaselines({
      panel: warmPanel,
      preferences: GUEST_PREFERENCES,
      settings: async (panel) => assert.equal(panel, warmPanel),
      openSection: async (panel) => assert.equal(panel, warmPanel),
      observePreference: async (panel, preference) => {
        assert.equal(panel, warmPanel);
        return states[preference.caseId];
      },
      preferenceBaseline,
    });
    if (mode === 'baseline_drift') {
      states.T10.selected = 'Ask before acting';
      states.T10.stored = 'ask';
    }
    await rerunGuestSettingsAfterExtensionReload({
      panel: replacementPanel,
      cases: reportCases,
      preferences: GUEST_PREFERENCES,
      preExtensionBaselines,
      settings: async (panel) => {
        assert.equal(panel, replacementPanel);
        events.push('settings');
        settingsActive = true;
      },
      openSection: async () => {},
      reloadSettings: async () => {},
      observeNewChatDefault: async () => ({}),
      observePreference: async (panel, preference) => {
        assert.equal(panel, replacementPanel);
        return states[preference.caseId];
      },
      preferenceBaseline,
      runPreferenceCase: async (_panel, _reload, preference, record) => {
        events.push(`${preference.caseId}_run`);
        if (preference.caseId === 'T10' && mode !== 'baseline_drift') {
          states.T10.selected = 'Ask before acting';
          states.T10.stored = 'ask';
          settingsActive = false;
          throw new Error('private Patient preview token=must-not-leak');
        }
        record('choice remained available', states[preference.caseId], true);
      },
      restorePreferenceBaseline: async (_panel, preference, baseline, record) => {
        events.push(`${preference.caseId}_restore`);
        assert.equal(settingsActive, true, 'Settings must be reopened before restoration');
        if (preference.caseId === 'T10' && mode === 'restore_failure')
          throw new Error('private restoration token=must-not-leak');
        states[preference.caseId].selected = baseline.label;
        states[preference.caseId].stored = baseline.value;
        record('restored', states[preference.caseId], true);
      },
      runSectionsCase: async (_panel, _reload, record) => record('sections', 'warm', {}, true),
      runAutoScrapeCase: async (_panel, _reload, record) => record('switch', 'warm', {}, true),
      runAutoScrapeModeCase: async (_panel, _reload, record) => record('mode', 'warm', {}, true),
    });
    enforceFullExtensionRechecks(reportCases);
    assert.deepEqual(
      events.filter((value) => value.endsWith('_run')),
      ['T04_run', 'T10_run'],
    );
    assert.equal(reportCases[1].status, 'fail');
    assert.equal(reportCases[2].fullExtensionReload.status, 'pass');
    assert.equal(reportCases[2].status, 'fail');
    assert.equal(JSON.stringify(reportCases).includes('must-not-leak'), false);
    if (mode === 'baseline_drift') {
      assert.equal(reportCases[1].fullExtensionReload.criteria[0].status, 'fail');
      assert.equal(states.T10.stored, 'act');
    } else {
      const restoreIndex = events.indexOf('T10_restore');
      assert.equal(events[restoreIndex - 1], 'settings');
      if (mode === 'chat_failure') assert.equal(states.T10.stored, 'act');
      else
        assert.equal(
          reportCases[1].fullExtensionReload.criteria.some((entry) => entry.status === 'fail'),
          true,
        );
    }
  }
});

test('native callback invokes tested orchestration after replacement Settings opens and enforces its result', async () => {
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const packageJson = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  const boundary = source.indexOf("status: 'settings_opened'");
  const capture = source.indexOf('await captureGuestPreferenceBaselines({');
  const reload = source.indexOf('const replacement = await reloadExtension()', capture);
  const recheck = source.indexOf('await rerunGuestSettingsAfterExtensionReload({');
  const reloadCatch = source.indexOf('report.guestStageFailed = guestStage', boundary);
  assert.ok(
    capture >= 0 &&
      reload > capture &&
      boundary > reload &&
      recheck > boundary &&
      reloadCatch > recheck,
  );
  assert.match(
    source.slice(recheck, reloadCatch),
    /panel: replacement\.panel,[\s\S]*cases: report\.cases,[\s\S]*preExtensionBaselines,[\s\S]*restorePreferenceBaseline: restoreGuestPreferenceBaseline/,
  );
  assert.match(source, /enforceFullExtensionRechecks\(report\.cases\)/);
  assert.match(
    packageJson.scripts['test:focused-acceptance'],
    /settings-full-extension-rechecks\.test\.mjs/,
  );
});
