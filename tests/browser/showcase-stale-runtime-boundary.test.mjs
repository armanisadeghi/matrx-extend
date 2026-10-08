import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import vm from 'node:vm';
import {
  STALE_PICKER_KINDS,
  armShowcaseInstallBoundary,
  armShowcaseStaleBoundary,
  assertFreshShowcasePickerContext,
  observeShowcaseRelay,
  readShowcaseRelays,
  showcaseStampedDetections,
  summarizeShowcaseDetectionWindow,
} from './showcase-stale-runtime-boundary.mjs';

test('reinjection detection window separates current producer, relay duplication, and late prior events', () => {
  const detected = STALE_PICKER_KINDS.detected;
  const prior = { kind: detected, session_id: 'prior', tab_id: 77, document_id: 'document' };
  const current = { kind: detected, session_id: 'current', tab_id: 77, document_id: 'document' };
  const result = { kind: STALE_PICKER_KINDS.result, session_id: 'current' };
  assert.deepEqual(
    summarizeShowcaseDetectionWindow(
      [prior, current, current, prior, result],
      { observed: [prior, current] },
      1,
      'current',
    ),
    {
      detected_count: 3,
      stamped_detected_count: 3,
      unstamped_detected_count: 0,
      current_session_detected_count: 2,
      other_session_detected_count: 1,
      producer_current_detected_count: 1,
    },
  );
});

async function createRuntimeBoundaryFixture() {
  const delivered = [];
  const cancelled = [];
  const pageListeners = new Map();
  const document = {
    addEventListener(type, listener) {
      pageListeners.set(`${type}:${listener.name}`, listener);
    },
    removeEventListener(type, listener) {
      pageListeners.delete(`${type}:${listener.name}`);
    },
  };
  const runtime = {
    id: 'cihdmkcdjjckfhjpgoedmgfpoljebaml',
    sendMessage(message) {
      delivered.push(message);
      return Promise.resolve({ ack: true });
    },
  };
  const world = vm.createContext({
    chrome: { runtime },
    document,
    window: {
      __matrxListPickerStart() {},
      __matrxListPickerTeardown() {},
      __matrxListPickerCancel(id) {
        cancelled.push(id);
      },
    },
    location: { href: 'http://localhost/events' },
  });
  const cdp = new EventEmitter();
  cdp.send = async (method, params) => {
    if (method === 'Runtime.enable') {
      queueMicrotask(() =>
        cdp.emit('Runtime.executionContextCreated', {
          context: { id: 7, auxData: { isDefault: false, frameId: 'owned-frame' } },
        }),
      );
      return {};
    }
    assert.equal(method, 'Runtime.evaluate');
    assert.equal(params.contextId, 7);
    return {
      result: {
        value: JSON.parse(JSON.stringify(await vm.runInContext(params.expression, world))),
      },
    };
  };
  cdp.detach = async () => {};
  const page = {
    url: () => 'http://localhost/events',
    context: () => ({ newCDPSession: async () => cdp }),
  };
  const boundary = await armShowcaseStaleBoundary(page, runtime.id);
  return { boundary, delivered, cancelled, pageListeners, document, runtime, world };
}

