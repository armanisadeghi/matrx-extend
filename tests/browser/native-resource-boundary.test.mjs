import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  awaitNativeResourceHealth,
  guardNativeResourceSessionSend,
  requireNativeResourceHealth,
  runNativeResourceAction,
} from './native-resource-boundary.mjs';
import { attachTargetSession } from './native-sidepanel-qa-harness.mjs';
import { createNativeStageReceipt } from './native-stage-receipt.mjs';
import { waitFor } from './settings-panel-driver.mjs';

const completeSample = {
  pressureLevel: 1,
  availableMemoryGiB: 12.6,
  requiredMemoryGiB: 4,
  oneMinuteLoad: 1.44,
  logicalCpus: 4,
  cpuBusyFraction: 0.13,
  swapUsedMiB: 0,
  repoFreeGiB: 108.12,
  profileFreeGiB: 108.12,
  safetyFreeGiB: 108.12,
  systemFreeGiB: 108.12,
};

// Harbor Dental's native Scrape run may start another UI batch only while its
// own admitted guard has recent healthy evidence and no unsafe signal.
test('native Scrape resource boundary permits fresh own-run health and refuses unsafe, stale, and wrong-run evidence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'native-resource-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const leaseRoot = join(root, 'lease');
  const journalDir = join(repo, 'docs/stabilization/resource-journals');
  const policyDir = join(repo, 'docs/stabilization');
  const ownerDir = join(leaseRoot, 'heavy');
  await mkdir(journalDir, { recursive: true });
  await mkdir(ownerDir, { recursive: true });
  const runId = `scrape-${randomUUID()}`;
  const nonce = randomUUID();
  const stopFile = join(leaseRoot, `stop-${nonce}.json`);
  const env = {
    MATRX_RESOURCE_RUN_ID: runId,
    MATRX_RESOURCE_OWNER: nonce,
    MATRX_RESOURCE_STOP_FILE: stopFile,
  };
  const now = Date.parse('2026-10-04T09:14:22.000Z');
  const admitted = {
    schema: 1,
    runId,
    code: 'RESOURCE_ADMITTED',
    at: '2026-10-04T09:14:06.000Z',
    sample: completeSample,
    reasons: [],
  };
  const healthy = {
    schema: 1,
    runId,
    code: 'RESOURCE_WATCH_HEALTHY',
    at: '2026-10-04T09:14:20.000Z',
    sample: completeSample,
    reasons: [],
  };
  const journalPath = join(journalDir, `${runId}.pending.jsonl`);
  const writeEvents = (events) =>
    writeFile(journalPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  await writeFile(
    join(policyDir, 'resource-policy.json'),
    JSON.stringify({ watchIntervalSeconds: 15 }),
  );
  await writeFile(join(ownerDir, 'owner.json'), JSON.stringify({ runId, nonce, kind: 'run' }));
  const check = (at = now) =>
    requireNativeResourceHealth({ repo, leaseRoot, env, clock: () => at });

  await writeEvents([admitted, healthy]);
  assert.deepEqual(await check(), {
    runId,
    event: 'RESOURCE_WATCH_HEALTHY',
    at: healthy.at,
    ageMs: 2000,
  });
  const busy = {
    ...healthy,
    code: 'RESOURCE_CPU_PENDING',
    at: '2026-10-04T09:14:18.000Z',
    reasons: ['RESOURCE_CPU_BUSY'],
    sample: { ...completeSample, cpuBusyFraction: 0.92 },
  };
  const recovering = { ...busy, at: '2026-10-04T09:14:19.000Z', reasons: [] };
  const recovered = { ...healthy, code: 'RESOURCE_CPU_RECOVERED' };
  for (const field of Object.keys(completeSample)) {
    for (const value of [undefined, null, Number.POSITIVE_INFINITY, '0.1']) {
      const malformed = { ...completeSample, [field]: value };
      if (value === undefined) delete malformed[field];
      await writeEvents([admitted, { ...healthy, sample: malformed }]);
      await assert.rejects(check(), /journal_invalid/, `latest ${field} ${String(value)}`);
      await writeEvents([admitted, { ...busy, sample: malformed }, recovering, recovered]);
      await assert.rejects(check(), /journal_invalid/, `pending ${field} ${String(value)}`);
      await writeEvents([admitted, busy, recovering, { ...recovered, sample: malformed }]);
      await assert.rejects(check(), /journal_invalid/, `recovered ${field} ${String(value)}`);
    }
  }
  await writeEvents([admitted, healthy]);
  await writeEvents([
    {
      schema: 1,
      code: 'RESOURCE_RECOVERY_SAMPLES_READY',
      at: '2026-10-04T09:14:05.000Z',
      previousRunId: 'prior-run',
    },
    admitted,
    healthy,
  ]);
  assert.equal((await check()).event, 'RESOURCE_WATCH_HEALTHY');
  await writeEvents([admitted, healthy]);
  let actions = 0;
  assert.equal(
    await runNativeResourceAction(
      () => check(),
      () => ++actions,
    ),
    1,
  );
  await writeEvents([
    admitted,
    healthy,
    { ...healthy, code: 'RESOURCE_WATCH_UNSAFE', at: '2026-10-04T09:14:21.000Z', reasons: ['cpu'] },
    {
      schema: 1,
      runId,
      code: 'RESOURCE_PROCESS_ATTRIBUTION',
      at: '2026-10-04T09:14:21.100Z',
      processes: [{ pid: 413, parentPid: 201, cpuPercent: 72.5, executable: 'Chromium' }],
    },
  ]);
  await assert.rejects(check(), /unsafe_sample/);
  await writeEvents([
    admitted,
    healthy,
    {
      ...healthy,
      code: 'RESOURCE_WATCH_UNSAFE',
      at: '2026-10-04T09:14:21.000Z',
      reasons: ['RESOURCE_CPU_BUSY'],
    },
    { ...healthy, at: '2026-10-04T09:14:22.000Z' },
  ]);
  await assert.rejects(check(), /unsafe_sample/, 'legacy unsafe history cannot be cleared');
  await writeEvents([
    admitted,
    healthy,
    { ...healthy, code: 'RESOURCE_WATCH_UNSAFE', at: '2026-10-04T09:14:21.000Z', reasons: ['cpu'] },
  ]);
  await assert.rejects(
    runNativeResourceAction(
      () => check(),
      () => ++actions,
    ),
    /unsafe_sample/,
  );
  assert.equal(actions, 1, 'unsafe evidence must refuse the next native UI action');
  let reloadStarted = false;
  await assert.rejects(
    runNativeResourceAction(
      () => check(),
      () => {
        reloadStarted = true;
      },
    ),
    /unsafe_sample/,
  );
  assert.equal(reloadStarted, false, 'refused reload must not record a start');
  await writeEvents([admitted, healthy]);
  await assert.rejects(check(Date.parse('2026-10-04T09:14:36.000Z')), /stale_health/);
  let refreshClock = Date.parse('2026-10-04T09:14:36.000Z');
  let refreshElapsed = 0;
  let refreshWaits = 0;
  let publishRefresh = true;
  let refreshedActionRan = false;
  const awaitHealth = () =>
    awaitNativeResourceHealth({
      repo,
      leaseRoot,
      env,
      clock: () => refreshClock,
      monotonicClock: () => refreshElapsed,
      wait: async (ms) => {
        refreshClock += ms;
        refreshElapsed += ms;
        refreshWaits++;
        if (publishRefresh && refreshWaits === 1)
          await writeEvents([
            admitted,
            healthy,
            { ...healthy, at: new Date(refreshClock).toISOString() },
          ]);
      },
    });
  assert.equal(
    await runNativeResourceAction(awaitHealth, () => {
      refreshedActionRan = true;
      return 'fresh';
    }),
    'fresh',
  );
  assert.equal(refreshWaits, 1);
  assert.equal(refreshedActionRan, true);
  await writeEvents([admitted, healthy]);
  refreshWaits = 0;
  refreshElapsed = 0;
  publishRefresh = false;
  refreshedActionRan = false;
  await assert.rejects(
    runNativeResourceAction(awaitHealth, () => {
      refreshedActionRan = true;
    }),
    /stale_health/,
  );
  assert.equal(refreshedActionRan, false, 'an expired wait cannot start a native action');
  assert.ok(refreshWaits > 0, 'the wait must allow the guard a chance to publish health');
  refreshClock = Date.parse('2026-10-04T09:14:36.000Z');
  refreshWaits = 0;
  await assert.rejects(
    awaitNativeResourceHealth({
      repo,
      leaseRoot,
      env,
      clock: () => refreshClock,
      wait: async (ms) => {
        refreshClock += ms;
        await writeEvents([
          admitted,
          healthy,
          { ...healthy, code: 'RESOURCE_WATCH_UNSAFE', reasons: ['cpu'] },
        ]);
      },
    }),
    /unsafe_sample/,
  );
  await writeEvents([admitted, healthy]);
  let rollbackClock = Date.parse('2026-10-04T09:14:36.000Z');
  let elapsedMs = 0;
  let rollbackWaits = 0;
  let rollbackActionRan = false;
  await assert.rejects(
    runNativeResourceAction(
      () =>
        awaitNativeResourceHealth({
          repo,
          leaseRoot,
          env,
          clock: () => rollbackClock,
          monotonicClock: () => elapsedMs,
          wait: async (ms) => {
            elapsedMs += ms;
            rollbackWaits++;
            if (rollbackWaits === 1) rollbackClock -= 60_000;
            if (rollbackWaits > 11) throw new Error('wall_clock_extended_wait');
          },
        }),
      () => {
        rollbackActionRan = true;
      },
    ),
    /stale_health/,
  );
  assert.equal(elapsedMs, 15_000, 'wall-clock rollback must not extend the wait budget');
  assert.equal(rollbackActionRan, false, 'clock rollback cannot admit a native action');
  let lateClock = Date.parse('2026-10-04T09:14:36.000Z');
  let lateElapsed = 0;
  let lateActionRan = false;
  await assert.rejects(
    runNativeResourceAction(
      () =>
        awaitNativeResourceHealth({
          repo,
          leaseRoot,
          env,
          clock: () => lateClock,
          monotonicClock: () => lateElapsed,
          wait: async () => {
            lateElapsed = 15_001;
            lateClock += 15_001;
            await writeEvents([
              admitted,
              healthy,
              { ...healthy, at: new Date(lateClock).toISOString() },
            ]);
          },
        }),
      () => {
        lateActionRan = true;
      },
    ),
    /stale_health/,
  );
  assert.equal(lateActionRan, false, 'health published after the budget cannot start an action');
  await writeEvents([admitted, healthy]);
  let delayedClock = now;
  let delayedActionRan = false;
  await assert.rejects(
    runNativeResourceAction(
      () =>
        requireNativeResourceHealth({
          repo,
          leaseRoot,
          env,
          clock: () => delayedClock,
          readEvidence: async (path, encoding) => {
            const content = await readFile(path, encoding);
            if (path === journalPath) delayedClock = Date.parse('2026-10-04T09:14:36.000Z');
            return content;
          },
        }),
      () => {
        delayedActionRan = true;
      },
    ),
    /stale_health/,
  );
  assert.equal(delayedActionRan, false, 'journal read delay must refuse the next action');
  await writeFile(
    join(ownerDir, 'owner.json'),
    JSON.stringify({ runId: 'other-run', nonce, kind: 'run' }),
  );
  await assert.rejects(check(), /wrong_run/);
  await writeFile(join(ownerDir, 'owner.json'), JSON.stringify({ runId, nonce, kind: 'run' }));
  await writeEvents([admitted, { ...healthy, runId: 'other-run' }]);
  await assert.rejects(check(), /wrong_run/);
  await writeEvents([{ ...admitted, runId: undefined }, healthy]);
  await assert.rejects(check(), /wrong_run/);
  await writeEvents([admitted, { ...healthy, runId: undefined }]);
  await assert.rejects(check(), /wrong_run/);
  await writeEvents([admitted, healthy]);
  await writeFile(stopFile, '{}');
  await assert.rejects(check(), /stop_requested/);
  await rm(stopFile);
  await rm(journalPath);
  await assert.rejects(check(), /evidence_missing/);
});

