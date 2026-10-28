import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import {
  FULL_EXTENSION_RECHECK_IDS,
  enforceFullExtensionRechecks,
  initializeFullExtensionRechecks,
  rerunGuestSettingsAfterExtensionReload,
  runFullExtensionRecheck,
  snapshotPanelDocumentReload,
} from './settings-full-extension-rechecks.mjs';
import {
  GUEST_PREFERENCES,
  observeGuestPreference,
  preferenceBaseline,
} from './settings-guest-preference-batch.mjs';
import {
  runGuestSectionsCase,
  scrapeSwitchWaitDiagnostic,
} from './settings-guest-scrape-controls.mjs';
import { waitFor } from './settings-panel-driver.mjs';

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
      permissionMode: 'act',
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

test('T28 and T40 failures retain only safe census and wait samples', async () => {
  const sections = cases().find((item) => item.id.endsWith('T28'));
  await runFullExtensionRecheck(sections, async () => {
    await runGuestSectionsCase(
      null,
      async () => {},
      () => {},
      {
        evaluate: async () => ({
          active: true,
          headings: ['Account'],
          expandedControlCount: 14,
          nonSectionExpandedControlCount: 4,
          raw: 'private page text',
        }),
      },
    );
  });
  assert.deepEqual(sections.fullExtensionReload.exception.sectionCensus, {
    active: true,
    count: 1,
    unrecognizedHeadingCount: 0,
    expandedControlCount: 14,
    nonSectionExpandedControlCount: 4,
    headings: ['Account'],
  });
  const scrape = cases().find((item) => item.id.endsWith('T40'));
  await runFullExtensionRecheck(scrape, async () => {
    await waitFor(
      'auto_scrape_true_warm',
      async () => ({
        active: true,
        sectionOpen: true,
        toggle: { count: 1, visible: true, stored: false, raw: 'private storage' },
      }),
      (state) => state.toggle.stored === true,
      1,
      (state) => scrapeSwitchWaitDiagnostic(state, true),
    );
  });
  assert.deepEqual(scrape.fullExtensionReload.exception.wait, {
    label: 'auto_scrape_true_warm',
    sample: {
      active: true,
      sectionOpen: true,
      controlCount: 1,
      visibleMatches: true,
      storedMatches: false,
    },
  });
  assert.equal(JSON.stringify({ sections, scrape }).includes('private'), false);
});

test('inner restoration serialization rejects unknown stages and strips arbitrary observation fields', async () => {
  const item = cases()[0];
  const capture = async (diagnostic) => {
    await runFullExtensionRecheck(item, async () => {
      throw Object.assign(new Error('private password'), {
        safeCategory: 'full_extension_preference_or_restore_failed',
        safeBaselineRestoration: diagnostic,
      });
    });
    return item.fullExtensionReload.baselineRestoration;
  };
  assert.equal(await capture({ stage: 'private page' }), null);
  const diagnostic = await capture({
    stage: 'remove_absent_key',
    errorName: 'private password',
    observation: {
      settingsActive: true,
      storedPresent: false,
      storagePresent: 'secret',
      token: 'secret',
    },
  });
  assert.equal(diagnostic.errorName, 'OtherError');
  assert.equal(diagnostic.observation.settingsActive, true);
  assert.equal(diagnostic.observation.storedPresent, false);
  assert.equal(diagnostic.observation.storagePresent, null);
  assert.equal(JSON.stringify(diagnostic).includes('secret'), false);
  assert.equal(JSON.stringify(diagnostic).includes('password'), false);
});

