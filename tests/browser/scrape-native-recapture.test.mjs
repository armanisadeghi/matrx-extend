import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmScrapeRecapture } from './scrape-native-recapture.mjs';

function controlledDialog(initial) {
  let state = initial;
  const actions = [];
  const panel = {};
  const evaluate = async () => state;
  const waitFor = async (label, read, accept) => {
    const observed = await read();
    if (!accept(observed)) throw new Error(`${label}_not_observed`);
    return observed;
  };
  const resourceAction = async (action) => {
    actions.push('resource_gate');
    return action();
  };
  const click = async (_panel, kind, label) => {
    actions.push(`${kind}:${label}`);
    state =
      label === 'Cancel'
        ? { count: 0, confirm: null, cancel: null, edited: true, deepIdle: true }
        : label === 'Re-capture' && kind === 'scrape-recapture-dialog'
          ? { count: 0, confirm: null, cancel: null, edited: false, deepIdle: false }
          : { count: 1, confirm: 'Re-capture', cancel: 'Cancel', edited: true, deepIdle: true };
  };
  return { panel, evaluate, waitFor, resourceAction, click, actions };
}

test('deep recapture confirms the edited-result dialog before continuing', async () => {
  const controlled = controlledDialog({
    count: 1,
    confirm: 'Re-capture',
    cancel: 'Cancel',
    edited: true,
    deepIdle: true,
  });
  await confirmScrapeRecapture(controlled);
  assert.deepEqual(controlled.actions, [
    'resource_gate',
    'scrape-recapture-dialog:Cancel',
    'resource_gate',
    'title:Scroll the page top→bottom to load lazy content (images, infinite-scroll items), then capture. Better for dynamic pages.',
    'resource_gate',
    'scrape-recapture-dialog:Re-capture',
  ]);
});

test('deep recapture refuses to continue when the edited-result dialog is absent', async () => {
  const controlled = controlledDialog({ count: 0, confirm: null });
  await assert.rejects(
    confirmScrapeRecapture(controlled),
    /scrape_discard_edits_dialog_not_observed/,
  );
  assert.deepEqual(controlled.actions, []);
});