test('native CDP factory session remains frozen behind a guarded receiver-safe facade', async () => {
  class FakeCdp extends EventEmitter {
    #commands = [];

    get commands() {
      return this.#commands;
    }

    async send(method, params, sessionId) {
      this.#commands.push({ method, params, sessionId });
      if (method === 'Target.attachToTarget') return { sessionId: 'owned-session' };
      return { method, sessionId };
    }
  }
  const cdp = new FakeCdp();
  let healthCalls = 0;
  const raw = await attachTargetSession(cdp, 'panel-target');
  const originalSend = raw.send;
  assert.equal(Object.isFrozen(raw), true);
  const session = guardNativeResourceSessionSend(raw, async (action) => {
    healthCalls++;
    if (healthCalls === 2) throw new Error('NATIVE_RESOURCE_BOUNDARY_REFUSED:unsafe_sample');
    return action();
  });
  assert.notEqual(session, raw, 'the guard returns a separate facade');
  assert.equal(raw.send, originalSend, 'the frozen factory session is not modified');
  assert.equal(session.targetId, 'panel-target');
  assert.deepEqual(await session.send('Runtime.evaluate', { expression: '1' }), {
    method: 'Runtime.evaluate',
    sessionId: 'owned-session',
  });
  await assert.rejects(session.send('Input.dispatchMouseEvent'), /unsafe_sample/);
  assert.equal(healthCalls, 2, 'each CDP send gets a fresh health decision');
  assert.deepEqual(
    cdp.commands.map(({ method }) => method),
    ['Target.attachToTarget', 'Runtime.evaluate'],
    'a refused command does not reach the CDP transport',
  );
  let received = 0;
  const unsubscribe = session.on('Runtime.consoleAPICalled', () => received++);
  cdp.emit('Runtime.consoleAPICalled', {}, 'other-session');
  cdp.emit('Runtime.consoleAPICalled', {}, 'owned-session');
  assert.equal(received, 1, 'event forwarding remains scoped to the attached session');
  unsubscribe();
  cdp.emit('Runtime.consoleAPICalled', {}, 'owned-session');
  assert.equal(received, 1, 'unsubscribe still removes the scoped listener');
  await session.detachVerified();
  await session.detachVerified();
  assert.deepEqual(
    cdp.commands.slice(-1).map(({ method, params }) => [method, params.sessionId]),
    [['Target.detachFromTarget', 'owned-session']],
    'verified detach retains idempotent factory behavior',
  );
  await assert.rejects(session.send('Runtime.evaluate'), /native_target_session_retired/);
});

