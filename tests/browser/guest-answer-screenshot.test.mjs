import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { prepareGuestAnswerScreenshot } from './guest-answer-screenshot.mjs';
import { readPackageChatControls } from './package-chat-controls.mjs';

function installTextRanges(window) {
  window.document.createRange = () => ({
    setStart(node) {
      this.node = node;
    },
    setEnd() {},
    getBoundingClientRect() {
      return (
        this.node.parentElement.closest('article') ?? this.node.parentElement
      ).getBoundingClientRect();
    },
  });
}

test('horizontally clipped requested code cannot authorize a panel screenshot', async () => {
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" title="Chat" aria-selected="true" aria-controls="chat"></button>
    <div id="chat" data-state="active" style="overflow-x:hidden">
      <article role="article" aria-label="Assistant answer"><div data-message-content>Capture Understand Use CODE-791</div></article>
    </div>`;
  const pane = window.document.getElementById('chat');
  for (const element of window.document.querySelectorAll('*')) {
    element.getBoundingClientRect = () => ({
      left: 0,
      right: 250,
      top: 20,
      bottom: 120,
      width: 250,
      height: 100,
    });
    element.scrollIntoView = () => {};
  }
  window.document.createRange = () => ({
    setStart() {},
    setEnd() {},
    getBoundingClientRect() {
      return {
        left: 300 - pane.scrollLeft,
        right: 360 - pane.scrollLeft,
        top: 40,
        bottom: 60,
        width: 60,
        height: 20,
      };
    },
  });
  Object.defineProperty(window.document.documentElement, 'clientWidth', { value: 400 });
  Object.defineProperty(window.document.documentElement, 'clientHeight', { value: 300 });
  const proof = runInNewContext(`(${prepareGuestAnswerScreenshot.toString()})({code:'CODE-791'})`, {
    document: window.document,
    getComputedStyle: (element) => window.getComputedStyle(element),
  });
  assert.equal(
    proof.eligible,
    false,
    'text beyond the clipped pane must not count as visual proof',
  );
  pane.style.overflowX = 'auto';
  Object.defineProperty(pane, 'clientWidth', { value: 250 });
  Object.defineProperty(pane, 'scrollWidth', { value: 500 });
  const scrolled = runInNewContext(
    `(${prepareGuestAnswerScreenshot.toString()})({code:'CODE-791'})`,
    {
      document: window.document,
      getComputedStyle: (element) => window.getComputedStyle(element),
    },
  );
  assert.equal(scrolled.eligible, true, 'a scrollable pane may bring the real code line into view');
  assert.ok(pane.scrollLeft > 100, 'the horizontal screenshot proof must move the real pane');
  await window.happyDOM.abort();
});

test('long completed answer scrolls the requested code line into the captured viewport', async () => {
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" title="Chat" aria-selected="true" aria-controls="chat"></button>
    <div id="chat" data-state="active" style="overflow-y:auto">
      <article role="article" aria-label="Assistant answer"><div data-message-content>Capture Understand Use. ${'More explanation. '.repeat(90)}CODE-791</div></article>
    </div>`;
  const pane = window.document.getElementById('chat');
  const article = pane.querySelector('article');
  for (const element of window.document.querySelectorAll('*')) {
    element.getBoundingClientRect = () => ({
      left: 0,
      right: 250,
      top: 10,
      bottom: 290,
      width: 250,
      height: 280,
    });
    element.scrollIntoView = () => {};
  }
  article.getBoundingClientRect = () => ({
    left: 0,
    right: 250,
    top: 20 - pane.scrollTop,
    bottom: 1220 - pane.scrollTop,
    width: 250,
    height: 1200,
  });
  Object.defineProperty(pane, 'clientHeight', { value: 280 });
  Object.defineProperty(pane, 'scrollHeight', { value: 1300 });
  Object.defineProperty(window.document.documentElement, 'clientWidth', { value: 400 });
  Object.defineProperty(window.document.documentElement, 'clientHeight', { value: 300 });
  window.document.createRange = () => ({
    setStart(node, index) {
      this.node = node;
      this.index = index;
    },
    setEnd() {},
    getBoundingClientRect() {
      const top = this.index > 500 ? 1060 - pane.scrollTop : 40 - pane.scrollTop;
      return { left: 20, right: 130, top, bottom: top + 20, width: 110, height: 20 };
    },
  });
  const proof = runInNewContext(`(${prepareGuestAnswerScreenshot.toString()})({code:'CODE-791'})`, {
    document: window.document,
    getComputedStyle: (element) => window.getComputedStyle(element),
  });
  assert.equal(proof.eligible, true);
  assert.ok(pane.scrollTop > 700, 'the code line must enter the native screenshot viewport');
  const stageProof = runInNewContext(
    `(${prepareGuestAnswerScreenshot.toString()})({code:'CODE-791',focus:'Capture'})`,
    {
      document: window.document,
      getComputedStyle: (element) => window.getComputedStyle(element),
    },
  );
  assert.equal(stageProof.eligible, true);
  assert.ok(pane.scrollTop < 100, 'the stage frame must return to the visible start of the reply');
  pane.style.overflowY = 'hidden';
  pane.scrollTop = 0;
  const clipped = runInNewContext(
    `(${prepareGuestAnswerScreenshot.toString()})({code:'CODE-791'})`,
    {
      document: window.document,
      getComputedStyle: (element) => window.getComputedStyle(element),
    },
  );
  assert.equal(clipped.eligible, false, 'a clipped code line cannot provide screenshot proof');
  await window.happyDOM.abort();
});

