'use strict';
const assert = require('node:assert/strict');
const { createVaultNetworkJournal } = require('./vault-network-journal.cjs');
const API = 'https://server.app.matrxserver.com';

class Flat {
  constructor() {
    this.listeners = new Map();
    this.calls = [];
    this.fatal = false;
    this.plans = [];
    this.heldDetaches = [];
    this.holdDetach = false;
    this.networkGates = new Map();
    this.networkReleases = new Map();
    this.failDetach = new Set();
  }
  on(method, listener) {
    this.listeners.set(method, listener);
  }
  off(method, listener) {
    if (this.listeners.get(method) === listener) this.listeners.delete(method);
  }
  emit(method, params, sessionId) {
    this.listeners.get(method)?.(params, sessionId);
  }
  plan(plan) {
    this.plans.push(plan);
  }
  gateNetwork(sessionId) {
    this.networkGates.set(sessionId, true);
  }
  releaseNetwork(sessionId) {
    this.networkReleases.get(sessionId)?.();
  }
  emitAttach(plan) {
    this.emit('Target.attachedToTarget', {
      sessionId: plan.sessionId,
      targetInfo: { targetId: plan.actualTargetId ?? plan.targetId, type: plan.type ?? 'page' },
      waitingForDebugger: true,
    });
  }
  async send(method, params = {}, sessionId) {
    this.calls.push({ method, params, sessionId });
    if (
      method === 'Target.setAutoAttach' &&
      params.autoAttach === false &&
      Object.hasOwn(params, 'filter')
    )
      throw new Error('no_disable_filter');
    if (method === 'Network.enable' && this.networkGates.has(sessionId)) {
      return new Promise((resolve) =>
        this.networkReleases.set(sessionId, () => {
          this.networkGates.delete(sessionId);
          resolve({});
        }),
      );
    }
    if (method === 'Target.attachToTarget') {
      const plan = this.plans.shift();
      if (!plan) throw new Error('missing_plan');
      if (plan.before) this.emitAttach(plan);
      if (plan.raceAuto) this.emitAttach(plan.raceAuto);
      if (!plan.before && !plan.missing) queueMicrotask(() => this.emitAttach(plan));
      return { sessionId: plan.sessionId };
    }
    if (method === 'Target.detachFromTarget') {
      if (this.failDetach.has(params.sessionId)) throw new Error('detach_refused');
      if (this.holdDetach) this.heldDetaches.push(params.sessionId);
      else
        queueMicrotask(() =>
          this.emit('Target.detachedFromTarget', { sessionId: params.sessionId }),
        );
    }
    return {};
  }
  flushDetaches() {
    for (const sessionId of this.heldDetaches.splice(0))
      this.emit('Target.detachedFromTarget', { sessionId });
  }
  async detach() {
    this.closed = true;
  }
}
const newJournal = (cdp) =>
  createVaultNetworkJournal({ cdp, apiOrigin: API, ownedLocalOrigin: 'http://127.0.0.1:40123' });
const request = (cdp, session, id, url, method = 'GET') =>
  cdp.emit('Network.requestWillBeSent', { requestId: id, request: { url, method } }, session);
const response = (cdp, session, id, status) =>
  cdp.emit('Network.responseReceived', { requestId: id, response: { status } }, session);