test('native guarded facade preserves frozen getters, symbols, and private-brand receivers', async () => {
  const marker = Symbol('session-marker');
  class BrandedSession {
    #identity = 'original-session';

    get targetId() {
      return this.#identity;
    }

    [marker]() {
      return this.#identity;
    }

    send(method) {
      return `${this.#identity}:${method}`;
    }

    on() {
      return this.#identity;
    }

    detach() {
      return this.#identity;
    }

    detachVerified() {
      return this.#identity;
    }
  }
  const original = Object.freeze(new BrandedSession());
  let checks = 0;
  const resourceAction = async (action) => {
    checks++;
    return action();
  };
  const guarded = guardNativeResourceSessionSend(original, resourceAction);
  assert.equal(guardNativeResourceSessionSend(original, resourceAction), guarded);
  assert.equal(guardNativeResourceSessionSend(guarded, resourceAction), guarded);
  assert.throws(
    () => guardNativeResourceSessionSend(original, async (action) => action()),
    /native_resource_session_guard_conflict/,
  );
  assert.equal(guarded.targetId, 'original-session');
  assert.equal(guarded[marker](), 'original-session');
  assert.equal(await guarded.send('Runtime.enable'), 'original-session:Runtime.enable');
  assert.equal(guarded.on(), 'original-session');
  assert.equal(guarded.detach(), 'original-session');
  assert.equal(guarded.detachVerified(), 'original-session');
  assert.equal(checks, 1, 'only transport sends invoke the health gate');
  assert.equal(original.send('Runtime.enable'), 'original-session:Runtime.enable');
});

