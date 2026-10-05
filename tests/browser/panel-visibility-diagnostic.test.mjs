import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const harnessSource = await readFile(
  new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
  'utf8',
);
const scrapeSource = await readFile(
  new URL('./scrape-guest-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const between = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'diagnostic execution seam missing');
  return source.slice(from, to);
};
function helpers(source) {
  return new Function(
    `${between(source, 'async function observePanelVisibility(', 'async function sidePanelContexts(')}; return { observePanelVisibility, activateOwnedSidePanel };`,
  )();
}

// SUT owns measurement expression, failure reduction and checkpoint orchestration.
// External CDP/DOM, authentication and screenshot dependencies are doubled.
async function checkMeasurements(source) {
  const { observePanelVisibility } = helpers(source);
  for (const [visibility, focus, ready, width, height] of [
    ['hidden', true, 'complete', 600, 800],
    ['visible', false, 'loading', 420, 700],
    ['unsupported', false, 'complete', 320, 600],
  ]) {
    const calls = [];
    const observation = await observePanelVisibility({
      send: async (method, params) => {
        calls.push(method);
        assert.equal(params.returnByValue, true);
        const value = runInNewContext(params.expression, {
          document: {
            visibilityState: visibility,
            hasFocus: () => focus,
            readyState: ready,
            URL: 'private-url',
            body: { textContent: 'private-content' },
          },
          window: { innerWidth: width, innerHeight: height, privateIdentity: 'private-identity' },
        });
        return { result: { value } };
      },
    });
    assert.deepEqual(observation, {
      measured: true,
      visibility: visibility === 'unsupported' ? 'other' : visibility,
      hasFocus: focus,
      ready: ready === 'complete',
      width,
      height,
    });
    assert.deepEqual(calls, ['Runtime.evaluate']);
  }
  for (const result of [{ exceptionDetails: { text: 'private-error' } }, {}, { result: {} }]) {
    assert.deepEqual(await observePanelVisibility({ send: async () => result }), {
      measured: false,
    });
  }
  assert.deepEqual(
    await observePanelVisibility({
      send: async () => {
        throw new Error('private-error');
      },
    }),
    { measured: false },
  );
}

async function checkPath(source, scrape, refused = false) {
  const { activateOwnedSidePanel } = helpers(source);
  const phases = [];
  let visible = true;
  const panel = {
    send: async (_method, { expression }) => ({
      result: {
        value: runInNewContext(expression, {
          document: {
            visibilityState: visible ? 'visible' : 'hidden',
            hasFocus: () => true,
            readyState: 'complete',
          },
          window: { innerWidth: 600, innerHeight: 800 },
        }),
      },
    }),
    detach: async () => {},
  };
  const initial = between(
    source,
    '    const readyPanel = await waitForSettledGuestPanel',
    '    if (publicDemoUrl)',
  );
  const captures = between(source, '    const normalPng =', "    onStage('exercise_panel');");
  const observe = await new Function(
    'waitForSettledGuestPanel',
    'onPanelVisibilityObservation',
    'observePanelVisibility',
    'cdp',
    'panelTarget',
    'normalTarget',
    'artifacts',
    'join',
    'onStage',
    'captureTarget',
    `return (async () => { ${initial} ${captures} return observeVisibility; })();`,
  )(
    async () => panel,
    (value) => phases.push(value),
    helpers(source).observePanelVisibility,
    {},
    { targetId: 'panel' },
    { targetId: 'root' },
    '',
    (...parts) => parts.join('/'),
    () => {},
    async () => {},
  );
  let reply = '';
  const actions = [];
  const page = {
    bringToFront: async () => actions.push('foreground'),
    locator: (selector) => {
      const locator = {
        evaluate: async (mutate) => {
          const element = { textContent: reply };
          mutate(element);
          reply = element.textContent;
        },
        click: async () => {
          assert.equal(selector, '#open-panel');
          actions.push('open');
          reply = JSON.stringify({ ok: !refused, result: { opened: !refused } });
        },
        filter: () => locator,
        waitFor: async () => {},
        textContent: async () => reply,
      };
      return locator;
    },
  };
  const setup = between(
    scrape,
    'exercisePanel: async ({',
    '      report.panel_viewports.push({',
  ).slice('exercisePanel: '.length);
  const authObserve = async () => {};
  const exercise = new Function(
    'signInSettings',
    'selectRequiredSettingsOrganization',
    'selection',
    'report',
    'assert',
    'REPO',
    'waitFor',
    'evaluate',
    `let expectedIdentity; return (${setup}\n});`,
  )(
    async ({ observeBoundary }) => {
      assert.equal(observeBoundary, authObserve);
      visible = false;
      return { mode: 'member' };
    },
    async () => ({}),
    { mode: 'member' },
    {},
    assert,
    '',
    async (_label, read, accepts) => assert.equal(accepts(await read()), true),
    async () => true,
  );
  const run = () =>
    exercise({
      page,
      panel,
      observePanelVisibility: observe,
      observeAuthenticatedPanel: authObserve,
      reopenPanel: () =>
        activateOwnedSidePanel({
          panel,
          page,
          panelTargetId: 'panel',
          cdp: {
            send: async (method) => {
              assert.equal(method, 'Target.activateTarget');
              actions.push('activate');
            },
          },
          observe,
        }),
      requireResourceHealth: async () => {},
      resourceAction: async (action) => action(),
    });
  if (refused) await assert.rejects(run, /native_sidepanel_open_refused/);
  else await run();
  const expectedPhases = [
    'initial_settled_before_screenshots',
    'after_initial_screenshots',
    'before_authentication',
    'after_authentication',
    'after_organization_selection',
    'before_reopen',
    'after_root_foreground',
    ...(!refused ? ['after_trusted_open', 'after_target_activation'] : []),
  ];
  assert.deepEqual(
    phases.map((entry) => entry.phase),
    expectedPhases,
  );
  assert.deepEqual(actions, refused ? ['foreground', 'open'] : ['foreground', 'open', 'activate']);
  for (const [index, entry] of phases.entries()) {
    assert.deepEqual(entry, {
      phase: expectedPhases[index],
      measured: true,
      visibility: index < 3 ? 'visible' : 'hidden',
      hasFocus: true,
      ready: true,
      width: 600,
      height: 800,
    });
  }
}

test('actual diagnostic emits only measured state or explicit unavailable state', async () => {
  await checkMeasurements(harnessSource);
});
test('actual setup preserves all nine checkpoints and stops observation after refused reopen', async () => {
  await checkPath(harnessSource, scrapeSource);
  await checkPath(harnessSource, scrapeSource, true);
});
test('in-memory mutations cannot omit checkpoints or manufacture successful measurements', async () => {
  const mutations = [
    [harnessSource, scrapeSource.replace('observeBoundary: observeAuthenticatedPanel,', '')],
    [
      harnessSource.replace("await observeVisibility('initial_settled_before_screenshots');", ''),
      scrapeSource,
    ],
    [
      harnessSource.replace("await observeVisibility('after_initial_screenshots');", ''),
      scrapeSource,
    ],
    ...[
      'before_reopen',
      'after_root_foreground',
      'after_trusted_open',
      'after_target_activation',
    ].map((phase) => [harnessSource.replace(`await observe('${phase}');`, ''), scrapeSource]),
    ...['before_authentication', 'after_authentication', 'after_organization_selection'].map(
      (phase) => [
        harnessSource,
        scrapeSource.replace(`await observePanelVisibility('${phase}');`, ''),
      ],
    ),
  ];
  for (const [source, scrape] of mutations)
    await assert.rejects(() => checkPath(source, scrape), assert.AssertionError);
  await assert.rejects(
    () =>
      checkMeasurements(
        harnessSource.replaceAll('return { measured: false };', 'return { measured: true };'),
      ),
    assert.AssertionError,
  );
  await assert.rejects(
    () =>
      checkMeasurements(
        harnessSource.replace(
          'hasFocus: document.hasFocus(),',
          'hasFocus: document.hasFocus(), privateUrl: document.URL,',
        ),
      ),
    assert.AssertionError,
  );
  await assert.rejects(
    () =>
      checkMeasurements(
        harnessSource.replace(
          'async function observePanelVisibility(panel) {',
          "async function observePanelVisibility(panel) { return { measured: true, visibility: 'hidden', hasFocus: true, ready: true, width: 600, height: 800 };",
        ),
      ),
    assert.AssertionError,
  );
});
