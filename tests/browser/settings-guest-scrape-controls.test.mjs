import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { publishAtomicJsonReport } from './atomic-json-report.mjs';
import { NATIVE_STAGES } from './scrape-save-auth-report.mjs';
import { runFullExtensionRecheck } from './settings-full-extension-rechecks.mjs';
import { guestModeShadowMatches } from './settings-guest-preference-batch.mjs';
import {
  runGuestAutoScrapeCase,
  runGuestAutoScrapeModeCase,
  runGuestDeepCleanCase,
  runGuestSectionsCase,
  scrapeObservationExpression,
  settingsSectionObservationExpression,
} from './settings-guest-scrape-controls.mjs';
import {
  settingsFixtureIntegrityFailure,
  withExactSettingsFixture,
} from './settings-scrape-mode-baseline.mjs';

test('Scrape observation applies product defaults only to absent persisted fields', async () => {
  const window = new Window();
  window.document.body.innerHTML =
    '<button role="tab" title="Settings" data-state="active" aria-controls="pane"></button><div id="pane" role="tabpanel" data-state="active"><button aria-expanded="true" aria-controls="scrape">Scrape</button><div id="scrape"><button role="switch" aria-label="Auto-scrape on load" aria-checked="false"></button><div><span>Auto-scrape mode</span><button role="combobox">Capture</button></div></div></div>';
  const observe = async (raw) =>
    runInNewContext(scrapeObservationExpression(), {
      document: window.document,
      chrome: {
        storage: {
          local: { get: async () => (raw === undefined ? {} : { 'matrx.settings.v1': raw }) },
        },
      },
    });
  const fresh = await observe(undefined);
  assert.equal(fresh.storagePresent, false);
  assert.equal(fresh.mode.storedPresent, false);
  assert.equal(fresh.toggle.stored, false);
  assert.equal(fresh.mode.stored, 'capture');
  const conflicting = await observe(
    JSON.stringify({ state: { scrapeAutoOnLoad: true, scrapeAutoMode: 'scroll-capture' } }),
  );
  assert.equal(conflicting.storagePresent, true);
  assert.equal(conflicting.mode.storedPresent, true);
  assert.equal(conflicting.toggle.stored, true);
  assert.equal(conflicting.mode.stored, 'scroll-capture');
  const partial = await observe(JSON.stringify({ state: { scrapeAutoOnLoad: true } }));
  assert.equal(partial.toggle.stored, true);
  assert.equal(partial.mode.stored, 'capture');
  assert.equal(partial.mode.storedPresent, false);
  const malformed = await observe('{');
  assert.equal(malformed.toggle.stored, null);
  assert.equal(malformed.mode.stored, null);
  await window.happyDOM.abort();
});

test('T40 still rejects an explicit UI and storage disagreement', async () => {
  const { state, driver, reload } = simulatedPanel();
  state.switchStored = true;
  await assert.rejects(
    runGuestAutoScrapeCase(null, reload, () => {}, driver),
    /auto_scrape_initial_ui_storage_disagree/,
  );
  assert.equal(state.clicks.length, 0);
});