function fullRestartFixture({
  mutateModeAfterReplacement = false,
  realModeStorage = false,
  mutateRawModeAfterReplacement = false,
  absentTheme = false,
  absentMode = false,
  omitChoiceDriver = false,
  baselineStoragePresent = false,
  failBaselineRestore = null,
  skipChoice = null,
  failNewChat = false,
  refusalNeverShows = false,
  failSettingsCalls = [],
  failAcquireLivePanel = false,
  transportClasses = [],
  scrapeContainerPresent = true,
  materializeScrapeInT40 = false,
  settingsFailureByCall = {},
  materializeThemeMode = false,
  mutateModeOnThemeRead = null,
  sectionFailureByCall = {},
  restorationFault = null,
  rerun = rerunGuestSettingsAfterExtensionReload,
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
    T10: {
      activeSettings: true,
      count: 1,
      selected: 'Act without asking',
      shadowFootprint: emptyModeFootprint(),
      stored: null,
      storedPresent: false,
      storagePresent: false,
      saveRefusal: false,
    },
    T67: {
      active: true,
      sectionOpen: true,
      mode: { count: 1, visible: 'Capture', stored: 'capture' },
    },
  };
  if (absentTheme)
    Object.assign(states.T04, {
      stored: null,
      storedPresent: false,
      storagePresent: baselineStoragePresent,
    });
  if (absentMode) states.T10.storagePresent = false;
  const settingsKey = 'matrx.settings.v1';
  const scrapeBaseline = JSON.stringify({
    state: { scrapeAutoMode: 'capture', scrapeAutoOnLoad: false, theme: 'system' },
    version: 0,
  });
  const storage = scrapeContainerPresent ? { [settingsKey]: scrapeBaseline } : {};
  const calls = {
    reloads: [],
    options: [],
    chats: [],
    caseRunners: [],
    scrapeBaseline,
    removals: [],
    observations: [],
    sections: 0,
  };
  const modeDocument = realModeStorage ? new Window().document : null;
  if (modeDocument)
    modeDocument.body.innerHTML =
      '<button role="tab" data-matrx-title="Settings" data-state="active" aria-controls="settings-pane"></button><div id="settings-pane" role="tabpanel" data-state="active"><div><div><span>Default mode</span></div><button role="combobox">Act without asking</button></div></div>';
  const local = {
    get: async (keys) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys])
          .filter((key) => Object.hasOwn(storage, key))
          .map((key) => [key, structuredClone(storage[key])]),
      ),
    remove: async (key) => {
      calls.removals.push(key);
      delete storage[key];
    },
    set: async (entries) => Object.assign(storage, entries),
  };
  let settingsCalls = 0;
  const lifecycle = {
    choiceReloadComplete: false,
    restorationStarted: false,
    restorationModeVerified: false,
    restorationReload: false,
    faultInjected: false,
    recoveryFaultInjected: false,
  };
  // CDP is the external dependency in the native-default-driver lane. The real
  // click/wait/restore helpers and production rerun callback remain in use.
  let pointerTarget;
  const makePanel = (targetId) => ({
    targetId,
    detach: async () => {},
    async send(method, params) {
      if (method === 'Input.dispatchMouseEvent') {
        if (params.type === 'mouseReleased')
          await choiceDriver.click(activePanel, ...pointerTarget);
        return {};
      }
      assert.equal(method, 'Runtime.evaluate');
      const script = params.expression;
      const pointer = script.match(/const kind = ("[^"\n]+"), label = ("[^"\n]+");/);
      let value;
      if (pointer) {
        pointerTarget = [JSON.parse(pointer[1]), JSON.parse(pointer[2])];
        value = { count: 1, matchedCount: 1, x: 40, y: 40, hitTarget: true, animating: false };
      } else if (script.includes('return { count: buttons.length, expanded:')) {
        value = { count: 1, expanded: 'true' };
      } else if (script.includes("?.getAttribute('aria-expanded'))()")) {
        value = 'true';
      } else {
        value = await choiceDriver.evaluate(activePanel, script);
      }
      return { result: { value } };
    },
  });
  let activePanel = makePanel('panel-initial-replacement');
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
    async evaluate(panel, script) {
      assert.equal(panel, activePanel);
      if (realModeStorage && script.includes('const shadowFootprint = "T10"')) {
        currentPreference = GUEST_PREFERENCES.find((item) => item.caseId === 'T10');
        return JSON.parse(
          JSON.stringify(
            await runInNewContext(script, {
              document: modeDocument,
              window: { matchMedia: () => ({ matches: false }) },
              getComputedStyle: () => ({ backgroundColor: 'rgb(255, 255, 255)' }),
              TextEncoder,
              crypto: webcrypto,
              chrome: { storage: { local } },
            }),
          ),
        );
      }
      if (script.includes('"defaultPermissionMode"'))
        currentPreference = GUEST_PREFERENCES.find((item) => item.caseId === 'T10');
      if (
        script.includes('chrome.storage.local') &&
        !script.includes('const originalStoragePresent =') &&
        !script.includes('document.')
      ) {
        return runInNewContext(script, {
          chrome: { storage: { local } },
          crypto: webcrypto,
          TextEncoder,
        });
      }
      if (script.includes('const originalStoragePresent =')) {
        if (realModeStorage)
          await runInNewContext(script, {
            chrome: { storage: { local } },
            crypto: webcrypto,
            TextEncoder,
          });
        if (failBaselineRestore === 'remove_absent_key')
          throw new TypeError('private token secret');
        const restored = script.includes('"defaultPermissionMode"') ? states.T10 : states.T04;
        Object.assign(restored, {
          stored: null,
          storedPresent: false,
          storagePresent: baselineStoragePresent,
        });
      }
      return { ...(script.includes('"defaultPermissionMode"') ? states.T10 : states.T04) };
    },
    async click(panel, kind, label) {
      assert.equal(panel, activePanel);
      if (kind === 'settings-select') {
        const control = allChoices.find((item) => item.label === label);
        assert.ok(control, `unknown fixture control ${label}`);
        currentPreference = control;
      }
      if (kind !== 'option') return;
      calls.options.push([currentPreference.caseId, label]);
      if (label === skipChoice) return;
      const preference = allChoices.find((item) => item.caseId === currentPreference.caseId);
      const [value] = preference.choices.find(([, optionLabel]) => optionLabel === label);
      if (preference.caseId === 'T67') {
        states.T67.mode.visible = label;
        states.T67.mode.stored = value;
        const parsed = storage[settingsKey]
          ? JSON.parse(storage[settingsKey])
          : { state: {}, version: 0 };
        parsed.state.scrapeAutoMode = value;
        storage[settingsKey] = JSON.stringify(parsed);
      } else {
        const state = states[preference.caseId];
        if (preference.caseId === 'T10') {
          if (refusalNeverShows) {
            state.selected = 'Ask before acting';
            state.saveRefusal = false;
          } else {
            state.saveRefusal = true;
            if (modeDocument && !modeDocument.querySelector('[role="alert"]'))
              modeDocument
                .getElementById('settings-pane')
                .insertAdjacentHTML(
                  'beforeend',
                  '<div role="alert">Sign in to save Default mode.</div>',
                );
          }
          return;
        }
        state.selected = label;
        state.stored = value;
        if (preference.caseId === 'T04') {
          if (materializeThemeMode)
            storage[settingsKey] = JSON.stringify({
              state: { theme: value, defaultPermissionMode: 'ask' },
              version: 0,
            });
          state.darkClass = value === 'dark';
          if (absentTheme) Object.assign(state, { storedPresent: true, storagePresent: true });
        }
      }
    },
    async waitFor(name, read, accept) {
      const value = await read();
      assert.equal(accept(value), true, name);
      if (name === 'Theme_light_after_extension_reload') lifecycle.choiceReloadComplete = true;
      if (
        name === 'T04_full_extension_baseline_restored' &&
        failBaselineRestore === 'observe_restored_baseline'
      ) {
        throw new RangeError('private user page');
      }
      return value;
    },
  };
  const settings = async (panel, onStep = () => {}) => {
    assert.equal(panel, activePanel);
    settingsCalls += 1;
    onStep('settings_tab_wait_started');
    onStep('before_click');
    if (lifecycle.choiceReloadComplete && !lifecycle.restorationStarted)
      lifecycle.restorationStarted = true;
    if (
      restorationFault === 'final_reload' &&
      lifecycle.restorationReload &&
      !lifecycle.faultInjected
    ) {
      lifecycle.faultInjected = true;
      throw Object.assign(new Error('private'), {
        driverFailure: { code: 'pointer_target_not_unique' },
      });
    }
    if (
      restorationFault === 'unknown_then_recovery' &&
      lifecycle.faultInjected &&
      !lifecycle.recoveryFaultInjected
    ) {
      lifecycle.recoveryFaultInjected = true;
      throw Object.assign(new Error('private'), {
        driverFailure: { code: 'pointer_stable_hit_not_observed' },
      });
    }
    if (Object.hasOwn(settingsFailureByCall, settingsCalls))
      throw settingsFailureByCall[settingsCalls];
    onStep('click_returned');
    onStep('guest_wait_started');
    if (failSettingsCalls.includes(settingsCalls)) {
      const error = new Error('private page https://private.example/path?token=secret');
      error.pageText = 'private user content';
      error.token = 'secret';
      throw error;
    }
    if (states.T04) states.T04.activeSettings = true;
    if (states.T10) states.T10.activeSettings = true;
  };
  const openSection = async (panel) => {
    assert.equal(panel, activePanel);
    calls.sections += 1;
    if (
      restorationFault === 'unknown_then_recovery' &&
      lifecycle.restorationModeVerified &&
      !lifecycle.faultInjected
    ) {
      lifecycle.faultInjected = true;
      throw new Error('private first restoration');
    }
    if (Object.hasOwn(sectionFailureByCall, calls.sections))
      throw sectionFailureByCall[calls.sections];
  };
  const observePreference = async (panel, preference) => {
    calls.observations.push(preference.caseId);
    if (
      preference.caseId === 'T04' &&
      calls.observations.filter((id) => id === 'T04').length === mutateModeOnThemeRead
    )
      Object.assign(states.T10.shadowFootprint.stores[0], {
        storagePresent: true,
        fieldPresent: true,
        parseStatus: 'valid',
        mode: 'ask',
        fingerprint: 'a'.repeat(64),
      });
    assert.equal(panel, activePanel);
    currentPreference = preference;
    if (preference.caseId === 'T10' && lifecycle.restorationStarted)
      lifecycle.restorationModeVerified = true;
    if (
      restorationFault === 'baseline' &&
      preference.caseId === 'T04' &&
      lifecycle.restorationStarted &&
      !lifecycle.faultInjected
    ) {
      lifecycle.faultInjected = true;
      Object.assign(states.T10.shadowFootprint.stores[0], {
        storagePresent: true,
        fieldPresent: true,
        parseStatus: 'valid',
        mode: 'ask',
        fingerprint: 'a'.repeat(64),
      });
    }
    if (realModeStorage && preference.caseId === 'T10')
      return observeGuestPreference(panel, preference, choiceDriver);
    return { ...states[preference.caseId] };
  };
  const observeAutoScrapeMode = async (panel) => {
    assert.equal(panel, activePanel);
    currentPreference = { caseId: 'T67' };
    return {
      ...structuredClone(states.T67),
      storagePresent: Object.hasOwn(storage, settingsKey),
      mode: {
        ...states.T67.mode,
        storedPresent: Boolean(
          storage[settingsKey] &&
            Object.hasOwn(JSON.parse(storage[settingsKey]).state, 'scrapeAutoMode'),
        ),
      },
    };
  };
  const reloadExtension = async () => {
    if (mutateRawModeAfterReplacement)
      storage[settingsKey] = JSON.stringify({ state: { defaultPermissionMode: 'ask' } });
    if (mutateModeAfterReplacement) {
      const entry = states.T10.shadowFootprint.stores[1];
      Object.assign(entry, {
        storagePresent: true,
        fieldPresent: true,
        parseStatus: 'valid',
        fingerprint: 'a'.repeat(64),
        count: 1,
      });
    }
    const previous = activePanel;
    if (lifecycle.restorationStarted && states.T04.selected === 'System')
      lifecycle.restorationReload = true;
    calls.reloads.push(previous.targetId);
    activePanel = makePanel(`panel-replacement-${calls.reloads.length}`);
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
    lifecycle,
    storage,
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
      await rerun({
        panel: activePanel,
        cases: reportCases,
        preferences: GUEST_PREFERENCES,
        reloadSettings: async (panel) => {
          assert.equal(panel, activePanel);
          const mode = storage[settingsKey]
            ? (JSON.parse(storage[settingsKey]).state.scrapeAutoMode ?? 'capture')
            : 'capture';
          states.T67.mode.stored = mode;
          states.T67.mode.visible = mode === 'capture' ? 'Capture' : 'Scroll & capture';
        },
        settings,
        openSection,
        observeNewChatDefault: async (panel, mode, label) => {
          assert.equal(panel, activePanel);
          calls.chats.push({ mode, label });
          if (failNewChat && mode === 'act') throw new Error('synthetic new-chat failure');
          return { modeLabel: label, permissionMode: mode };
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
          if (materializeScrapeInT40) storage[settingsKey] = scrapeBaseline;
          record('switch', 'warm', { restored: true }, true);
        },
        reloadExtension,
        acquireLivePanel: async () => {
          if (failAcquireLivePanel)
            throw new Error('private recovery URL https://private.example/recover?token=secret');
          return activePanel;
        },
        ...(!omitChoiceDriver && { choiceDriver }),
        observeAutoScrapeMode,
        transportFailureClass: () => transportClasses.shift() ?? 'none',
      });
      enforceFullExtensionRechecks(reportCases);
    },
  };
}

