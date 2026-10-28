import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { beginStartupProcessInterval } from '../../scripts/startup-process-interval.mjs';
import { observeNativeStartupBoundary } from './native-cdp-startup-diagnostic.mjs';
import {
  guardNativeResourceSessionSend,
  runNativeResourceAction,
} from './native-resource-boundary.mjs';
import { observeOwnedEndpointAfterTimeout } from './native-sidepanel-qa-harness.mjs';

// Execute the actual complete driver, including its finally. Replace only the
// artifact/runtime/OS/CDP/policy-health boundaries so no native browser is needed.
const source = await readFile(
  new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
  'utf8',
);
const driver = source
  .slice(
    source.indexOf('function resolveNativeResourceAction'),
    source.indexOf('\nif (process.argv[1]'),
  )
  .replace(/^export /gm, '');
const startupError = new Error('original startup error');
const stopAfterStartup = new Error('stop after startup');
const policyError = new Error('resource readiness refused');

async function run({
  spawnFails = false,
  healthFails = false,
  connectFails = false,
  snapshotFails = false,
  beginFails = false,
  finishFails = false,
  enabled = true,
  cdpEnabled = false,
  guardEnabled = false,
  endpointTimeout = false,
  observationFails = false,
  driverCode = driver,
  passiveEndpoint = false,
  boundaryStalled = false,
  boundaryFails = false,
  outerLstatStalled = false,
  observationWindowMs = 100,
} = {}) {
  const events = [];
  const output = [];
  const observations = [];
  const boundaryBudgets = [];
  const timeoutError = new Error('owned_cdp_endpoint_timeout');
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 123;
  child.stderr.destroyed = false;
  child.stderr.readableEnded = false;
  child.exitCode = null;
  child.signalCode = null;
  const session = { detach: async () => events.push('detach') };
  const sandbox = {
    REPO: '/repo',
    // Keep the real owning composition/action primitive. Only the external
    // policy/lease read is adapted; both readiness and refusal are exercised.
    guardNativeResourceSessionSend,
    runNativeResourceAction,
    awaitNativeResourceHealth: async (options) => {
      assert.equal(JSON.stringify(options), '{"repo":"/repo"}');
      events.push('resource-health');
      if (healthFails) throw policyError;
      return { event: 'RESOURCE_WATCH_HEALTHY', runId: 'owned-startup', ageMs: 0 };
    },
    RELEASE_RECEIPT: '/receipt',
    EXPECTED_EXTENSION_ID: 'owned',
    join: (...parts) => parts.join('/'),
    tmpdir: () => '/tmp',
    readFile: async () => '{}',
    verifyNativeExpectedRelease: async (input) => {
      // This startup-only test replaces the artifact boundary. Reject any
      // unexpected identity route rather than manufacturing provenance success.
      assert.equal(JSON.stringify(input.receipt), '{}');
      assert.equal(input.extensionDir, undefined);
      assert.equal(input.expectedRelease, undefined);
      assert.equal(input.localDevReceiptPath, undefined);
      assert.equal(input.expectedExtensionId, 'owned');
      return { extensionDir: '/extension' };
    },
    verifyReleasedArtifact: async () => {},
    resolveBrowserRuntime: async () => ({ executablePath: '/chrome' }),
    mkdtemp: async () => '/owned',
    mkdir: async () => {},
    prepareOwnedProfile: async () => ({ profile: '/owned/profile' }),
    rm: async () => events.push('remove-profile'),
    performance,
    setTimeout,
    clearTimeout,
    process: {
      env: {
        MATRX_STARTUP_INTERVAL_DIAGNOSTIC: enabled ? '1' : '0',
        MATRX_CDP_STARTUP_DIAGNOSTIC: cdpEnabled ? '1' : '0',
        MATRX_GUARD_INTERVAL_DIAGNOSTIC: guardEnabled ? '1' : '0',
      },
      stderr: { write: (line) => output.push(line) },
    },
    beginStartupProcessInterval: async () => {
      if (beginFails) throw new Error('private begin failure');
      if (finishFails)
        return async () => {
          throw new Error('private finish failure');
        };
      return beginStartupProcessInterval({
        rootPid: 100,
        read: async () => {
          events.push('snapshot');
          if (snapshotFails) throw new Error('private snapshot failure');
          return '100 1 0:01.00 node\n';
        },
      });
    },
    spawn: () => {
      events.push('spawn');
      if (spawnFails) throw startupError;
      return child;
    },
    connectNativeStartupOwnedCdp: async () => {
      events.push('connect');
      if (endpointTimeout) throw timeoutError;
      if (connectFails) throw startupError;
      return session;
    },
    observeNativeStartupBoundary: (options, budget) => {
      boundaryBudgets.push(budget);
      if (boundaryFails) throw new Error('private snapshot failed');
      return observeNativeStartupBoundary(
        {
          ...options,
          fileSystem: {
            readlink: async () => (boundaryStalled ? new Promise(() => {}) : 'host-123'),
          },
        },
        budget,
      );
    },
    safeEndpointDiagnostic: () => null,
    safeEndpointWaitDiagnostic: () => null,
    observeOwnedEndpointAfterTimeout: (options) =>
      observeOwnedEndpointAfterTimeout({
        ...options,
        windowMs: outerLstatStalled ? 20 : 0,
        ...(outerLstatStalled && { fileSystem: { lstat: () => new Promise(() => {}) } }),
      }),
    safeStartupFailureCode: () => 'test_failure',
    browserDiagnosticFlags: () => ({}),
    stopOwnedChild: async (value) => {
      assert.equal(value, spawnFails || healthFails ? undefined : child);
      events.push('cleanup');
    },
  };
  const invoke = runInNewContext(`${driverCode}; runNativeSidepanelQa`, sandbox);
  await assert.rejects(
    invoke({
      ...((endpointTimeout || passiveEndpoint) && {
        startupEndpointObservationMs: observationWindowMs,
        onStartupEndpointObservation: async (value) => {
          observations.push(value);
          if (observationFails) throw new Error('private diagnostic sink failed');
        },
      }),
      onStage: (stage) => {
        if (stage === 'endpoint_read') throw stopAfterStartup;
      },
    }),
    (error) =>
      error ===
      (healthFails
        ? policyError
        : endpointTimeout
          ? timeoutError
          : spawnFails || connectFails
            ? startupError
            : stopAfterStartup),
  );
  const brackets = output
    .filter((line) => line.startsWith('BROWSER_STARTUP_CPU_INTERVAL '))
    .map((line) => JSON.parse(line.slice('BROWSER_STARTUP_CPU_INTERVAL '.length)));
  assert.deepEqual(events.slice(-2), ['cleanup', 'remove-profile']);
  const failures = output
    .filter((line) => line.startsWith('BROWSER_STARTUP_FAILURE '))
    .map((line) => JSON.parse(line.slice('BROWSER_STARTUP_FAILURE '.length)));
  return { events, brackets, observations, boundaryBudgets, failures };
}

