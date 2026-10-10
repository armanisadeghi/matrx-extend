import assert from 'node:assert/strict';
import test from 'node:test';
import {
  observeRecoveryPreflight,
  runAfterEffectiveHostDenial,
  withRecoveryHostAccessCleanup,
} from './scrape-recovery-failure-diagnostic.mjs';
import { evaluate } from './settings-panel-driver.mjs';
import { connectOwnedCdp } from './vault-owned-cdp.cjs';

// Real guest denial preflight: external Chrome may reject or never answer a
// command after navigation. The SUT must retain its safe boundary and restore
// the owned permission state without performing the Scrape action.
async function strictTransport(failingOperation, failureMode) {
  const executable = '/owned/chrome';
  const fs = {
    async readFile() {
      return '9222\n/devtools/browser/owned-session';
    },
    async readlink() {
      return 'owned-host-123';
    },
  };
  class Socket {
    constructor() {
      setImmediate(() => this.onopen());
    }
    send(raw) {
      const message = JSON.parse(raw);
      if (message.params.expression === failingOperation) {
        if (failureMode === 'timeout') return;
        setImmediate(() =>
          this.onmessage({
            data: JSON.stringify({
              id: message.id,
              error: { code: -32000, message: 'private protocol detail' },
            }),
          }),
        );
        return;
      }
      setImmediate(() =>
        this.onmessage({
          data: JSON.stringify({
            id: message.id,
            result: {
              result: {
                value: message.params.expression === 'panel_readiness' ? { ready: true } : 'denied',
              },
            },
          }),
        }),
      );
    }
    close() {
      setImmediate(() => this.onclose());
    }
  }
  return connectOwnedCdp({
    preparedProfile: { profile: '/owned/profile' },
    chromeExecutable: executable,
    fileSystem: fs,
    WebSocketCtor: Socket,
    processInspector: async () => ({ executable, args: '--user-data-dir=/owned/profile' }),
    timeoutMs: 30,
  });
}

async function preflight(cdp, onFailure, counters, originTransitionCompleted = true) {
  const observe = (operation) =>
    observeRecoveryPreflight(
      {
        operation,
        originTransitionCompleted,
        transportFailureClass: () => cdp.failureClass,
        onFailure,
      },
      () => evaluate(cdp, operation),
    );
  return withRecoveryHostAccessCleanup(
    async () => {
      const state = await observe('panel_readiness');
      assert.equal(state.ready, true);
      return runAfterEffectiveHostDenial(
        () => observe('effective_host_access'),
        async () => {
          counters.clicks++;
          return 'scrape-action-completed';
        },
      );
    },
    async () => {
      counters.restores++;
      counters.hostAccess = 'ON_ALL_SITES';
    },
  );
}

for (const operation of ['panel_readiness', 'effective_host_access']) {
  for (const mode of ['protocol_error', 'timeout']) {
    test(`T14 ${operation} ${mode} captures the strict transport refusal before Scrape and restores access`, async () => {
      const cdp = await strictTransport(operation, mode);
      const counters = { clicks: 0, restores: 0, hostAccess: 'ON_CLICK' };
      let snapshot;
      try {
        await assert.rejects(
          preflight(
            cdp,
            (value) => {
              snapshot = value;
            },
            counters,
          ),
          /owned_cdp_transport_failed/,
        );
        assert.ok(snapshot, 'preflight transport refusal must persist its safe operation');
        assert.deepEqual(snapshot, {
          phase: 'denial_preflight',
          operation,
          origin_transition_completed: true,
          failure_code: 'owned_cdp_transport_failed',
          transport_failure_class: mode === 'timeout' ? 'command_timeout' : 'protocol_error',
        });
        assert.deepEqual(counters, { clicks: 0, restores: 1, hostAccess: 'ON_ALL_SITES' });
        assert(!/private|owned-session|owned\/profile|9222/.test(JSON.stringify(snapshot)));
      } finally {
        await cdp.detach().catch(() => {});
      }
    });
  }
}

test('T14 successful denied preflight dispatches Scrape once and restores owned access', async () => {
  const cdp = await strictTransport(null, null);
  const counters = { clicks: 0, restores: 0, hostAccess: 'ON_CLICK' };
  let snapshot = null;
  try {
    const result = await preflight(
      cdp,
      (value) => {
        snapshot = value;
      },
      counters,
    );
    assert.deepEqual(result, { access: 'denied', value: 'scrape-action-completed' });
    assert.deepEqual(counters, { clicks: 1, restores: 1, hostAccess: 'ON_ALL_SITES' });
    assert.equal(snapshot, null);
  } finally {
    await cdp.detach();
  }
});