for (const baselineStoragePresent of [false, true]) {
  test(`native omitted choice driver restores absent theme through production callback (container=${baselineStoragePresent})`, async () => {
    const f = fullRestartFixture({
      absentTheme: true,
      omitChoiceDriver: true,
      baselineStoragePresent,
    });
    await f.run();
    const theme = f.reportCases[0].fullExtensionReload;
    assert.equal(
      theme.status,
      'pass',
      `EXT-D-0220 native restoration must invoke helper: ${JSON.stringify({
        stage: theme.restorationFailureStage,
        inner: theme.baselineRestoration,
      })}`,
    );
    assert.deepEqual(
      [
        f.states.T04.selected,
        f.states.T04.stored,
        f.states.T04.storedPresent,
        f.states.T04.storagePresent,
      ],
      ['System', null, false, baselineStoragePresent],
    );
    assert.ok(f.calls.reloads.length >= 1);
    assert.deepEqual(
      f.calls.options.filter(([id]) => id === 'T04'),
      [
        ['T04', 'Dark'],
        ['T04', 'Light'],
        ['T04', 'System'],
      ],
    );
    assert.equal(f.reportCases[1].fullExtensionReload.status, 'pass');
    assert.equal(f.reportCases[4].fullExtensionReload.status, 'pass');
  });
}

