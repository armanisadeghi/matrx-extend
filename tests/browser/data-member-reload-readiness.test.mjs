import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Window } from 'happy-dom';
import * as driver from './settings-panel-driver.mjs';

const source = readFileSync(
  new URL('./data-member-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const start = source.indexOf("        report.stage = 'extension_reload_reopen_data';");
const end = source.indexOf(
  "        await waitFor(\n          'data_member_reloaded_data_tab_ready'",
  start,
);
assert.ok(start >= 0 && end > start);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const reopen = new AsyncFunction(
  'panel',
  'native',
  'report',
  'click',
  'waitForReplacementTab',
  `${source.slice(start, end)} return report;`,
);

function replacement({
  mountAfter = 2,
  duplicate = false,
  frameUrl = 'https://panel.test/',
  targetUrl = 'https://panel.test/',
} = {}) {
  const url = 'https://panel.test/';
  const window = new Window({ url });
  window.document.body.innerHTML = '<main class="animate-pulse"></main>';
  let evaluations = 0;
  const events = [];
  const mount = () => {
    window.document.body.innerHTML = `<button role="tab" title="Data" aria-controls="data-pane"></button>${duplicate ? '<button role="tab" title="Data"></button>' : ''}<div id="data-pane" role="tabpanel"></div>`;
    const target = window.document.querySelector('button[title="Data"]');
    for (const button of window.document.querySelectorAll('button[title="Data"]')) {
      button.getBoundingClientRect = () => ({
        x: 10,
        y: 10,
        left: 10,
        top: 10,
        right: 110,
        bottom: 40,
        width: 100,
        height: 30,
      });
      button.scrollIntoView = () => {};
      button.getAnimations = () => [];
    }
    window.document.elementFromPoint = () => target;
  };
  const panel = {
    targetId: 'replacement-panel',
    async send(method, args) {
      if (method === 'Runtime.evaluate') {
        evaluations++;
        if (evaluations === mountAfter) mount();
        return { result: { value: window.eval(args.expression) } };
      }
      if (method === 'Target.getTargetInfo')
        return { targetInfo: { targetId: panel.targetId, type: 'page', url: targetUrl } };
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { url: frameUrl } } };
      if (method === 'Input.dispatchMouseEvent') events.push(args.type);
      return {};
    },
  };
  return {
    panel,
    window,
    events,
    get evaluations() {
      return evaluations;
    },
    url,
  };
}

test('member Data waits for the adopted replacement tab to mount before trusted pointer input', async () => {
  const fixture = replacement();
  try {
    const report = { stage: null };
    await reopen(
      fixture.panel,
      { panelTarget: { url: fixture.url } },
      report,
      driver.click,
      driver.waitForReplacementTab,
    );
    assert.equal(report.stage, 'extension_reload_reopen_data');
    assert.ok(fixture.evaluations >= 3, 'first empty sample must precede mounted tab and pointer');
    assert.deepEqual(fixture.events, ['mousePressed', 'mouseReleased']);
    assert.equal(report.reload_data_readiness?.first?.matched, 0);
    assert.equal(report.reload_data_readiness?.last?.visible, 1);
  } finally {
    fixture.window.happyDOM.abort();
  }
});

for (const [name, options, stage] of [
  ['never mounted', { mountAfter: Number.POSITIVE_INFINITY }, 'tab_not_ready'],
  ['duplicate Data tabs', { mountAfter: 1, duplicate: true }, 'tab_not_ready'],
  ['wrong replacement frame', { mountAfter: 1, frameUrl: 'https://other.test/' }, 'frame_mismatch'],
  [
    'wrong replacement target',
    { mountAfter: 1, targetUrl: 'https://other.test/' },
    'target_mismatch',
  ],
])
  test(`member Data readiness refuses ${name} before pointer input`, async () => {
    const fixture = replacement(options);
    try {
      await assert.rejects(
        driver.waitForReplacementTab(fixture.panel, 'Data', 120, fixture.url),
        (error) => {
          assert.equal(error.readinessDiagnostic?.stage, stage);
          assert.equal(
            error.readinessDiagnostic?.first?.matched,
            name === 'never mounted' ? 0 : name === 'duplicate Data tabs' ? 2 : 1,
          );
          return true;
        },
      );
      assert.deepEqual(fixture.events, []);
    } finally {
      fixture.window.happyDOM.abort();
    }
  });

test('constant readiness result cannot make the real member Data pointer click a loading panel', async () => {
  const fixture = replacement();
  try {
    await assert.rejects(
      reopen(
        fixture.panel,
        { panelTarget: { url: fixture.url } },
        { stage: null },
        driver.click,
        async () => ({ first: { matched: 1 }, last: { visible: 1 } }),
      ),
      (error) => error.driverFailure?.code === 'pointer_target_not_unique',
    );
    assert.deepEqual(fixture.events, []);
  } finally {
    fixture.window.happyDOM.abort();
  }
});

test('member Data receipt retains bounded first and last samples when the replacement never mounts', async () => {
  const fixture = replacement({ mountAfter: Number.POSITIVE_INFINITY });
  const report = { stage: null };
  try {
    await assert.rejects(
      reopen(
        fixture.panel,
        { panelTarget: { url: fixture.url } },
        report,
        driver.click,
        (panel, title, _timeout, url) => driver.waitForReplacementTab(panel, title, 120, url),
      ),
      /replacement_data_tab_ready_not_observed/,
    );
    assert.equal(report.reload_data_readiness.stage, 'tab_not_ready');
    assert.equal(report.reload_data_readiness.first.matched, 0);
    assert.equal(report.reload_data_readiness.last.visible, 0);
    assert.ok(report.reload_data_readiness.elapsed_ms >= 0);
    assert.deepEqual(fixture.events, []);
  } finally {
    fixture.window.happyDOM.abort();
  }
});
