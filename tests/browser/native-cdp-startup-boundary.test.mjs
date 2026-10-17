import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { observeNativeCdpStartup } from './native-cdp-startup-diagnostic.mjs';

const require = createRequire(import.meta.url);
const { prepareOwnedProfile, connectOwnedCdp } = require('./vault-owned-cdp.cjs');

// A hosted acceptance browser can stop before publishing its endpoint. Real
// child/pipe and profile boundaries remain real; no browser or credentials run.
async function drive({ exited, foreignLock = false, closedPipe = false }) {
  const profile = await mkdtemp(join(tmpdir(), 'owned-startup-boundary-'));
  const child = spawn(process.execPath, ['-e', exited ? '' : 'setInterval(() => {}, 1000)'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await once(child, 'spawn');
  if (exited) await once(child, 'close');
  try {
    if (closedPipe) {
      child.stderr.destroy();
      await once(child.stderr, 'close');
    }
    const preparedProfile = await prepareOwnedProfile(profile);
    if (!exited)
      await symlink(
        `host-${foreignLock ? child.pid + 1 : child.pid}`,
        join(profile, 'SingletonLock'),
      );
    const observations = [];
    await assert.rejects(
      observeNativeCdpStartup(
        {
          preparedProfile,
          chromeExecutable: process.execPath,
          startupChild: child,
          startupDeadlineMs: 80,
          timeoutMs: 80,
        },
        connectOwnedCdp,
        { enabled: true, emit: (value) => observations.push(value) },
      ),
      /owned_cdp_endpoint_timeout/,
    );
    assert.equal(observations.length, 1);
    assert.doesNotMatch(JSON.stringify(observations), new RegExp(`${profile}|host-|${child.pid}`));
    assert.equal(
      typeof observations[0].startupBoundary,
      'object',
      'startup diagnostic lost profile/process/pipe boundary',
    );
    return observations[0].startupBoundary;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'close');
    }
    await rm(profile, { recursive: true, force: true });
  }
}

test('missing endpoint distinguishes a live profile owner from a stopped child with closed stderr', async () => {
  const live = await drive({ exited: false });
  assert.equal(live.profileLock, 'spawned_child');
  assert.equal(live.childExitObserved, false);
  assert.equal(live.stderrClosed, false);
  const exited = await drive({ exited: true });
  assert.equal(exited.profileLock, 'absent');
  assert.equal(exited.childExitObserved, true);
  assert.equal(exited.stderrClosed, true);
});

test('missing endpoint identifies a lock owned by a different process without inspecting or attaching to it', async () => {
  const foreign = await drive({ exited: false, foreignLock: true });
  assert.equal(foreign.profileLock, 'other_owner');
  assert.equal(foreign.childExitObserved, false);
});

test('closed stderr with a live profile owner is distinguishable from process exit', async () => {
  const boundary = await drive({ exited: false, closedPipe: true });
  assert.equal(boundary.profileLock, 'spawned_child');
  assert.equal(boundary.childExitObserved, false);
  assert.equal(boundary.stderrClosed, true);
});

for (const failure of ['EACCES', 'EIO', 'stalled']) {
  test(`diagnostic ${failure} lock inspection preserves real endpoint timeout`, async () => {
    const profile = await mkdtemp(join(tmpdir(), 'owned-startup-unavailable-'));
    try {
      const preparedProfile = await prepareOwnedProfile(profile);
      const observations = [];
      await assert.rejects(
        observeNativeCdpStartup(
          {
            preparedProfile,
            chromeExecutable: process.execPath,
            startupDeadlineMs: 80,
            timeoutMs: 80,
            fileSystem: {
              ...fs,
              readlink: async () => {
                if (failure === 'stalled') return new Promise(() => {});
                throw Object.assign(new Error('private diagnostic detail'), { code: failure });
              },
            },
          },
          connectOwnedCdp,
          { enabled: true, emit: (value) => observations.push(value) },
        ),
        /owned_cdp_endpoint_timeout/,
      );
      assert.equal(observations[0].startupBoundary.profileLock, 'unavailable');
      assert.equal(observations[0].outcome, 'failed');
      assert.doesNotMatch(JSON.stringify(observations), /private diagnostic detail/);
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  });
}

test('unavailable diagnostic preserves distinct connector successes and original errors', async () => {
  for (const value of [{ ownerVerified: true }, { ownerVerified: false }]) {
    const result = await observeNativeCdpStartup(
      {
        startupDeadlineMs: 80,
        fileSystem: {
          readlink: async () => {
            throw new Error('private inspection');
          },
        },
      },
      async () => value,
      { enabled: true, emit: () => {} },
    );
    assert.equal(result, value);
  }
  const originalError = new Error('connector refusal');
  await assert.rejects(
    observeNativeCdpStartup(
      {
        startupDeadlineMs: 80,
        fileSystem: {
          readlink: async () => {
            throw new Error('private inspection');
          },
        },
      },
      async () => {
        throw originalError;
      },
      { enabled: true, emit: () => {} },
    ),
    (error) => error === originalError,
  );
});

test('successful connector settles before a pending diagnostic read or timer can resolve', async () => {
  const value = { ownerVerified: true };
  const events = [];
  const pending = observeNativeCdpStartup(
    {
      preparedProfile: { profile: '/owned/profile' },
      startupDeadlineMs: 5000,
      fileSystem: { readlink: () => new Promise(() => {}) },
    },
    async () => {
      events.push('connector');
      return value;
    },
    {
      enabled: true,
      emit: (observation) => {
        events.push('diagnostic');
        assert.equal(observation.startupBoundary, null);
      },
    },
  ).then((result) => {
    events.push('result');
    return result;
  });
  // Microtasks drain before any timer/I/O callback: a diagnostic await cannot
  // hide behind a generous wall-clock threshold in this assertion.
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  assert.deepEqual(events, ['connector', 'diagnostic', 'result']);
  assert.equal(await pending, value);
});
