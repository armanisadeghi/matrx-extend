import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FULL_EXTENSION_RECHECK_IDS,
  enforceFullExtensionRechecks,
  initializeFullExtensionRechecks,
  rerunGuestSettingsAfterExtensionReload,
  runFullExtensionRecheck,
  snapshotPanelDocumentReload,
} from './settings-full-extension-rechecks.mjs';
import { GUEST_PREFERENCES, preferenceBaseline } from './settings-guest-preference-batch.mjs';

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
  assert.equal(failed.fullExtensionReload.exception.name, 'Error');
  assert.equal(failed.fullExtensionReload.exception.code, 'other');
  assert.equal(
    failed.fullExtensionReload.exception.source.file,
    'settings-full-extension-rechecks.test.mjs',
  );
  assert.ok(failed.fullExtensionReload.exception.source.line > 0);
  assert.equal(JSON.stringify(failed).includes('injected_full_extension_failure'), false);
});

test('unexpected full-extension exceptions retain distinct safe source diagnostics', async () => {
  const capture = async (error) => {
    const item = { id: 'EXT-F-1003-T40', status: 'pass', steps: [], criteria: [] };
    await runFullExtensionRecheck(item, async () => {
      throw error;
    });
    return item.fullExtensionReload.exception;
  };
  const timeout = Object.assign(
    new TypeError('private URL https://private.invalid/?token=secret'),
    {
      code: 'ETIMEDOUT',
    },
  );
  const invalidState = Object.assign(new RangeError('private password'), {
    code: 'ERR_INVALID_STATE',
  });

  const first = await capture(timeout);
  const second = await capture(invalidState);
  assert.deepEqual(
    [first.name, first.code, first.source.file],
    ['TypeError', 'ETIMEDOUT', 'settings-full-extension-rechecks.test.mjs'],
  );
  assert.deepEqual(
    [second.name, second.code, second.source.file],
    ['RangeError', 'ERR_INVALID_STATE', 'settings-full-extension-rechecks.test.mjs'],
  );
  assert.notEqual(first.source.line, second.source.line);
  assert.equal(JSON.stringify({ first, second }).includes('private.invalid'), false);
  assert.equal(JSON.stringify({ first, second }).includes('secret'), false);
  assert.equal(JSON.stringify({ first, second }).includes('password'), false);
});

