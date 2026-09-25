'use strict';
const assert = require('node:assert/strict');
const { createVaultSaveResponseLoss } = require('./vault-save-response-loss.cjs');
const API = 'https://server.app.matrxserver.com';
const WORKER = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/background.js';
const FIRST = '11111111-1111-4111-8111-111111111111';
const CHANGED = '22222222-2222-4222-8222-222222222222';
const FIXTURES = new Set([
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
]);
class Context {
  async route(url, handler) {
    this.url = url;
    this.handler = handler;
  }
  async unroute(url, handler) {
    assert.equal(url, this.url);
    assert.equal(handler, this.handler);
    if (this.unrouteError) throw new Error('unroute');
    this.unrouted = true;
  }
  dispatch(route, req) {
    return this.handler(route, req);
  }
}
const request = (key) => ({
  method: () => 'POST',
  headers: () => ({ 'idempotency-key': key }),
  serviceWorker: () => ({ url: () => WORKER }),
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const route = ({ status = 201, fetchGate, abortFails = false, disposeFails = false } = {}) => ({
  fetchCalls: [],
  abortCalls: 0,
  continueCalls: 0,
  async fetch(options) {
    this.fetchCalls.push(options);
    if (fetchGate) await fetchGate.promise;
    return {
      status: () => status,
      dispose: async () => {
        if (disposeFails) throw new Error('dispose');
      },
    };
  },
  async abort() {
    this.abortCalls += 1;
    if (abortFails) throw new Error('abort');
  },
  async continue() {
    this.continueCalls += 1;
  },
});
const create = (context, callback = () => {}) =>
  createVaultSaveResponseLoss({
    context,
    apiOrigin: API,
    exactExtensionWorkerUrl: WORKER,
    existingFixtureKeys: FIXTURES,
    onRejectedBeforeForwardKey: callback,
  });

async function lossThenExplicitSameKeyRetry() {
  const context = new Context(),
    interceptor = create(context);
  await interceptor.install();
  const first = route();
  await context.dispatch(first, request(FIRST));
  await interceptor.waitForFirstLoss(50);
  assert.deepEqual(first.fetchCalls, [{ maxRetries: 0, maxRedirects: 0, timeout: 15_000 }]);
  assert.equal(first.abortCalls, 1);
  interceptor.allowExplicitRetry();
  const retry = route();
  await context.dispatch(retry, request(FIRST));
  assert.equal(retry.fetchCalls.length, 0);
  assert.equal(retry.continueCalls, 1);
  interceptor.assertCompleted();
  await interceptor.dispose();
  assert.equal(context.unrouted, true);
}
async function abortFailureNeverExcludesKey() {
  const context = new Context(),
    rejected = [];
  const interceptor = create(context, async (key) => rejected.push(key));
  await interceptor.install();
  await context.dispatch(route(), request(FIRST));
  await interceptor.waitForFirstLoss(50);
  interceptor.allowExplicitRetry();
  const bad = route({ abortFails: true });
  await context.dispatch(bad, request(CHANGED));
  assert.equal(bad.abortCalls, 1);
  assert.deepEqual(rejected, [], 'abort failure must not exclude key');
  assert.equal(interceptor.snapshot().rejectedBeforeForwardCallbacks, 0);
  await assert.rejects(interceptor.dispose(), /response_loss_retry_key_changed/);
}
async function fixtureSetIsCloned() {
  const context = new Context(),
    keys = new Set(FIXTURES),
    interceptor = createVaultSaveResponseLoss({
      context,
      apiOrigin: API,
      exactExtensionWorkerUrl: WORKER,
      existingFixtureKeys: keys,
    });
  keys.add(FIRST);
  await interceptor.install();
  await context.dispatch(route(), request(FIRST));
  await interceptor.waitForFirstLoss(50);
  assert.equal(interceptor.snapshot().firstForwarded, true);
  await interceptor.dispose();
}
async function concurrentFirstNeverDoubleForwards() {
  const context = new Context(),
    rejected = [],
    gate = deferred(),
    interceptor = create(context, async (key) => rejected.push(key));
  await interceptor.install();
  const first = route({ fetchGate: gate });
  const firstPending = context.dispatch(first, request(FIRST));
  const concurrent = route();
  await context.dispatch(concurrent, request(CHANGED));
  assert.equal(concurrent.fetchCalls.length, 0, 'concurrent changed key must not be forwarded');
  assert.equal(concurrent.abortCalls, 1);
  assert.deepEqual(rejected, [CHANGED]);
  gate.resolve();
  await firstPending;
  await assert.rejects(interceptor.dispose(), /response_loss_retry_key_changed/);
}
async function ambiguityWakesWaiterAndRetainsOriginalKey() {
  const context = new Context(),
    rejected = [],
    interceptor = create(context, async (key) => rejected.push(key));
  await interceptor.install();
  const waiting = interceptor.waitForFirstLoss(5_000);
  await context.dispatch(route({ status: 500 }), request(FIRST));
  await assert.rejects(waiting, /response_loss_first_status_not_2xx/);
  const snapshot = interceptor.snapshot();
  assert.equal(snapshot.firstForwardAttempted, true);
  assert.equal(snapshot.forwardOutcomeAmbiguous, true);
  assert.deepEqual(rejected, []);
  await assert.rejects(interceptor.dispose(), /response_loss_first_status_not_2xx/);
}
async function handlerEnteringDuringDisposeAborts() {
  const context = new Context(),
    gate = deferred(),
    interceptor = create(context);
  await interceptor.install();
  const first = route({ fetchGate: gate });
  const pending = context.dispatch(first, request(FIRST));
  const disposing = interceptor.dispose();
  const late = route();
  await context.dispatch(late, request(CHANGED));
  assert.equal(late.abortCalls, 1);
  gate.resolve();
  await pending;
  await assert.rejects(disposing);
  assert.equal(context.unrouted, true);
}
async function exactUnrouteFailureIsReported() {
  const context = new Context();
  context.unrouteError = true;
  const interceptor = create(context);
  await interceptor.install();
  await assert.rejects(interceptor.dispose(), /response_loss_unroute_failed/);
  assert.equal(interceptor.snapshot().unrouteSucceeded, false);
}
async function disposeRejectsPendingLossWaiterImmediately() {
  const context = new Context(),
    interceptor = create(context);
  await interceptor.install();
  const waiting = interceptor.waitForFirstLoss(5_000);
  await assert.rejects(interceptor.dispose(), /response_loss_disposed/);
  await assert.rejects(waiting, /response_loss_disposed/);
}
(async () => {
  await lossThenExplicitSameKeyRetry();
  await abortFailureNeverExcludesKey();
  await fixtureSetIsCloned();
  await concurrentFirstNeverDoubleForwards();
  await ambiguityWakesWaiterAndRetainsOriginalKey();
  await handlerEnteringDuringDisposeAborts();
  await exactUnrouteFailureIsReported();
  await disposeRejectsPendingLossWaiterImmediately();
  process.stdout.write(
    'PASS: response loss preserves one real 2xx forward and rejects unsafe retry lifecycle states\n',
  );
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
