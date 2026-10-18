import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { prepareGuestAnswerScreenshot } from './guest-answer-screenshot.mjs';

test('answer screenshot refuses a DOM-visible reply that remains outside the viewport', async () => {
  const window = new Window();
  window.document.body.innerHTML = `
    <button role="tab" title="Chat" aria-selected="true" aria-controls="chat"></button>
    <div id="chat" data-state="active">
      <article role="article" aria-label="Assistant answer"><div data-message-content>Old code OLD-482</div></article>
      <article role="article" aria-label="Assistant answer"><div data-message-content>Heading Field guide, code NEW-791</div></article>
    </div>`;
  const articles = window.document.querySelectorAll('article');
  const newest = articles[1];
  let top = 900;
  for (const article of articles) {
    article.getBoundingClientRect = () => ({
      left: 0,
      right: 250,
      top: article === newest ? top : 10,
      bottom: (article === newest ? top : 10) + 80,
      width: 250,
      height: 80,
    });
  }
  Object.defineProperty(window.document.documentElement, 'clientWidth', { value: 400 });
  Object.defineProperty(window.document.documentElement, 'clientHeight', { value: 300 });
  newest.scrollIntoView = () => {};
  const verify = (expected) =>
    runInNewContext(`(${prepareGuestAnswerScreenshot.toString()})(expected)`, {
      document: window.document,
      getComputedStyle: (element) => window.getComputedStyle(element),
      expected,
    });

  assert.equal(verify({ code: 'NEW-791', heading: 'Field guide' }).eligible, false);
  newest.scrollIntoView = () => {
    top = 80;
  };
  assert.equal(verify({ code: 'NEW-791', heading: 'Field guide' }).eligible, true);
  assert.equal(verify({ code: 'OLD-482' }).eligible, false);
  assert.equal(verify({ code: 'NEW-791', heading: 'Different heading' }).eligible, false);
  await window.happyDOM.abort();
});