const headings = [
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

function simulatedPanel(initialRaw) {
  const entries = initialRaw === undefined ? {} : { 'matrx.settings.v1': initialRaw };
  const local = {
    get: async (keys) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys])
          .filter((key) => Object.hasOwn(entries, key))
          .map((key) => [key, structuredClone(entries[key])]),
      ),
    set: async (values) => Object.assign(entries, structuredClone(values)),
    remove: async (key) => {
      delete entries[key];
    },
  };
  const state = {
    sections: Object.fromEntries(headings.map((label) => [label, true])),
    switchVisible: false,
    switchStored: false,
    modeVisible: 'Capture',
    modeStored: 'capture',
    deepVisible: false,
    deepStored: false,
    reloads: 0,
    clicks: [],
  };
  const fields = {
    switchStored: ['scrapeAutoOnLoad', false],
    modeStored: ['scrapeAutoMode', 'capture'],
    deepStored: ['scrapeDeepClean', false],
  };
  for (const [name, [field, fallback]] of Object.entries(fields))
    Object.defineProperty(state, name, {
      configurable: true,
      get() {
        try {
          return JSON.parse(entries['matrx.settings.v1'])?.state?.[field] ?? fallback;
        } catch {
          return fallback;
        }
      },
      set(value) {
        let parsed;
        try {
          parsed = JSON.parse(entries['matrx.settings.v1']);
        } catch {}
        parsed ??= {
          state: {
            defaultPermissionMode: 'ask',
            scrapeAutoOnLoad: false,
            scrapeAutoMode: 'capture',
            scrapeDeepClean: false,
          },
          version: 0,
        };
        parsed.state[field] = value;
        entries['matrx.settings.v1'] = JSON.stringify(parsed);
      },
    });
  let selectOpen = false;
  const driver = {
    async evaluate(_panel, expression) {
      if (expression.includes('matrx.qa.settingsFixture.'))
        return runInNewContext(expression, {
          chrome: { storage: { local } },
          crypto: webcrypto,
          TextEncoder,
        });
      if (expression.includes('const headings = sections.map')) {
        const label = headings.find((name) => expression.includes(JSON.stringify(name)));
        const expanded = state.sections[label];
        return {
          active: true,
          headings,
          count: 1,
          expanded: String(expanded),
          expandedControlCount: headings.length,
          nonSectionExpandedControlCount: 0,
          contentAriaHidden: String(!expanded),
          contentInert: !expanded,
          contentNonempty: true,
          contentRendered: expanded,
          emptyHint: ['Data', 'SEO'].includes(label) ? true : null,
          settingsDigest: 'unchanged',
        };
      }
      const window = new Window();
      window.document.body.innerHTML = `<button role="tab" title="Settings" data-state="active" aria-controls="pane"></button><div id="pane" role="tabpanel" data-state="active"><button aria-expanded="true" aria-controls="scrape">Scrape</button><div id="scrape"><button role="switch" aria-label="Auto-scrape on load" aria-checked="${state.switchVisible}"></button><div><span>Auto-scrape mode</span><button role="combobox">${state.modeVisible}</button></div><div><div><button role="switch" aria-label="Deep clean" aria-checked="${state.deepVisible}"></button>Deep clean coming soon</div></div></div></div>`;
      try {
        return JSON.parse(
          JSON.stringify(
            await runInNewContext(expression, {
              document: window.document,
              chrome: { storage: { local } },
            }),
          ),
        );
      } finally {
        await window.happyDOM.abort();
      }
    },
    async openSection() {},
    async click(_panel, kind, label) {
      state.clicks.push([kind, label]);
      if (kind === 'section') state.sections[label] = !state.sections[label];
      if (kind === 'switch') {
        if (label === 'Deep clean') {
          state.deepVisible = !state.deepVisible;
          state.deepStored = state.deepVisible;
        } else {
          state.switchVisible = !state.switchVisible;
          state.switchStored = state.switchVisible;
        }
      }
      if (kind === 'switch' || kind === 'option') {
        const previous = entries['matrx.settings.v1'];
        const parsed = previous
          ? JSON.parse(previous)
          : { state: { defaultPermissionMode: 'ask', scrapeDeepClean: false }, version: 0 };
        parsed.state.scrapeDeepClean = state.deepStored;
        parsed.state.scrapeAutoOnLoad = state.switchStored;
        parsed.state.scrapeAutoMode = state.modeStored;
        entries['matrx.settings.v1'] = JSON.stringify(parsed);
      }
      if (kind === 'settings-select') selectOpen = true;
      if (kind === 'option') {
        assert.equal(selectOpen, true);
        selectOpen = false;
        state.modeVisible = label;
        state.modeStored = label === 'Capture' ? 'capture' : 'scroll-capture';
        const parsed = JSON.parse(entries['matrx.settings.v1']);
        parsed.state.scrapeAutoMode = state.modeStored;
        entries['matrx.settings.v1'] = JSON.stringify(parsed);
      }
    },
    async waitFor(label, read, accept) {
      const observed = await read();
      assert.equal(accept(observed), true, `${label}_not_observed`);
      return observed;
    },
  };
  const reload = async () => {
    state.reloads += 1;
    state.deepVisible = state.deepStored;
    state.switchVisible = state.switchStored;
    state.modeVisible = state.modeStored === 'capture' ? 'Capture' : 'Scroll & capture';
  };
  return { state, driver, reload, entries, local };
}

test('T28 case runner observes rendered content and restores every section across reload', async () => {
  const { state, driver, reload } = simulatedPanel();
  await runGuestSectionsCase(null, reload, () => {}, driver);
  assert.equal(state.reloads, 1);
  assert.deepEqual(
    Object.values(state.sections),
    headings.map(() => true),
  );
  assert.equal(state.clicks.filter(([kind]) => kind === 'section').length, headings.length * 4);
});

