import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  guestTransportModeForReceipt,
  requireGuestConversationSequence,
  requireGuestTransport,
  watchGuestAiRequests,
} from './guest-chat-transport-observer.mjs';

// Captured .522 publisher hashes, with the adapter's documented receipt shape.
// This guards transport selection, not artifact authentication (the workflow
// verifies the release and ZIP bytes; the native harness verifies runtime bytes).
const storeReceipt = (version = '0.2.522') => ({
  kind: 'native_store_zip_candidate_key_adapted',
  version,
  publishState: 'pushed',
  sourceSha: 'f4a72d5ddbb508f63eef71661547b80c23bb6ffe',
  treeSha256: 'a'.repeat(64),
  storeTreeSha256: 'b'.repeat(64),
  storeZip: { sha256: 'fe80e3025dead2e2f508f0c2ba44656f33fa069b454d7f1313061f44e7cd54b9' },
  artifactSelection: {
    source: 'release_receipt_store_zip',
    publisherSourceTreeSha256: 'f521397efceb1cd9f2ecd3292d01256f33e575db29a6d28f184fc51f89fc6195',
    selectedZipSha256: 'fe80e3025dead2e2f508f0c2ba44656f33fa069b454d7f1313061f44e7cd54b9',
    originalStoreTreeSha256: 'b'.repeat(64),
    runtimeTreeSha256: 'a'.repeat(64),
    modifiedPaths: ['manifest.json'],
  },
});

test('proven Store receipt selects transport across release increments', () => {
  for (const version of ['0.2.520', '0.2.521', '0.2.522', '0.2.999', '0.3.0', '1.0.0']) {
    assert.equal(guestTransportModeForReceipt(storeReceipt(version)), 'package');
  }
  assert.equal(guestTransportModeForReceipt(storeReceipt('0.2.205')), 'legacy');
});

test('receipt selection refuses malformed, unsupported and unproven artifacts', () => {
  const valid = storeReceipt();
  for (const receipt of [
    null,
    {},
    { kind: valid.kind, version: valid.version },
    { ...valid, kind: 'unknown' },
    ...['', '0.2.519', '0.2.522-next', 'garbage', null, 522].map((version) => ({
      ...valid,
      version,
    })),
    { ...valid, publishState: 'not_published' },
    { ...valid, sourceSha: 'unproven' },
    { ...valid, treeSha256: 'unproven' },
    { ...valid, storeZip: undefined },
    { ...valid, artifactSelection: undefined },
    ...[
      { source: 'release_receipt_local_zip' },
      { selectedZipSha256: 'c'.repeat(64) },
      { runtimeTreeSha256: 'c'.repeat(64) },
      { originalStoreTreeSha256: 'c'.repeat(64) },
      { publisherSourceTreeSha256: null },
      { modifiedPaths: ['manifest.json', 'sidepanel.html'] },
    ].map((change) => ({ ...valid, artifactSelection: { ...valid.artifactSelection, ...change } })),
  ])
    assert.throws(
      () => guestTransportModeForReceipt(receipt),
      /guest_transport_receipt_unrecognized/,
    );
});

test('published CRX and local development retain their distinct provenance contracts', () => {
  const crx = {
    kind: 'published_store_crx_unpacked',
    version: '0.2.205',
    treeSha256: 'a'.repeat(64),
    crxSha256: 'b'.repeat(64),
    extensionId: 'a'.repeat(32),
    downloadSource: 'Google Chrome public update service; verified CRX3 signing key and SHA-256',
  };
  assert.equal(guestTransportModeForReceipt(crx), 'legacy');
  assert.equal(guestTransportModeForReceipt({ ...crx, version: '0.2.522' }), 'package');
  assert.throws(
    () => guestTransportModeForReceipt({ ...crx, crxSha256: null }),
    /guest_transport_receipt_unrecognized/,
  );
  const local = {
    kind: 'local_dev_unpacked',
    version: '0.2.520',
    schema_version: 1,
    publish_state: 'not_published',
    treeSha256: 'a'.repeat(64),
    extensionDir: '/owned/chrome-mv3',
    observedAt: '2026-10-17T00:00:00.000Z',
  };
  assert.equal(guestTransportModeForReceipt(local), 'package');
  assert.equal(guestTransportModeForReceipt({ ...local, version: '0.2.999' }), 'package');
  for (const change of [
    { version: '0.2.205' },
    { publish_state: 'pushed' },
    { schema_version: 2 },
    { observedAt: null },
  ])
    assert.throws(
      () => guestTransportModeForReceipt({ ...local, ...change }),
      /guest_transport_receipt_unrecognized/,
    );
});

