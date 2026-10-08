import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  runGuestAutoScrapeCase,
  runGuestAutoScrapeModeCase,
  runGuestSectionsCase,
  settingsSectionObservationExpression,
} from './settings-guest-scrape-controls.mjs';

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

function simulatedPanel() {
  const state = {
    sections: Object.fromEntries(headings.map((label) => [label, true])),
    switchVisible: false,
    switchStored: false,
    modeVisible: 'Capture',
    modeStored: 'capture',
    reloads: 0,
    clicks: [],
  };
  let selectOpen = false;
  const driver = {
    async evaluate(_panel, expression) {
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
      return {
        active: true,
        sectionOpen: true,
        toggle: { count: 1, visible: state.switchVisible, stored: state.switchStored },
        mode: { count: 1, visible: state.modeVisible, stored: state.modeStored },
      };
    },
    async openSection() {},
    async click(_panel, kind, label) {
      state.clicks.push([kind, label]);
      if (kind === 'section') state.sections[label] = !state.sections[label];
      if (kind === 'switch') {
        state.switchVisible = !state.switchVisible;
        state.switchStored = state.switchVisible;
      }
      if (kind === 'settings-select') selectOpen = true;
      if (kind === 'option') {
        assert.equal(selectOpen, true);
        selectOpen = false;
        state.modeVisible = label;
        state.modeStored = label === 'Capture' ? 'capture' : 'scroll-capture';
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
    state.switchVisible = state.switchStored;
    state.modeVisible = state.modeStored === 'capture' ? 'Capture' : 'Scroll & capture';
  };
  return { state, driver, reload };
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

test('T28 onFailure receipt bounds diagnostics for inactive and same-count roster drift', async () => {
  const acceptanceSource = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const runCaseStart = acceptanceSource.indexOf('async function runCase(c, fn) {');
  const runCaseEnd = acceptanceSource.indexOf('\nlet observedPort;', runCaseStart);
  assert.ok(runCaseStart >= 0 && runCaseEnd > runCaseStart);
  const runCase = new Function(
    'criterion',
    `${acceptanceSource.slice(runCaseStart, runCaseEnd)}\nreturn runCase;`,
  )((c, name, status, evidence) => c.criteria.push({ name, status, evidence }));

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

    const receipt = { criteria: [] };
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
  await assert.rejects(
    runGuestAutoScrapeCase(
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
    ),
    /injected_after_write_failure/,
  );
  assert.equal(state.clicks.filter(([kind]) => kind === 'switch').length, 3);
  assert.equal(state.switchVisible, false);
  assert.equal(state.switchStored, false);
  assert.equal(state.reloads, 1);
});

test('T67 case runner repairs same-selection storage drift through alternate choice and reload', async () => {
  const { state, driver, reload } = simulatedPanel();
  await assert.rejects(
    runGuestAutoScrapeModeCase(
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
    ),
    /injected_after_write_failure/,
  );
  assert.deepEqual(
    state.clicks.filter(([kind]) => kind === 'option').map(([, label]) => label),
    ['Scroll & capture', 'Scroll & capture', 'Capture'],
  );
  assert.equal(state.modeVisible, 'Capture');
  assert.equal(state.modeStored, 'capture');
  assert.equal(state.reloads, 1);
});