test('T28 census recognizes actual section wrappers and excludes nested expanded controls', async () => {
  const window = new Window();
  const labels = [...headings, 'Extra section'];
  const wrappers = labels
    .map((label, index) => {
      const id = `section-content-${index}`;
      const nested =
        index === 0
          ? '<button role="combobox" aria-expanded="false" aria-controls="nested-1">Provider</button><button role="combobox" aria-expanded="false" aria-controls="nested-2">Model</button><button role="combobox" aria-expanded="false" aria-controls="nested-3">Region</button><button role="combobox" aria-expanded="false" aria-controls="nested-4">Format</button>'
          : '';
      return `<div class="collapsible"><div class="flex items-center"><button aria-expanded="true" aria-controls="${id}">${label}</button></div><div id="${id}" aria-hidden="false">${nested}</div></div>`;
    })
    .join('');
  window.document.body.innerHTML = `<button role="tab" title="Settings" data-state="active" aria-controls="settings-pane"></button><div id="settings-pane" role="tabpanel" data-state="active"><div class="flex h-full flex-col"><header></header><div class="flex-1 overflow-y-auto"><div class="space-y-3 px-3 pb-3">${wrappers}</div></div></div></div>`;
  for (const content of window.document.querySelectorAll('[aria-hidden]')) {
    content.getBoundingClientRect = () => ({ height: 10 });
  }
  const result = await runInNewContext(settingsSectionObservationExpression('Account'), {
    document: window.document,
    chrome: { storage: { local: { get: async (key) => ({ [key]: '{}' }) } } },
    crypto: webcrypto,
    TextEncoder,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
  });
  assert.deepEqual(Array.from(result.headings), labels);
  assert.equal(result.expandedControlCount, 16);
  assert.equal(result.nonSectionExpandedControlCount, 4);
  assert.equal(result.count, 1);
  await window.happyDOM.abort();
});

test('T28 case runner rejects an open section without rendered content and verifies cleanup', async () => {
  const { state, driver, reload } = simulatedPanel();
  state.sections.Account = false;
  const baselineSections = { ...state.sections };
  const originalEvaluate = driver.evaluate;
  let accountReads = 0;
  driver.evaluate = async (...args) => {
    const observed = await originalEvaluate(...args);
    if (observed.headings && args[1].includes('"Account"')) {
      accountReads += 1;
      if (accountReads === 3) observed.contentRendered = false;
    }
    return observed;
  };
  await assert.rejects(
    runGuestSectionsCase(null, reload, () => {}, driver),
    /Account_section_open_not_observed/,
  );
  assert.deepEqual(state.sections, baselineSections);
  assert.deepEqual(
    state.clicks.filter(([kind]) => kind === 'section'),
    [
      ['section', 'Account'],
      ['section', 'Account'],
    ],
  );
  assert.equal(state.reloads, 0);
});

test('T28 onFailure receipt bounds diagnostics for inactive and same-count roster drift', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'settings-case-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const acceptanceSource = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const runCaseStart = acceptanceSource.indexOf('async function runCase(c, fn) {');
  const runCaseEnd = acceptanceSource.indexOf('\nlet observedPort;', runCaseStart);
  assert.ok(runCaseStart >= 0 && runCaseEnd > runCaseStart);
  const runCase = new Function(
    'settingsFixtureIntegrityFailure',
    'criterion',
    'publishAtomicJsonReport',
    'NATIVE_STAGES',
    'OUTPUT',
    'CASE_IDS',
    'report',
    `${acceptanceSource.slice(acceptanceSource.indexOf('let publicationFailure;'), runCaseEnd)}\nreturn runCase;`,
  )(
    settingsFixtureIntegrityFailure,
    (c, name, status, evidence) => c.criteria.push({ name, status, evidence }),
    publishAtomicJsonReport,
    NATIVE_STAGES,
    join(dir, 'report.json'),
    ['EXT-F-1003-T28'],
    { cases: [] },
  );

  const privateLookingHeading = 'Patient preview private-record-7f3c';
  const cases = [
    {
      label: 'inactive empty census',
      active: false,
      observedHeadings: [],
      expected:
        /guest_settings_sections_missing:\{"active":false,"count":0,"headings":\[\],"unrecognizedHeadingCount":0,"expandedControlCount":0,"nonSectionExpandedControlCount":0\}/,
      privateLookingHeading: null,
    },
    {
      label: 'same-count roster drift',
      active: true,
      observedHeadings: [...headings.slice(0, 4), privateLookingHeading, ...headings.slice(5)],
      expected:
        /guest_settings_sections_missing:\{"active":true,"count":11,"headings":\["Account","Organization","Appearance","Chat","Scrape","Data","SEO","Desktop bridge","Data & reset","About"\],"unrecognizedHeadingCount":1,"expandedControlCount":11,"nonSectionExpandedControlCount":0\}/,
      privateLookingHeading,
    },
  ];

  for (const scenario of cases) {
    const { state, driver, reload } = simulatedPanel();
    const originalEvaluate = driver.evaluate;
    driver.evaluate = async (...args) => {
      const observed = await originalEvaluate(...args);
      if (observed.headings) {
        observed.active = scenario.active;
        observed.headings = scenario.observedHeadings;
        if (!scenario.active) {
          observed.expandedControlCount = 0;
          observed.nonSectionExpandedControlCount = 0;
        }
      }
      return observed;
    };

    const receipt = { id: 'EXT-F-1003-T28', criteria: [] };
    await runCase(receipt, () => runGuestSectionsCase(null, reload, () => {}, driver));

    assert.equal(receipt.status, 'fail', scenario.label);
    assert.match(receipt.error, scenario.expected, scenario.label);
    if (scenario.privateLookingHeading)
      assert.equal(
        JSON.stringify(receipt).includes(scenario.privateLookingHeading),
        false,
        `${scenario.label}_unsafe_evidence`,
      );
    assert.deepEqual(state.clicks, [], scenario.label);
    assert.equal(state.reloads, 0, scenario.label);
  }
});

