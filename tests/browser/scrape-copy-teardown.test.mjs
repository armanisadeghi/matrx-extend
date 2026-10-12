import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { waitForCopyPopoverTeardown } from './scrape-copy-teardown.mjs';

// The clinic's copied capture must finish closing before another control runs.
function fixture() {
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" title="Scrape" data-state="active" aria-controls="scrape-pane"></button>
    <section id="scrape-pane" role="tabpanel" data-state="active"><button title="Copy capture" aria-controls="capture-menu"></button></section>
    <div data-radix-popper-content-wrapper><div role="dialog" id="capture-menu" data-state="closed"><button>Private clipboard payload</button></div></div>`;
  return window;
}

async function observe(window, samples) {
  return waitForCopyPopoverTeardown({
    panel: {},
    evaluate: async (_panel, expression) => window.eval(expression),
    waitFor: async (_name, read, ready) => {
      for (const change of samples) {
        change();
        const value = await read();
        if (ready(value)) return value;
      }
      throw new Error('owned_copy_popover_teardown_not_observed');
    },
  });
}

test('closed but connected owned copy dialog cannot count as teardown', async () => {
  const window = fixture();
  await assert.rejects(observe(window, [() => {}]), /owned_copy_popover_teardown_not_observed/);
});

test('teardown waits for actual removal rather than closed state', async () => {
  const window = fixture();
  let removalReached = false;
  const result = await observe(window, [
    () => {},
    () => {
      removalReached = true;
      window.document.getElementById('capture-menu').remove();
    },
  ]);
  assert.equal(removalReached, true);
  assert.equal(result.connectedOwnedDialogs, 0);
  assert.equal(JSON.stringify(result).includes('Private clipboard payload'), false);
});

test('a detached trigger does not hide a closed copy portal from the boundary', async () => {
  const window = fixture();
  window.document.querySelector('button[title="Copy capture"]').removeAttribute('aria-controls');
  await assert.rejects(observe(window, [() => {}]), /owned_copy_popover_teardown_not_observed/);
});

test('an open owned copy dialog also refuses the next control', async () => {
  const window = fixture();
  window.document.getElementById('capture-menu').setAttribute('data-state', 'open');
  await assert.rejects(observe(window, [() => {}]), /owned_copy_popover_teardown_not_observed/);
});

test('missing active Scrape panel is not successful teardown', async () => {
  const window = fixture();
  window.document.getElementById('capture-menu').remove();
  window.document.getElementById('scrape-pane').setAttribute('data-state', 'inactive');
  await assert.rejects(observe(window, [() => {}]), /owned_copy_popover_teardown_not_observed/);
});
