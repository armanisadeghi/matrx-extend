import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(
  new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
  'utf8',
);
const scrape = await readFile(
  new URL('./scrape-guest-native-acceptance.mjs', import.meta.url),
  'utf8',
);
function helper(text) {
  const start = text.indexOf('async function observePanelVisibility(');
  const end = text.indexOf('async function sidePanelContexts(', start);
  return new Function(`${text.slice(start, end)}; return activateOwnedSidePanel;`)();
}

// Captured member run: original exact panel remained visible after auth/org and
// root foreground; a redundant trusted open was its first hidden transition.
// Owns actual setup ordering + helper decisions; only external browser/auth IO is doubled.
async function exercise(text, initial, reply = { ok: true, result: { opened: true } }) {
  let visibility = initial;
  let result = 'stale-success';
  const events = [];
  const panel = {
    send: async (_method, { expression }) => ({
      result: {
        value: runInNewContext(expression, {
          chrome: { runtime: { id: 'fixture-extension' } },
          document: { visibilityState: visibility, hasFocus: () => true, readyState: 'complete' },
          window: { innerWidth: 360, innerHeight: 373 },
        }),
      },
    }),
  };
  const page = {
    bringToFront: async () => events.push('foreground'),
    locator: (selector) => {
      const locator = {
        evaluate: async (mutate) => {
          const element = { textContent: result };
          mutate(element);
          result = element.textContent;
          events.push('clear');
        },
        click: async () => {
          assert.equal(selector, '#open-panel');
          assert.equal(result, '', 'stale reply not cleared');
          events.push('open');
          // External native open behavior captured at the failure boundary:
          // a repeated open can hide a visible panel, while hidden needs opening.
          visibility = visibility === 'visible' ? 'hidden' : 'visible';
          result = JSON.stringify(reply);
        },
        filter: () => locator,
        waitFor: async () => {},
        textContent: async () => result,
      };
      return locator;
    },
  };
  const start = scrape.indexOf('exercisePanel: async ({');
  const end = scrape.indexOf('      report.panel_viewports.push({', start);
  const setup = scrape.slice(start + 'exercisePanel: '.length, end);
  const activate = helper(text);
  const run = new Function(
    'signInSettings',
    'selectRequiredSettingsOrganization',
    'startPanelTransitionRecorder',
    'traceOrganizationPointers',
    'classifyPanelTransition',
    'selection',
    'requiredOrganizationName',
    'report',
    'assert',
    'REPO',
    'waitFor',
    'evaluate',
    'authenticatedPanelForegroundDiagnostic',
    `let expectedIdentity; return (${setup}\n});`,
  )(
    async () => ({ mode: 'member' }),
    async () => ({}),
    async () => ({ mark: async () => {}, stop: async () => ({ status: 'measured', events: [] }) }),
    (value) => value,
    () => 'no_hidden_event',
    { mode: 'member' },
    undefined,
    {},
    assert,
    '',
    async (_label, read, accepts) => {
      assert.equal(accepts(await read()), true, 'exact panel became hidden');
      events.push('visible-gate');
    },
    async (session, expression) =>
      (await session.send('Runtime.evaluate', { expression })).result.value,
    async () => ({ visibility }),
  );
  await run({
    panel,
    page,
    browserSession: {
      send: async (method) => {
        assert.equal(method, 'Browser.getVersion');
        return { product: 'Chrome/fixture' };
      },
    },
    observePanelVisibility: async () => {},
    reopenPanel: () =>
      activate({
        panel,
        page,
        panelTargetId: 'exact-owned-panel',
        cdp: {
          send: async (_method, args) => {
            assert.deepEqual(args, { targetId: 'exact-owned-panel' });
            events.push('activate');
          },
        },
      }),
    requireResourceHealth: async () => events.push('health'),
    resourceAction: async (action) => action(),
  });
  return events;
}

test('authenticated setup preserves the visible exact panel without native open or activation', async () => {
  assert.deepEqual(await exercise(source, 'visible'), ['health', 'visible-gate', 'health']);
});
test('authenticated setup legitimately reopens the hidden exact panel before unchanged visibility gate', async () => {
  assert.deepEqual(await exercise(source, 'hidden'), [
    'health',
    'foreground',
    'clear',
    'open',
    'activate',
    'visible-gate',
    'health',
  ]);
  await assert.rejects(
    () => exercise(source, 'hidden', { ok: true, result: { opened: false } }),
    /native_sidepanel_open_refused/,
  );
});
test('in-memory omitted work and constant preservation fail the actual setup seam', async () => {
  const from = source.indexOf('async function activateOwnedSidePanel(');
  const to = source.indexOf('async function sidePanelContexts(', from);
  const constant = `${source.slice(0, from)}async function activateOwnedSidePanel() {}\n${source.slice(to)}`;
  await assert.rejects(() => exercise(constant, 'hidden'), /exact panel became hidden/);
  const unconditional = source.replace("if (visibility.visibility === 'visible') return;", '');
  await assert.rejects(() => exercise(unconditional, 'visible'), /exact panel became hidden/);
});

test('unavailable exact-panel visibility refuses any native action', async () => {
  for (const response of [
    {},
    { exceptionDetails: {} },
    { result: { value: { visibility: 'other' } } },
  ]) {
    await assert.rejects(
      () =>
        helper(source)({
          panel: { send: async () => response },
          page: { bringToFront: async () => assert.fail('unmeasured panel must not be reopened') },
          cdp: { send: async () => assert.fail('unmeasured panel must not be activated') },
          panelTargetId: 'exact-owned-panel',
        }),
      /native_sidepanel_visibility_unavailable_before_reopen/,
    );
  }
  await assert.rejects(
    () =>
      helper(source)({
        panel: {
          send: async () => {
            throw new Error('transport unavailable');
          },
        },
        page: { bringToFront: async () => assert.fail('failed probe must not reopen') },
        panelTargetId: 'exact-owned-panel',
      }),
    /native_sidepanel_visibility_unavailable_before_reopen/,
  );
});

test('hidden recovery cannot drop exact target activation or use a constant hidden decision', async () => {
  const noActivation = source.replace(
    "await cdp.send('Target.activateTarget', { targetId: panelTargetId });",
    '',
  );
  await assert.rejects(
    async () =>
      assert.deepEqual(await exercise(noActivation, 'hidden'), [
        'health',
        'foreground',
        'clear',
        'open',
        'activate',
        'visible-gate',
        'health',
      ]),
    assert.AssertionError,
  );
  const constantHidden = source.replace(
    'const visibility = await observePanelVisibility(panel);',
    "const visibility = { measured: true, visibility: 'hidden' };",
  );
  await assert.rejects(() => exercise(constantHidden, 'visible'), /exact panel became hidden/);
});
