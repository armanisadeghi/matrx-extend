import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { cleanupD47Probe } from './showcase-d47-driver-evidence.mjs';
import {
  installPassiveWorkerProbe,
  removePassiveWorkerProbe,
} from './showcase-d47-worker-probe.mjs';

function workerHarness({ acknowledge = true, execute = true, removeWorks = true } = {}) {
  const listeners = new Set();
  const calls = [];
  const context = createContext({
    chrome: {
      debugger: {
        onEvent: {
          addListener: (listener) => listeners.add(listener),
          removeListener: (listener) => {
            if (removeWorks) listeners.delete(listener);
          },
          hasListener: (listener) => listeners.has(listener),
        },
      },
    },
  });
  const worker = {
    async send(method, args) {
      calls.push(method);
      if (method === 'Runtime.enable') return {};
      const firstEvaluation = calls.filter((call) => call === 'Runtime.evaluate').length === 1;
      if (!execute && firstEvaluation) throw new Error('evaluation_unavailable');
      const value = runInContext(args.expression, context);
      if (!acknowledge && firstEvaluation) throw new Error('ack_lost');
      return { result: { value } };
    },
    async detach() {
      calls.push('detach');
    },
  };
  return { worker, listeners, calls, context };
}

test('an applied probe with lost acknowledgement is removed before detach', async () => {
  const { worker, listeners, calls, context } = workerHarness({ acknowledge: false });
  let attempted = false;
  let primary;
  const installer =
    process.env.D47_PROBE_MUTANT === 'ack_only'
      ? async (target, origin, onAttempt) => {
          await installPassiveWorkerProbe(target, origin, () => {});
          onAttempt();
        }
      : process.env.D47_PROBE_MUTANT === 'constant_success'
        ? async () => true
        : installPassiveWorkerProbe;
  try {
    await installer(worker, 'http://127.0.0.1:4179', () => {
      attempted = true;
    });
  } catch (error) {
    primary = error;
  }
  assert.equal(primary?.message, 'ack_lost');
  assert.equal(listeners.size, 1);
  assert.equal(await cleanupD47Probe(worker, attempted, removePassiveWorkerProbe), null);
  assert.equal(listeners.size, 0);
  assert.equal(runInContext('globalThis.__d47PassiveProbe', context), undefined);
  assert.deepEqual(calls.slice(-2), ['Runtime.evaluate', 'detach']);
  assert.equal(primary.message, 'ack_lost');
});

test('a lost acknowledgement before evaluation still confirms absence', async () => {
  const { worker, listeners, calls } = workerHarness({ acknowledge: false, execute: false });
  let attempted = false;
  await assert.rejects(
    installPassiveWorkerProbe(worker, 'http://127.0.0.1:4179', () => {
      attempted = true;
    }),
    /evaluation_unavailable/,
  );
  assert.equal(attempted, true);
  assert.equal(await cleanupD47Probe(worker, attempted, removePassiveWorkerProbe), null);
  assert.equal(listeners.size, 0);
  assert.deepEqual(calls.slice(-2), ['Runtime.evaluate', 'detach']);
});

test('an applied probe whose listener remains is reported as cleanup failure', async () => {
  const { worker, listeners, calls } = workerHarness({ acknowledge: false, removeWorks: false });
  let attempted = false;
  await assert.rejects(
    installPassiveWorkerProbe(worker, 'http://127.0.0.1:4179', () => {
      attempted = true;
    }),
    /ack_lost/,
  );
  assert.deepEqual(await cleanupD47Probe(worker, attempted, removePassiveWorkerProbe), [
    'remove_failed',
  ]);
  assert.equal(listeners.size, 1);
  assert.deepEqual(calls.slice(-2), ['Runtime.evaluate', 'detach']);
});
