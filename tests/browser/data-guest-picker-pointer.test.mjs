import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { click } from './settings-panel-driver.mjs';

function makePanel() {
  const window = new Window({ url: 'https://catalog.test/products' });
  window.document.body.innerHTML = `
    <button role="tab" title="Data" data-state="active" aria-controls="data-pane"></button>
    <div id="data-pane" role="tabpanel" data-state="active">
      <button>Pick fields on this page</button>
    </div>
    <div id="other-pane"><button>Pick fields on this page</button></div>`;
  const target = window.document.querySelector('#data-pane button');
  const rect = { x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 };
  for (const button of window.document.querySelectorAll('button'))
    button.getBoundingClientRect = () => rect;
  target.scrollIntoView = () => {};
  target.getAnimations = () => [];
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

function makeMissingPickerPanel() {
  const window = new Window({ url: 'https://catalog.test/products' });
  window.document.body.innerHTML = `
    <button role="tab" title="Data" data-state="active" aria-controls="data-pane"></button>
    <div id="data-pane" role="tabpanel" data-state="active">
      <p>Field selection works as a guest.</p>
      <button disabled>Picking on page…</button>
    </div>`;
  return {
    window,
    panel: {
      async send(method, args) {
        if (method === 'Runtime.evaluate')
          return { result: { value: window.eval(args.expression) } };
        return {};
      },
    },
  };
}

test('Data picker pointer resolution is scoped to the active Data panel', async () => {
  const { panel, events, window } = makePanel();
  try {
    const diagnostic = await click(panel, 'data-picker-button', 'Pick fields on this page');
    assert.equal(diagnostic.selected_point_available, true);
    assert.deepEqual(events, ['mousePressed', 'mouseReleased']);
  } finally {
    window.happyDOM.abort();
  }
});

test('global exact-text matching reproduces the duplicate picker target failure', async () => {
  const { panel, window } = makePanel();
  try {
    await assert.rejects(click(panel, 'button-text', 'Pick fields on this page'), (error) => {
      assert.equal(error.driverFailure?.code, 'pointer_target_not_unique');
      assert.equal(error.driverFailure?.matchedTargetCount, 2);
      assert.equal(error.driverFailure?.visibleMatchCount, 2);
      return true;
    });
  } finally {
    window.happyDOM.abort();
  }
});

test('zero picker matches preserve the safe active Data panel state', async () => {
  const { panel, window } = makeMissingPickerPanel();
  try {
    await assert.rejects(
      click(panel, 'data-picker-button', 'Pick fields on this page'),
      (error) => {
        assert.equal(error.driverFailure?.matchedTargetCount, 0);
        assert.equal(error.driverFailure?.visibleMatchCount, 0);
        assert.deepEqual(JSON.parse(JSON.stringify(error.driverFailure?.dataPanelDiagnostic)), {
          active_tab_count: 1,
          pane_id: 'data-pane',
          pane_active: true,
          button_count: 1,
          buttons: [{ label: 'Picking on page…', disabled: true }],
          picker_prompt_present: false,
          guest_explanation_present: true,
        });
        return true;
      },
    );
  } finally {
    window.happyDOM.abort();
  }
});