test('each held A channel stays outside Chrome until its exact envelope is released', async () => {
  const { boundary, delivered, cancelled, document, runtime, world } =
    await createRuntimeBoundaryFixture();
  await boundary.holdNext(STALE_PICKER_KINDS.exit);
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const oldExit = { __matrx: true, kind: 'data:list-picker-exit', payload: { session_id: a } };
  const currentDetection = {
    __matrx: true,
    kind: 'data:list-picker-item-detected',
    payload: { session_id: b },
  };
  const heldPromise = runtime.sendMessage(oldExit);
  assert.equal(delivered.length, 0);
  assert.deepEqual((await boundary.snapshot()).held, [
    { kind: oldExit.kind, session_id: a, list_root: null, item_selector: null },
  ]);
  await runtime.sendMessage(currentDetection);
  assert.deepEqual(delivered, [currentDetection]);
  assert.deepEqual(await boundary.release(STALE_PICKER_KINDS.exit, b), { released: false });
  assert.deepEqual((await boundary.snapshot()).held, [
    { kind: oldExit.kind, session_id: a, list_root: null, item_selector: null },
  ]);
  assert.deepEqual(delivered, [currentDetection]);
  assert.deepEqual(await boundary.release(STALE_PICKER_KINDS.exit, a), {
    released: true,
    ack: true,
  });
  assert.deepEqual(await heldPromise, { ack: true });
  assert.deepEqual(delivered, [currentDetection, oldExit]);
  assert.deepEqual(await boundary.release(STALE_PICKER_KINDS.exit, a), { released: false });
  assert.deepEqual(delivered, [currentDetection, oldExit]);
  for (const kind of [STALE_PICKER_KINDS.detected, STALE_PICKER_KINDS.result]) {
    await boundary.holdNext(kind);
    const oldMessage = {
      __matrx: true,
      kind,
      payload: { session_id: a, list_root: '#archive', item_selector: '.archive-card' },
    };
    const held = runtime.sendMessage(oldMessage);
    assert.deepEqual((await boundary.snapshot()).held, [
      { kind, session_id: a, list_root: '#archive', item_selector: '.archive-card' },
    ]);
    assert.equal(delivered.includes(oldMessage), false, `${kind} reached Chrome before release`);
    await assert.rejects(boundary.holdNext(kind), /showcase_previous_message_still_held/);
    assert.deepEqual(await boundary.release(STALE_PICKER_KINDS.exit, a), { released: false });
    assert.deepEqual(await boundary.release(kind, a), { released: true, ack: true });
    assert.deepEqual(await held, { ack: true });
    assert.equal(delivered.at(-1), oldMessage);
  }
  await boundary.holdCancel();
  const priorCancel = world.window.__matrxListPickerCancel;
  priorCancel(a);
  assert.deepEqual(cancelled, []);
  assert.deepEqual(await boundary.cancelSnapshot(), { count: 1, session_id: a });
  world.window.__matrxListPickerCancel = (id) => cancelled.push(`replacement:${id}`);
  assert.deepEqual(await boundary.releaseCancel(b), { released: false });
  assert.deepEqual(await boundary.releaseCancel(a), { released: true });
  assert.deepEqual(cancelled, [a]);
  await boundary.armListenerCount();
  function oldClick() {}
  function newClick() {}
  function newHover() {}
  document.addEventListener('click', oldClick, true);
  assert.deepEqual(await boundary.listenerSnapshot(), { click_count: 1, hover_count: 0 });
  document.removeEventListener('click', oldClick, true);
  document.addEventListener('click', newClick, true);
  document.addEventListener('mouseover', newHover, true);
  assert.deepEqual(await boundary.listenerSnapshot(), { click_count: 1, hover_count: 1 });
  document.removeEventListener('click', newClick, true);
  document.removeEventListener('mouseover', newHover, true);
  assert.deepEqual(await boundary.listenerSnapshot(), { click_count: 0, hover_count: 0 });
  await boundary.closeListenerCount();
  await boundary.capturePickerContext();
  const reused = await boundary.comparePickerContext();
  assert.deepEqual(reused, {
    both_present: true,
    start_distinct: false,
    teardown_distinct: false,
  });
  assert.throws(
    () => assertFreshShowcasePickerContext(reused),
    /showcase_reinject_reused_picker_module/,
  );
  world.window.__matrxListPickerStart = function freshStart() {};
  world.window.__matrxListPickerTeardown = function freshTeardown() {};
  const fresh = await boundary.comparePickerContext();
  assert.deepEqual(fresh, {
    both_present: true,
    start_distinct: true,
    teardown_distinct: true,
  });
  assert.doesNotThrow(() => assertFreshShowcasePickerContext(fresh));
  await boundary.close();
});

test('deferred installation replays the exact Chrome operation before replacement', async () => {
  const installed = [];
  const world = vm.createContext({
    chrome: {
      scripting: {
        executeScript(details) {
          installed.push(details);
          return Promise.resolve([{ result: true }]);
        },
      },
    },
  });
  const panel = {
    async send(method, params) {
      assert.equal(method, 'Runtime.evaluate');
      return {
        result: {
          value: JSON.parse(JSON.stringify(await vm.runInContext(params.expression, world))),
        },
      };
    },
  };
  const boundary = await armShowcaseInstallBoundary(panel);
  const target = { tabId: 7, documentIds: ['current-document'] };
  const oldInstall = world.chrome.scripting.executeScript({
    target,
    files: ['content-scripts/list-picker.js'],
  });
  assert.equal(installed.length, 0);
  assert.equal((await boundary.snapshot()).held, true);
  assert.deepEqual(await boundary.release(), { released: true });
  await oldInstall;
  assert.equal(installed.length, 1);
  await world.chrome.scripting.executeScript({ target, files: ['content-scripts/list-picker.js'] });
  assert.equal(installed.length, 2);
  const session = '11111111-1111-4111-8111-111111111111';
  await world.chrome.scripting.executeScript({
    target,
    func() {
      return window.__matrxListPickerStart;
    },
    args: [session, null],
  });
  const snapshot = await boundary.snapshot();
  assert.equal(snapshot.observed.length, 2);
  assert.deepEqual(snapshot.starts, [
    { session_id: session, tab_id: 7, document_id: 'current-document' },
  ]);
  await boundary.close();
});

test('refuses default or foreign extension picker worlds', async () => {
  for (const world of ['default', 'foreign-extension']) {
    const cdp = new EventEmitter();
    cdp.send = async (method) => {
      if (method === 'Runtime.enable')
        queueMicrotask(() =>
          cdp.emit('Runtime.executionContextCreated', {
            context: { id: 1, auxData: { isDefault: world === 'default', frameId: 'page' } },
          }),
        );
      if (method === 'Runtime.evaluate')
        return {
          result: {
            value: {
              id: 'different-extension',
              picker: 'function',
              url: 'http://localhost/events',
            },
          },
        };
      return {};
    };
    await assert.rejects(
      armShowcaseStaleBoundary(
        {
          url: () => 'http://localhost/events',
          context: () => ({ newCDPSession: async () => cdp }),
        },
        'cihdmkcdjjckfhjpgoedmgfpoljebaml',
      ),
      /showcase_picker_isolated_context_missing/,
    );
  }
});