test('actual driver brackets successful spawn and CDP exactly once before cleanup', async () => {
  const { events, brackets } = await run();
  assert.deepEqual(events, [
    'snapshot',
    'resource-health',
    'spawn',
    'connect',
    'snapshot',
    'detach',
    'cleanup',
    'remove-profile',
  ]);
  assert.equal(brackets.length, 1);
  assert.equal(brackets[0].outcome, 'cdp_connected');
});
test('actual driver preserves synchronous spawn error while closing its bracket', async () => {
  const { events, brackets } = await run({ spawnFails: true });
  assert.deepEqual(events, [
    'snapshot',
    'resource-health',
    'spawn',
    'snapshot',
    'cleanup',
    'remove-profile',
  ]);
  assert.equal(brackets.length, 1);
  assert.equal(brackets[0].outcome, 'spawn_failed');
});
test('actual driver preserves CDP failure with failed snapshots and cleanup', async () => {
  const { brackets } = await run({ connectFails: true, snapshotFails: true });
  assert.equal(brackets.length, 1);
  assert.equal(brackets[0].outcome, 'cdp_failed');
  assert.equal(brackets[0].unavailable, true);
});
test('diagnostic begin and finish failures cannot replace driver success or failure', async () => {
  for (const options of [
    { beginFails: true },
    { finishFails: true },
    { beginFails: true, spawnFails: true },
    { finishFails: true, connectFails: true },
  ]) {
    const { brackets } = await run(options);
    assert.equal(brackets.length, 1);
    assert.equal(brackets[0].unavailable, true);
  }
});
test('ordinary startup performs no diagnostic process reads', async () => {
  const { events, brackets } = await run({ enabled: false });
  assert.deepEqual(events, [
    'resource-health',
    'spawn',
    'connect',
    'detach',
    'cleanup',
    'remove-profile',
  ]);
  assert.deepEqual(brackets, []);
});
test('Notes CDP diagnostic brackets actual startup without enabling SEO diagnostics', async () => {
  const { events, brackets } = await run({ enabled: false, cdpEnabled: true });
  assert.equal(brackets.length, 1, 'Notes startup lost its process CPU bracket');
  assert.equal(brackets[0].outcome, 'cdp_connected');
  assert.deepEqual(events.slice(0, 5), [
    'snapshot',
    'resource-health',
    'spawn',
    'connect',
    'snapshot',
  ]);
});

