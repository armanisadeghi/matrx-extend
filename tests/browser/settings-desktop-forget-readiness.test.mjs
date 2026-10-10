import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { clickDesktopPairForget } from './settings-desktop-pointer-diagnostics.mjs';
import {
  click,
  desktopPairForgetControlReady,
  settingsActionSummary,
} from './settings-panel-driver.mjs';

function makePanel(forgetButtonCount) {
  const window = new Window({ url: 'chrome-extension://owned/settings.html' });
  const buttons = Array.from(
    { length: forgetButtonCount },
    () => '<button>Forget pair code</button>',
  ).join('');
  window.document.body.innerHTML = `
    <button role="tab" title="Settings" data-state="active" aria-controls="settings-pane"></button>
    <div id="settings-pane" role="tabpanel" data-state="active">
      <input placeholder="Pair code" value="controlled-pair" />
      ${buttons}
    </div>`;
  const rect = { x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 };
  const target = window.document.querySelector('#settings-pane button:not([role="tab"])');
  for (const button of window.document.querySelectorAll('button')) {
    button.getBoundingClientRect = () => rect;
    button.scrollIntoView = () => {};
  }
  window.HTMLElement.prototype.getAnimations = () => [];
  window.document.elementFromPoint = () => target;
  const events = [];
  return {
    events,
    window,
    panel: {
      async send(method, args) {
        if (method === 'Runtime.evaluate')
          return { result: { value: window.eval(args.expression) } };
        if (method === 'Input.dispatchMouseEvent') events.push(args.type);
        return {};
      },
    },
  };
}

test('pair input alone cannot satisfy guest Forget readiness or dispatch a click', async () => {
  const { panel, events, window } = makePanel(0);
  try {
    const summary = await settingsActionSummary(panel, 'Forget pair code');
    assert.equal(window.document.querySelector('input[placeholder="Pair code"]') !== null, true);
    assert.equal(summary.settingsActive, true);
    assert.equal(summary.matchedCount, 0);
    assert.equal(summary.visibleCount, 0);
    assert.equal(
      desktopPairForgetControlReady({
        ...summary,
        pairAvailable: true,
        forgetButtonVisibleCount: summary.visibleCount,
      }),
      false,
    );
    await assert.rejects(click(panel, 'settings-button', 'Forget pair code'), (error) => {
      assert.equal(error.driverFailure?.code, 'pointer_target_not_unique');
      assert.equal(error.driverFailure?.matchedTargetCount, 0);
      assert.equal(error.driverFailure?.visibleMatchCount, 0);
      return true;
    });
    assert.deepEqual(events, []);
  } finally {
    window.happyDOM.abort();
  }
});

test('one visible guest Forget control is ready and remains clickable', async () => {
  const { panel, events, window } = makePanel(1);
  try {
    const summary = await settingsActionSummary(panel, 'Forget pair code');
    assert.equal(summary.settingsActive, true);
    assert.equal(summary.matchedCount, 1);
    assert.equal(summary.visibleCount, 1);
    assert.equal(
      desktopPairForgetControlReady({
        ...summary,
        pairAvailable: true,
        forgetButtonVisibleCount: summary.visibleCount,
      }),
      true,
    );
    assert.equal(
      desktopPairForgetControlReady({
        ...summary,
        pairAvailable: false,
        forgetButtonVisibleCount: summary.visibleCount,
      }),
      false,
    );
    const diagnostic = await click(panel, 'settings-button', 'Forget pair code');
    assert.equal(diagnostic.selected_point_available, true);
    assert.deepEqual(events, ['mousePressed', 'mouseReleased']);
  } finally {
    window.happyDOM.abort();
  }
});

test('two visible guest Forget controls are not ready and strict pointer selection refuses', async () => {
  const { panel, events, window } = makePanel(2);
  try {
    const summary = await settingsActionSummary(panel, 'Forget pair code');
    assert.equal(summary.settingsActive, true);
    assert.equal(summary.matchedCount, 2);
    assert.equal(summary.visibleCount, 2);
    assert.equal(
      desktopPairForgetControlReady({
        ...summary,
        pairAvailable: true,
        forgetButtonVisibleCount: summary.visibleCount,
      }),
      false,
    );
    await assert.rejects(click(panel, 'settings-button', 'Forget pair code'), (error) => {
      assert.equal(error.driverFailure?.code, 'pointer_target_not_unique');
      assert.equal(error.driverFailure?.matchedTargetCount, 2);
      assert.equal(error.driverFailure?.visibleMatchCount, 2);
      return true;
    });
    assert.deepEqual(events, []);
  } finally {
    window.happyDOM.abort();
  }
});

// Break guarded here: discarding the safe pointer error erases whether a
// once-ready Forget control vanished, duplicated, or lost its active pane.
for (const [transition, active, count] of [
  ['removed', true, 0],
  ['duplicated', true, 2],
  ['pane-inactive', false, 0],
]) {
  test(`Forget failure report preserves ready-to-${transition} cardinality without clicking`, async () => {
    const { panel, events, window } = makePanel(1);
    try {
      const summary = await settingsActionSummary(panel, 'Forget pair code');
      const readiness = {
        settingsActive: summary.settingsActive,
        pairAvailable: true,
        forgetButtonMatchedCount: summary.matchedCount,
        forgetButtonVisibleCount: summary.visibleCount,
        pairInput: 'private-pair-value',
      };
      const pane = window.document.getElementById('settings-pane');
      if (transition === 'removed') pane.querySelector('button').remove();
      if (transition === 'duplicated') {
        const original = pane.querySelector('button');
        const duplicate = original.cloneNode(true);
        duplicate.getBoundingClientRect = original.getBoundingClientRect;
        pane.append(duplicate);
      }
      if (transition === 'pane-inactive') pane.setAttribute('data-state', 'inactive');
      const report = { diagnostics: { existing: true } };
      await assert.rejects(clickDesktopPairForget(panel, report, readiness), (error) => {
        assert.equal(error.driverFailure?.code, 'pointer_target_not_unique');
        return true;
      });
      assert.deepEqual(report.diagnostics, {
        existing: true,
        desktop_pair_forget_control_readiness: {
          settingsActive: true,
          pairAvailable: true,
          matchedCount: 1,
          visibleCount: 1,
        },
        desktop_pair_forget_pointer_failure: {
          code: 'pointer_target_not_unique',
          sampleStage: 'visibility_filter',
          matchedTargetCount: count,
          visibleMatchCount: count,
          uniqueVisibleTarget: false,
          settingsPanelActive: active,
        },
      });
      assert.deepEqual(events, []);
    } finally {
      window.happyDOM.abort();
    }
  });
}

test('stable unique Forget records successful readiness while dispatching the trusted click', async () => {
  const { panel, events, window } = makePanel(1);
  try {
    const report = {};
    await clickDesktopPairForget(panel, report, {
      settingsActive: true,
      pairAvailable: true,
      forgetButtonMatchedCount: 1,
      forgetButtonVisibleCount: 1,
    });
    assert.deepEqual(report, {
      diagnostics: {
        desktop_pair_forget_control_readiness: {
          settingsActive: true,
          pairAvailable: true,
          matchedCount: 1,
          visibleCount: 1,
        },
      },
    });
    assert.deepEqual(events, ['mousePressed', 'mouseReleased']);
  } finally {
    window.happyDOM.abort();
  }
});
