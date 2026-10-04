import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { requireGuestTransport, watchGuestAiRequests } from './guest-chat-transport-observer.mjs';

// Break caught: observing the panel CDP target records zero requests because
// the first real stream POST is emitted by a lazily created offscreen target.
test('fresh offscreen target is observed before its first fetch, without precreation', async () => {
  const events = new EventEmitter();
  const calls = [];
  let resume;
  const resumed = new Promise((resolve) => {
    resume = resolve;
  });
  const browserSession = {
    on: events.on.bind(events),
    off: events.off.bind(events),
    async send(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === 'Runtime.runIfWaitingForDebugger' && sessionId === 'offscreen-session')
        resume();
      if (method === 'Network.getResponseBody') {
        return {
          body: JSON.stringify({ error: 'guest_ai_allowance_used', secret: 'do-not-retain' }),
          base64Encoded: false,
        };
      }
      return {};
    },
  };
  const watch = await watchGuestAiRequests({
    browserSession,
    panelTarget: { url: 'chrome-extension://abc/sidepanel.html' },
    attachOffscreen: async () => {
      throw new Error('native_sidepanel_offscreen_target_missing');
    },
  });
  assert.deepEqual(
    calls.map((call) => call.method),
    ['Target.setAutoAttach'],
  );
  watch.arm('opening');
  events.emit('Target.attachedToTarget', {
    sessionId: 'other-session',
    targetInfo: { url: 'https://example.com/' },
    waitingForDebugger: true,
  });
  events.emit('Target.attachedToTarget', {
    sessionId: 'offscreen-session',
    targetInfo: { url: 'chrome-extension://abc/offscreen.html' },
    waitingForDebugger: true,
  });
  await resumed;
  const enableIndex = calls.findIndex(
    (call) => call.method === 'Network.enable' && call.sessionId === 'offscreen-session',
  );
  const resumeIndex = calls.findIndex(
    (call) =>
      call.method === 'Runtime.runIfWaitingForDebugger' && call.sessionId === 'offscreen-session',
  );
  assert.ok(enableIndex >= 0 && resumeIndex > enableIndex);
  events.emit(
    'Network.requestWillBeSent',
    {
      requestId: 'first-1',
      request: {
        method: 'POST',
        url: 'https://server.invalid/v2/ai/mandates/extend.browser_chat',
        headers: { Authorization: 'Bearer do-not-retain' },
        postData: 'prompt=do-not-retain',
      },
    },
    'offscreen-session',
  );
  events.emit(
    'Network.responseReceived',
    {
      requestId: 'first-1',
      response: { status: 402, headers: { 'Set-Cookie': 'do-not-retain' } },
    },
    'offscreen-session',
  );
  events.emit('Network.loadingFinished', { requestId: 'first-1' }, 'offscreen-session');
  await watch.settle();
  const first = watch.snapshot();
  requireGuestTransport(first, 'opening');
  assert.deepEqual(
    first.map(({ attempt, cdp_request_id, status, code }) => ({
      attempt,
      cdp_request_id,
      status,
      code,
    })),
    [
      {
        attempt: 'opening',
        cdp_request_id: 'first-1',
        status: 402,
        code: 'guest_ai_allowance_used',
      },
    ],
  );
  assert.match(first[0].request_at_utc, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(first[0]).sort(), [
    'attempt',
    'cdp_request_id',
    'code',
    'request_at_utc',
    'status',
  ]);
  assert.equal(JSON.stringify(first).includes('do-not-retain'), false);

  watch.arm('post_reload_new_conversation');
  events.emit(
    'Network.requestWillBeSent',
    {
      requestId: 'second-2',
      request: { method: 'POST', url: 'https://server.invalid/v2/ai/mandates/extend.browser_chat' },
    },
    'offscreen-session',
  );
  events.emit(
    'Network.responseReceived',
    {
      requestId: 'second-2',
      response: { status: 200 },
    },
    'offscreen-session',
  );
  requireGuestTransport(watch.snapshot(), 'post_reload_new_conversation');
  await watch.stop();
  assert.ok(
    calls.some(
      (call) =>
        call.method === 'Runtime.runIfWaitingForDebugger' && call.sessionId === 'other-session',
    ),
  );
  assert.ok(
    calls.some(
      (call) => call.method === 'Target.setAutoAttach' && call.params.autoAttach === false,
    ),
  );
});

test('transport proof refuses absent and statusless observations', () => {
  assert.throws(
    () => requireGuestTransport([], 'opening'),
    /opening_guest_ai_transport_unobserved/,
  );
  assert.throws(
    () => requireGuestTransport([{ attempt: 'opening', status: null }], 'opening'),
    /opening_guest_ai_transport_unobserved/,
  );
  assert.throws(
    () =>
      requireGuestTransport([{ attempt: 'opening', status: 200 }], 'post_reload_new_conversation'),
    /post_reload_new_conversation_guest_ai_transport_unobserved/,
  );
  requireGuestTransport([{ attempt: 'opening', status: 200 }], 'opening');
});