// EXT-D-0158: rejecting omitted options aborts WXT before fresh picker hooks install.
test('listener observer forwards every option form and counts only capture listeners', async () => {
  const { boundary, document, pageListeners } = await createRuntimeBoundaryFixture();
  await boundary.armListenerCount();
  // WXT registers its script-started listener without options before installing hooks.
  // The observer must forward all legal option forms, including untracked events.
  for (const options of [undefined, false, {}, { capture: false }, true, { capture: true }]) {
    function scriptStarted() {}
    assert.doesNotThrow(() =>
      document.addEventListener('wxt:script-started', scriptStarted, options),
    );
    assert.equal(pageListeners.has('wxt:script-started:scriptStarted'), true);
    assert.deepEqual(await boundary.listenerSnapshot(), { click_count: 0, hover_count: 0 });
    assert.doesNotThrow(() =>
      document.removeEventListener('wxt:script-started', scriptStarted, options),
    );
    assert.equal(pageListeners.has('wxt:script-started:scriptStarted'), false);
  }
  function bubbleClick() {}
  document.addEventListener('click', bubbleClick);
  assert.deepEqual(await boundary.listenerSnapshot(), { click_count: 0, hover_count: 0 });
  assert.equal(pageListeners.has('click:bubbleClick'), true);
  document.removeEventListener('click', bubbleClick);
  function objectCapture() {}
  document.addEventListener('click', objectCapture, { capture: true });
  assert.deepEqual(await boundary.listenerSnapshot(), { click_count: 1, hover_count: 0 });
  document.removeEventListener('click', objectCapture, true);
  assert.deepEqual(await boundary.listenerSnapshot(), { click_count: 0, hover_count: 0 });
  await boundary.closeListenerCount();
  await boundary.close();
});

test('native observer counts stamped deliveries without treating the raw producer copy as a duplicate', async () => {
  const callbacks = [];
  const world = vm.createContext({
    chrome: { runtime: { onMessage: { addListener: (callback) => callbacks.push(callback) } } },
  });
  const panel = {
    async send(method, params) {
      assert.equal(method, 'Runtime.evaluate');
      return {
        result: { value: JSON.parse(JSON.stringify(vm.runInContext(params.expression, world))) },
      };
    },
  };
  await observeShowcaseRelay(panel);
  const deliver = (payload, kind = STALE_PICKER_KINDS.detected) => {
    for (const callback of callbacks) callback({ __matrx: true, kind, payload });
  };
  // Chrome delivers both the content send and the SW broadcast to the panel.
  // These shapes match list-picker.ts and list-picker-relay.ts respectively.
  const raw = { session_id: 'current' };
  const stamped = { ...raw, tab_id: 77, document_id: 'current-document' };
  deliver({ session_id: 'previous', tab_id: 77, document_id: 'current-document' });
  const start = (await readShowcaseRelays(panel)).length;
  deliver(raw);
  assert.deepEqual(showcaseStampedDetections(await readShowcaseRelays(panel), start), []);
  deliver(stamped);
  const first = showcaseStampedDetections(await readShowcaseRelays(panel), start);
  assert.deepEqual(first, [{ kind: STALE_PICKER_KINDS.detected, ...stamped }]);
  assert.equal((await readShowcaseRelays(panel)).length, 3, 'raw evidence must be retained');
  assert.deepEqual(
    summarizeShowcaseDetectionWindow(
      await readShowcaseRelays(panel),
      { observed: [{ kind: STALE_PICKER_KINDS.detected, ...raw }] },
      start,
      'current',
    ),
    {
      detected_count: 2,
      stamped_detected_count: 1,
      unstamped_detected_count: 1,
      current_session_detected_count: 2,
      other_session_detected_count: 0,
      producer_current_detected_count: 1,
    },
  );
  // A second stamped delivery is still a duplicate: never deduplicate identities.
  deliver(stamped);
  assert.equal(showcaseStampedDetections(await readShowcaseRelays(panel), start).length, 2);
  deliver({ ...raw, tab_id: 77 });
  deliver({ ...raw, document_id: 'current-document' });
  deliver({ ...raw, tab_id: 77, document_id: '' });
  deliver(stamped, STALE_PICKER_KINDS.result);
  assert.equal(showcaseStampedDetections(await readShowcaseRelays(panel), start).length, 2);
  deliver({ session_id: 'other', tab_id: 88, document_id: 'other-document' });
  assert.equal(showcaseStampedDetections(await readShowcaseRelays(panel), start).length, 3);
});
