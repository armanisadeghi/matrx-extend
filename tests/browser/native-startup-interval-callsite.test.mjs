import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { beginStartupProcessInterval } from '../../scripts/startup-process-interval.mjs';

// Execute the actual complete driver, including its finally. Replace only the
// artifact/runtime/OS/CDP boundaries so no native browser or heavy job is needed.
const source = await readFile(
  new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
  'utf8',
);
const driver = source
  .slice(
    source.indexOf('export async function runNativeSidepanelQa'),
    source.indexOf('\nif (process.argv[1]'),
  )
  .replace('export ', '');
const startupError = new Error('original startup error');
const stopAfterStartup = new Error('stop after startup');

async function run({
  spawnFails = false,
  connectFails = false,
  snapshotFails = false,
  beginFails = false,
  finishFails = false,
  enabled = true,
} = {}) {
  const events = [];
  const output = [];
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  const session = { detach: async () => events.push('detach') };
  const sandbox = {
    REPO: '/repo',
    RELEASE_RECEIPT: '/receipt',
    EXPECTED_EXTENSION_ID: 'owned',
    join: (...parts) => parts.join('/'),
    tmpdir: () => '/tmp',
    readFile: async () => '{}',
    resolveExpectedRelease: () => ({ extensionDir: '/extension' }),
    verifyReleasedArtifact: async () => {},
    resolveBrowserRuntime: async () => ({ executablePath: '/chrome' }),
    mkdtemp: async () => '/owned',
    mkdir: async () => {},
    prepareOwnedProfile: async () => ({}),
    rm: async () => events.push('remove-profile'),
    performance,
    process: {
      env: { MATRX_STARTUP_INTERVAL_DIAGNOSTIC: enabled ? '1' : '0' },
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
      if (connectFails) throw startupError;
      return session;
    },
    safeEndpointDiagnostic: () => null,
    safeEndpointWaitDiagnostic: () => null,
    safeStartupFailureCode: () => 'test_failure',
    browserDiagnosticFlags: () => ({}),
    stopOwnedChild: async (value) => {
      assert.equal(value, spawnFails ? undefined : child);
      events.push('cleanup');
    },
  };
  const invoke = runInNewContext(`${driver}; runNativeSidepanelQa`, sandbox);
  await assert.rejects(
    invoke({
      onStage: (stage) => {
        if (stage === 'endpoint_read') throw stopAfterStartup;
      },
    }),
    (error) => error === (spawnFails || connectFails ? startupError : stopAfterStartup),
  );
  const brackets = output
    .filter((line) => line.startsWith('BROWSER_STARTUP_CPU_INTERVAL '))
    .map((line) => JSON.parse(line.slice('BROWSER_STARTUP_CPU_INTERVAL '.length)));
  assert.deepEqual(events.slice(-2), ['cleanup', 'remove-profile']);
  return { events, brackets };
}

test('actual driver brackets successful spawn and CDP exactly once before cleanup', async () => {
  const { events, brackets } = await run();
  assert.deepEqual(events, [
    'snapshot',
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
  assert.deepEqual(events, ['snapshot', 'spawn', 'snapshot', 'cleanup', 'remove-profile']);
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
  assert.deepEqual(events, ['spawn', 'connect', 'detach', 'cleanup', 'remove-profile']);
  assert.deepEqual(brackets, []);
});
