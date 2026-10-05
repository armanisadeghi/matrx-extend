import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  requireGuestConversationSequence,
  requireGuestTransport,
  watchGuestAiRequests,
} from './guest-chat-transport-observer.mjs';

// Break caught: a second guest send silently starts a new conversation or
// reuses the opening reply while the transport still returns HTTP 200.
test('guest sequence requires one HTTP 200 POST per turn with continued then new identity', () => {
  const opening = {
    attempt: 'opening',
    status: 200,
    conversation_fingerprint: 'opening-fingerprint',
    is_new: true,
  };
  const same = {
    attempt: 'same_conversation_followup',
    status: 200,
    conversation_fingerprint: 'opening-fingerprint',
    is_new: false,
  };
  const reloaded = {
    attempt: 'post_reload_new_conversation',
    status: 200,
    conversation_fingerprint: 'reloaded-fingerprint',
    is_new: true,
  };
  requireGuestConversationSequence([opening, same, reloaded]);
  assert.throws(
    () => requireGuestConversationSequence([opening, { ...same, is_new: true }, reloaded]),
    /followup_must_continue_conversation/,
  );
  assert.throws(
    () =>
      requireGuestConversationSequence([
        opening,
        { ...same, conversation_fingerprint: 'other' },
        reloaded,
      ]),
    /followup_must_keep_opening_conversation_identity/,
  );
  assert.throws(
    () => requireGuestConversationSequence([opening, { ...same, status: 402 }, reloaded]),
    /same_conversation_followup_requires_http_200/,
  );
  assert.throws(
    () =>
      requireGuestConversationSequence([
        opening,
        same,
        { ...reloaded, conversation_fingerprint: 'opening-fingerprint' },
      ]),
    /post_reload_must_use_new_conversation_identity/,
  );
  assert.throws(
    () => requireGuestConversationSequence([opening, same, same, reloaded]),
    /same_conversation_followup_requires_exactly_one_offscreen_post/,
  );
});

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
    ['Target.setDiscoverTargets', 'Target.setAutoAttach'],
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
        postData: JSON.stringify({
          conversation_id: 'conversation-private-opening',
          is_new: true,
          user_input: 'do-not-retain',
        }),
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
    'conversation_fingerprint',
    'is_new',
    'request_at_utc',
    'status',
  ]);
  assert.equal(JSON.stringify(first).includes('do-not-retain'), false);
  assert.equal(JSON.stringify(first).includes('conversation-private-opening'), false);
  assert.equal(first[0].is_new, true);
  assert.match(first[0].conversation_fingerprint, /^[0-9a-f]{16}$/);

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

test('large offscreen POST body is inspected transiently without retaining guest text or ID', async () => {
  const events = new EventEmitter();
  const watch = await watchGuestAiRequests({
    browserSession: { on: events.on.bind(events), off: events.off.bind(events) },
    panelTarget: { url: 'chrome-extension://abc/sidepanel.html' },
    attachOffscreen: async () => ({
      async send(method) {
        if (method === 'Network.getRequestPostData')
          return {
            postData: JSON.stringify({
              conversation_id: 'private-conversation',
              is_new: false,
              user_input: 'private-question',
            }),
          };
        return {};
      },
      on(name, listener) {
        events.on(name, listener);
        return () => events.off(name, listener);
      },
      async detachVerified() {},
    }),
  });
  watch.arm('same_conversation_followup');
  events.emit('Network.requestWillBeSent', {
    requestId: 'large-post',
    request: { method: 'POST', url: 'https://server.invalid/v2/ai/mandates/extend.browser_chat' },
  });
  events.emit('Network.responseReceived', { requestId: 'large-post', response: { status: 200 } });
  await watch.settle();
  const rows = watch.snapshot();
  assert.equal(rows[0].is_new, false);
  assert.match(rows[0].conversation_fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(JSON.stringify(rows).includes('private-conversation'), false);
  assert.equal(JSON.stringify(rows).includes('private-question'), false);
  await watch.stop();
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

// Chromium TargetHandler only observes target navigation after discovery is enabled.
// A lazy offscreen document starts blank; network metadata must not remain provisional.
test('discovery delivers the late offscreen identity required for transport proof', async () => {
  const events = new EventEmitter();
  let discovery = false;
  let network = false;
  const watch = await watchGuestAiRequests({
    panelTarget: { url: 'chrome-extension://abc/sidepanel.html' },
    attachOffscreen: async () => {
      throw new Error('native_sidepanel_offscreen_target_missing');
    },
    browserSession: {
      on: events.on.bind(events),
      off: events.off.bind(events),
      async send(method, params, sessionId) {
        if (method === 'Target.getTargets')
          return {
            targetInfos: [
              {
                targetId: 'late-target',
                type: 'other',
                url: 'chrome-extension://abc/offscreen.html',
              },
              {
                targetId: 'private-target',
                type: 'page',
                url: 'https://private.invalid/?secret=never-retain',
              },
            ],
          };
        if (method === 'Target.setDiscoverTargets') discovery = params.discover;
        if (method === 'Network.enable') network = true;
        if (method === 'Runtime.runIfWaitingForDebugger') {
          if (discovery)
            events.emit('Target.targetInfoChanged', {
              targetInfo: { targetId: 'late-target', url: 'chrome-extension://abc/offscreen.html' },
            });
          if (network) {
            events.emit(
              'Network.requestWillBeSent',
              {
                requestId: 'opening-request',
                request: {
                  method: 'POST',
                  url: 'https://server.invalid/v2/ai/mandates/extend.browser_chat',
                },
              },
              sessionId,
            );
            events.emit(
              'Network.responseReceived',
              { requestId: 'opening-request', response: { status: 200 } },
              sessionId,
            );
          }
        }
        return {};
      },
    },
  });
  const before = await watch.diagnostics();
  assert.equal(before.counters.request_events, 0);
  assert.equal(before.confirmed_sessions, 0);
  watch.arm('opening');
  events.emit('Target.attachedToTarget', {
    sessionId: 'late-session',
    targetInfo: { targetId: 'late-target', url: '' },
    waitingForDebugger: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  requireGuestTransport(watch.snapshot(), 'opening');
  const observed = await watch.diagnostics();
  assert.deepEqual(observed.counters, {
    attached: 1,
    identity_changed: 1,
    network_enabled: 1,
    request_events: 1,
    post_events: 1,
    chat_path_events: 1,
    response_events: 1,
  });
  assert.equal(observed.confirmed_sessions, 1);
  assert.equal(observed.provisional_sessions, 0);
  assert.equal(observed.buffered_requests, 1);
  assert.deepEqual(observed.target_inventory, [
    { identity: 'offscreen', auto_attached_by_observer: true, type: 'other' },
    { identity: 'other', auto_attached_by_observer: false, type: 'page' },
  ]);
  assert.equal(JSON.stringify(observed).includes('never-retain'), false);
  await watch.stop();
  assert.equal(
    discovery,
    true,
    'observer cleanup must preserve session-wide discovery for other harness consumers',
  );
});