// Break caught: a turn loses its identity on the documented v2 404/405 route
// fallback, accepts arbitrary duplicate POSTs, or never reaches a successful reply.
test('guest sequence accepts only one success or the documented v2 route fallback', () => {
  const opening = {
    attempt: 'opening',
    status: 200,
    path_class: 'canonical',
    conversation_fingerprint: 'opening-fingerprint',
    is_new: true,
  };
  const same = {
    attempt: 'same_conversation_followup',
    status: 200,
    path_class: 'canonical',
    conversation_fingerprint: 'opening-fingerprint',
    is_new: false,
  };
  const reloaded = {
    attempt: 'post_reload_new_conversation',
    status: 200,
    path_class: 'canonical',
    conversation_fingerprint: 'reloaded-fingerprint',
    is_new: true,
  };
  requireGuestConversationSequence([opening, same, reloaded]);

  const fallback = (attempt, status, path_class, conversation_fingerprint, is_new) => ({
    attempt,
    status,
    path_class,
    conversation_fingerprint,
    is_new,
  });
  requireGuestConversationSequence([
    fallback('opening', 404, 'versioned', 'opening-fingerprint', true),
    opening,
    fallback('same_conversation_followup', 405, 'versioned', 'opening-fingerprint', false),
    same,
    fallback('post_reload_new_conversation', 404, 'versioned', 'reloaded-fingerprint', true),
    reloaded,
  ]);

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
    /same_conversation_followup_fallback_must_be_v2_not_found_or_method_not_allowed/,
  );
  assert.throws(
    () =>
      requireGuestConversationSequence([
        opening,
        fallback('same_conversation_followup', 404, 'canonical', 'opening-fingerprint', false),
        same,
        reloaded,
      ]),
    /same_conversation_followup_fallback_must_be_v2_not_found_or_method_not_allowed/,
  );
  assert.throws(
    () =>
      requireGuestConversationSequence([
        opening,
        fallback('same_conversation_followup', 404, 'versioned', 'opening-fingerprint', false),
        fallback('same_conversation_followup', 200, 'versioned', 'opening-fingerprint', false),
        reloaded,
      ]),
    /same_conversation_followup_fallback_must_use_canonical_route/,
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
        url: 'https://server.invalid/ai/mandates/extend.browser_chat',
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
    first.map(({ attempt, cdp_request_id, status, code, path_class }) => ({
      attempt,
      cdp_request_id,
      status,
      code,
      path_class,
    })),
    [
      {
        attempt: 'opening',
        cdp_request_id: 'first-1',
        status: 402,
        code: 'guest_ai_allowance_used',
        path_class: 'canonical',
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
    'path_class',
    'request_at_utc',
    'status',
  ]);
  assert.equal(JSON.stringify(first).includes('do-not-retain'), false);
  assert.equal(JSON.stringify(first).includes('conversation-private-opening'), false);
  assert.equal(first[0].is_new, true);
  assert.match(first[0].conversation_fingerprint, /^[0-9a-f]{16}$/);

  watch.arm('post_reload_new_conversation');
  const observedBeforeWrongPrefix = watch.snapshot().length;
  events.emit(
    'Network.requestWillBeSent',
    {
      requestId: 'wrong-prefix',
      request: {
        method: 'POST',
        url: 'https://server.invalid/wrong/api/v2/ai/mandates/extend.browser_chat',
      },
    },
    'offscreen-session',
  );
  events.emit(
    'Network.responseReceived',
    {
      requestId: 'wrong-prefix',
      response: { status: 200 },
    },
    'offscreen-session',
  );
  assert.equal(
    watch.snapshot().length,
    observedBeforeWrongPrefix,
    'wrong_route_prefix_must_not_be_observed',
  );

  events.emit(
    'Network.requestWillBeSent',
    {
      requestId: 'second-2',
      request: {
        method: 'POST',
        url: 'https://server.invalid/api/v2/ai/mandates/extend.browser_chat',
      },
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
  assert.equal(
    watch.snapshot().find((request) => request.attempt === 'post_reload_new_conversation')
      ?.path_class,
    'versioned',
  );
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

// Break caught: package Chat's panel fetch can return an HTTP failure, an
// unfinished NDJSON body, or an error before end while the UI still has text.
test('package panel transport requires a correlated successful terminal NDJSON response', async () => {
  const events = new EventEmitter();
  const bodies = new Map();
  const calls = [];
  const panel = {
    async send(method, { requestId } = {}) {
      calls.push(method);
      if (method === 'Network.getResponseBody')
        return { body: bodies.get(requestId), base64Encoded: false };
      return {};
    },
    on(name, listener) {
      events.on(name, listener);
      return () => events.off(name, listener);
    },
  };
  const watch = await watchGuestAiRequests({
    panel,
    panelTarget: { url: 'chrome-extension://abc/sidepanel.html' },
    mode: 'package',
  });
  assert.deepEqual(calls, ['Network.enable']);
  const emit = async (id, status, body, label) => {
    watch.arm(label);
    bodies.set(id, body);
    events.emit('Network.requestWillBeSent', {
      requestId: id,
      request: {
        method: 'POST',
        url: 'https://server.invalid/ai/mandates/extend.browser_chat',
        postData: JSON.stringify({ conversation_id: `private-${id}`, is_new: true }),
      },
    });
    events.emit('Network.responseReceived', { requestId: id, response: { status } });
    events.emit('Network.loadingFinished', { requestId: id });
    await watch.settle();
  };
  await emit('refused', 402, JSON.stringify({ error: 'guest_ai_allowance_used' }), 'refused');
  await emit(
    'unfinished',
    200,
    '{"event":"chunk","data":{"text":"plausible answer"}}\n',
    'unfinished',
  );
  await emit(
    'errored',
    200,
    '{"event":"error","data":{"message":"failed"}}\n{"event":"end","data":{"reason":"complete"}}\n',
    'errored',
  );
  await emit(
    'complete',
    200,
    '{"event":"init","data":{"operation":"user_request","operation_id":"private-operation"}}\n{"event":"completion","data":{"operation":"user_request","operation_id":"private-operation","status":"success"}}\n{"event":"end","data":{"reason":"complete"}}\n',
    'complete',
  );
  const rows = watch.snapshot();
  for (const label of ['refused', 'unfinished', 'errored']) {
    assert.throws(
      () => requireGuestTransport(rows, label, 'package'),
      new RegExp(`${label}_guest_ai_transport_unobserved`),
    );
  }
  requireGuestTransport(rows, 'complete', 'package');
  assert.equal(rows.find((row) => row.attempt === 'complete').terminal_success, true);
  assert.equal(rows.find((row) => row.attempt === 'errored').stream_error, true);
  assert.equal(JSON.stringify(rows).includes('plausible answer'), false);
  assert.equal(JSON.stringify(rows).includes('private-'), false);
  await watch.stop();
});

// Break caught: package Chat sends a persisted second turn to the conversation
// URL, so the observer must capture its own terminal stream and URL identity.
test('package observer proves a persisted follow-up on the conversation route', async () => {
  const events = new EventEmitter();
  const bodies = new Map();
  const panel = {
    async send(method, { requestId } = {}) {
      if (method === 'Network.getResponseBody')
        return { body: bodies.get(requestId), base64Encoded: false };
      return {};
    },
    on(name, listener) {
      events.on(name, listener);
      return () => events.off(name, listener);
    },
  };
  const watch = await watchGuestAiRequests({
    panel,
    panelTarget: { url: 'chrome-extension://abc/sidepanel.html' },
    mode: 'package',
  });
  const complete = (operation) =>
    `${JSON.stringify({ event: 'init', data: { operation: 'user_request', operation_id: operation } })}\n` +
    `${JSON.stringify({ event: 'completion', data: { operation: 'user_request', operation_id: operation, status: 'success' } })}\n` +
    `${JSON.stringify({ event: 'end', data: { reason: 'complete' } })}\n`;
  const emit = async ({ id, attempt, url, postData, body, status = 200 }) => {
    watch.arm(attempt);
    bodies.set(id, body);
    events.emit('Network.requestWillBeSent', {
      requestId: id,
      request: { method: 'POST', url, postData: JSON.stringify(postData) },
    });
    events.emit('Network.responseReceived', { requestId: id, response: { status } });
    events.emit('Network.loadingFinished', { requestId: id });
    await watch.settle();
  };
  await emit({
    id: 'opening',
    attempt: 'opening',
    url: 'https://server.invalid/ai/mandates/extend.browser_chat',
    postData: { conversation_id: 'private-conversation', is_new: true, store: true },
    body: complete('opening-operation'),
  });
  await emit({
    id: 'followup',
    attempt: 'same_conversation_followup',
    url: 'https://server.invalid/ai/conversations/private-conversation',
    postData: { user_input: 'private-question', stream: true, store: true },
    body: complete('followup-operation'),
  });
  await emit({
    id: 'reloaded',
    attempt: 'post_reload_new_conversation',
    url: 'https://server.invalid/ai/mandates/extend.browser_chat',
    postData: { conversation_id: 'private-new-conversation', is_new: true, store: true },
    body: complete('reloaded-operation'),
  });
  const rows = watch.snapshot();
  requireGuestTransport(rows, 'same_conversation_followup', 'package');
  requireGuestConversationSequence(rows);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].path_class, 'conversation');
  assert.equal(rows[1].is_new, false);
  assert.equal(rows[1].conversation_fingerprint, rows[0].conversation_fingerprint);
  assert.equal(rows[1].terminal_success, true);
  assert.throws(
    () => requireGuestConversationSequence([rows[0], { ...rows[1], is_new: true }, rows[2]]),
    /followup_must_continue_conversation/,
  );
  assert.throws(
    () =>
      requireGuestConversationSequence([
        rows[0],
        { ...rows[1], conversation_fingerprint: rows[2].conversation_fingerprint },
        rows[2],
      ]),
    /followup_must_keep_opening_conversation_identity/,
  );
  assert.throws(
    () =>
      requireGuestTransport(
        [rows[0], { ...rows[1], terminal_success: false }, rows[2]],
        'same_conversation_followup',
        'package',
      ),
    /same_conversation_followup_guest_ai_transport_unobserved/,
  );
  assert.equal(JSON.stringify(rows).includes('private-conversation'), false);
  assert.equal(JSON.stringify(rows).includes('private-question'), false);
  for (const [id, method, url] of [
    ['conversation-read', 'GET', 'https://server.invalid/ai/conversations/private-conversation'],
    [
      'neighboring-service',
      'POST',
      'https://server.invalid/other/ai/conversations/private-conversation',
    ],
    [
      'conversation-message',
      'POST',
      'https://server.invalid/ai/conversations/private-conversation/messages',
    ],
  ]) {
    watch.arm('same_conversation_followup');
    bodies.set(id, complete(`${id}-operation`));
    events.emit('Network.requestWillBeSent', {
      requestId: id,
      request: { method, url, postData: JSON.stringify({ stream: true }) },
    });
    events.emit('Network.responseReceived', { requestId: id, response: { status: 200 } });
    events.emit('Network.loadingFinished', { requestId: id });
    await watch.settle();
  }
  assert.equal(watch.snapshot().length, 3, 'unrelated conversation reads and paths stay excluded');
  await emit({
    id: 'contradictory-followup',
    attempt: 'contradictory_followup',
    url: 'https://server.invalid/ai/conversations/private-conversation',
    postData: {
      conversation_id: 'private-new-conversation',
      is_new: false,
      user_input: 'private-question',
      stream: true,
      store: true,
    },
    body: complete('contradictory-operation'),
  });
  const contradictory = watch.snapshot().at(-1);
  assert.equal(contradictory.path_class, 'conversation');
  assert.equal(contradictory.terminal_success, true);
  assert.equal(contradictory.conversation_fingerprint, null);
  await watch.stop();
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
    request: { method: 'POST', url: 'https://server.invalid/ai/mandates/extend.browser_chat' },
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
    request: { method: 'POST', url: 'https://server.invalid/ai/mandates/extend.browser_chat' },
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
      request: { method: 'POST', url: 'https://server.invalid/ai/mandates/extend.browser_chat' },
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
      request: { method: 'POST', url: 'https://server.invalid/ai/mandates/extend.browser_chat' },
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
      request: { method: 'POST', url: 'https://server.invalid/ai/mandates/extend.browser_chat' },
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
                  url: 'https://server.invalid/ai/mandates/extend.browser_chat',
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

test('package observer waits across delegated EOF, real result delivery and correlated resume completion', async () => {
  const events = new EventEmitter();
  const bodies = new Map();
  const panel = {
    on: (name, listener) => {
      events.on(name, listener);
      return () => events.off(name, listener);
    },
    send: async (method, { requestId } = {}) =>
      method === 'Network.getResponseBody'
        ? { body: bodies.get(requestId), base64Encoded: false }
        : {},
  };
  const watch = await watchGuestAiRequests({
    panel,
    panelTarget: { url: 'chrome-extension://abc/sidepanel.html' },
    mode: 'package',
  });
  watch.arm('opening');
  const emit = async (id, path, body, postData = {}) => {
    bodies.set(id, body);
    events.emit('Network.requestWillBeSent', {
      requestId: id,
      request: {
        method: 'POST',
        url: `https://server.invalid${path}`,
        postData: JSON.stringify({
          conversation_id: 'private-conversation',
          is_new: true,
          ...postData,
        }),
      },
    });
    events.emit('Network.responseReceived', { requestId: id, response: { status: 200 } });
    events.emit('Network.loadingFinished', { requestId: id });
    await watch.settle();
  };
  await emit(
    'start',
    '/ai/mandates/extend.browser_chat',
    [
      {
        event: 'tool_event',
        data: { event: 'tool_delegated', call_id: 'private-call', tool_name: 'get_page_text' },
      },
      { event: 'end', data: { reason: 'complete' } },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n'),
  );
  assert.equal(watch.snapshot()[0].terminal_success, false, 'transport EOF is not request success');
  assert.equal(watch.snapshot()[0].pending_tool_count, 1);
  await emit(
    'unrelated-resume',
    '/ai/conversations/another-conversation/resume',
    [
      { event: 'init', data: { operation: 'user_request', operation_id: 'private-operation' } },
      {
        event: 'completion',
        data: { operation: 'user_request', operation_id: 'private-operation', status: 'success' },
      },
      { event: 'end', data: { reason: 'complete' } },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n'),
  );
  assert.equal(
    watch.snapshot()[0].terminal_success,
    false,
    'another conversation cannot finish this tool call',
  );
  assert.equal(watch.snapshot()[0].resume_count, 0);

  await emit(
    'result',
    '/ai/conversations/private-conversation/tool_results',
    JSON.stringify({ resolved: ['private-call'], continuation_needed: true }),
    { results: [{ call_id: 'private-call', output: { text: 'private-tool-output' } }] },
  );
  assert.equal(
    watch.snapshot()[0].terminal_success,
    false,
    'accepted tool output still needs resumed answer',
  );
  assert.equal(watch.snapshot()[0].pending_tool_count, 0);
  await emit(
    'resume',
    '/ai/conversations/private-conversation/resume',
    [
      { event: 'init', data: { operation: 'user_request', operation_id: 'private-operation' } },
      {
        event: 'completion',
        data: { operation: 'user_request', operation_id: 'private-operation', status: 'success' },
      },
      { event: 'end', data: { reason: 'complete' } },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n'),
  );
  const rows = watch.snapshot();
  assert.equal(rows.length, 1, 'continuations belong to the opening turn, never extra user sends');
  assert.equal(rows[0].terminal_success, true);
  assert.equal(rows[0].semantic_completion, 'success');
  assert.equal(rows[0].resume_count, 1);
  assert.equal(rows[0].tool_result_successes, 1);
  assert.equal(JSON.stringify(rows).includes('private-'), false);

  watch.arm('same_conversation_followup');
  await emit(
    'failed-turn',
    '/ai/mandates/extend.browser_chat',
    [
      { event: 'init', data: { operation: 'user_request', operation_id: 'private-operation' } },
      {
        event: 'completion',
        data: { operation: 'user_request', operation_id: 'private-operation', status: 'failed' },
      },
      { event: 'end', data: { reason: 'complete' } },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n'),
    { is_new: false },
  );
  assert.equal(watch.snapshot()[1].semantic_completion, 'failed');
  assert.equal(watch.snapshot()[1].terminal_success, false);
  assert.equal(watch.snapshot()[1].stream_error, true);
  await watch.stop();
});

for (const scenario of [
  'missing_result',
  'failed_result',
  'missing_resume',
  'failed_resume',
  'stale_completion',
]) {
  test(`delegated package turn refuses ${scenario} despite optimistic start success`, async () => {
    const events = new EventEmitter();
    const bodies = new Map();
    const panel = {
      on(name, listener) {
        events.on(name, listener);
        return () => events.off(name, listener);
      },
      async send(method, { requestId } = {}) {
        return method === 'Network.getResponseBody'
          ? { body: bodies.get(requestId), base64Encoded: false }
          : {};
      },
    };
    const watch = await watchGuestAiRequests({
      panel,
      panelTarget: { url: 'chrome-extension://abc/sidepanel.html' },
      mode: 'package',
    });
    watch.arm('opening');
    const emit = async (id, path, rows, status = 200) => {
      bodies.set(
        id,
        Array.isArray(rows)
          ? rows.map((row) => JSON.stringify(row)).join('\n')
          : JSON.stringify(rows),
      );
      events.emit('Network.requestWillBeSent', {
        requestId: id,
        request: {
          method: 'POST',
          url: `https://server.invalid${path}`,
          postData: JSON.stringify({ conversation_id: 'private-conversation', is_new: true }),
        },
      });
      events.emit('Network.responseReceived', { requestId: id, response: { status } });
      events.emit('Network.loadingFinished', { requestId: id });
      await watch.settle();
    };
    await emit('start', '/ai/mandates/extend.browser_chat', [
      { event: 'tool_event', data: { event: 'tool_delegated', call_id: 'private-call' } },
      { event: 'tool_event', data: { event: 'tool_completed', call_id: 'private-call' } },
      { event: 'init', data: { operation: 'user_request', operation_id: 'private-operation' } },
      {
        event: 'completion',
        data: { operation: 'user_request', operation_id: 'private-operation', status: 'success' },
      },
      { event: 'end', data: { reason: 'complete' } },
    ]);
    if (scenario !== 'missing_result')
      await emit(
        'result',
        '/ai/conversations/private-conversation/tool_results',
        { resolved: ['private-call'], not_found: [], continuation_needed: true },
        scenario === 'failed_result' ? 500 : 200,
      );
    if (scenario === 'stale_completion')
      await emit('resume', '/ai/conversations/private-conversation/resume', [
        { event: 'end', data: { reason: 'complete' } },
      ]);
    if (['missing_result', 'failed_result'].includes(scenario))
      await emit(
        'resume-without-accepted-result',
        '/ai/conversations/private-conversation/resume',
        [
          { event: 'init', data: { operation: 'user_request', operation_id: 'private-operation' } },
          {
            event: 'completion',
            data: {
              operation: 'user_request',
              operation_id: 'private-operation',
              status: 'success',
            },
          },
          { event: 'end', data: { reason: 'complete' } },
        ],
      );
    if (scenario === 'failed_resume')
      await emit(
        'failed-resume',
        '/ai/conversations/private-conversation/resume',
        { error: 'resume_failed' },
        500,
      );
    assert.equal(
      watch.snapshot()[0].terminal_success,
      false,
      `${scenario} must not reuse optimistic start completion`,
    );
    await watch.stop();
  });
}

for (const scenario of ['missing_init', 'missing_operation_id', 'mismatched_operation_id']) {
  test(`package observer rejects ${scenario} for semantic completion`, async () => {
    const events = new EventEmitter();
    const rows = [
      ...(scenario === 'missing_init'
        ? []
        : [
            {
              event: 'init',
              data: { operation: 'user_request', operation_id: 'private-opening-operation' },
            },
          ]),
      {
        event: 'completion',
        data: {
          operation: 'user_request',
          status: 'success',
          ...(scenario === 'missing_operation_id'
            ? {}
            : {
                operation_id:
                  scenario === 'mismatched_operation_id'
                    ? 'private-unrelated-operation'
                    : 'private-opening-operation',
              }),
        },
      },
      { event: 'end', data: { reason: 'complete' } },
    ];
    const panel = {
      on(name, listener) {
        events.on(name, listener);
        return () => events.off(name, listener);
      },
      async send(method) {
        return method === 'Network.getResponseBody'
          ? { body: rows.map((row) => JSON.stringify(row)).join('\n'), base64Encoded: false }
          : {};
      },
    };
    const watch = await watchGuestAiRequests({
      panel,
      panelTarget: { url: 'chrome-extension://abc/sidepanel.html' },
      mode: 'package',
    });
    watch.arm('opening');
    events.emit('Network.requestWillBeSent', {
      requestId: 'op-start',
      request: {
        method: 'POST',
        url: 'https://server.invalid/ai/mandates/extend.browser_chat',
        postData: JSON.stringify({ conversation_id: 'private-conversation', is_new: true }),
      },
    });
    events.emit('Network.responseReceived', { requestId: 'op-start', response: { status: 200 } });
    events.emit('Network.loadingFinished', { requestId: 'op-start' });
    await watch.settle();
    assert.equal(
      watch.snapshot()[0].terminal_success,
      false,
      `${scenario} cannot complete this user request`,
    );
    assert.equal(JSON.stringify(watch.snapshot()).includes('private-'), false);
    await watch.stop();
  });
}