(async () => {
  const cdp = new Flat(),
    journal = newJournal(cdp);
  await journal.start();
  assert.deepEqual(cdp.calls[0].params.filter, [{ type: 'page' }, { exclude: true }]);

  cdp.plan({ sessionId: 'before', targetId: 'panel', before: true });
  const first = await journal.bindPanelTarget('panel');
  assert.equal(first.sessionId, 'before');
  assert.deepEqual(
    cdp.calls.slice(1, 4).map((call) => [call.method, call.sessionId]),
    [
      ['Target.attachToTarget', undefined],
      ['Network.enable', 'before'],
      ['Runtime.runIfWaitingForDebugger', 'before'],
    ],
  );
  request(cdp, 'before', 'old', API + '/api/vault/items');
  response(cdp, 'before', 'old', 204);
  await journal.assertCoverage();

  cdp.plan({ sessionId: 'after', targetId: 'panel-two' });
  const second = await journal.bindPanelTarget('panel-two');
  assert.equal(second.sessionId, 'after');
  request(cdp, 'after', 'new', API + '/api/vault/items');
  response(cdp, 'after', 'new', 200);
  await journal.assertCoverage();

  const concurrentA = journal.bindPanelTarget('panel-two');
  const concurrentB = journal.bindPanelTarget('panel-two');
  assert.strictEqual(concurrentA, concurrentB);
  await concurrentA;
  await assert.rejects(() => journal.assertCoverage(), /sentinel/);
  request(cdp, 'after', 'fresh', API + '/api/vault/items');
  response(cdp, 'after', 'fresh', 200);
  await journal.assertCoverage();

  cdp.plan({
    sessionId: 'manual',
    targetId: 'raced',
    before: true,
    raceAuto: { sessionId: 'automatic', targetId: 'raced' },
  });
  const raced = await journal.bindPanelTarget('raced');
  assert.equal(raced.sessionId, 'manual');
  assert.ok(
    cdp.calls.some(
      (call) => call.method === 'Target.detachFromTarget' && call.params.sessionId === 'automatic',
    ),
  );
  await journal.settle();
  assert.equal(journal.snapshot().boundTargetSessionCount, 1);

  cdp.gateNetwork('inverse-manual');
  cdp.plan({
    sessionId: 'inverse-manual',
    targetId: 'inverse',
    before: true,
    raceAuto: { sessionId: 'inverse-auto', targetId: 'inverse' },
  });
  const inverseBind = journal.bindPanelTarget('inverse');
  await new Promise((resolve) => setImmediate(resolve));
  cdp.releaseNetwork('inverse-manual');
  const inverse = await inverseBind;
  assert.equal(inverse.sessionId, 'inverse-auto');
  assert.ok(
    cdp.calls.some(
      (call) =>
        call.method === 'Target.detachFromTarget' && call.params.sessionId === 'inverse-manual',
    ),
  );

  cdp.plan({ sessionId: 'late-manual', targetId: 'late' });
  await journal.bindPanelTarget('late');
  cdp.holdDetach = true;
  cdp.emitAttach({ sessionId: 'late-auto', targetId: 'late' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    cdp.calls.some(
      (call) => call.method === 'Target.detachFromTarget' && call.params.sessionId === 'late-auto',
    ),
  );
  request(cdp, 'late-auto', 'duplicate-write', API + '/api/vault/items', 'POST');
  request(cdp, 'late-manual', 'canonical-write', API + '/api/vault/items', 'POST');
  assert.equal(journal.snapshot().vaultMutationRequests, 1);
  assert.equal(journal.snapshot().boundTargetCountingSessionCount, 1);
  cdp.flushDetaches();
  cdp.holdDetach = false;
  await journal.settle();
  assert.equal(journal.snapshot().boundTargetSessionCount, 1);

  const mismatchCdp = new Flat(),
    mismatch = newJournal(mismatchCdp);
  await mismatch.start();
  mismatchCdp.plan({ sessionId: 'wrong', targetId: 'wanted', actualTargetId: 'other' });
  await assert.rejects(() => mismatch.bindPanelTarget('wanted'), /mismatch/);
  mismatchCdp.emit('Target.detachedFromTarget', { sessionId: 'wrong' });
  await mismatch.dispose().catch(() => {});

  const missingCdp = new Flat(),
    missing = newJournal(missingCdp);
  await missing.start();
  missingCdp.plan({ sessionId: 'missing', targetId: 'missing-target', missing: true });
  await assert.rejects(() => missing.bindPanelTarget('missing-target'), /attach_timeout/);
  await missing.dispose().catch(() => {});

  const duplicateCdp = new Flat(),
    duplicate = newJournal(duplicateCdp);
  await duplicate.start();
  duplicateCdp.emitAttach({ sessionId: 'one-event', targetId: 'duplicate' });
  duplicateCdp.emitAttach({ sessionId: 'one-event', targetId: 'duplicate' });
  await duplicate.settle();
  await assert.rejects(() => duplicate.assertCoverage(), /observer/);
  duplicateCdp.emit('Target.detachedFromTarget', { sessionId: 'one-event' });
  await duplicate.dispose().catch(() => {});

  const cleanupCdp = new Flat(),
    cleanup = newJournal(cleanupCdp);
  await cleanup.start();
  cleanupCdp.plan({ sessionId: 'manual-cleanup', targetId: 'close-me' });
  await cleanup.bindPanelTarget('close-me');
  await cleanup.dispose();
  assert.ok(
    cleanupCdp.calls.some(
      (call) =>
        call.method === 'Target.detachFromTarget' && call.params.sessionId === 'manual-cleanup',
    ),
  );
  assert.equal(cleanupCdp.closed, true);

  const failedDetachCdp = new Flat(),
    failedDetach = newJournal(failedDetachCdp);
  await failedDetach.start();
  failedDetachCdp.plan({ sessionId: 'failure-manual', targetId: 'failure' });
  await failedDetach.bindPanelTarget('failure');
  failedDetachCdp.failDetach.add('failure-auto');
  failedDetachCdp.emitAttach({ sessionId: 'failure-auto', targetId: 'failure' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failedDetach.snapshot().observerError, true);
  failedDetachCdp.emit('Target.detachedFromTarget', { sessionId: 'failure-auto' });
  await failedDetach.dispose().catch(() => {});

  // These emulate page targets closed by Chrome before the journal cleanup starts.
  cdp.emit('Target.detachedFromTarget', { sessionId: 'before' });
  cdp.emit('Target.detachedFromTarget', { sessionId: 'after' });
  cdp.emit('Target.detachedFromTarget', { sessionId: 'manual' });
  cdp.emit('Target.detachedFromTarget', { sessionId: 'inverse-auto' });
  cdp.emit('Target.detachedFromTarget', { sessionId: 'late-manual' });
  await journal.dispose();
  assert.equal(cdp.closed, true);
  assert.deepEqual(cdp.calls.findLast((call) => call.method === 'Target.setAutoAttach').params, {
    autoAttach: false,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  process.stdout.write(
    'PASS: explicit panel binds correlate sessions, reset epochs, and clean manual observers\n',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