test('answer screenshot refuses a DOM-visible reply that remains outside the viewport', async () => {
  const window = new Window();
  window.document.body.innerHTML = `
    <button role="tab" title="Chat" aria-selected="true" aria-controls="chat"></button>
    <div id="chat" data-state="active">
      <article role="article" aria-label="Assistant answer"><div data-message-content>Old code OLD-482</div></article>
      <article role="article" aria-label="Assistant answer"><div data-message-content>Heading Field guide, code NEW-791</div></article>
    </div>`;
  for (const element of window.document.querySelectorAll('*'))
    element.getBoundingClientRect = () => ({
      left: 0,
      right: 250,
      top: 10,
      bottom: 90,
      width: 250,
      height: 80,
    });
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
  installTextRanges(window);
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

// Store .205 MessageRow/Markdown shape, captured in run 39129963929 (source 2f68bc4).
test('Store completed answer screenshot reads direct Markdown and refuses non-answer proof', async () => {
  const window = new Window();
  window.document.body.innerHTML = `
    <button role="tab" title="Chat" aria-selected="true" aria-controls="chat"></button>
    <div id="chat" data-state="active">
      <div class="group flex justify-end"><div class="min-w-0 text-foreground">USER-482</div><button title="Copy message"></button></div>
      <div class="group space-y-2" id="answer">
        <div class="min-w-0 text-foreground">Field guide NEW-791</div>
        <div class="group/toolcard"><div class="min-w-0 text-foreground">TOOL-482</div><button title="Copy reply"></button></div>
        <div><button title="Copy reply">ACTION-482</button></div>
      </div>
      <div class="group space-y-2"><div class="min-w-0 text-foreground">PENDING-482</div></div>
    </div>`;
  for (const element of window.document.querySelectorAll('*')) {
    element.getBoundingClientRect = () => ({
      left: 0,
      right: 250,
      top: 20,
      bottom: 100,
      width: 250,
      height: 80,
    });
    element.scrollIntoView = () => {};
  }
  Object.defineProperty(window.document.documentElement, 'clientWidth', { value: 400 });
  Object.defineProperty(window.document.documentElement, 'clientHeight', { value: 300 });
  installTextRanges(window);
  const verify = (code) =>
    runInNewContext(`(${prepareGuestAnswerScreenshot.toString()})({code})`, {
      document: window.document,
      getComputedStyle: (element) => window.getComputedStyle(element),
      code,
    }).eligible;
  const observed = () =>
    runInNewContext(`(${readPackageChatControls.toString()})(pane)`, {
      document: window.document,
      pane: window.document.getElementById('chat'),
      getComputedStyle: (element) => window.getComputedStyle(element),
    }).replies;
  assert.deepEqual(Array.from(observed()), ['Field guide NEW-791']);
  assert.equal(verify('NEW-791'), true, 'real completed .205 answer must be screenshot eligible');
  for (const code of ['USER-482', 'TOOL-482', 'ACTION-482', 'PENDING-482'])
    assert.equal(verify(code), false, code);
  const body = window.document.querySelector('#answer > .min-w-0');
  body.textContent = 'Changed reply NEXT-865';
  assert.equal(verify('NEW-791'), false);
  assert.deepEqual(Array.from(observed()), ['Changed reply NEXT-865']);
  assert.equal(verify('NEXT-865'), true);
  for (const attribute of ['hidden', 'inert', 'aria-hidden']) {
    window.document.getElementById('answer').setAttribute(attribute, 'true');
    assert.equal(verify('NEXT-865'), false, attribute);
    window.document.getElementById('answer').removeAttribute(attribute);
  }
  for (const [property, value] of [
    ['opacity', '0'],
    ['visibility', 'collapse'],
  ]) {
    window.document.getElementById('answer').style[property] = value;
    assert.equal(
      verify('NEXT-865'),
      false,
      `${property}:${value} cannot provide screenshot evidence`,
    );
    window.document.getElementById('answer').style[property] = '';
  }
  body.style.display = 'none';
  assert.equal(verify('NEXT-865'), false);
  body.style.display = '';
  const copyReply = window.document.querySelector('#answer > div:last-child > button');
  copyReply.title = 'Copy message';
  assert.equal(
    verify('NEXT-865'),
    false,
    'a nested tool Copy reply cannot complete its parent row',
  );
  copyReply.title = '';
  copyReply.setAttribute('data-matrx-title', 'Copy reply');
  assert.equal(verify('NEXT-865'), true, 'tooltip-managed completed action remains eligible');
  const stop = window.document.createElement('button');
  stop.title = 'Stop';
  stop.innerHTML = '<svg class="lucide-square"></svg>';
  stop.getBoundingClientRect = body.getBoundingClientRect;
  window.document.getElementById('chat').append(stop);
  assert.equal(verify('NEXT-865'), false, 'a streaming run is not terminal evidence');
  await window.happyDOM.abort();
});

// v0.2.205 PilotView MessageRow renders completed actions in an opacity-0
// group-hover:opacity-100 toolbar. Its Copy reply marks completion, not paint.
test('Store screenshot accepts painted answer when completed toolbar is unhovered', async () => {
  const window = new Window();
  window.document.body.innerHTML = `
    <button role="tab" title="Chat" aria-selected="true" aria-controls="chat"></button>
    <div id="chat" data-state="active">
      <div class="group space-y-2" id="answer">
        <div class="min-w-0 text-foreground">Capture Understand Use OPEN-791</div>
        <div class="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100" style="opacity:0">
          <button title="Copy reply"></button>
        </div>
      </div>
    </div>`;
  for (const element of window.document.querySelectorAll('*')) {
    element.getBoundingClientRect = () => ({
      left: 0,
      right: 250,
      top: 20,
      bottom: 100,
      width: 250,
      height: 80,
    });
    element.scrollIntoView = () => {};
  }
  Object.defineProperty(window.document.documentElement, 'clientWidth', { value: 400 });
  Object.defineProperty(window.document.documentElement, 'clientHeight', { value: 300 });
  installTextRanges(window);
  const context = {
    document: window.document,
    pane: window.document.getElementById('chat'),
    getComputedStyle: (element) => window.getComputedStyle(element),
  };
  const verify = () =>
    runInNewContext(`(${prepareGuestAnswerScreenshot.toString()})({code:'OPEN-791'})`, context);
  const read = () => runInNewContext(`(${readPackageChatControls.toString()})(pane)`, context);
  assert.deepEqual(Array.from(read().replies), ['Capture Understand Use OPEN-791']);
  assert.equal(verify().eligible, true, 'painted completed reply must not require hover');
  const toolbar = window.document.querySelector('#answer > div:last-child');
  toolbar.style.opacity = '1';
  assert.equal(verify().eligible, true, 'hovered completion marker has identical meaning');
  toolbar.style.opacity = '0';
  const body = window.document.querySelector('#answer > .min-w-0');
  body.style.opacity = '0';
  assert.equal(verify().eligible, false, 'unpainted prose cannot provide proof');
  body.style.opacity = '1';
  window.document.getElementById('answer').style.opacity = '0';
  assert.equal(verify().eligible, false, 'unpainted row cannot provide proof');
  window.document.getElementById('answer').style.opacity = '1';
  context.pane.style.opacity = '0';
  assert.equal(verify().eligible, false, 'unpainted pane cannot provide proof');
  context.pane.style.opacity = '1';
  toolbar.querySelector('button').remove();
  assert.equal(
    verify().eligible,
    false,
    'pending row without completed actions cannot provide proof',
  );
  await window.happyDOM.abort();
});
