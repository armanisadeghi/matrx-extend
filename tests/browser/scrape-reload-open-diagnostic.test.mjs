import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  refuseDiagnosticAcceptance,
  reloadOpenEvidenceClass,
  startScrapeReloadOpenDiagnostic,
} from './scrape-reload-open-diagnostic.mjs';

test('worker probe is opt-in and its receipt cannot earn acceptance credit', () => {
  const ordinary = { status: 'passed', failure: null };
  assert.equal(reloadOpenEvidenceClass(false).evidence_class, 'acceptance_eligible');
  assert.equal(refuseDiagnosticAcceptance(ordinary, false), false);
  assert.equal(ordinary.status, 'passed');
  const diagnostic = { status: 'passed', failure: null };
  assert.equal(reloadOpenEvidenceClass(true).evidence_class, 'diagnostic_only');
  assert.equal(refuseDiagnosticAcceptance(diagnostic, true), true);
  assert.deepEqual(diagnostic, {
    status: 'unverified',
    failure: { stage: 'extension_reload', code: 'diagnostic_only_perturbed_worker' },
  });
});

function cdptarget(open) {
  const listeners = [];
  const chrome = {
    runtime: {
      onMessageExternal: {
        addListener(listener) {
          listeners.push(listener);
        },
        removeListener(listener) {
          listeners.splice(listeners.indexOf(listener), 1);
        },
      },
    },
    sidePanel: { open },
  };
  const original = chrome.sidePanel.open;
  // Existing extension listener runs first, as it does in the real worker.
  listeners.push((message) => {
    if (message.action === 'openPanel') chrome.sidePanel.open({ windowId: 7 });
  });
  const context = { chrome };
  const calls = [];
  const cdp = {
    async send(method, params, sessionId) {
      calls.push(method);
      if (method === 'Target.attachToTarget') return { sessionId: 'owned-worker-session' };
      if (method === 'Target.detachFromTarget') {
        assert.equal(sessionId, undefined);
        return {};
      }
      assert.equal(method, 'Runtime.evaluate');
      assert.equal(sessionId, 'owned-worker-session');
      return { result: { value: runInNewContext(params.expression, context) } };
    },
  };
  return {
    cdp,
    chrome,
    original,
    listeners,
    calls,
    deliver(message) {
      for (const listener of [...listeners]) listener(message);
    },
  };
}

test('observer records actual worker ingress and open settlement, then restores worker hooks', async () => {
  const worker = cdptarget(() => Promise.resolve());
  const diagnostic = await startScrapeReloadOpenDiagnostic(worker.cdp, 'replacement-worker');
  worker.deliver({
    channel: 'FRONTEND_RPC',
    action: 'openPanel',
    requestId: 'native-sidepanel-qa',
  });
  await Promise.resolve();
  const evidence = await diagnostic.close();
  assert.equal(evidence.availability, 'ready');
  assert.equal(evidence.ingress, true);
  assert.equal(evidence.open_invoked, true);
  assert.equal(evidence.open_settlement, 'resolved');
  assert.equal(evidence.send_response, 'unobservable_without_instrumented_build');
  assert.equal(worker.chrome.sidePanel.open, worker.original);
  assert.equal(worker.listeners.length, 1);
  assert.deepEqual(worker.calls.at(-1), 'Target.detachFromTarget');
});

test('nonmatching worker traffic cannot be reported as request ingress', async () => {
  const worker = cdptarget(() => Promise.reject(new Error('private token')));
  const diagnostic = await startScrapeReloadOpenDiagnostic(worker.cdp, 'replacement-worker');
  worker.deliver({ channel: 'FRONTEND_RPC', action: 'openPanel', requestId: 'another-request' });
  await Promise.resolve();
  const evidence = await diagnostic.close();
  assert.equal(evidence.ingress, false);
  assert.equal(evidence.open_invoked, true);
  assert.equal(evidence.open_settlement, 'rejected');
  assert.doesNotMatch(JSON.stringify(evidence), /private|token/);
});

test('observer detaches after failed installation and reports unavailable evidence', async () => {
  const calls = [];
  const cdp = {
    async send(method) {
      calls.push(method);
      if (method === 'Target.attachToTarget') return { sessionId: 'owned-worker-session' };
      if (method === 'Runtime.evaluate') throw new Error('private URL token');
      return {};
    },
  };
  const diagnostic = await startScrapeReloadOpenDiagnostic(cdp, 'replacement-worker');
  const evidence = await diagnostic.close();
  assert.notEqual(evidence.availability, 'ready');
  assert.equal(evidence.ingress, false);
  assert.deepEqual(calls.at(-1), 'Target.detachFromTarget');
  assert.doesNotMatch(JSON.stringify(evidence), /private|token/);
});