test('T14 unknown diagnostic inputs never copy transport or error text and rethrow the original failure', async () => {
  const original = new Error('private runtime detail');
  let snapshot;
  await assert.rejects(
    observeRecoveryPreflight(
      {
        operation: 'private operation',
        originTransitionCompleted: 'private origin',
        transportFailureClass: () => 'private transport',
        onFailure: (value) => {
          snapshot = value;
        },
      },
      async () => {
        throw original;
      },
    ),
    (error) => error === original,
  );
  assert.deepEqual(snapshot, {
    phase: 'denial_preflight',
    operation: 'unknown',
    origin_transition_completed: null,
    failure_code: 'scrape_recovery_preflight_failed',
    transport_failure_class: 'unknown',
  });
});

// Chrome APIs can leave the promise returned to Runtime.evaluate unsettled after
// a host-access transition. Execute the actual emitted expression, with only
// Chrome and the clock replaced, so dropping its bound is observable.
async function probeRuntime({ query, execute }) {
  const { runInNewContext } = await import('node:vm');
  const { probeEffectiveHostAccess } = await import('./scrape-effective-host-access-probe.mjs');
  const timers = new Map();
  let sequence = 0;
  let injections = 0;
  let resolved = false;
  let result;
  const panel = {
    async send(method, params) {
      assert.equal(method, 'Runtime.evaluate');
      assert.equal(params.awaitPromise, true);
      const value = await runInNewContext(params.expression, {
        chrome: {
          tabs: { query },
          scripting: {
            executeScript(args) {
              injections++;
              assert.deepEqual(JSON.parse(JSON.stringify(args.target)), { tabId: 27 });
              assert.equal(args.func(), true);
              return execute();
            },
          },
        },
        setTimeout(callback, delay) {
          assert.equal(delay, 50, 'probe must finish before the 100ms strict CDP command budget');
          timers.set(++sequence, callback);
          return sequence;
        },
        clearTimeout(id) {
          timers.delete(id);
        },
      });
      return { result: { value } };
    },
  };
  const pending = probeEffectiveHostAccess(panel, 100).then((value) => {
    resolved = true;
    result = value;
    return value;
  });
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  await flush();
  return {
    async expire() {
      for (const callback of [...timers.values()]) callback();
      await flush();
    },
    flush,
    pending,
    state: () => ({ resolved, result, injections, timers: timers.size }),
  };
}

for (const boundary of ['tabs_query', 'execute_script']) {
  test(`T14 bounded ${boundary} nonsettlement refuses Scrape and restores access before CDP timeout`, async () => {
    let release;
    const stalled = new Promise((resolve) => {
      release = resolve;
    });
    const runtime = await probeRuntime({
      query: () => (boundary === 'tabs_query' ? stalled : Promise.resolve([{ id: 27 }])),
      execute: () => (boundary === 'execute_script' ? stalled : Promise.resolve([])),
    });
    await runtime.expire();
    assert.equal(
      runtime.state().resolved,
      true,
      'unsettled Chrome API must not hold Runtime.evaluate until strict CDP failure',
    );
    assert.equal(runtime.state().result, 'unknown');
    let clicks = 0;
    let restores = 0;
    await assert.rejects(
      withRecoveryHostAccessCleanup(
        () =>
          runAfterEffectiveHostDenial(
            () => runtime.pending,
            () => {
              clicks++;
            },
          ),
        async () => {
          restores++;
        },
      ),
      /scrape_recovery_effective_access_unknown/,
    );
    assert.equal(clicks, 0);
    assert.equal(restores, 1);
    release(boundary === 'tabs_query' ? [{ id: 27 }] : []);
    await runtime.flush();
    assert.deepEqual(
      runtime.state(),
      {
        resolved: true,
        result: 'unknown',
        injections: boundary === 'tabs_query' ? 0 : 1,
        timers: 0,
      },
      'late query must not start injection; late injection cannot turn timeout into denial',
    );
  });
}

for (const [name, execute, expected, clicks] of [
  ['successful injection', () => Promise.resolve([]), 'available', 0],
  [
    'Chrome permission refusal',
    () =>
      Promise.reject(
        new Error(
          'Cannot access contents of the page. Extension manifest must request permission.',
        ),
      ),
    'denied',
    1,
  ],
  ['unrelated Chrome failure', () => Promise.reject(new Error('No tab with id: 27')), 'unknown', 0],
]) {
  test(`T14 bounded probe preserves ${name} semantics and clears its timer`, async () => {
    const runtime = await probeRuntime({ query: () => Promise.resolve([{ id: 27 }]), execute });
    assert.deepEqual(runtime.state(), {
      resolved: true,
      result: expected,
      injections: 1,
      timers: 0,
    });
    let actualClicks = 0;
    const action = () => {
      actualClicks++;
    };
    if (expected === 'denied')
      await runAfterEffectiveHostDenial(() => runtime.state().result, action);
    else
      await assert.rejects(
        runAfterEffectiveHostDenial(() => runtime.state().result, action),
        new RegExp(`scrape_recovery_effective_access_${expected}`),
      );
    assert.equal(actualClicks, clicks);
    await runtime.expire();
    assert.equal(runtime.state().result, expected);
  });
}
