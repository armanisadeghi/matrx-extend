import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const { configureStore } = createRequire(
  import.meta.resolve('@ai-matrx/chat/store/create-chat-store'),
)('@reduxjs/toolkit');
import { createGuestSendExecutionProbe } from './guest-chat-send-execution-probe.mjs';

// A guest asks about an article. A bubbling click alone must never imply that Redux received it.
function setup() {
  const privateId = 'opening-guest-conversation';
  const text = 'Read the current page.';
  const state = {
    conversations: { byConversationId: { [privateId]: {} } },
    instanceUserInput: { byConversationId: { [privateId]: { text, submissionPhase: 'idle' } } },
    chatHost: {
      identity: { authReady: true, fingerprintId: 'private-signature', accessToken: null },
    },
  };
  const store = configureStore({
    reducer: (current, action = {}) =>
      action.type === 'submit'
        ? {
            ...current,
            instanceUserInput: {
              byConversationId: {
                [privateId]: {
                  text,
                  submissionPhase: 'pending',
                  preSend: { status: 'failed', error: 'private detail' },
                },
              },
            },
          }
        : (current ?? state),
  });
  const composer = {
    __reactFiber$probe: {
      memoizedProps: { conversationId: privateId },
      dependencies: { firstContext: { memoizedValue: { store }, next: null } },
    },
  };
  const button = {
    __reactProps$probe: {
      onClick() {
        throw Error('diagnostic must never invoke handler');
      },
    },
  };
  return { store, composer, button, text, privateId };
}

for (const dispatched of [false, true]) {
  test(`distinguishes a native click ${dispatched ? 'with' : 'without'} a subsequent Redux notification`, () => {
    const { store, composer, button, text, privateId } = setup();
    const probe = createGuestSendExecutionProbe(composer, button);
    store.dispatch({ type: 'unrelated-before-click' });
    assert.equal(probe.snapshot().storeNotificationsAfterClick, 0);
    probe.begin();
    if (dispatched) store.dispatch({ type: 'submit' });
    const receipt = probe.stop();
    assert.equal(receipt.storeNotificationsAfterClick, dispatched ? 1 : 0);
    assert.equal(receipt.pendingSubmissionObserved, dispatched);
    assert.equal(receipt.submissionPhase, dispatched ? 'pending' : 'idle');
    assert.equal(receipt.preSendStatus, dispatched ? 'failed' : null);
    assert.equal(receipt.preSendErrorPresent, dispatched);
    assert.equal(receipt.fingerprintPresent, true);
    assert.equal(receipt.accessTokenPresent, false);
    assert.equal(receipt.buttonReactOnClickPresent, true);
    for (const privateValue of [text, privateId, 'private-signature', 'private detail'])
      assert.equal(JSON.stringify(receipt).includes(privateValue), false);
    store.dispatch({ type: 'after-stop' });
    assert.equal(probe.snapshot().storeNotificationsAfterClick, dispatched ? 1 : 0);
  });
}

test('missing or ambiguous stores and missing handlers stay explicit', () => {
  assert.equal(createGuestSendExecutionProbe(null, null).snapshot().storeLocated, false);
  const { store, composer } = setup();
  composer.__reactFiber$probe.dependencies.firstContext.next = {
    memoizedValue: { store: { getState: store.getState, subscribe: store.subscribe } },
    next: null,
  };
  const receipt = createGuestSendExecutionProbe(composer, {}).stop();
  assert.equal(receipt.storeLocated, false);
  assert.equal(receipt.submissionPhase, null);
  assert.equal(receipt.buttonReactOnClickPresent, false);
});

// A thrown handler and an asynchronously rejected send must leave different, sanitized evidence.
test('runtime categories survive click return and stop on final cleanup', () => {
  const { composer, button } = setup();
  const listeners = new Set();
  class TrackedEvents extends EventTarget {
    addEventListener(type, listener) {
      listeners.add(listener);
      super.addEventListener(type, listener);
    }
    removeEventListener(type, listener) {
      listeners.delete(listener);
      super.removeEventListener(type, listener);
    }
  }
  const events = new TrackedEvents();
  const probe = createGuestSendExecutionProbe(composer, button, events);
  const privateError = () => {
    const event = new Event('error');
    for (const key of ['error', 'message', 'filename', 'stack', 'reason'])
      Object.defineProperty(event, key, {
        get() {
          throw Error('diagnostic read private event detail');
        },
      });
    return event;
  };
  events.dispatchEvent(privateError());
  assert.deepEqual(probe.snapshot().runtimeErrors, { windowErrors: 0, unhandledRejections: 0 });
  probe.begin();
  events.dispatchEvent(privateError());
  events.dispatchEvent(new Event('unhandledrejection'));
  assert.equal(listeners.size, 2);
  const receipt = probe.stop();
  assert.equal(listeners.size, 0);
  assert.deepEqual(receipt.runtimeErrors, { windowErrors: 1, unhandledRejections: 1 });
  events.dispatchEvent(privateError());
  events.dispatchEvent(new Event('unhandledrejection'));
  assert.deepEqual(probe.snapshot().runtimeErrors, receipt.runtimeErrors);
});

test('a delayed submission notification remains observable until teardown', async () => {
  const { store, composer, button } = setup();
  const probe = createGuestSendExecutionProbe(composer, button);
  probe.begin();
  const clickReturn = probe.snapshot();
  assert.equal(clickReturn.pendingSubmissionObserved, false);

  let releaseDispatch;
  const delayedNotification = new Promise((resolve) => {
    releaseDispatch = () => {
      store.dispatch({ type: 'submit' });
      resolve();
    };
  });
  queueMicrotask(releaseDispatch);
  await delayedNotification;

  const terminalObservation = probe.snapshot();
  assert.equal(terminalObservation.storeNotificationsAfterClick, 1);
  assert.equal(terminalObservation.pendingSubmissionObserved, true);
  assert.equal(terminalObservation.submissionPhase, 'pending');
  const finalReceipt = probe.stop();
  store.dispatch({ type: 'after-stop' });
  assert.equal(probe.snapshot().storeNotificationsAfterClick, 1);
  assert.equal(finalReceipt.pendingSubmissionObserved, true);
});