for (const failBaselineRestore of [null, 'remove_absent_key', 'observe_restored_baseline']) {
  test(`production T04 rerun preserves absent baseline and safe inner restoration outcome (${failBaselineRestore})`, async () => {
    const f = fullRestartFixture({ absentTheme: true, failBaselineRestore });
    await f.run();
    const theme = f.reportCases[0];
    if (failBaselineRestore === null) {
      assert.equal(theme.fullExtensionReload.status, 'pass');
      assert.deepEqual(
        [
          f.states.T04.selected,
          f.states.T04.stored,
          f.states.T04.storedPresent,
          f.states.T04.storagePresent,
        ],
        ['System', null, false, false],
      );
      assert.ok(f.calls.reloads.length >= 1);
    } else {
      assert.equal(theme.fullExtensionReload.status, 'fail');
      assert.equal(theme.fullExtensionReload.restorationFailureStage, 'restore_baseline_select');
      const diagnostic = theme.fullExtensionReload.baselineRestoration;
      assert.ok(diagnostic, 'EXT-D-0220 must retain inner baseline restoration diagnostics');
      assert.equal(diagnostic.stage, failBaselineRestore);
      assert.equal(
        diagnostic.errorName,
        failBaselineRestore === 'remove_absent_key' ? 'TypeError' : 'RangeError',
      );
      assert.equal(diagnostic.observation.settingsActive, true);
      assert.equal(
        diagnostic.observation.baselineMatches,
        failBaselineRestore === 'observe_restored_baseline',
      );
      assert.equal(
        diagnostic.observation.storagePresent,
        failBaselineRestore === 'remove_absent_key',
      );
      assert.equal(JSON.stringify(theme).includes('private'), false);
      assert.equal(JSON.stringify(theme).includes('secret'), false);
    }
    assert.equal(
      f.reportCases[1].fullExtensionReload.status,
      'pass',
      'mode sibling remains executable',
    );
  });
}

