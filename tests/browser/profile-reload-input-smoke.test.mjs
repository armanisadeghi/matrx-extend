import assert from 'node:assert/strict';
import test from 'node:test';
import { observeGuestPaneTransition } from './profile-reload-input-smoke.mjs';

function ownedPanel({ transition = true, initial = 'Chat' } = {}) {
  let selected = initial;
  let pressed = false;
  let activated = false;
  const panel = {
    async send(method, args) {
      if (method === 'Runtime.evaluate')
        return {
          result: { value: { selected, scrape_count: 1, point: { x: 42, y: 28 } } },
        };
      assert.equal(activated, true);
      assert.deepEqual(
        { x: args.x, y: args.y, button: args.button },
        { x: 42, y: 28, button: 'left' },
      );
      if (args.type === 'mousePressed') pressed = true;
      if (args.type === 'mouseReleased' && pressed && transition) selected = 'Scrape';
      return {};
    },
  };
  return {
    panel,
    activate: async () => {
      activated = true;
    },
  };
}

test('guest smoke requires a trusted click to move selected pane', async () => {
  const moving = ownedPanel();
  assert.deepEqual(await observeGuestPaneTransition(moving.panel, moving.activate), {
    before_selected: 'Chat',
    after_selected: 'Scrape',
    trusted_click: true,
  });
  const stuck = ownedPanel({ transition: false });
  await assert.rejects(
    observeGuestPaneTransition(stuck.panel, stuck.activate, { wait: async () => {} }),
    /guest_pane_transition_unobserved/,
  );
  const alreadySelected = ownedPanel({ initial: 'Scrape' });
  await assert.rejects(
    observeGuestPaneTransition(alreadySelected.panel, alreadySelected.activate),
    /guest_pane_input_precondition_failed/,
  );
});
