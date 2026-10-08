import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  runGuestAutoScrapeCase,
  runGuestAutoScrapeModeCase,
  runGuestSectionsCase,
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
      if (expression.includes('const headings =')) {
        const label = headings.find((name) => expression.includes(JSON.stringify(name)));
        const expanded = state.sections[label];
        return {
          active: true,
          headings,
          count: 1,
          expanded: String(expanded),
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
        /guest_settings_sections_missing:\{"active":false,"count":0,"headings":\[\],"unrecognizedHeadingCount":0\}/,
      privateLookingHeading: null,
    },
    {
      label: 'same-count roster drift',
      active: true,
      observedHeadings: [...headings.slice(0, 4), privateLookingHeading, ...headings.slice(5)],
      expected:
        /guest_settings_sections_missing:\{"active":true,"count":11,"headings":\["Account","Organization","Appearance","Chat","Scrape","Data","SEO","Desktop bridge","Data & reset","About"\],"unrecognizedHeadingCount":1\}/,
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