function fullRestartFixture({
  skipChoice = null,
  failNewChat = false,
  failSettingsCalls = [],
  failAcquireLivePanel = false,
  transportClasses = [],
} = {}) {
  const reportCases = cases();
  initializeFullExtensionRechecks(reportCases);
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
    T67: {
      active: true,
      sectionOpen: true,
      mode: { count: 1, visible: 'Capture', stored: 'capture' },
    },
  };
  const calls = { reloads: [], options: [], chats: [], caseRunners: [] };
  let settingsCalls = 0;
  let activePanel = { targetId: 'panel-initial-replacement', detach: async () => {} };
  let currentPreference;
  const allChoices = [
    ...GUEST_PREFERENCES,
    {
      caseId: 'T67',
      label: 'Auto-scrape mode',
      choices: [
        ['capture', 'Capture'],
        ['scroll-capture', 'Scroll & capture'],
      ],
    },
  ];
  const choiceDriver = {
    async click(panel, kind, label) {
      assert.equal(panel, activePanel);
      if (kind !== 'option') return;
      calls.options.push([currentPreference.caseId, label]);
      if (label === skipChoice) return;
      const preference = allChoices.find((item) => item.caseId === currentPreference.caseId);
      const [value] = preference.choices.find(([, optionLabel]) => optionLabel === label);
      if (preference.caseId === 'T67') {
        states.T67.mode.visible = label;
        states.T67.mode.stored = value;
      } else {
        const state = states[preference.caseId];
        state.selected = label;
        state.stored = value;
        if (preference.caseId === 'T04') state.darkClass = value === 'dark';
      }
    },
    async waitFor(name, read, accept) {
      const value = await read();
      assert.equal(accept(value), true, name);
      return value;
    },
  };
  const settings = async (panel) => {
    assert.equal(panel, activePanel);
    settingsCalls += 1;
    if (failSettingsCalls.includes(settingsCalls)) {
      const error = new Error('private page https://private.example/path?token=secret');
      error.pageText = 'private user content';
      error.token = 'secret';
      throw error;
    }
    if (states.T04) states.T04.activeSettings = true;
    if (states.T10) states.T10.activeSettings = true;
  };
  const openSection = async (panel) => assert.equal(panel, activePanel);
  const observePreference = async (panel, preference) => {
    assert.equal(panel, activePanel);
    currentPreference = preference;
    return { ...states[preference.caseId] };
  };
  const observeAutoScrapeMode = async (panel) => {
    assert.equal(panel, activePanel);
    currentPreference = { caseId: 'T67' };
    return structuredClone(states.T67);
  };
  const reloadExtension = async () => {
    const previous = activePanel;
    calls.reloads.push(previous.targetId);
    activePanel = { targetId: `panel-replacement-${calls.reloads.length}`, detach: async () => {} };
    for (const id of ['T04', 'T10']) {
      const preference = GUEST_PREFERENCES.find((item) => item.caseId === id);
      const choice = preference.choices.find(([value]) => value === states[id].stored);
      if (choice) states[id].selected = choice[1];
    }
    const [modeValue, modeLabel] = allChoices
      .at(-1)
      .choices.find(([value]) => value === states.T67.mode.stored);
    states.T67.mode.visible = modeLabel;
    return {
      panel: activePanel,
      management_reload_clicked: true,
      old_targets_retired: true,
      worker_replaced: true,
      panel_replaced: true,
      replacement_panel_target_id: activePanel.targetId,
      retirement_evidence: { timeline: { final_predicate: true } },
      previous_target_id: previous.targetId,
    };
  };
  const preExtensionBaselines = {
    T04: preferenceBaseline(states.T04, GUEST_PREFERENCES[0]),
    T10: preferenceBaseline(states.T10, GUEST_PREFERENCES[1]),
  };
  return {
    reportCases,
    states,
    calls,
    get activePanel() {
      return activePanel;
    },
    settings,
    openSection,
    observePreference,
    observeAutoScrapeMode,
    preExtensionBaselines,
    choiceDriver,
    reloadExtension,
    run: async () => {
      await rerunGuestSettingsAfterExtensionReload({
        panel: activePanel,
        cases: reportCases,
        preferences: GUEST_PREFERENCES,
        reloadSettings: async (panel) => assert.equal(panel, activePanel),
        settings,
        openSection,
        observeNewChatDefault: async (panel, mode, label) => {
          assert.equal(panel, activePanel);
          calls.chats.push({ mode, label });
          if (failNewChat && mode === 'ask') throw new Error('synthetic new-chat failure');
          return { modeLabel: label, modeIcon: mode };
        },
        observePreference,
        preferenceBaseline,
        preferenceMatches: (state, preference, value, label) => {
          if (preference.caseId !== 'T04')
            return (
              state?.activeSettings === true &&
              state?.count === 1 &&
              state?.selected === label &&
              state?.stored === value
            );
          return (
            state?.activeSettings === true &&
            state?.count === 1 &&
            state?.selected === label &&
            state?.stored === value &&
            state?.darkClass === (value === 'dark') &&
            state?.renderedBackgroundMatches === true
          );
        },
        preExtensionBaselines,
        runSectionsCase: async (_panel, _reload, record) => {
          calls.caseRunners.push('T28');
          record('sections', 'warm', { count: 44 }, true);
        },
        runAutoScrapeCase: async (_panel, _reload, record) => {
          calls.caseRunners.push('T40');
          record('switch', 'warm', { restored: true }, true);
        },
        reloadExtension,
        acquireLivePanel: async () => {
          if (failAcquireLivePanel)
            throw new Error('private recovery URL https://private.example/recover?token=secret');
          return activePanel;
        },
        choiceDriver,
        observeAutoScrapeMode,
        transportFailureClass: () => transportClasses.shift() ?? 'none',
      });
      enforceFullExtensionRechecks(reportCases);
    },
  };
}

