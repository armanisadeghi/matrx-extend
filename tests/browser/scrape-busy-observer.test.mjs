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
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 100,
    height: 30,
    left: 0,
    top: 0,
    right: 100,
    bottom: 30,
  });
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

test('same-turn child-list busy transitions remain unverified without a live sample', async () => {
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
  assert.equal(observed.observed, false);
  assert.equal(observed.text, null);
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
});

test('same-turn text-node busy transitions remain unverified without a live sample', async () => {
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
  assert.equal(observed.observed, false);
  assert.equal(observed.text, null);
});

test('busy in a foreign pane cannot pass after button returns idle to Scrape', async () => {
  const window = panel();
  const title = 'Capture the page exactly as it is right now';
  window.eval(armBusyExpression(title));
  const button = window.document.querySelector('#scrape-pane button');
  const foreign = window.document.createElement('section');
  foreign.id = 'foreign-pane';
  window.document.body.append(foreign);
  foreign.append(button);
  button.disabled = true;
  button.textContent = 'Capturing…';
  button.disabled = false;
  button.textContent = 'Re-capture';
  window.document.querySelector('#scrape-pane').append(button);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.eval(readBusyExpression).observed, false);
});

test('busy while hidden cannot pass after button returns idle and visible', async () => {
  const window = panel();
  const title = 'Capture the page exactly as it is right now';
  window.eval(armBusyExpression(title));
  const button = window.document.querySelector('#scrape-pane button');
  button.style.display = 'none';
  button.disabled = true;
  button.textContent = 'Capturing…';
  button.disabled = false;
  button.textContent = 'Re-capture';
  button.style.display = 'block';
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.eval(readBusyExpression).observed, false);
});

// Stylesheet changes do not carry historical computed visibility in mutation records.
test('stylesheet-hidden busy transitions cannot pass after visibility is restored', async () => {
  const window = panel();
  const style = window.document.createElement('style');
  window.document.head.append(style);
  window.eval(armBusyExpression('Capture the page exactly as it is right now'));
  const button = window.document.querySelector('#scrape-pane button');
  style.textContent = '#scrape-pane button { display: none }';
  assert.equal(window.getComputedStyle(button).display, 'none');
  button.disabled = true;
  button.textContent = 'Capturing…';
  button.disabled = false;
  button.textContent = 'Re-capture';
  style.textContent = '';
  await new Promise((resolve) => setTimeout(resolve, 0));
  const observed = window.eval(readBusyExpression);
  assert.equal(observed.observed, false);
  assert.equal(observed.disabledSamples, 0);
});

for (const hiddenStyle of ['opacity:0', 'display:none', 'visibility:hidden']) {
  test(`a busy button with ${hiddenStyle} on its ancestor is not visible`, async () => {
    const window = panel();
    window.eval(armBusyExpression('Capture the page exactly as it is right now'));
    const button = window.document.querySelector('#scrape-pane button');
    window.document.querySelector('#scrape-pane').style.cssText = hiddenStyle;
    button.disabled = true;
    button.textContent = 'Capturing…';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(window.eval(readBusyExpression).observed, false);
  });
}

test('busy text without disabled never passes', async () => {
  const window = panel();
  window.eval(armBusyExpression('Capture the page exactly as it is right now'));
  window.document.querySelector('#scrape-pane button').textContent = 'Capturing…';
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.eval(readBusyExpression).observed, false);
});

test('disabled without busy text never passes', async () => {
  const window = panel();
  window.eval(armBusyExpression('Capture the page exactly as it is right now'));
  window.document.querySelector('#scrape-pane button').disabled = true;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.eval(readBusyExpression).observed, false);
});