test('T40 case runner repairs UI-baseline/storage-drift through clicks and verifies after reload', async () => {
  const { state, driver, reload } = simulatedPanel();
  let failure;
  try {
    await runGuestAutoScrapeCase(
      null,
      reload,
      (phase) => {
        if (phase === 'warm') {
          state.switchVisible = false;
          state.switchStored = true;
          throw new Error('injected_after_write_failure');
        }
      },
      driver,
    );
  } catch (error) {
    failure = error;
  }
  assert.match(failure?.message ?? '', /injected_after_write_failure/);
  assert.deepEqual(failure.safeLastAutoScrapeObservation, {
    active: true,
    sectionOpen: true,
    controlCount: 1,
    visibleMatches: false,
    storedMatches: false,
  });
  const item = { id: 'EXT-F-1003-T40', steps: [], criteria: [] };
  await runFullExtensionRecheck(item, async () => {
    throw failure;
  });
  assert.deepEqual(
    item.fullExtensionReload.exception.lastSafeObservation,
    failure.safeLastAutoScrapeObservation,
  );
  assert.equal(state.clicks.filter(([kind]) => kind === 'switch').length, 3);
  assert.equal(state.switchVisible, false);
  assert.equal(state.switchStored, false);
  assert.equal(state.reloads, 3);
});

test('T67 case runner repairs same-selection storage drift through alternate choice and reload', async () => {
  const { state, driver, reload } = simulatedPanel();
  let failure;
  try {
    await runGuestAutoScrapeModeCase(
      null,
      reload,
      (phase) => {
        if (phase === 'warm') {
          state.modeVisible = 'Capture';
          state.modeStored = 'scroll-capture';
          throw new Error('injected_after_write_failure');
        }
      },
      driver,
    );
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.safeCategory, 'auto_scrape_mode_recheck_failed');
  assert.equal(failure?.safeStage, 'choice_record');
  assert.equal(failure?.safeFailureKind, 'case');
  assert.equal(JSON.stringify(failure).includes('injected_after_write_failure'), false);
  assert.deepEqual(
    state.clicks.filter(([kind]) => kind === 'option').map(([, label]) => label),
    ['Scroll & capture', 'Scroll & capture', 'Capture'],
  );
  assert.equal(state.modeVisible, 'Capture');
  assert.equal(state.modeStored, 'capture');
  assert.equal(state.reloads, 3);
});

test('T67 full-extension cleanup failure reports its actual safe phase after baseline restore', async () => {
  const { state, driver } = simulatedPanel();
  const item = { id: 'EXT-F-1003-T67', status: 'pass', steps: [], criteria: [] };
  const reload = async () => {
    state.reloads += 1;
    state.modeVisible = state.modeStored === 'capture' ? 'Capture' : 'Scroll & capture';
    if (state.reloads === 3) throw new Error('private_untrusted_reload_failure');
  };

  await runFullExtensionRecheck(item, async (record) => {
    await runGuestAutoScrapeModeCase(
      null,
      reload,
      (phase, action, observation, passed) =>
        record(`${phase}: ${action}`, passed ? 'pass' : 'fail', observation),
      driver,
    );
  });

  assert.equal(item.fullExtensionReload.status, 'fail');
  assert.equal(item.fullExtensionReload.error, 'auto_scrape_mode_recheck_failed');
  assert.equal(item.fullExtensionReload.failureStage, 'restore_reload');
  assert.equal(item.fullExtensionReload.failureKind, 'restore');
  assert.equal(
    item.fullExtensionReload.criteria.filter(({ status }) => status === 'pass').length,
    4,
  );
  assert.equal(state.modeVisible, 'Capture');
  assert.equal(state.modeStored, 'capture');
  assert.equal(state.reloads, 5);
  assert.equal(
    JSON.stringify(item.fullExtensionReload).includes('private_untrusted_reload_failure'),
    false,
  );
});