test('each nonbaseline theme, mode, and capture choice survives its own real replacement boundary and restores baseline', async () => {
  const f = fullRestartFixture();
  await f.run();
  const [theme, mode, sections, autoScrape, scrapeMode] = f.reportCases;
  assert.equal(theme.fullExtensionReload.status, 'pass');
  assert.equal(mode.fullExtensionReload.status, 'pass');
  assert.equal(sections.fullExtensionReload.status, 'pass');
  assert.equal(autoScrape.fullExtensionReload.downstreamCapture.status, 'unverified');
  assert.equal(scrapeMode.fullExtensionReload.status, 'pass');
  assert.equal(f.states.T04.stored, 'system');
  assert.equal(f.states.T10.stored, 'act');
  assert.equal(f.states.T67.mode.stored, 'capture');
  assert.deepEqual(f.calls.reloads, [
    'panel-initial-replacement',
    'panel-replacement-1',
    'panel-replacement-2',
    'panel-replacement-3',
    'panel-replacement-4',
    'panel-replacement-5',
    'panel-replacement-6',
  ]);
  assert.deepEqual(f.calls.chats, [
    { mode: 'ask', label: 'Ask before acting' },
    { mode: 'act', label: 'Act without asking' },
  ]);
  assert.equal(
    mode.fullExtensionReload.criteria.filter((entry) => entry.name.includes('new chat inherits'))
      .length,
    2,
  );
  assert.equal(
    theme.fullExtensionReload.criteria.some((entry) =>
      entry.name.includes('survives full extension reload'),
    ),
    true,
  );
  assert.equal(
    scrapeMode.fullExtensionReload.criteria.some((entry) =>
      entry.name.includes('survives full extension reload'),
    ),
    true,
  );
});

test('a failed new-chat check still restores the original mode through another extension restart', async () => {
  const f = fullRestartFixture({ failNewChat: true });
  await f.run();
  const mode = f.reportCases.find((item) => item.id.endsWith('T10'));
  assert.equal(mode.fullExtensionReload.status, 'fail');
  assert.equal(f.states.T10.selected, 'Act without asking');
  assert.equal(f.states.T10.stored, 'act');
  assert.ok(f.calls.reloads.length >= 7);
  assert.equal(JSON.stringify(f.reportCases).includes('synthetic new-chat failure'), false);
});

test('pre-extension mode drift fails its case, restores the captured baseline, and does not leak observation text', async () => {
  const f = fullRestartFixture();
  f.states.T10.selected = 'Ask before acting';
  f.states.T10.stored = 'ask';
  await f.run();
  const mode = f.reportCases.find((item) => item.id.endsWith('T10'));
  assert.equal(mode.fullExtensionReload.status, 'fail');
  assert.equal(f.states.T10.selected, 'Act without asking');
  assert.equal(f.states.T10.stored, 'act');
  assert.ok(f.calls.reloads.length >= 1);
});

