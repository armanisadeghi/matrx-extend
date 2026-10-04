import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { armBusyExpression, readBusyExpression } from './scrape-busy-observer.mjs';

function panel() {
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" title="Scrape" data-state="active"
    aria-controls="scrape-pane">Scrape</button>
    <section id="scrape-pane" role="tabpanel" data-state="active">
      <button title="Capture the page exactly as it is right now">Capture</button>
    </section>`;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 });
  return window;
}

test('EXT-D-0115 observes busy state when React replaces the capture button', async () => {
  const window = panel();
  const title = 'Capture the page exactly as it is right now';
  window.eval(armBusyExpression(title));
  const old = window.document.querySelector('#scrape-pane button');
  const replacement = window.document.createElement('button');
  replacement.title = title;
  replacement.disabled = true;
  replacement.textContent = 'Capturing…';
  old.replaceWith(replacement);
  await new Promise((resolve) => setTimeout(resolve, 0));
  replacement.disabled = false;
  replacement.textContent = 'Re-capture';
  const observed = window.eval(readBusyExpression);
  assert.equal(observed.observed, true);
  assert.equal(observed.text, 'Capturing…');
  assert.equal(observed.buttonReplacements, 1);
});

test('EXT-D-0115 observes busy state when tooltip moves title to data-matrx-title', async () => {
  const window = panel();
  const title = 'Capture the page exactly as it is right now';
  window.eval(armBusyExpression(title));
  const button = window.document.querySelector('#scrape-pane button');
  button.removeAttribute('title');
  button.setAttribute('data-matrx-title', title);
  button.disabled = true;
  button.textContent = 'Capturing…';
  await new Promise((resolve) => setTimeout(resolve, 0));
  const observed = window.eval(readBusyExpression);
  assert.equal(observed.observed, true);
  assert.equal(observed.text, 'Capturing…');
  assert.equal(observed.buttonReplacements, 0);
});

test('fast busy transition is observed when it starts and ends before mutation delivery', async () => {
  const window = panel();
  const title = 'Capture the page exactly as it is right now';
  window.eval(armBusyExpression(title));
  const button = window.document.querySelector('#scrape-pane button');
  button.disabled = true;
  button.textContent = 'Capturing…';
  button.disabled = false;
  button.textContent = 'Re-capture';
  await new Promise((resolve) => setTimeout(resolve, 0));
  const observed = window.eval(readBusyExpression);
  assert.equal(observed.observed, true);
  assert.equal(observed.text, 'Capturing…');
  assert.equal(observed.overlappingMutationState, true);
  assert.equal(observed.disabledSamples, 0);
});

test('nonoverlapping disabled and busy text mutations do not count as busy', async () => {
  const window = panel();
  const title = 'Capture the page exactly as it is right now';
  window.eval(armBusyExpression(title));
  const button = window.document.querySelector('#scrape-pane button');
  button.disabled = true;
  button.disabled = false;
  button.textContent = 'Capturing…';
  button.textContent = 'Re-capture';
  await new Promise((resolve) => setTimeout(resolve, 0));
  const observed = window.eval(readBusyExpression);
  assert.equal(observed.observed, false);
  assert.equal(observed.disabledMutationRecords, 2);
  assert.equal(observed.busyLabelMutationRecords, 2);
});

test('same-turn text-node updates count only when disabled and busy overlap', async () => {
  const window = panel();
  const title = 'Capture the page exactly as it is right now';
  window.eval(armBusyExpression(title));
  const button = window.document.querySelector('#scrape-pane button');
  button.disabled = true;
  button.firstChild.textContent = 'Capturing…';
  button.disabled = false;
  button.firstChild.textContent = 'Re-capture';
  await new Promise((resolve) => setTimeout(resolve, 0));
  const observed = window.eval(readBusyExpression);
  assert.equal(observed.observed, true);
  assert.equal(observed.text, 'Capturing…');
  assert.equal(observed.overlappingMutationState, true);
});
