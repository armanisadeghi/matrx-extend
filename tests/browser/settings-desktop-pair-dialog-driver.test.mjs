import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { click } from './settings-panel-driver.mjs';

function makePanel({ pairDialogs = 1, cancelButtons = 1, unrelatedLabels = [] } = {}) {
  const window = new Window({ url: 'chrome-extension://owned/settings.html' });
  const pairModal = (index) => `
    <div role="alertdialog" data-pair="${index}">
      <h2 data-slot="alert-dialog-title">Forget the desktop pair code?</h2>
      ${Array.from({ length: cancelButtons }, () => '<button>Cancel</button>').join('')}
      <button>Forget pair code</button>
    </div>`;
  const unrelated = unrelatedLabels.map(
    (label) => `<div role="alertdialog"><button>${label}</button></div>`,
  );
  window.document.body.innerHTML = `${Array.from({ length: pairDialogs }, (_, i) => pairModal(i)).join('')}${unrelated.join('')}`;
  const rect = { x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 };
  for (const button of window.document.querySelectorAll('button')) {
    button.getBoundingClientRect = () => rect;
    button.scrollIntoView = () => {};
  }
  window.HTMLElement.prototype.getAnimations = () => [];
  const events = [];
  let targetLabel;
  window.document.elementFromPoint = () =>
    [...window.document.querySelectorAll('[role="alertdialog"][data-pair] button')].find(
      (button) => button.textContent.trim() === targetLabel,
    ) ?? null;
  const panel = {
    async send(method, args) {
      if (method === 'Runtime.evaluate') return { result: { value: window.eval(args.expression) } };
      if (method === 'Input.dispatchMouseEvent') events.push(args.type);
      return {};
    },
  };
  return {
    window,
    events,
    panel,
    setTarget: (label) => {
      targetLabel = label;
    },
  };
}

for (const label of ['Cancel', 'Forget pair code']) {
  test(`pair Forget ${label} ignores an unrelated dialog with the same label`, async () => {
    const { window, events, panel, setTarget } = makePanel({ unrelatedLabels: [label] });
    setTarget(label);
    try {
      await click(panel, 'desktop-pair-forget-dialog', label);
      assert.deepEqual(events, ['mousePressed', 'mouseReleased']);
    } finally {
      window.happyDOM.abort();
    }
  });
}

test('duplicate pair dialogs refuse Cancel without dispatching input', async () => {
  const { window, events, panel, setTarget } = makePanel({ pairDialogs: 2 });
  setTarget('Cancel');
  try {
    await assert.rejects(click(panel, 'desktop-pair-forget-dialog', 'Cancel'), (error) => {
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

test('duplicate same-label buttons in the pair dialog refuse without dispatching input', async () => {
  const { window, events, panel, setTarget } = makePanel({ cancelButtons: 2 });
  setTarget('Cancel');
  try {
    await assert.rejects(click(panel, 'desktop-pair-forget-dialog', 'Cancel'), (error) => {
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