test('full-extension callbacks retain separate safe choice and restore stages plus allowlisted transport classes', async () => {
  const f = fullRestartFixture({
    failSettingsCalls: [2, 3],
    failAcquireLivePanel: true,
    transportClasses: ['command_timeout', 'protocol_error'],
  });
  await f.run();
  const theme = f.reportCases.find((item) => item.id.endsWith('T04'));
  assert.equal(theme.fullExtensionReload.status, 'fail');
  assert.equal(theme.fullExtensionReload.firstChoiceFailureStage, 'choice_settings_reopen');
  assert.equal(theme.fullExtensionReload.restorationFailureStage, 'restore_acquire_panel');
  assert.equal(theme.fullExtensionReload.firstChoiceTransportClass, 'command_timeout');
  assert.equal(theme.fullExtensionReload.restorationTransportClass, 'protocol_error');
  const serialized = JSON.stringify(theme.fullExtensionReload);
  assert.doesNotMatch(serialized, /private|secret|https?:\/\//);
  assert.ok(
    theme.fullExtensionReload.criteria.some(
      ({ evidence }) => evidence?.firstChoiceFailureStage === 'choice_settings_reopen',
    ),
    'the sanitized failure stage must reach the receipt criterion',
  );
});

test('post-replacement stage outcomes and preference booleans survive report serialization without raw errors', async () => {
  const f = fullRestartFixture({ failSettingsCalls: [2] });
  await f.run();
  const theme = f.reportCases.find((item) => item.id.endsWith('T04'));
  const diagnostics = theme.fullExtensionReload.firstChoicePostReplacementStages;

  assert.deepEqual(
    diagnostics.map(({ stage, outcome }) => [stage, outcome]),
    [
      ['choice_detach_previous_panel', 'completed'],
      ['choice_settings_reopen', 'failed'],
    ],
  );
  assert.equal(diagnostics[0].observation, null);
  assert.equal(diagnostics[1].observation, null);
  const serialized = JSON.stringify(theme.fullExtensionReload);
  assert.doesNotMatch(serialized, /private|secret|https?:\/\//);
  assert.doesNotMatch(serialized, /pageText|token/);
});

test('post-replacement preference observation retains only safe match booleans after a later failure', async () => {
  const f = fullRestartFixture({ failNewChat: true });
  await f.run();
  const mode = f.reportCases.find((item) => item.id.endsWith('T10'));
  const observation = mode.fullExtensionReload.firstChoicePostReplacementStages.find(
    ({ stage }) => stage === 'choice_preference_observation',
  )?.observation;

  assert.deepEqual(observation, {
    settingsActive: true,
    sectionOpen: null,
    selectedMatches: true,
    storedMatches: true,
    preferenceMatches: true,
  });
  assert.doesNotMatch(JSON.stringify(observation), /Dark|dark|System|system/);
});

test('later rechecks are unverified and stop using a panel after failed recovery', async () => {
  const f = fullRestartFixture({
    failSettingsCalls: [6, 7],
    failAcquireLivePanel: true,
    transportClasses: ['protocol_error', 'protocol_error'],
  });
  await f.run();
  const mode = f.reportCases.find((item) => item.id.endsWith('T10'));
  const sections = f.reportCases.find((item) => item.id.endsWith('T28'));
  const autoScrape = f.reportCases.find((item) => item.id.endsWith('T40'));
  const scrapeMode = f.reportCases.find((item) => item.id.endsWith('T67'));

  assert.equal(mode.fullExtensionReload.restorationFailureStage, 'restore_acquire_panel');
  assert.deepEqual(f.calls.caseRunners, []);
  for (const item of [sections, autoScrape, scrapeMode]) {
    assert.equal(item.fullExtensionReload.status, 'unverified');
    assert.equal(item.fullExtensionReload.error, 'previous_panel_recovery_failed');
    assert.equal(item.status, 'unverified');
  }
});

test('unrecognized transport details collapse to the safe other enum', async () => {
  const f = fullRestartFixture({
    failSettingsCalls: [2],
    transportClasses: ['private URL https://private.example/?token=secret'],
  });
  await f.run();
  const theme = f.reportCases.find((item) => item.id.endsWith('T04'));
  assert.equal(theme.fullExtensionReload.firstChoiceTransportClass, 'other');
  assert.equal(JSON.stringify(theme.fullExtensionReload).includes('private.example'), false);
  assert.equal(JSON.stringify(theme.fullExtensionReload).includes('secret'), false);
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
    /panel: replacement\.panel,[\s\S]*cases: report\.cases,[\s\S]*preExtensionBaselines,[\s\S]*reloadExtension,[\s\S]*acquireLivePanel,[\s\S]*preferenceMatches,[\s\S]*transportFailureClass/,
  );
  assert.match(source, /enforceFullExtensionRechecks\(report\.cases\)/);
  assert.match(
    packageJson.scripts['test:focused-acceptance'],
    /settings-full-extension-rechecks\.test\.mjs/,
  );
});
