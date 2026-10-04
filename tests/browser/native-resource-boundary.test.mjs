import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  awaitNativeResourceHealth,
  requireNativeResourceHealth,
  runNativeResourceAction,
} from './native-resource-boundary.mjs';

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
    sample: { memoryAvailableGiB: 12 },
    reasons: [],
  };
  const healthy = {
    schema: 1,
    runId,
    code: 'RESOURCE_WATCH_HEALTHY',
    at: '2026-10-04T09:14:20.000Z',
    sample: { memoryAvailableGiB: 12 },
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
