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