test('native guarded facade wraps accessor-defined send and refuses before transport', async () => {
  let transportCalls = 0;
  const session = Object.freeze({
    targetId: 'accessor-target',
    get send() {
      return () => {
        transportCalls++;
      };
    },
    on() {},
    detach() {},
    detachVerified() {},
  });
  let checks = 0;
  const guarded = guardNativeResourceSessionSend(session, async () => {
    checks++;
    throw new Error('NATIVE_RESOURCE_BOUNDARY_REFUSED:unsafe_sample');
  });
  await assert.rejects(guarded.send('Runtime.enable'), /unsafe_sample/);
  assert.equal(checks, 1, 'accessor send is guarded exactly once');
  assert.equal(transportCalls, 0, 'refusal blocks the accessor-provided transport');
});

test('D47 stage snapshots are private, allowlisted, and survive child termination', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'd47-stage-receipt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const receipt = join(root, 'showcase-d47-native-owned.stages.json');
  const modulePath = new URL('./native-stage-receipt.mjs', import.meta.url).href;
  const source = `
    import { createNativeStageReceipt } from ${JSON.stringify(modulePath)};
    const receipt = createNativeStageReceipt(${JSON.stringify(receipt)});
    receipt.record('native', 'panel_context');
    receipt.record('d47', 'signin');
    process.stdout.write('STAGES_SYNCED\\n');
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('stage_child_not_ready')), 5000);
    child.stdout.on('data', (chunk) => {
      if (!String(chunk).includes('STAGES_SYNCED')) return;
      clearTimeout(timeout);
      resolve();
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`stage_child_exited:${code}`));
    });
  });
  const closed = new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  child.kill('SIGTERM');
  await closed;
  const metadata = await stat(receipt);
  assert.equal(metadata.mode & 0o777, 0o600);
  const saved = JSON.parse(await readFile(receipt, 'utf8'));
  assert.equal(saved.schema_version, 1);
  assert.deepEqual(
    saved.events.map(({ source: phase, stage }) => [phase, stage]),
    [
      ['native', 'panel_context'],
      ['d47', 'signin'],
    ],
  );
  assert.ok(
    saved.events.every((event) => Number.isInteger(event.elapsed_ms) && event.elapsed_ms >= 0),
  );
  assert.equal(JSON.stringify(saved).includes('password'), false);
  assert.equal(JSON.stringify(saved).includes('http'), false);
});

test('D47 stage receipt refuses stage values outside its fixed vocabulary', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'd47-stage-refusal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const receipt = createNativeStageReceipt(join(root, 'stage.json'));
  assert.throws(() => receipt.record('d47', 'secret-value'), /native_stage_receipt_value_refused/);
});

test('D47 readiness polling rechecks resource health before each UI observation', async () => {
  let healthChecks = 0;
  let uiReads = 0;
  await assert.rejects(
    waitFor(
      'd47_resource_poll',
      async () => {
        uiReads++;
        return false;
      },
      Boolean,
      1000,
      (value) => value,
      async () => {
        healthChecks++;
        if (healthChecks === 2) throw new Error('NATIVE_RESOURCE_BOUNDARY_REFUSED:unsafe_sample');
      },
    ),
    /unsafe_sample/,
  );
  assert.equal(healthChecks, 2);
  assert.equal(uiReads, 1, 'a refused poll must not query the UI');
});