test('actual composed driver refuses unavailable policy before spawn and still cleans its profile', async () => {
  const { events, brackets } = await run({ healthFails: true });
  assert.deepEqual(events, [
    'snapshot',
    'resource-health',
    'snapshot',
    'cleanup',
    'remove-profile',
  ]);
  assert.equal(brackets.length, 1);
  assert.equal(brackets[0].outcome, 'spawn_failed');
});

test('actual timeout callback reports unknown presence and preserves failure through sink errors', async () => {
  for (const observationFails of [false, true]) {
    const { observations } = await run({ endpointTimeout: true, observationFails });
    assert.equal(observations[0].phase, 'cdp_timeout');
    assert.equal(observations[0].endpointPresent, null);
    assert.equal(observations[0].presenceBasis, 'unobserved');
    assert.equal(observations[0].sampleTiming, null);
    assert.equal(observations[0].elapsedMs, observations[0].failureObservedElapsedMs);
    assert.ok(observations[0].reportedElapsedMs >= observations[0].failureObservedElapsedMs);
    if (!observationFails) assert.equal(observations[1].endpointPresent, null);
  }
});

test('actual timeout observation oracle rejects the manufactured false callback mutation', async () => {
  const mutated = driver.replace(/(phase: 'cdp_timeout',\n\s*endpointPresent:) null,/, '$1 false,');
  assert.notEqual(mutated, driver, 'mutation must target the actual timeout callback');
  const assertUnknown = async (driverCode) => {
    const { observations } = await run({ endpointTimeout: true, driverCode });
    assert.equal(
      observations[0].endpointPresent,
      null,
      'timeout alone cannot prove filesystem absence',
    );
  };
  await assertUnknown(driver);
  await assert.rejects(assertUnknown(mutated), /timeout alone cannot prove filesystem absence/);
});

test('passive timeout bounds child snapshot and stalled lstat without replacing original cleanup sentinel', async () => {
  for (const options of [
    { boundaryStalled: true },
    { boundaryFails: true },
    { outerLstatStalled: true },
    { observationFails: true },
  ]) {
    const { events, brackets, observations, boundaryBudgets, failures } = await run({
      enabled: false,
      endpointTimeout: true,
      observationWindowMs: 15000,
      ...options,
    });
    assert.deepEqual(
      boundaryBudgets,
      [300],
      'passive snapshot uses existing observation-window cadence',
    );
    assert.deepEqual(brackets, [], 'passive failure cannot enable CPU observations');
    assert.deepEqual(events.slice(-2), ['cleanup', 'remove-profile']);
    assert.equal(failures[0].childPid, 123);
    assert.equal(failures[0].failureObservedElapsedMs, failures[0].elapsedMs);
    assert.equal(failures[0].startupBoundaryTiming.origin, 'failure_observer');
    assert.ok(failures[0].startupBoundaryTiming.completedElapsedMs >= 0);
    assert.equal(
      failures[0].startupBoundary.profileLock,
      options.boundaryStalled || options.boundaryFails ? 'unavailable' : 'spawned_child',
    );
    assert.equal(observations[0].endpointPresent, null);
    if (options.outerLstatStalled) assert.equal(observations[1].inspectionFailed, true);
  }
});

test('passive callback success adds no failure snapshot or startup CPU I/O', async () => {
  const { events, brackets, observations, boundaryBudgets, failures } = await run({
    enabled: false,
    passiveEndpoint: true,
  });
  assert.deepEqual(boundaryBudgets, []);
  assert.deepEqual(brackets, []);
  assert.deepEqual(failures, []);
  assert.equal(observations[0].phase, 'cdp_connected');
  assert.equal(observations[0].presenceBasis, 'validated_connector_record');
  assert.deepEqual(events, [
    'resource-health',
    'spawn',
    'connect',
    'detach',
    'cleanup',
    'remove-profile',
  ]);
});

test('guard-only flag does not start child CPU snapshots', async () => {
  const { events, brackets } = await run({ enabled: false, guardEnabled: true });
  assert.equal(events.includes('snapshot'), false);
  assert.deepEqual(brackets, []);
});
