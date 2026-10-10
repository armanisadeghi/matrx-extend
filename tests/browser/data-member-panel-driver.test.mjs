import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { click } from './settings-panel-driver.mjs';

function makePanel(markup, targetSelector) {
  const window = new Window({ url: 'chrome-extension://fixture/panel.html' });
  window.document.body.innerHTML = markup;
  const target = window.document.querySelector(targetSelector);
  const rect = { x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 };
  target.getBoundingClientRect = () => rect;
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

test('member Data pattern name click stays inside the active Data pane', async () => {
  const fixture = makePanel(
    `<button role="tab" title="Data" data-state="active" aria-controls="data-pane"></button>
     <div id="data-pane" role="tabpanel" data-state="active">
       <input placeholder="Pattern name…"><button>Save pattern</button>
     </div>
     <div id="other-pane" role="tabpanel" data-state="inactive">
       <input placeholder="Pattern name…"><button>Save pattern</button>
     </div>`,
    '#data-pane input',
  );
  try {
    const result = await click(fixture.panel, 'data-pattern-name', 'Pattern name…');
    assert.equal(result.selected_point_available, true);
    assert.deepEqual(fixture.events, ['mousePressed', 'mouseReleased']);
  } finally {
    fixture.window.happyDOM.abort();
  }
});