test('existing offscreen target is observed directly without changing target startup', async () => {
  const browserEvents = new EventEmitter();
  const offscreenEvents = new EventEmitter();
  const calls = [];
  let detached = false;
  const watch = await watchGuestAiRequests({
    browserSession: {
      on: browserEvents.on.bind(browserEvents),
      off: browserEvents.off.bind(browserEvents),
      async send(method) {
        calls.push(method);
        return {};
      },
    },
    panelTarget: { url: 'chrome-extension://abc/sidepanel.html' },
    attachOffscreen: async () => ({
      async send(method) {
        calls.push(method);
        return {};
      },
      on(name, listener) {
        offscreenEvents.on(name, listener);
        return () => offscreenEvents.off(name, listener);
      },
      async detachVerified() {
        detached = true;
      },
    }),
  });
  assert.deepEqual(calls, ['Network.enable']);
  watch.arm('opening');
  offscreenEvents.emit('Network.requestWillBeSent', {
    requestId: 'preexisting-1',
    request: { method: 'POST', url: 'https://server.invalid/v2/ai/mandates/extend.browser_chat' },
  });
  offscreenEvents.emit('Network.responseReceived', {
    requestId: 'preexisting-1',
    response: { status: 200 },
  });
  requireGuestTransport(watch.snapshot(), 'opening');
  await watch.stop();
  assert.equal(detached, true);
  assert.equal(calls.includes('Target.setAutoAttach'), false);
});

test('offscreen target with initially empty URL still captures its first POST', async () => {
  const events = new EventEmitter();
  const calls = [];
  let resumed;
  const resumePromise = new Promise((resolve) => {
    resumed = resolve;
  });
  const browserSession = {
    on: events.on.bind(events),
    off: events.off.bind(events),
    async send(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === 'Runtime.runIfWaitingForDebugger') resumed();
      return {};
    },
  };
  const watch = await watchGuestAiRequests({
    browserSession,
    panelTarget: { url: 'chrome-extension://abc/sidepanel.html' },
    attachOffscreen: async () => {
      throw new Error('native_sidepanel_offscreen_target_missing');
    },
  });
  watch.arm('opening');
  events.emit('Target.attachedToTarget', {
    sessionId: 'late-url-session',
    targetInfo: { targetId: 'late-url-target', url: '' },
    waitingForDebugger: true,
  });
  await resumePromise;
  events.emit(
    'Network.requestWillBeSent',
    {
      requestId: 'late-first',
      request: { method: 'POST', url: 'https://server.invalid/v2/ai/mandates/extend.browser_chat' },
    },
    'late-url-session',
  );
  events.emit(
    'Network.responseReceived',
    {
      requestId: 'late-first',
      response: { status: 402 },
    },
    'late-url-session',
  );
  events.emit('Target.targetInfoChanged', {
    targetInfo: { targetId: 'late-url-target', url: 'chrome-extension://abc/offscreen.html' },
  });
  requireGuestTransport(watch.snapshot(), 'opening');
  assert.ok(
    calls.findIndex((call) => call.method === 'Network.enable') <
      calls.findIndex((call) => call.method === 'Runtime.runIfWaitingForDebugger'),
  );
  await watch.stop();
});

test('unavailable error body preserves HTTP status and later observations', async () => {
  const events = new EventEmitter();
  const browserSession = {
    on: events.on.bind(events),
    off: events.off.bind(events),
    async send(method) {
      if (method === 'Network.getResponseBody') {
        throw new Error('owned_cdp_response_body_unavailable');
      }
      return {};
    },
  };
  const watch = await watchGuestAiRequests({
    browserSession,
    panelTarget: { url: 'chrome-extension://abc/sidepanel.html' },
    attachOffscreen: async () => {
      throw new Error('native_sidepanel_offscreen_target_missing');
    },
  });
  watch.arm('opening');
  events.emit('Target.attachedToTarget', {
    sessionId: 'offscreen-session',
    targetInfo: { targetId: 'offscreen-target', url: 'chrome-extension://abc/offscreen.html' },
    waitingForDebugger: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  events.emit(
    'Network.requestWillBeSent',
    {
      requestId: 'first',
      request: { method: 'POST', url: 'https://server.invalid/v2/ai/mandates/extend.browser_chat' },
    },
    'offscreen-session',
  );
  events.emit(
    'Network.responseReceived',
    {
      requestId: 'first',
      response: { status: 402 },
    },
    'offscreen-session',
  );
  events.emit('Network.loadingFinished', { requestId: 'first' }, 'offscreen-session');
  await watch.settle();
  assert.deepEqual(
    watch.snapshot().map(({ status, code }) => ({ status, code })),
    [{ status: 402, code: null }],
  );
  watch.arm('post_reload_new_conversation');
  events.emit(
    'Network.requestWillBeSent',
    {
      requestId: 'second',
      request: { method: 'POST', url: 'https://server.invalid/v2/ai/mandates/extend.browser_chat' },
    },
    'offscreen-session',
  );
  events.emit(
    'Network.responseReceived',
    {
      requestId: 'second',
      response: { status: 200 },
    },
    'offscreen-session',
  );
  requireGuestTransport(watch.snapshot(), 'post_reload_new_conversation');
  await watch.stop();
});

test('existing target detach failure is reported', async () => {
  const events = new EventEmitter();
  const watch = await watchGuestAiRequests({
    browserSession: { on: events.on.bind(events), off: events.off.bind(events) },
    panelTarget: { url: 'chrome-extension://abc/sidepanel.html' },
    attachOffscreen: async () => ({
      async send() {
        return {};
      },
      on() {
        return () => {};
      },
      async detachVerified() {
        throw new Error('detach_failed');
      },
    }),
  });
  await assert.rejects(() => watch.stop(), /guest_transport_observer_cleanup_failed/);
});