test('theme and capture choices survive replacement; guest mode refuses Ask after its own replacement', async () => {
  const f = fullRestartFixture();
  await f.run();
  const [theme, mode, sections, autoScrape, scrapeMode] = f.reportCases;
  assert.equal(theme.fullExtensionReload.status, 'pass');
  assert.equal(mode.fullExtensionReload.status, 'pass', JSON.stringify(mode.fullExtensionReload));
  assert.equal(sections.fullExtensionReload.status, 'pass');
  assert.equal(autoScrape.fullExtensionReload.downstreamCapture.status, 'unverified');
  assert.equal(scrapeMode.fullExtensionReload.status, 'pass');
  assert.equal(f.states.T04.stored, 'system');
  assert.equal(f.states.T10.stored, null);
  assert.equal(f.states.T10.selected, 'Act without asking');
  assert.equal(f.states.T10.saveRefusal, true);
  assert.equal(f.states.T67.mode.stored, 'capture');
  assert.ok(f.calls.reloads.length >= 1);
  assert.deepEqual(f.calls.chats, [{ mode: 'act', label: 'Act without asking' }]);
  assert.equal(
    mode.fullExtensionReload.criteria.filter((entry) =>
      entry.name.includes('New guest chat retains Act'),
    ).length,
    1,
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

test('guest T10 refusal does not create a Settings mode field', async () => {
  const f = fullRestartFixture({ absentMode: true });
  await f.run();
  const mode = f.reportCases.find((item) => item.id.endsWith('T10'));
  assert.equal(mode.fullExtensionReload.status, 'pass', JSON.stringify(mode.fullExtensionReload));
  assert.equal(f.states.T10.selected, 'Act without asking');
  assert.equal(f.states.T10.stored, null);
  assert.equal(f.states.T10.storedPresent, false);
  assert.equal(f.states.T10.storagePresent, false);
  assert.ok(f.calls.chats.some(({ mode }) => mode === 'act'));
  assert.ok(f.calls.options.some(([id, label]) => id === 'T10' && label === 'Ask before acting'));
});

test('a failed guest new-chat check retains the refusal and reports failure', async () => {
  const f = fullRestartFixture({ failNewChat: true });
  await f.run();
  const mode = f.reportCases.find((item) => item.id.endsWith('T10'));
  assert.equal(mode.fullExtensionReload.status, 'fail');
  assert.equal(mode.fullExtensionReload.firstChoiceFailureStage, 'choice_after_reload_callback');
  assert.deepEqual(mode.fullExtensionReload.lastModeObservation, {
    settingsActive: true,
    controlUnique: true,
    actSelected: true,
    refusalVisible: true,
  });
  assert.ok(
    mode.fullExtensionReload.firstChoicePostReplacementStages.some(
      ({ stage, outcome }) => stage === 'choice_after_reload_callback' && outcome === 'failed',
    ),
  );
  assert.equal(f.states.T10.selected, 'Act without asking');
  assert.equal(f.states.T10.stored, null);
  assert.ok(f.calls.reloads.length >= 1);
  assert.equal(JSON.stringify(f.reportCases).includes('synthetic new-chat failure'), false);
});

test('T10 failed refusal predicate records the last Ask poll rather than its initial Act baseline', async () => {
  const f = fullRestartFixture({ refusalNeverShows: true });
  await f.run();
  const mode = f.reportCases.find((item) => item.id.endsWith('T10'));
  assert.equal(mode.fullExtensionReload.status, 'fail');
  assert.equal(mode.fullExtensionReload.firstChoiceFailureStage, 'choice_observation');
  assert.deepEqual(mode.fullExtensionReload.lastModeObservation, {
    settingsActive: true,
    controlUnique: true,
    actSelected: false,
    refusalVisible: false,
  });
  assert.doesNotMatch(JSON.stringify(mode.fullExtensionReload), /private|secret|https?:\/\//);
});

test('guest mode drift fails before a reload or sibling choice can conceal it', async () => {
  const f = fullRestartFixture();
  f.states.T10.selected = 'Ask before acting';
  f.states.T10.stored = 'ask';
  await f.run();
  const mode = f.reportCases.find((item) => item.id.endsWith('T10'));
  assert.equal(mode.fullExtensionReload.status, 'fail');
  assert.equal(mode.fullExtensionReload.firstChoiceFailureStage, 'initial_baseline_observation');
  assert.equal(f.states.T10.selected, 'Ask before acting');
  assert.equal(f.states.T10.stored, 'ask');
  assert.deepEqual(f.calls.reloads, []);
  assert.deepEqual(f.calls.options, []);
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

test('guest refusal evidence survives a later new-chat failure without private details', async () => {
  const f = fullRestartFixture({ failNewChat: true });
  await f.run();
  const mode = f.reportCases.find((item) => item.id.endsWith('T10'));
  const refusal = mode.fullExtensionReload.criteria.find(({ name }) =>
    name.includes('Guest Ask choice is refused'),
  );
  assert.equal(refusal?.status, 'pass');
  assert.equal(refusal?.evidence?.saveRefusal, true);
  assert.doesNotMatch(JSON.stringify(mode.fullExtensionReload), /private|secret|https?:\/\//);
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

  assert.equal(mode.fullExtensionReload.status, 'fail');
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

for (const scrapeContainerPresent of [false, true]) {
  test(`T67 reestablishes absent container after T40 and restores prior raw baseline (present=${scrapeContainerPresent})`, async () => {
    const f = fullRestartFixture({ scrapeContainerPresent, materializeScrapeInT40: true });
    await f.run();
    const result = f.reportCases[4].fullExtensionReload;
    assert.equal(result.status, 'pass', JSON.stringify(result));
    const initial = result.criteria.find(
      (entry) => entry.name === 'initial absent Settings container observed',
    );
    assert.equal(initial.status, 'pass');
    assert.equal(initial.evidence.storagePresent, false);
    assert.equal(initial.evidence.mode.storedPresent, false);
    assert.equal(initial.evidence.mode.stored, 'capture');
    assert.equal(initial.evidence.mode.visible, 'Capture');
    assert.equal(f.calls.caseRunners.includes('T40'), true);
    assert.equal(f.storage['matrx.settings.v1'], f.calls.scrapeBaseline);
    assert.equal(result.criteria.at(-1).evidence.exactBaselineRestored, true);
    assert.equal(f.reportCases[0].fullExtensionReload.status, 'pass');
    assert.equal(f.reportCases[1].fullExtensionReload.status, 'pass');
    assert.deepEqual(
      f.calls.options.filter(([id]) => id === 'T67'),
      [
        ['T67', 'Scroll & capture'],
        ['T67', 'Capture'],
      ],
    );
  });
}

test('T67 restores the preceding T40 container even when the original choice assertion fails', async () => {
  const f = fullRestartFixture({
    scrapeContainerPresent: false,
    materializeScrapeInT40: true,
    skipChoice: 'Scroll & capture',
  });
  await f.run();
  const result = f.reportCases[4].fullExtensionReload;
  assert.equal(result.status, 'fail');
  assert.equal(result.firstChoiceFailureStage, 'choice_observation');
  assert.equal(f.storage['matrx.settings.v1'], f.calls.scrapeBaseline);
  assert.equal(
    result.criteria.find(
      (entry) => entry.name === 'pre-T67 Settings container restored after panel reload',
    ).evidence.exactBaselineRestored,
    true,
  );
});

test('T67 restores an originally absent container after exercising explicit capture choices', async () => {
  const f = fullRestartFixture({ scrapeContainerPresent: false });
  await f.run();
  assert.equal(f.reportCases[4].fullExtensionReload.status, 'pass');
  assert.equal(Object.hasOwn(f.storage, 'matrx.settings.v1'), false);
});

function emptyModeFootprint() {
  return {
    status: 'observed',
    stores: ['settings', 'chat', 'pilot'].map((store) => ({
      store,
      storagePresent: false,
      fieldPresent: false,
      parseStatus: 'absent',
      mode: null,
      fingerprint: null,
      count: null,
    })),
  };
}

test('T10 compares immutable warm footprint after replacement before a new Ask choice', async () => {
  const f = fullRestartFixture({ mutateModeAfterReplacement: true });
  await f.run();
  const mode = f.reportCases.find((item) => item.id.endsWith('T10'));
  assert.equal(mode.fullExtensionReload.status, 'fail');
  assert.equal(mode.fullExtensionReload.firstChoiceFailureStage, 'initial_baseline_observation');
  assert.equal(
    f.calls.options.some(([id]) => id === 'T10'),
    false,
  );
  assert.ok(f.calls.reloads.length > 0);
  assert.equal(
    f.preExtensionBaselines.T10.observation.shadowFootprint.stores[1].storagePresent,
    false,
  );
});

// One shared raw settings store feeds the real generated mode observer and Theme cleanup.
// A detached synthetic mode footprint would not expose deletion hiding this mutation.
test('outer replacement mode shadow is detected before destructive Theme work', async () => {
  const f = fullRestartFixture({
    realModeStorage: true,
    absentTheme: true,
    scrapeContainerPresent: false,
  });
  const mode = GUEST_PREFERENCES.find((item) => item.caseId === 'T10');
  f.preExtensionBaselines.T10 = preferenceBaseline(
    await f.observePreference(f.activePanel, mode),
    mode,
  );
  f.storage['matrx.settings.v1'] = JSON.stringify({ state: { defaultPermissionMode: 'ask' } });
  await f.run();
  const result = f.reportCases.find((item) => item.id.endsWith('T10')).fullExtensionReload;
  assert.equal(result.status, 'fail');
  assert.deepEqual(f.calls.options, []);
  assert.deepEqual(f.calls.removals, []);
  assert.equal(JSON.parse(f.storage['matrx.settings.v1']).state.defaultPermissionMode, 'ask');
});

test('Theme replacement mode shadow remains observable before absent-container cleanup', async () => {
  const f = fullRestartFixture({
    realModeStorage: true,
    absentTheme: true,
    scrapeContainerPresent: false,
    mutateRawModeAfterReplacement: true,
  });
  const mode = GUEST_PREFERENCES.find((item) => item.caseId === 'T10');
  f.preExtensionBaselines.T10 = preferenceBaseline(
    await f.observePreference(f.activePanel, mode),
    mode,
  );
  await f.run();
  assert.equal(
    f.reportCases.find((item) => item.id.endsWith('T10')).fullExtensionReload.status,
    'fail',
  );
  assert.ok(f.calls.reloads.length > 0);
  assert.deepEqual(f.calls.removals, []);
  assert.equal(JSON.parse(f.storage['matrx.settings.v1']).state.defaultPermissionMode, 'ask');
  assert.equal(
    f.calls.options.some(([id]) => id === 'T10'),
    false,
  );
});

// The real compound callback and final publisher must retain the original branch,
// even though aggregate errors intentionally expose only a generic public message.
test('compound Theme reopen distinguishes successful Settings open from exact-sample mode mismatch', async () => {
  const f = fullRestartFixture({
    realModeStorage: true,
    scrapeContainerPresent: false,
    absentTheme: true,
    materializeThemeMode: true,
  });
  const mode = GUEST_PREFERENCES.find((item) => item.caseId === 'T10');
  f.preExtensionBaselines.T10 = preferenceBaseline(
    await f.observePreference(f.activePanel, mode),
    mode,
  );
  await f.run();
  const result = f.reportCases[0].fullExtensionReload;
  assert.equal(result.status, 'fail');
  assert.equal(result.firstChoiceFailureStage, 'choice_settings_reopen');
  assert.equal(result.firstChoiceReopen.operation, 'mode_compare');
  assert.equal(result.firstChoiceReopen.openStep, 'guest_wait_started');
  assert.equal(result.firstChoiceReopen.failureCode, 'mode_baseline_mismatch');
  assert.equal(result.firstChoiceReopen.modeComparison.stage, 'full_recheck');
  assert.equal(result.firstChoiceReopen.modeComparison.serialization, 'unequal');
  assert.equal(result.firstChoiceReopen.modeComparison.predicates.permissionComparison, false);
  assert.equal(result.firstChoiceReopen.modeComparison.firstFalse, 'permissionComparison');
  assert.equal(result.firstRestorationReopen.operation, 'mode_compare');
  assert.equal(result.recoveryReopen.operation, 'mode_compare');
  assert.equal(result.firstChoiceReopen.modeComparison.stores[0].storagePresent, 'unequal');
  const finalCriterion = result.criteria.at(-1).evidence;
  assert.deepEqual(finalCriterion.firstChoiceReopen, result.firstChoiceReopen);
  assert.doesNotMatch(
    JSON.stringify(result),
    /defaultPermissionMode|"ask"|fingerprint.*[a-f0-9]{64}/,
  );
  assert.equal(f.calls.reloads.length, 1);
  assert.deepEqual(f.calls.options, [['T04', 'Dark']]);
  assert.equal(f.calls.observations.filter((id) => id === 'T10').length, 7);
});

test('compound reopen retains original pointer, first restoration and recovery independently', async () => {
  const pointer = Object.freeze(
    Object.assign(new Error('private URL https://private.example?token=secret'), {
      driverFailure: { code: 'pointer_stable_hit_not_observed', arbitrary: 'private' },
    }),
  );
  const wait = new Error('guest_settings_not_observed:{"transient":"private-content"}');
  const hostile = Object.freeze(
    Object.defineProperty({}, 'message', {
      get() {
        throw new Error('private getter');
      },
    }),
  );
  const f = fullRestartFixture({ settingsFailureByCall: { 2: pointer, 3: wait, 4: hostile } });
  await f.run();
  const result = f.reportCases[0].fullExtensionReload;
  assert.equal(result.status, 'fail');
  assert.equal(result.firstChoiceReopen.operation, 'settings_open');
  assert.equal(result.firstChoiceReopen.failureCode, 'pointer_stable_hit_not_observed');
  assert.equal(result.firstRestorationReopen.failureCode, 'guest_observation_unavailable');
  assert.equal(result.recoveryReopen.failureCode, 'unavailable');
  assert.equal(result.firstChoiceReopen.openStep, 'before_click');
  assert.equal(result.firstChoiceReopen.modeComparison, null);
  assert.doesNotMatch(JSON.stringify(result), /private|secret|https?:\/\//);
  assert.equal(f.calls.reloads.length, 4);
  assert.deepEqual(
    f.calls.options.filter(([id]) => id === 'T04'),
    [['T04', 'Dark']],
  );
});

test('reopen diagnostic publication reprojects malformed and hostile values without exposing errors', async () => {
  const hostile = Object.defineProperty({}, 'operation', {
    get() {
      throw new Error('private getter');
    },
  });
  for (const value of [
    Object.freeze({
      operation: 'private',
      openStep: 'secret',
      failureCode: 'https://private.example',
      modeComparison: { stage: 'private' },
    }),
    hostile,
    'private',
  ]) {
    const item = cases()[0];
    const error = Object.freeze(
      Object.assign(new Error('private message'), {
        safeCategory: 'full_extension_preference_or_restore_failed',
        safeFirstChoiceReopen: value,
      }),
    );
    await runFullExtensionRecheck(item, async () => {
      throw error;
    });
    const result = item.fullExtensionReload;
    assert.equal(result.status, 'fail');
    assert.equal(result.firstChoiceReopen.operation, 'unavailable');
    assert.equal(result.firstChoiceReopen.failureCode, 'unavailable');
    assert.equal(result.firstChoiceReopen.modeComparison, null);
    assert.doesNotMatch(JSON.stringify(result), /private|secret|https?:\/\//);
  }
  const item = cases()[0];
  const error = Object.assign(new Error('private'), {
    safeCategory: 'full_extension_preference_or_restore_failed',
  });
  Object.defineProperty(error, 'safeFirstChoiceReopen', {
    get() {
      throw new Error('private getter');
    },
  });
  await runFullExtensionRecheck(item, async () => {
    throw error;
  });
  assert.equal(item.fullExtensionReload.status, 'fail');
  assert.equal(item.fullExtensionReload.firstChoiceReopen, null);
  const primitive = cases()[0];
  await runFullExtensionRecheck(primitive, async () => {
    throw 'private';
  });
  assert.equal(primitive.fullExtensionReload.status, 'fail');
  assert.doesNotMatch(JSON.stringify(primitive), /private/);
});

test('final serialized reopen receipt snapshots changing getters before enum validation', async () => {
  const sentinel = 'https://private.example/settings?token=private-sentinel';
  const receipt = {};
  for (const [key, first] of Object.entries({
    operation: 'settings_open',
    openStep: 'before_click',
    failureCode: 'pointer_target_not_unique',
  })) {
    let reads = 0;
    Object.defineProperty(receipt, key, {
      get() {
        reads += 1;
        return reads === 1 ? first : sentinel;
      },
    });
  }
  const item = cases()[0];
  await runFullExtensionRecheck(item, async () => {
    throw Object.assign(new Error(sentinel), {
      safeCategory: 'full_extension_preference_or_restore_failed',
      safeFirstChoiceReopen: receipt,
    });
  });
  const result = item.fullExtensionReload;
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.firstChoiceReopen, {
    operation: 'settings_open',
    openStep: 'before_click',
    failureCode: 'pointer_target_not_unique',
    modeComparison: null,
  });
  assert.doesNotMatch(JSON.stringify(item), /private|https?:\/\//);
});

test('diagnostic oracle rejects a constant-return replacement of the owned full-recheck function', async () => {
  const returnedExpected = {
    status: 'fail',
    firstChoiceReopen: {
      operation: 'settings_open',
      failureCode: 'pointer_stable_hit_not_observed',
    },
  };
  const f = fullRestartFixture({ rerun: async () => returnedExpected });
  await f.run();
  assert.throws(() => assert.deepEqual(f.reportCases[0].fullExtensionReload, returnedExpected));
  assert.equal(f.reportCases[0].fullExtensionReload.status, 'missing');
  assert.deepEqual(f.calls.reloads, []);
  assert.deepEqual(f.calls.observations, []);
});

test('final restoration management-reload reopen preserves first restoration diagnostic', async () => {
  const f = fullRestartFixture({ restorationFault: 'final_reload' });
  await f.run();
  const result = f.reportCases[0].fullExtensionReload;
  assert.equal(result.status, 'fail');
  assert.equal(result.firstChoiceFailureStage, 'not_failed');
  assert.equal(f.lifecycle.faultInjected, true);
  assert.equal(result.restorationFailureStage, 'restore_settings_reopen');
  assert.equal(result.firstRestorationReopen.operation, 'settings_open');
  assert.equal(result.firstRestorationReopen.failureCode, 'pointer_target_not_unique');
  assert.equal(result.firstRestorationReopenStage, 'restore_settings_reopen');
  assert.equal(result.recoveryReopen, null);
  assert.deepEqual(
    f.calls.options.filter(([id]) => id === 'T04'),
    [
      ['T04', 'Dark'],
      ['T04', 'Light'],
      ['T04', 'System'],
    ],
  );
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('baseline-restorer mode comparison preserves its original restoration receipt', async () => {
  const f = fullRestartFixture({ absentTheme: true, restorationFault: 'baseline' });
  await f.run();
  const result = f.reportCases[0].fullExtensionReload;
  assert.equal(result.status, 'fail');
  assert.equal(result.firstChoiceFailureStage, 'not_failed');
  assert.equal(f.lifecycle.faultInjected, true);
  assert.equal(result.restorationFailureStage, 'restore_baseline_select');
  assert.equal(result.firstRestorationReopen.operation, 'mode_compare');
  assert.equal(result.firstRestorationReopen.modeComparison.serialization, 'unequal');
  assert.equal(result.firstRestorationReopenStage, 'restore_baseline_select');
  assert.equal(result.recoveryReopen, null);
  assert.equal(f.calls.reloads.length, 2);
  assert.deepEqual(f.calls.removals, []);
});

test('unavailable first restoration receipt retains its original stage instead of recovery data', async () => {
  const f = fullRestartFixture({ restorationFault: 'unknown_then_recovery' });
  await f.run();
  const result = f.reportCases[0].fullExtensionReload;
  assert.equal(result.status, 'fail');
  assert.equal(f.lifecycle.faultInjected, true);
  assert.equal(f.lifecycle.recoveryFaultInjected, true);
  assert.equal(result.restorationFailureStage, 'restore_recovered_settings');
  assert.equal(result.firstRestorationReopen, null);
  assert.equal(result.firstRestorationReopenStage, 'restore_section');
  assert.equal(result.recoveryReopen.operation, 'settings_open');
  assert.equal(result.recoveryReopen.failureCode, 'pointer_stable_hit_not_observed');
  assert.doesNotMatch(JSON.stringify(result), /private/);
});