// Same absent→materialized Settings footprint that failed the original late T10 comparison.
test('actual T40 caller leaves the immutable T10 Settings footprint exactly unchanged', async () => {
  const { driver, reload, local, entries } = simulatedPanel();
  const source = await readFile(
    new URL('./settings-guest-preference-batch.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('function guestModeShadowExpression() {');
  const end = source.indexOf('\nexport function guestModeShadowMatches', start);
  const expression = new Function(
    `${source.slice(start, end)}; return guestModeShadowExpression();`,
  )();
  const read = () =>
    runInNewContext(expression, { chrome: { storage: { local } }, crypto: webcrypto, TextEncoder });
  const baseline = await read();
  await runGuestAutoScrapeCase(null, reload, () => {}, driver);
  assert.equal(
    guestModeShadowMatches(await read(), baseline),
    true,
    'original absent Settings footprint must survive actual caller cleanup',
  );
  assert.deepEqual(entries, {});
});

for (const [name, runner] of [
  ['T40', runGuestAutoScrapeCase],
  ['T67', runGuestAutoScrapeModeCase],
  ['T37', runGuestDeepCleanCase],
]) {
  for (const raw of [
    undefined,
    '{ "state": { "theme": "dark", "unknownSibling": "CANARY_private_dental_intake" }, "version": 0 }',
    '{"state":{"defaultPermissionMode":"act","scrapeAutoMode":"capture","scrapeAutoOnLoad":false,"scrapeDeepClean":false,"unknownSibling":{"a":3}},"version":0}',
  ]) {
    test(`${name} actual control preserves exact ${raw === undefined ? 'absent' : raw.includes('theme') ? 'partial' : 'explicit'} container through reload`, async () => {
      const f = simulatedPanel(raw);
      const expressions = [];
      const original = f.driver.evaluate;
      f.driver.evaluate = async (...args) => {
        expressions.push(args[1]);
        return original(...args);
      };
      await runner(null, f.reload, () => {}, f.driver);
      assert.equal(Object.hasOwn(f.entries, 'matrx.settings.v1'), raw !== undefined);
      assert.equal(f.entries['matrx.settings.v1'], raw);
      assert.deepEqual(Object.keys(f.entries), raw === undefined ? [] : ['matrx.settings.v1']);
      assert.ok(f.state.clicks.length > 0);
      assert.ok(f.state.reloads >= 4);
      assert.doesNotMatch(expressions.join('\n'), /CANARY_private_dental_intake|unknownSibling/);
    });
  }
}

for (const original of [
  '{malformed dental intake',
  { state: { custom: 'CANARY_nonstring' }, version: 9 },
  null,
]) {
  test(`exact lifecycle preserves opaque ${typeof original} value without parsing or returning it`, async () => {
    const f = simulatedPanel(original);
    await withExactSettingsFixture({
      getPanel: () => null,
      reloadSettings: f.reload,
      driver: f.driver,
      execute: async () => {
        f.entries['matrx.settings.v1'] = 'changed';
      },
    });
    assert.deepEqual(f.entries['matrx.settings.v1'], original);
    assert.equal(Object.keys(f.entries).length, 1);
  });
}

for (const failurePhase of [
  'capture_get',
  'capture_set',
  'capture_readback',
  'foreign',
  'missing',
  'corrupt',
  'restore_set',
  'before_reload',
  'after_reload',
  'verify',
  'dispose',
  'dispose_readback',
]) {
  test(`fixture ${failurePhase} uncertainty is branded, private and never authorizes later work`, async () => {
    const original = '{"state":{"unknownSibling":"CANARY_patient_intake"},"version":0}';
    const f = simulatedPanel(original);
    const get = f.local.get;
    const set = f.local.set;
    const remove = f.local.remove;
    let body = false;
    let reloads = 0;
    let captureReads = 0;
    let disposed = false;
    f.local.get = async (keys) => {
      if (!body) {
        captureReads++;
        if (failurePhase === 'capture_get' && captureReads === 2) throw new Error(original);
        if (failurePhase === 'capture_readback' && captureReads === 3) throw new Error(original);
      }
      if (failurePhase === 'verify' && reloads === 2 && keys === 'matrx.settings.v1') return {};
      if (failurePhase === 'dispose_readback' && disposed) throw new Error(original);
      return get(keys);
    };
    f.local.set = async (entries) => {
      if (failurePhase === 'capture_set' && !body) throw new Error(original);
      if (failurePhase === 'restore_set' && body) throw new Error(original);
      return set(entries);
    };
    f.local.remove = async (key) => {
      if (key.startsWith('matrx.qa.')) {
        if (failurePhase === 'dispose') throw new Error(original);
        disposed = true;
      }
      return remove(key);
    };
    let caught;
    try {
      await withExactSettingsFixture({
        getPanel: () => null,
        driver: f.driver,
        reloadSettings: async () => {
          reloads++;
          if (
            (failurePhase === 'before_reload' && reloads === 1) ||
            (failurePhase === 'after_reload' && reloads === 2)
          )
            throw new Error(original);
          await f.reload();
        },
        execute: async () => {
          body = true;
          const key = Object.keys(f.entries).find((key) => key.startsWith('matrx.qa.'));
          if (failurePhase === 'foreign') f.entries[key].owner = 'foreign';
          if (failurePhase === 'missing') delete f.entries[key];
          if (failurePhase === 'corrupt') f.entries[key].payload = '{';
          f.entries['matrx.settings.v1'] = 'changed by owned control';
        },
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, failurePhase);
    const receipt = settingsFixtureIntegrityFailure(caught);
    assert.ok(receipt, failurePhase);
    if (['foreign', 'missing', 'corrupt'].includes(failurePhase)) {
      assert.equal(receipt.snapshotRetained, false);
      assert.equal(receipt.backupOwned, false);
      assert.equal(receipt.backupPresent, failurePhase !== 'missing');
    }
    assert.doesNotMatch(JSON.stringify(receipt) + caught.message, /CANARY|patient|unknownSibling/);
    if (failurePhase.startsWith('capture')) {
      assert.equal(body, false);
      assert.equal(f.entries['matrx.settings.v1'], original);
    }
    if (['foreign', 'missing', 'corrupt'].includes(failurePhase))
      assert.equal(f.entries['matrx.settings.v1'], 'changed by owned control');
    if (!['missing', 'dispose_readback', 'capture_get', 'capture_set'].includes(failurePhase))
      assert.equal(
        Object.keys(f.entries).some((key) => key.startsWith('matrx.qa.')),
        true,
      );
    assert.equal(settingsFixtureIntegrityFailure({ ...caught, safeCleanupFailed: true }), null);
  });
}

test('exact lifecycle keeps mutable, frozen and primitive primary failures when cleanup also fails', async () => {
  for (const primary of [
    new Error('CANARY_primary'),
    Object.freeze(new Error('CANARY_frozen')),
    'CANARY_primitive',
  ]) {
    const f = simulatedPanel();
    let caught;
    try {
      await withExactSettingsFixture({
        getPanel: () => null,
        driver: f.driver,
        reloadSettings: async () => {
          throw new Error('CANARY_private_cleanup');
        },
        execute: async () => {
          throw primary;
        },
      });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught === primary || caught.cause === primary, true);
    assert.equal(caught.safeCleanupFailed, true);
    assert.equal(settingsFixtureIntegrityFailure(caught).phase, 'retire_before_restore');
    assert.equal(Object.keys(f.entries).filter((key) => key.startsWith('matrx.qa.')).length, 1);
  }
});

async function lifecycleVariant(mutation) {
  let source = await readFile(
    new URL('./settings-scrape-mode-baseline.mjs', import.meta.url),
    'utf8',
  );
  source = source.replace(
    /from '(\.\/[^']+)'/g,
    (_all, relative) => `from '${new URL(relative, import.meta.url).href}'`,
  );
  const mutations = {
    constant_noop: ['  const backupKey =', '  return undefined;\n  const backupKey ='],
    omit_restore: ["await storage('restore');", ''],
    omit_reload: [
      "phase = 'reload_after_restore';\n        await reload();",
      "phase = 'reload_after_restore';",
    ],
    omit_disposal: ["await storage('dispose');", ''],
    constant_restore: [
      'if (saved.present) await local.set({ [sourceKey]: saved.raw });',
      "if (saved.present) await local.set({ [sourceKey]: '{}' });",
    ],
    drop_sibling: [
      'if (saved.present) await local.set({ [sourceKey]: saved.raw });',
      'if (saved.present) { const parsed = JSON.parse(saved.raw); delete parsed.state.unknownSibling; await local.set({ [sourceKey]: JSON.stringify(parsed) }); }',
    ],
    wrong_owner: ['envelope.owner !== owner', 'envelope.owner === owner'],
    raw_leak: ['return { ok: true };', 'return { ok: true, raw: saved.raw };'],
  };
  const [before, after] = mutations[mutation];
  assert.ok(source.includes(before), `mutant ${mutation} must alter actual lifecycle`);
  source = source.replace(before, after);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

async function lifecycleForcing(variant, delayedWrite = false) {
  const raw =
    '{ "state": { "unknownSibling": "CANARY_dental_intake", "theme": "dark" }, "version": 0 }';
  const f = simulatedPanel(raw);
  let reloads = 0;
  let restored = false;
  const originalEvaluate = f.driver.evaluate;
  f.driver.evaluate = async (...args) => {
    const result = await originalEvaluate(...args);
    assert.doesNotMatch(
      JSON.stringify(result),
      /CANARY_dental_intake/,
      'raw source must never cross evaluate boundary',
    );
    if (args[1].endsWith(',"restore")')) restored = true;
    return result;
  };
  await variant.withExactSettingsFixture({
    getPanel: () => null,
    driver: f.driver,
    reloadSettings: async () => {
      reloads++;
      // A queued old writer arrives only on post-restoration hydration.
      if (delayedWrite && restored) f.entries['matrx.settings.v1'] = 'late writer';
      await f.reload();
    },
    execute: async () => {
      f.entries['matrx.settings.v1'] = '{"state":{},"version":0}';
    },
  });
  assert.equal(reloads, 2, 'exact restoration requires both actual document replacement barriers');
  assert.deepEqual(
    f.entries,
    { 'matrx.settings.v1': raw },
    'whole original and disposal are the forcing output',
  );
}

test('real lifecycle rejects late hydration writes and kills storage/reload/privacy mutants in memory', async () => {
  await lifecycleForcing({ withExactSettingsFixture });
  await assert.rejects(
    lifecycleForcing({ withExactSettingsFixture }, true),
    /settings_probe_cleanup_failed/,
  );
  for (const mutation of [
    'constant_noop',
    'omit_restore',
    'omit_reload',
    'omit_disposal',
    'constant_restore',
    'drop_sibling',
    'wrong_owner',
    'raw_leak',
  ]) {
    await assert.rejects(
      lifecycleForcing(await lifecycleVariant(mutation)),
      undefined,
      `${mutation} must be killed`,
    );
  }
});

test('actual T37 callback at original sequence executes the canonical control and whole-container cleanup', async () => {
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf("        await runCase(byId('T37'), async () => {");
  const end = source.indexOf("        await runCase(byId('T46'),", start);
  assert.ok(start > 0 && end > start, 'actual T37 callback delimiters are mandatory');
  assert.ok(
    source.indexOf('snapshotPanelDocumentReload(byId(suffix));') < start,
    'T37 remains after original panel snapshot',
  );
  const f = simulatedPanel();
  const c = { id: 'EXT-F-1003-T37', criteria: [], steps: [] };
  const runnerStart = source.indexOf('async function runCase(c, fn) {');
  const runnerEnd = source.indexOf('\nlet observedPort;', runnerStart);
  const events = [];
  const deps = {
    settingsFixtureIntegrityFailure,
    publicationFailure: undefined,
    checkpoint: (kind) => events.push(kind),
    panel: null,
    reloadSettings: f.reload,
    byId: () => c,
    criterion: (item, name, status, evidence) => item.criteria.push({ name, status, evidence }),
    runGuestDeepCleanCase: (...args) => runGuestDeepCleanCase(...args, f.driver),
  };
  await new Function(
    ...Object.keys(deps),
    `return (async () => { ${source.slice(runnerStart, runnerEnd)}\n${source.slice(start, end)} })();`,
  )(...Object.values(deps));
  assert.equal(c.status, 'pass');
  assert.equal(f.state.clicks.filter(([, label]) => label === 'Deep clean').length, 2);
  assert.deepEqual(f.entries, {});
  assert.deepEqual(events, ['case_start', 'case_end']);
});

test('omitting actual lifecycle wiring from any canonical caller exposes container shape corruption', async () => {
  let source = await readFile(
    new URL('./settings-guest-scrape-controls.mjs', import.meta.url),
    'utf8',
  );
  source = source.replace(
    /from '(\.\/[^']+)'/g,
    (_all, relative) => `from '${new URL(relative, import.meta.url).href}'`,
  );
  const before = 'import { withExactSettingsFixture }';
  assert.ok(source.includes(before));
  source = source.replace(
    before,
    'import { withExactSettingsFixture as canonicalExactSettingsFixture }',
  );
  source = source.replace(
    'const STORAGE_KEY =',
    'const withExactSettingsFixture = ({ execute }) => execute();\nconst STORAGE_KEY =',
  );
  const mutant = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );
  for (const name of [
    'runGuestAutoScrapeCase',
    'runGuestAutoScrapeModeCase',
    'runGuestDeepCleanCase',
  ]) {
    const f = simulatedPanel();
    await mutant[name](null, f.reload, () => {}, f.driver);
    assert.throws(
      () => assert.deepEqual(f.entries, {}),
      { code: 'ERR_ASSERTION' },
      `${name} omission must fail exact absent-container oracle`,
    );
  }
});

test('backup marker alone cannot alter immutable mode footprint and other local keys survive', async () => {
  const f = simulatedPanel();
  f.entries['matrx.unrelated'] = { dentalIntake: 'CANARY_sibling' };
  const source = await readFile(
    new URL('./settings-guest-preference-batch.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('function guestModeShadowExpression() {');
  const end = source.indexOf('\nexport function guestModeShadowMatches', start);
  const expression = new Function(
    `${source.slice(start, end)}; return guestModeShadowExpression();`,
  )();
  const read = () =>
    runInNewContext(expression, {
      chrome: { storage: { local: f.local } },
      crypto: webcrypto,
      TextEncoder,
    });
  const baseline = await read();
  await withExactSettingsFixture({
    getPanel: () => null,
    reloadSettings: f.reload,
    driver: f.driver,
    execute: async () => {
      assert.equal(Object.keys(f.entries).filter((key) => key.startsWith('matrx.qa.')).length, 1);
      assert.equal(guestModeShadowMatches(await read(), baseline), true);
    },
  });
  assert.deepEqual(f.entries, { 'matrx.unrelated': { dentalIntake: 'CANARY_sibling' } });
});

test('capture collision and transport uncertainty never mutate Settings or delete unknown backups', async () => {
  for (const uncertain of [false, true]) {
    const f = simulatedPanel('{"state":{"theme":"dark"},"version":0}');
    const original = structuredClone(f.entries);
    const originalGet = f.local.get;
    f.local.get = async (key) =>
      !uncertain && typeof key === 'string' && key.startsWith('matrx.qa.')
        ? { [key]: { owner: 'foreign' } }
        : originalGet(key);
    const evaluate = f.driver.evaluate;
    let body = false;
    f.driver.evaluate = async (...args) => {
      const result = await evaluate(...args);
      if (uncertain) throw new Error('CANARY_lost_response');
      return result;
    };
    let failure;
    try {
      await withExactSettingsFixture({
        getPanel: () => null,
        reloadSettings: f.reload,
        driver: f.driver,
        execute: async () => {
          body = true;
        },
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(settingsFixtureIntegrityFailure(failure));
    assert.equal(body, false);
    assert.equal(f.entries['matrx.settings.v1'], original['matrx.settings.v1']);
    assert.equal(
      Object.keys(f.entries).filter((key) => key.startsWith('matrx.qa.')).length,
      uncertain ? 1 : 0,
    );
  }
});

for (const [name, runner, lastReload, corruptUi] of [
  [
    'T40',
    runGuestAutoScrapeCase,
    5,
    (state) => {
      state.switchVisible = true;
    },
  ],
  [
    'T67',
    runGuestAutoScrapeModeCase,
    5,
    (state) => {
      state.modeVisible = 'Scroll & capture';
    },
  ],
  [
    'T37',
    runGuestDeepCleanCase,
    4,
    (state) => {
      state.deepVisible = true;
    },
  ],
]) {
  test(`${name} exact raw with wrong hydrated UI retains backup and fails before disposal`, async () => {
    const f = simulatedPanel();
    let caught;
    try {
      await runner(
        null,
        async () => {
          await f.reload();
          if (f.state.reloads === lastReload) corruptUi(f.state);
        },
        () => {},
        f.driver,
      );
    } catch (error) {
      caught = error;
    }
    const receipt = settingsFixtureIntegrityFailure(caught);
    assert.ok(receipt);
    assert.equal(receipt.phase, 'verify');
    assert.equal(receipt.restoredAfterReload, false);
    assert.equal(receipt.snapshotRetained, true);
    assert.equal(receipt.backupOwned, true);
    assert.equal(
      Object.hasOwn(f.entries, 'matrx.settings.v1'),
      false,
      'raw restoration succeeded but UI postcondition is independently required',
    );
    assert.equal(Object.keys(f.entries).filter((key) => key.startsWith('matrx.qa.')).length, 1);
  });
}

test('awaited post-reload verification finishes before any snapshot disposal', async () => {
  const f = simulatedPanel();
  let entered = false;
  let caught;
  try {
    await withExactSettingsFixture({
      getPanel: () => null,
      driver: f.driver,
      reloadSettings: f.reload,
      execute: async () => {},
      onRestored: async () => {
        entered = true;
        await Promise.resolve();
        assert.equal(Object.keys(f.entries).filter((key) => key.startsWith('matrx.qa.')).length, 1);
        throw new Error('CANARY_async_ui_failure');
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(entered, true);
  assert.equal(settingsFixtureIntegrityFailure(caught).snapshotRetained, true);
  assert.equal(Object.keys(f.entries).filter((key) => key.startsWith('matrx.qa.')).length, 1);
});

test('fixture failure phase remains separate from successful later restoration and disposal', async () => {
  const f = simulatedPanel('{"state":{"theme":"dark"},"version":0}');
  const remove = f.local.remove;
  let refused = false;
  f.local.remove = async (key) => {
    if (key === 'matrx.settings.v1' && !refused) {
      refused = true;
      throw new Error('CANARY_remove_failed');
    }
    return remove(key);
  };
  let caught;
  try {
    await withExactSettingsFixture({
      getPanel: () => null,
      driver: f.driver,
      reloadSettings: f.reload,
      execute: async ({ removeSource }) => removeSource(),
    });
  } catch (error) {
    caught = error;
  }
  const receipt = settingsFixtureIntegrityFailure(caught);
  assert.equal(receipt.phase, 'ownership');
  assert.equal(receipt.cleanupPhase, 'dispose');
  assert.equal(receipt.restoredAfterReload, true);
  assert.equal(receipt.snapshotRetained, false);
  assert.equal(receipt.backupPresent, false);
});
