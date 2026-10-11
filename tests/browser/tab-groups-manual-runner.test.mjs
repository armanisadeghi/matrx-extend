import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireTitleTooltips } from '@ai-matrx/design-system';
import { Window } from 'happy-dom';
import { pointerTarget, toolsTab } from './tab-groups-manual-runner.mjs';

function panelFor(markup, { blocked = false } = {}) {
  const window = new Window();
  window.document.body.innerHTML = markup;
  const { document } = window;
  const buttons = [...document.querySelectorAll('button')];
  for (const button of buttons) {
    button.getBoundingClientRect = () => ({ x: 8, y: 8, width: 28, height: 28 });
    button.scrollIntoView = () => {};
  }
  document.elementFromPoint = () => (blocked ? document.body : buttons[0]);
  const uninstall = acquireTitleTooltips(document);
  const events = [];
  return {
    events,
    document,
    close() {
      uninstall();
      window.close();
    },
    async send(method, parameters) {
      if (method === 'Runtime.evaluate')
        return { result: { value: window.eval(parameters.expression) } };
      assert.equal(method, 'Input.dispatchMouseEvent');
      events.push(parameters.type);
      if (parameters.type === 'mouseMoved') {
        const event = new window.Event('pointerover', { bubbles: true });
        Object.defineProperty(event, 'pointerType', { value: 'mouse' });
        buttons[0].dispatchEvent(event);
      }
      if (parameters.type === 'mousePressed')
        buttons[0].dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
      return {};
    },
  };
}

// The real tooltip changes the attribute between the driver's two samples.
test('D148 completes trusted Tools input after tooltip title transfer', async () => {
  const panel = panelFor('<button role="tab" title="Tools" data-state="inactive"></button>');
  try {
    await pointerTarget(panel, 'toolsTab', toolsTab);
    assert.deepEqual(panel.events, ['mouseMoved', 'mousePressed', 'mouseReleased']);
    assert.equal(panel.document.querySelector('button').title, 'Tools');
  } finally {
    panel.close();
  }
});

for (const [name, markup, options] of [
  ['missing member tab', '<button role="tab" title="Settings"></button>', {}],
  [
    'duplicate Tools tabs',
    '<button role="tab" title="Tools"></button><button role="tab" title="Tools"></button>',
    {},
  ],
  ['blocked hit target', '<button role="tab" title="Tools"></button>', { blocked: true }],
  [
    'wrong preserved title',
    '<button role="tab" title="Settings" data-matrx-title="Tools"></button>',
    {},
  ],
]) {
  test(`D148 refuses input for ${name}`, async () => {
    const panel = panelFor(markup, options);
    try {
      await assert.rejects(
        pointerTarget(panel, 'toolsTab', toolsTab),
        /tab_groups_toolsTab_(unique_match|hit_target)_required/,
      );
      assert.deepEqual(panel.events, []);
    } finally {
      panel.close();
    }
  });
}
