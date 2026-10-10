import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { clickDesktopPairFixture } from './settings-desktop-pointer-diagnostics.mjs';

// The guest fixture must save a pairing before Forget can be exercised.
// Break guarded: dropping Pair's pointer refusal discards its causal scalars.
function fixture(mode) {
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" title="Settings" data-state="active" aria-controls="settings-pane"></button>
    <div id="settings-pane" role="tabpanel" data-state="active"><input placeholder="Pair code" value="private-pair-value"><button>Pair</button></div>
    <div id="occluder" role="dialog">Private account text</div>`;
  const target = window.document.querySelector('#settings-pane button');
  const blocker = window.document.getElementById('occluder');
  let sample = 0;
  const rect = { x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 };
  for (const element of window.document.querySelectorAll('*')) {
    element.getBoundingClientRect = () => rect;
    element.scrollIntoView = () => {};
    element.getAnimations = () => [];
  }
  target.getBoundingClientRect = () => {
    const x = mode === 'moving' ? 10 + ++sample : 10;
    return { ...rect, x, left: x, right: x + 100 };
  };
  if (mode === 'animating') target.getAnimations = () => [{ playState: 'running' }];
  if (mode === 'disabled') target.disabled = true;
  if (mode === 'duplicate') {
    const duplicate = target.cloneNode(true);
    duplicate.getBoundingClientRect = () => rect;
    target.parentElement.append(duplicate);
  }
  window.document.elementFromPoint = () => (mode === 'occluded' ? blocker : target);
  const events = [];
  return {
    window,
    events,
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
const readiness = {
  settingsActive: true,
  pairAvailable: true,
  pairInputPresent: true,
  pairKeyPresent: false,
  pairInput: 'private-pair-value',
};
for (const mode of ['occluded', 'animating', 'moving', 'disabled', 'duplicate']) {
  test(`fixture Pair ${mode} refusal preserves its distinct pointer evidence without input`, async (t) => {
    const { window, panel, events } = fixture(mode);
    let time = 0;
    // Advance only the external deadline clock; keep real sampling/dispatch logic.
    t.mock.method(Date, 'now', () => {
      time += 1000;
      return time;
    });
    const report = { diagnostics: { existing: true } };
    try {
      await assert.rejects(clickDesktopPairFixture(panel, report, readiness), (error) => {
        assert.equal(
          error.driverFailure.code,
          mode === 'duplicate' ? 'pointer_target_not_unique' : 'pointer_stable_hit_not_observed',
        );
        return true;
      });
      const diagnostic = report.diagnostics.desktop_pair_fixture;
      assert.ok(diagnostic, 'fixture pointer refusal must persist diagnostic scalars');
      assert.deepEqual(diagnostic.readiness, {
        settingsActive: true,
        pairAvailable: true,
        pairInputPresent: true,
        pairKeyPresent: false,
      });
      assert.deepEqual(diagnostic.inputPhases, {
        targetSelected: false,
        pressAttempted: false,
        pressReturned: false,
        releaseAttempted: false,
        releaseReturned: false,
      });
      const failure = diagnostic.pointerFailure;
      assert.ok(failure, 'fixture pointer failure must remain in the report');
      assert.equal(
        failure.code,
        mode === 'duplicate' ? 'pointer_target_not_unique' : 'pointer_stable_hit_not_observed',
      );
      assert.equal(failure.sampleStage, mode === 'duplicate' ? 'visibility_filter' : null);
      assert.equal(failure.matchedTargetCount, mode === 'duplicate' ? 2 : 1);
      assert.equal(failure.visibleMatchCount, mode === 'duplicate' ? 2 : 1);
      assert.equal(failure.uniqueVisibleTarget, mode !== 'duplicate');
      assert.equal(failure.hitTarget, !['occluded', 'disabled', 'duplicate'].includes(mode));
      assert.equal(failure.animating, mode === 'animating');
      assert.equal(failure.positionStable, !['moving', 'duplicate'].includes(mode));
      assert.equal(failure.targetDisabled, mode === 'duplicate' ? null : mode === 'disabled');
      assert.equal(
        failure.centerHitCategory,
        mode === 'duplicate' ? null : mode === 'occluded' ? 'dialog' : 'target',
      );
      assert.equal(
        failure.selectedPointAvailable,
        mode === 'duplicate' ? null : mode !== 'occluded',
      );
      assert.equal(failure.stableSamples, 0);
      assert.equal(report.diagnostics.existing, true);
      assert.deepEqual(events, []);
      assert(
        !/private-pair-value|Private account text|occluder|targetRectangle|centerOccluder/.test(
          JSON.stringify(report),
        ),
      );
    } finally {
      window.happyDOM.abort();
    }
  });
}

test('stable fixture Pair records trusted press and release while keeping values private', async () => {
  const { window, panel, events } = fixture('stable');
  const report = {};
  try {
    const result = await clickDesktopPairFixture(panel, report, readiness);
    assert.equal(result.selected_point_available, true);
    assert.deepEqual(events, ['mousePressed', 'mouseReleased']);
    assert.deepEqual(report.diagnostics.desktop_pair_fixture, {
      readiness: {
        settingsActive: true,
        pairAvailable: true,
        pairInputPresent: true,
        pairKeyPresent: false,
      },
      inputPhases: {
        targetSelected: true,
        pressAttempted: true,
        pressReturned: true,
        releaseAttempted: true,
        releaseReturned: true,
      },
    });
  } finally {
    window.happyDOM.abort();
  }
});

for (const phase of ['mousePressed', 'mouseReleased']) {
  test(`fixture Pair ${phase} dispatch failure records attempted input and refuses completion`, async () => {
    const { window, panel, events } = fixture('stable');
    const send = panel.send;
    panel.send = async (method, args) => {
      if (method === 'Input.dispatchMouseEvent' && args.type === phase) {
        events.push(args.type);
        throw new Error('Private transport contents');
      }
      return send(method, args);
    };
    const report = {};
    try {
      const expected =
        phase === 'mousePressed'
          ? 'pointer_press_dispatch_failed'
          : 'pointer_release_dispatch_failed';
      await assert.rejects(
        clickDesktopPairFixture(panel, report, {}),
        (error) => error.driverFailure.code === expected,
      );
      assert.equal(report.diagnostics.desktop_pair_fixture.pointerFailure.code, expected);
      assert.deepEqual(report.diagnostics.desktop_pair_fixture.readiness, {
        settingsActive: null,
        pairAvailable: null,
        pairInputPresent: null,
        pairKeyPresent: null,
      });
      assert.deepEqual(report.diagnostics.desktop_pair_fixture.inputPhases, {
        targetSelected: true,
        pressAttempted: true,
        pressReturned: phase === 'mouseReleased',
        releaseAttempted: phase === 'mouseReleased',
        releaseReturned: false,
      });
      assert.deepEqual(
        events,
        phase === 'mousePressed' ? ['mousePressed'] : ['mousePressed', 'mouseReleased'],
      );
      assert(!JSON.stringify(report).includes('Private transport contents'));
    } finally {
      window.happyDOM.abort();
    }
  });
}
