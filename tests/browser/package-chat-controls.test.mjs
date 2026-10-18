import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { containsOrderedWholeTerms } from './guest-chat-completion-oracle.mjs';
import {
  prepareMemberAnswerScreenshot,
  readPackageChatControls,
} from './package-chat-controls.mjs';

test('Member screenshot refuses clipped or composer-occluded answer and accepts readable latest reply', async () => {
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" title="Chat" aria-selected="true" aria-controls="chat"></button>
    <div id="chat" data-state="active"><article role="article" aria-label="Assistant answer"><div data-message-content>Old answer</div></article>
    <article role="article" aria-label="Assistant answer"><div data-message-content>Understand the workflow</div></article>
    <textarea></textarea></div>`;
  const body = window.document.querySelectorAll('[data-message-content]')[1];
  const composer = window.document.querySelector('textarea');
  let top = 600;
  let termTop = 600;
  const composerTop = 260;
  let hit = body;
  body.getBoundingClientRect = () => ({
    left: 10,
    right: 210,
    top,
    bottom: top + 80,
    width: 200,
    height: 80,
  });
  composer.getBoundingClientRect = () => ({ top: composerTop });
  body.scrollIntoView = () => {};
  window.document.createRange = () => ({
    setStart() {},
    setEnd() {},
    getClientRects: () => [
      { left: 20, right: 110, top: termTop, bottom: termTop + 18, width: 90, height: 18 },
    ],
  });
  window.document.elementFromPoint = () => hit;
  Object.defineProperty(window.document.documentElement, 'clientWidth', { value: 400 });
  Object.defineProperty(window.document.documentElement, 'clientHeight', { value: 300 });
  const check = (terms = ['Understand'], phase = 'immediate') =>
    runInNewContext(`(${prepareMemberAnswerScreenshot.toString()})(terms, phase)`, {
      document: window.document,
      getComputedStyle: (node) => window.getComputedStyle(node),
      terms,
      phase,
    });
  assert.equal(check().eligible, false, 'offscreen text must fail');
  top = 270;
  termTop = 270;
  assert.equal(check().eligible, false, 'composer-covered text must fail');
  top = 80;
  termTop = 280;
  assert.equal(check().eligible, false, 'visible body with clipped term must fail');
  termTop = 80;
  hit = composer;
  assert.equal(check().eligible, false, 'overlay-covered text must fail');
  hit = body;
  assert.equal(check().eligible, true, 'readable latest answer must pass');
  body.parentElement.style.opacity = '0';
  assert.equal(check().eligible, false, 'transparent assistant ancestor must fail');
  const diagnostic = check().diagnostic;
  assert.equal(diagnostic.rejected_ancestor.tag, 'ARTICLE');
  assert.equal(diagnostic.rejected_ancestor.scope, 'article');
  assert.equal(diagnostic.rejected_ancestor.opacity, 0);
  assert.equal(diagnostic.composer_top, 260);
  assert.deepEqual(Object.keys(diagnostic.article_rect), ['x', 'y', 'width', 'height']);
  body.parentElement.style.opacity = '1';
  assert.equal(check().eligible, true, 'restored assistant paint must pass');
  const pane = window.document.getElementById('chat');
  Object.defineProperties(pane, {
    scrollHeight: { value: 500, configurable: true },
    clientHeight: { value: 180, configurable: true },
  });
  pane.scrollTo = ({ top }) => {
    pane.scrollTop = top;
  };
  assert.equal(check(['Understand'], 'scroll_bottom').diagnostic.scroll.top, 320);
  assert.equal(check(['Capture']).eligible, false, 'wrong answer text must fail');
  await window.happyDOM.abort();
});

test('Member screenshot scroll probe works when the native scroll area has no scrollTo method', async () => {
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" title="Chat" aria-selected="true" aria-controls="chat"></button>
    <div id="chat" data-state="active"><article role="article" aria-label="Assistant answer"><div data-message-content>Understand</div></article><textarea></textarea></div>`;
  const pane = window.document.getElementById('chat');
  const body = pane.querySelector('[data-message-content]');
  Object.defineProperties(pane, {
    scrollHeight: { value: 908, configurable: true },
    clientHeight: { value: 79, configurable: true },
  });
  pane.scrollTo = undefined;
  body.getBoundingClientRect = () => ({ x: 16, y: 134, width: 320, height: 35 });
  pane.querySelector('textarea').getBoundingClientRect = () => ({ top: 256 });
  window.document.createRange = () => ({
    setStart() {},
    setEnd() {},
    getClientRects: () => [{ left: 16, right: 100, top: 134, bottom: 150, width: 84, height: 16 }],
  });
  window.document.elementFromPoint = () => body;
  Object.defineProperty(window.document.documentElement, 'clientWidth', { value: 360 });
  Object.defineProperty(window.document.documentElement, 'clientHeight', { value: 360 });
  const proof = () =>
    runInNewContext(
      `(${prepareMemberAnswerScreenshot.toString()})(['Understand'], 'scroll_bottom')`,
      {
        document: window.document,
        getComputedStyle: (node) => window.getComputedStyle(node),
      },
    );
  assert.equal(proof().diagnostic.scroll.top, 829);
  await window.happyDOM.abort();
});

