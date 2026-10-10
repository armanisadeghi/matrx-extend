import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { observeNativeAiDelegatedResult } from './native-ai-delegated-observer.mjs';

const serverOrigin = 'https://server.app.matrxserver.com';
const endpoint = `${serverOrigin}/ai/conversations/72336a38-f816-442f-ad48-18610128fb67/tool_results`;

function fixture() {
  const events = new EventEmitter();
  const bodies = new Map();
  const worker = {
    on(name, listener) {
      events.on(name, listener);
      return () => events.off(name, listener);
    },
    async send(method, { requestId }) {
      assert.equal(method, 'Network.getRequestPostData');
      return { postData: bodies.get(requestId) };
    },
  };
  const request = (requestId, method, url, result, inline = true, authenticated = true) => {
    const body = JSON.stringify({ results: [{ call_id: 'owned-call', ...result }] });
    bodies.set(requestId, body);
    events.emit('Network.requestWillBeSent', {
      requestId,
      request: {
        method,
        url,
        headers: authenticated ? { Authorization: 'Bearer private-token' } : {},
        ...(inline ? { postData: body } : {}),
      },
    });
  };
  const response = (requestId, status) =>
    events.emit('Network.responseReceived', { requestId, response: { status } });
  const finish = (requestId) => events.emit('Network.loadingFinished', { requestId });
  return { events, worker, request, response, finish };
}

test('native AI observer accepts only a fresh canonical ai result on exact POST and strips payload', async () => {
  const fake = fixture();
  const observer = observeNativeAiDelegatedResult(fake.worker, serverOrigin);
  const result = {
    tool_name: 'ai',
    output: { ok: false, availability: 'unavailable', secret: 'private' },
  };
  fake.request('old', 'POST', endpoint, result);
  fake.response('old', 200);
  assert.equal((await observer.read()).posted, false);
  observer.arm();
  observer.expectCallId('owned-call');
  fake.request('wrong-method', 'GET', endpoint, result);
  fake.response('wrong-method', 200);
  fake.request('wrong-path', 'POST', `${endpoint}/other`, result);
  fake.response('wrong-path', 200);
  fake.request('other-tool', 'POST', endpoint, { tool_name: 'tabs', output: { ok: true } });
  fake.response('other-tool', 200);
  fake.request('wrong-call', 'POST', endpoint, { ...result, call_id: 'other-call' });
  fake.response('wrong-call', 200);
  fake.finish('wrong-call');
  assert.equal((await observer.read()).posted, false);
  fake.request('correct', 'POST', endpoint, result, false);
  fake.response('correct', 200);
  assert.equal((await observer.read()).posted, false, 'response alone is incomplete');
  fake.finish('correct');
  const observed = await observer.read();
  assert.deepEqual(observed, {
    posted: true,
    canonical_ai_tool: true,
    is_error: false,
    output_present: true,
    output_ok: false,
    output_unavailable: true,
    http_status: 200,
    authenticated: true,
    finished: true,
  });
  assert.equal(JSON.stringify(observed).includes('private'), false);
  observer.stop();
  assert.equal(fake.events.listenerCount('Network.requestWillBeSent'), 0);
  assert.equal(fake.events.listenerCount('Network.responseReceived'), 0);
  assert.equal(fake.events.listenerCount('Network.loadingFinished'), 0);
});

test('native AI observer reports the accepted error envelope without inferring unavailability', async () => {
  const fake = fixture();
  const observer = observeNativeAiDelegatedResult(fake.worker, serverOrigin);
  observer.arm();
  observer.expectCallId('owned-call');
  fake.request('handler-error', 'POST', endpoint, {
    tool_name: 'ai',
    output: null,
    is_error: true,
    error_message: 'private failure detail',
  });
  fake.response('handler-error', 200);
  fake.finish('handler-error');
  assert.deepEqual(await observer.read(), {
    posted: true,
    canonical_ai_tool: true,
    is_error: true,
    output_present: false,
    output_ok: false,
    output_unavailable: false,
    http_status: 200,
    authenticated: true,
    finished: true,
  });
  observer.stop();
});

test('native AI observer refuses leaf-only, failed transport, and duplicate result attribution', async () => {
  for (const [result, status, expected] of [
    [
      { tool_name: 'ai_summarize', output: { ok: true } },
      200,
      { posted: true, canonical_ai_tool: false },
    ],
    [{ tool_name: 'ai', output: { ok: true } }, 500, { posted: false, canonical_ai_tool: true }],
  ]) {
    const fake = fixture();
    const observer = observeNativeAiDelegatedResult(fake.worker, serverOrigin);
    observer.arm();
    observer.expectCallId('owned-call');
    fake.request('current', 'POST', endpoint, result);
    fake.response('current', status);
    fake.finish('current');
    assert.deepEqual(
      {
        posted: (await observer.read()).posted,
        canonical_ai_tool: (await observer.read()).canonical_ai_tool,
      },
      expected,
    );
    observer.stop();
  }
  const fake = fixture();
  const observer = observeNativeAiDelegatedResult(fake.worker, serverOrigin);
  observer.arm();
  observer.expectCallId('owned-call');
  fake.events.emit('Network.requestWillBeSent', {
    requestId: 'duplicate',
    request: {
      method: 'POST',
      url: endpoint,
      headers: { Authorization: 'Bearer private-token' },
      postData: JSON.stringify({
        results: [
          { call_id: 'owned-call', tool_name: 'ai', output: { ok: true } },
          { call_id: 'owned-call', tool_name: 'ai', output: { ok: true } },
        ],
      }),
    },
  });
  fake.response('duplicate', 200);
  fake.finish('duplicate');
  assert.equal((await observer.read()).posted, false);
  observer.stop();
});

test('native AI observer waits for accepted retry after a failed result POST', async () => {
  const fake = fixture();
  const observer = observeNativeAiDelegatedResult(fake.worker, serverOrigin);
  observer.arm();
  observer.expectCallId('owned-call');
  const result = { tool_name: 'ai', output: { ok: false, availability: 'unavailable' } };
  fake.request('first', 'POST', endpoint, result);
  fake.response('first', 500);
  fake.finish('first');
  assert.equal((await observer.read()).posted, false);
  fake.request('retry', 'POST', endpoint, result);
  fake.response('retry', 200);
  fake.finish('retry');
  assert.equal((await observer.read()).posted, true);
  observer.stop();
});

test('native AI observer refuses wrong backend origin and unauthenticated result POST', async () => {
  assert.throws(
    () => observeNativeAiDelegatedResult(fixture().worker, ''),
    /native_ai_backend_origin_unverified/,
  );
  const fake = fixture();
  const observer = observeNativeAiDelegatedResult(fake.worker, serverOrigin);
  observer.arm();
  observer.expectCallId('owned-call');
  const result = { tool_name: 'ai', output: { ok: true } };
  fake.request(
    'wrong-origin',
    'POST',
    endpoint.replace(serverOrigin, 'https://wrong.example'),
    result,
  );
  fake.response('wrong-origin', 200);
  fake.finish('wrong-origin');
  assert.equal((await observer.read()).posted, false);
  fake.request('no-auth', 'POST', endpoint, result, true, false);
  fake.response('no-auth', 200);
  fake.finish('no-auth');
  const observed = await observer.read();
  assert.equal(observed.posted, false);
  assert.equal(observed.authenticated, false);
  observer.stop();
});