test('Member proof identifies the selected article and its transcript fade without exposing message IDs', async () => {
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" title="Chat" aria-selected="true" aria-controls="chat"></button>
    <div id="chat" data-state="active"><div data-chat-column><div class="absolute inset-0 overflow-y-auto pt-12 [container-type:size] scrollbar-contrast" style="overflow-y:auto;opacity:0"><div aria-label="Conversation">
      <article role="article" aria-label="Assistant answer" data-primary-message-id="6ff85960-75cf-4ecd-921d-5b8c0674ae44"><div data-message-content>Capture Understand Use</div></article>
      <article role="article" aria-label="Assistant answer" data-primary-message-id="dc37ab99-4488-42b8-a4db-df4490c186c4"><div data-message-content>Understand</div></article>
    </div></div><textarea></textarea></div>`;
  const pane = window.document.getElementById('chat');
  const scroll = pane.querySelector('[class~="scrollbar-contrast"]');
  const bodies = [...pane.querySelectorAll('[data-message-content]')];
  Object.defineProperties(scroll, {
    scrollHeight: { value: 908, configurable: true },
    clientHeight: { value: 79, configurable: true },
  });
  scroll.getAnimations = () => [
    {
      playState: 'paused',
      currentTime: 17,
      effect: {
        getTiming: () => ({ delay: 50, duration: 200 }),
        getComputedTiming: () => ({ progress: 0 }),
      },
    },
  ];
  for (const body of bodies) {
    body.scrollIntoView = () => {};
    body.getBoundingClientRect = () => ({ x: 16, y: 134, width: 320, height: 35 });
  }
  pane.querySelector('textarea').getBoundingClientRect = () => ({ top: 256 });
  window.document.createRange = () => ({
    setStart() {},
    setEnd() {},
    getClientRects: () => [{ left: 16, right: 100, top: 134, bottom: 150, width: 84, height: 16 }],
  });
  window.document.elementFromPoint = () => bodies[1];
  window.document.hasFocus = () => false;
  Object.defineProperty(window.document, 'visibilityState', {
    value: 'hidden',
    configurable: true,
  });
  Object.defineProperty(window.document.documentElement, 'clientWidth', { value: 360 });
  Object.defineProperty(window.document.documentElement, 'clientHeight', { value: 360 });
  const probe = () =>
    runInNewContext(`(${prepareMemberAnswerScreenshot.toString()})(['Understand'], 'next_frame')`, {
      document: window.document,
      getComputedStyle: (node) => window.getComputedStyle(node),
    });
  const hidden = probe();
  assert.equal(hidden.eligible, false, 'zero-opacity transcript remains ineligible');
  assert.equal(hidden.diagnostic.document_visibility, 'hidden');
  assert.equal(hidden.diagnostic.document_has_focus, false);
  assert.equal(hidden.diagnostic.selected_chat_tab_count, 1);
  assert.equal(hidden.diagnostic.active_chat_pane_count, 1);
  assert.equal(hidden.diagnostic.chat_column_count, 1);
  assert.equal(hidden.diagnostic.transcript_count, 1);
  assert.equal(hidden.diagnostic.assistant_article_count, 2);
  assert.equal(hidden.diagnostic.selected_article_index, 1);
  assert.equal(hidden.diagnostic.selected_transcript_index, 0);
  assert.equal(hidden.diagnostic.article_candidates.length, 2);
  assert.match(hidden.diagnostic.article_candidates[0].article_id_hash, /^[0-9a-f]{16}$/);
  assert.notEqual(
    hidden.diagnostic.article_candidates[0].article_id_hash,
    hidden.diagnostic.article_candidates[1].article_id_hash,
  );
  assert.equal(hidden.diagnostic.article_candidates[1].rejected_ancestor.scope, 'above_article');
  assert.equal(hidden.diagnostic.transcript.opacity, 0);
  assert.equal(hidden.diagnostic.transcript.animations[0].play_state, 'paused');
  assert.equal(hidden.diagnostic.transcript.animations[0].current_time_ms, 17);
  assert.equal(hidden.diagnostic.transcript.animations[0].duration_ms, 200);
  assert.doesNotMatch(
    JSON.stringify(hidden.diagnostic),
    /6ff85960|dc37ab99|Capture Understand Use/,
  );
  scroll.style.opacity = '1';
  const painted = probe();
  assert.equal(painted.eligible, true, 'real opacity transition must restore paint eligibility');
  assert.equal(painted.diagnostic.transcript.opacity, 1);
  await window.happyDOM.abort();
});

// Markup contracts recovered from the immutable .520 Store ZIP, release 39049375284:
// Send/Stop aria labels; assistant article + data-message-content, never action-bar text.
function surface({ disabled = false, name = 'Send message', active = true, extra = '' } = {}) {
  const window = new Window();
  window.document.body.innerHTML = `<div id="chat" data-state="${active ? 'active' : 'inactive'}"><textarea></textarea><button aria-label="${name}" ${disabled ? 'disabled' : ''}></button>${extra}</div>`;
  const pane = window.document.getElementById('chat');
  for (const node of window.document.querySelectorAll('*')) {
    node.getBoundingClientRect = () => ({ width: 30, height: 30 });
  }
  const read = () =>
    runInNewContext(`(${readPackageChatControls.toString()})(pane)`, {
      pane,
      getComputedStyle: (node) => window.getComputedStyle(node),
    });
  return { window, pane, read };
}

test('ready send uses the actual package accessible control and refuses disabled, queue and duplicate controls', async () => {
  for (const [options, expected] of [
    [{}, true],
    [{ disabled: true }, false],
    [{ name: 'Queue message' }, false],
    [{ name: 'Send message (still initializing)' }, false],
    [{ active: false }, false],
    [{ extra: '<button aria-label="Send message"></button>' }, false],
  ]) {
    const { window, read } = surface(options);
    assert.equal(read().sendEnabled, expected, JSON.stringify(options));
    await window.happyDOM.abort();
  }
});

test('send readiness exposes missing versus disabled control without accepting a title-only decoy', async () => {
  const { window, pane, read } = surface({
    disabled: true,
    extra: '<button title="Send"></button>',
  });
  assert.equal(read().sendControlCount, 1);
  assert.equal(read().sendControlDisabled, true);
  pane.querySelector('[aria-label]').remove();
  assert.equal(read().sendControlCount, 0);
  assert.equal(read().sendControlDisabled, null);
  assert.equal(read().sendEnabled, false);
  await window.happyDOM.abort();
});

test('send readiness distinguishes the package initialization shell from a disabled ready control', async () => {
  const { window, pane, read } = surface({
    name: 'Send message (still initializing)',
    disabled: true,
  });
  const shell = read();
  assert.equal(shell.sendEnabled, false);
  assert.equal(shell.sendControlCount, 0);
  assert.equal(shell.sendLikeControlCount, 1);
  assert.equal(shell.initializationShellVisible, true);
  assert.deepEqual(
    Array.from(shell.sendLikeControls, (control) => ({ ...control })),
    [{ label: 'initializing', disabled: true, ariaDisabled: null }],
  );

  const send = pane.querySelector('button');
  send.setAttribute('aria-label', 'Send message');
  send.setAttribute('aria-disabled', 'true');
  const disabled = read();
  assert.equal(disabled.sendControlCount, 1);
  assert.equal(disabled.sendControlDisabled, true);
  assert.equal(disabled.initializationShellVisible, false);
  assert.deepEqual(
    Array.from(disabled.sendLikeControls, (control) => ({ ...control })),
    [{ label: 'send', disabled: true, ariaDisabled: 'true' }],
  );

  send.disabled = false;
  send.setAttribute('aria-disabled', 'false');
  const ready = read();
  assert.equal(ready.sendEnabled, true);
  assert.equal(ready.sendControlDisabled, false);
  assert.deepEqual(
    Array.from(ready.sendLikeControls, (control) => ({ ...control })),
    [{ label: 'send', disabled: false, ariaDisabled: 'false' }],
  );
  await window.happyDOM.abort();
});

test('answer observation excludes user text and action labels, includes each real assistant body and real stop state', async () => {
  const { window, pane, read } = surface({
    extra: `
    <article role="article" aria-label="Your message"><div data-message-content>Capture Understand Use</div></article>
    <article role="article" aria-label="Assistant answer"><div data-message-content>Opening check: 732, Capture, Understand, Use.</div><button>Copy answer</button></article>
    <article role="article" aria-label="Assistant answer, pinned"><div data-message-content>Follow-up check: 941.</div></article>
    <button aria-label="Stop the run"></button>`,
  });
  assert.deepEqual(Array.from(read().replies), [
    'Opening check: 732, Capture, Understand, Use.',
    'Follow-up check: 941.',
  ]);
  assert.equal(read().streaming, true);
  pane.querySelector('button[aria-label="Stop the run"]').remove();
  pane.querySelectorAll('[data-message-content]')[2].remove();
  assert.equal(read().streaming, false);
  assert.deepEqual(Array.from(read().replies), ['Opening check: 732, Capture, Understand, Use.']);
  await window.happyDOM.abort();
});

function nativePointerSurface() {
  const { window, pane } = surface();
  pane.setAttribute('role', 'tabpanel');
  window.document.body.insertAdjacentHTML(
    'afterbegin',
    '<button role="tab" title="Chat" data-state="active" aria-controls="chat"></button>',
  );
  window.document.body.insertAdjacentHTML(
    'beforeend',
    '<div><button aria-label="Send message"></button></div>',
  );
  const target = pane.querySelector('button');
  const rect = { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, x: 10, y: 10 };
  target.getBoundingClientRect = () => rect;
  target.scrollIntoView = () => {};
  window.HTMLElement.prototype.getAnimations = () => [];
  window.document.elementFromPoint = () => target;
  const events = [];
  const panel = {
    async send(method, args) {
      if (method === 'Runtime.evaluate') return { result: { value: window.eval(args.expression) } };
      if (method === 'Input.dispatchMouseEvent') events.push(args);
      return {};
    },
  };
  return { window, pane, target, rect, events, panel };
}

test('trusted send pointer finds only the active Chat composer and dispatches native input', async () => {
  const { click } = await import('./settings-panel-driver.mjs');
  const { window, rect, events, panel } = nativePointerSurface();
  await click(panel, 'chat-send', '');
  assert.deepEqual(
    events.map((event) => event.type),
    ['mousePressed', 'mouseReleased'],
  );
  assert.equal(events[0].x >= rect.left && events[0].x <= rect.right, true);
  assert.equal(events[0].y >= rect.top && events[0].y <= rect.bottom, true);
  await window.happyDOM.abort();
});

test('guest driver consumes package controls without dropping the terminal stream collector', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(
    new URL('./guest-chat-store-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const body = source.slice(
    source.indexOf('async function observe('),
    source.indexOf('async function installStreamTrace('),
  );
  const { window, pane } = surface();
  pane.setAttribute('role', 'tabpanel');
  window.document.body.insertAdjacentHTML(
    'afterbegin',
    '<button role="tab" title="Chat" aria-selected="true" aria-controls="chat"></button>',
  );
  const tab = window.document.querySelector('[role="tab"]');
  tab.getBoundingClientRect = () => ({ width: 30, height: 30 });
  window.chrome = { storage: { local: { get: async () => ({}) } } };
  window.__guestChatStreamTrace = {
    snapshot: () => ({ runs: [{ done: true }], continuations: 0 }),
  };
  const observe = new Function(
    'evaluate',
    'readPackageChatControls',
    'nativeOAuthStoredBearerExpression',
    'REQUIRED_ANSWER_TERMS',
    'containsOrderedWholeTerms',
    `${body}; return observe;`,
  )(
    async (_panel, expression) => window.eval(expression),
    readPackageChatControls,
    'false',
    ['Capture', 'Understand', 'Use'],
    containsOrderedWholeTerms,
  );
  const ready = await observe(null);
  assert.equal(ready.sendEnabled, true);
  assert.equal(ready.sendControlCount, 1);
  assert.equal(ready.sendLikeControlCount, 1);
  assert.equal(ready.initializationShellVisible, false);
  assert.equal(ready.streamTrace.runs[0].done, true);
  const send = pane.querySelector('button');
  send.disabled = true;
  assert.equal((await observe(null)).sendControlDisabled, true);
  send.setAttribute('aria-label', 'Send message (still initializing)');
  const shell = await observe(null);
  assert.equal(shell.sendEnabled, false);
  assert.equal(shell.sendControlCount, 0);
  assert.equal(shell.sendLikeControlCount, 1);
  assert.equal(shell.initializationShellVisible, true);
  await window.happyDOM.abort();
});

test('send pointer refuses an ARIA-disabled flip after readiness before trusted input', async () => {
  const { click } = await import('./settings-panel-driver.mjs');
  const { window, pane, target, events, panel } = nativePointerSurface();
  assert.equal(readPackageChatControlsWithWindow(window, pane).sendEnabled, true);
  const originalSend = panel.send;
  let pointerSamples = 0;
  panel.send = async (method, args) => {
    if (method === 'Runtime.evaluate' && ++pointerSamples === 2)
      target.setAttribute('aria-disabled', 'true');
    return originalSend(method, args);
  };
  await assert.rejects(click(panel, 'chat-send', ''), (error) => {
    assert.equal(error.driverFailure?.code, 'pointer_stable_hit_not_observed');
    assert.equal(error.driverFailure?.targetDisabled, true);
    return true;
  });
  assert.deepEqual(events, []);
  await window.happyDOM.abort();
});

function readPackageChatControlsWithWindow(window, pane) {
  return runInNewContext(`(${readPackageChatControls.toString()})(pane)`, {
    pane,
    getComputedStyle: (node) => window.getComputedStyle(node),
  });
}

test('assistant prose excludes pending and expanded tool cards plus hidden plain view', async () => {
  const { window, pane, read } = surface({
    extra: `
    <article role="article" aria-label="Assistant answer"><div data-message-content>
      <div class="group/toolcard"><button>Page Text</button><p>Capture Understand Use CARD-73</p></div>
    </div></article>
    <article role="article" aria-label="Assistant answer"><div data-message-content>
      <div style="display:none">Old answer</div><p>Capture Understand Use OPEN-73</p>
      <div class="group/toolcard"><p>Unrelated expanded tool output</p></div>
    </div></article>`,
  });
  assert.deepEqual(
    Array.from(read().replies).map((text) => text.trim()),
    ['Capture Understand Use OPEN-73'],
  );
  assert.equal(read().assistantDom.toolCardCount, 2);
  assert.equal(read().assistantDom.toolOnlyArticleCount, 1);
  pane.querySelectorAll('article')[1].querySelector('p').textContent = 'Understand FOLLOW-92';
  assert.deepEqual(
    Array.from(read().replies).map((text) => text.trim()),
    ['Understand FOLLOW-92'],
  );
  await window.happyDOM.abort();
});

// Public v0.2.205 ChatView.tsx at 2f68bc4: normal composer submit branch.
// Lucide ArrowUp renders the arrow-up class; title is migrated by tooltip setup.
test('public .205 composer icon send is ready, while title decoys and ambiguous sends fail closed', async () => {
  const { window, pane, read } = surface({ name: 'unrelated' });
  const button = pane.querySelector('button');
  button.outerHTML =
    '<button type="button" title="Send"><svg class="lucide lucide-arrow-up size-4"></svg></button>';
  const send = pane.querySelector('button');
  send.getBoundingClientRect = () => ({ width: 30, height: 30 });
  assert.equal(read().sendEnabled, true);
  assert.equal(read().sendLikeControlCount, 1);
  send.disabled = true;
  assert.equal(read().sendEnabled, false);
  send.disabled = false;
  send.removeAttribute('title');
  send.setAttribute('data-matrx-title', 'Send');
  assert.equal(read().sendEnabled, true);
  send.insertAdjacentHTML('afterend', '<button title="Send"></button>');
  assert.equal(read().sendControlCount, 1, 'title-only decoy is excluded');
  send.insertAdjacentHTML('afterend', send.outerHTML);
  send.nextElementSibling.getBoundingClientRect = () => ({ width: 30, height: 30 });
  assert.equal(read().sendEnabled, false, 'two actual icon sends are ambiguous');
  pane.querySelectorAll('button')[1].remove();
  send.setAttribute('aria-label', 'Queue message');
  assert.equal(read().sendEnabled, false, 'an explicit non-send label wins over title');
  await window.happyDOM.abort();
});

test('public .205 icon send reaches trusted pointer input and refuses a title-only decoy', async () => {
  const { click } = await import('./settings-panel-driver.mjs');
  const { window, target, events, panel } = nativePointerSurface();
  target.removeAttribute('aria-label');
  target.title = 'Send';
  target.innerHTML = '<svg class="lucide lucide-arrow-up size-4"></svg>';
  await click(panel, 'chat-send', '');
  assert.equal(events.length, 2);
  target.innerHTML = '';
  events.length = 0;
  await assert.rejects(click(panel, 'chat-send', ''));
  assert.equal(events.length, 0);
  await window.happyDOM.abort();
});

// Public Store v0.2.205 MessageRow/Markdown markup (source 2f68bc4).
// A package-only article selector silently drops the visibly rendered reply.
test('public Store answer observation reads completed assistant Markdown without user, tool or action text', async () => {
  const { window, pane, read } = surface({
    extra: `
    <div class="group flex justify-end gap-1"><div class="min-w-0 text-foreground">User asks for Capture Understand Use</div><button title="Copy message"></button></div>
    <div class="group space-y-2">
      <div class="min-w-0 text-foreground">Opening check: 732. Capture, Understand, Use.</div>
      <div class="group/toolcard"><div class="min-w-0 text-foreground">Tool result: follow-up 941</div></div>
      <div class="mt-1"><button title="Copy reply">Copy reply</button><button>Speak reply</button></div>
    </div>
    <div class="group space-y-2"><div class="min-w-0 text-foreground">Follow-up check: 941.</div><div><button data-matrx-title="Copy reply"></button></div></div>
    <div class="group space-y-2"><div class="min-w-0 text-foreground">Pending answer</div></div>
    <button title="Stop"><svg class="lucide-square"></svg></button>
    <button title="Copy reply">Decoy action</button>`,
  });
  assert.deepEqual(Array.from(read().replies), [
    'Opening check: 732. Capture, Understand, Use.',
    'Follow-up check: 941.',
  ]);
  pane.querySelector('div.group.space-y-2 > div.min-w-0.text-foreground').textContent =
    'Opening check: 865. Capture, Understand, Use.';
  assert.equal(read().replies[0], 'Opening check: 865. Capture, Understand, Use.');
  pane.querySelector('div.group.space-y-2').style.display = 'none';
  assert.deepEqual(Array.from(read().replies), ['Follow-up check: 941.']);
  assert.equal(read().streaming, true);
  pane.querySelector('button[title="Stop"]').remove();
  assert.equal(read().streaming, false);
  pane.setAttribute('data-state', 'inactive');
  assert.deepEqual(Array.from(read().replies), []);
  await window.happyDOM.abort();
});

test('public Stop observation rejects title decoys, wrong icons and contradictory accessible labels', async () => {
  for (const extra of [
    '<button title="Stop"></button>',
    '<button title="Stop"><svg class="lucide-arrow-up"></svg></button>',
    '<button title="Stop" aria-label="Cancel upload"><svg class="lucide-square"></svg></button>',
    '<button title="Stop" hidden><svg class="lucide-square"></svg></button>',
    '<button title="Stop" disabled><svg class="lucide-square"></svg></button>',
    '<button title="Stop" aria-disabled="true"><svg class="lucide-square"></svg></button>',
  ]) {
    const { window, read } = surface({ extra });
    assert.equal(read().streaming, false, extra);
    await window.happyDOM.abort();
  }
});
