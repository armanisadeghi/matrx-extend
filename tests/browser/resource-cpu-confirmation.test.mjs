import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cpuEpisode } from '../../scripts/stabilization-resource-cpu.mjs';
import { openResourceJournal } from '../../scripts/stabilization-resource-journal.mjs';
import { resourceVerdict } from '../../scripts/stabilization-resource-verdict.mjs';
import {
  awaitNativeResourceHealth,
  requireNativeResourceHealth,
  runNativeResourceAction,
} from './native-resource-boundary.mjs';

const policy = { watchIntervalSeconds: 15, unsafeSamplesToStop: 2, healthySamplesToResume: 3 };
const cpuBad = ['RESOURCE_CPU_BUSY'];
const diskBad = ['RESOURCE_DISK_LOW'];

test('real CPU state, journal, and native action boundary require confirmed recovery', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'resource-cpu-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const leaseRoot = join(root, 'lease');
  await mkdir(join(repo, 'docs/stabilization'), { recursive: true });
  await mkdir(join(leaseRoot, 'heavy'), { recursive: true });
  await writeFile(join(repo, 'docs/stabilization/resource-policy.json'), JSON.stringify(policy));
  const runId = `cpu-${randomUUID()}`;
  const nonce = randomUUID();
  const env = {
    MATRX_RESOURCE_RUN_ID: runId,
    MATRX_RESOURCE_OWNER: nonce,
    MATRX_RESOURCE_STOP_FILE: join(leaseRoot, `stop-${nonce}.json`),
  };
  await writeFile(
    join(leaseRoot, 'heavy/owner.json'),
    JSON.stringify({ runId, nonce, kind: 'run' }),
  );
  const journal = openResourceJournal(repo, runId);
  const start = Date.parse('2026-10-04T21:08:24.364Z');
  let elapsed = 0;
  let actions = 0;
  const cpu = cpuEpisode(policy, () => elapsed);
  const sample = { cpuBusyFraction: 0.52, availableMemoryGiB: 5.81 };
  const emit = (code, reasons = [], at = start + elapsed) =>
    journal.write({ schema: 1, runId, code, at: new Date(at).toISOString(), sample, reasons });
  const check = () =>
    requireNativeResourceHealth({ repo, leaseRoot, env, clock: () => start + elapsed });
  const action = () => runNativeResourceAction(check, () => ++actions);
  emit('RESOURCE_ADMITTED');
  emit('RESOURCE_WATCH_HEALTHY');
  assert.equal(await action(), 1);
  // Keep the previous healthy evidence fresh so dropping the pending check
  // would actually start an action, rather than merely trip stale health.
  emit('RESOURCE_WATCH_HEALTHY', [], start + 2_000);

  elapsed += 16_000;
  assert.equal(cpu.observe(cpuBad), 'pending');
  emit('RESOURCE_CPU_PENDING', cpuBad);
  await assert.rejects(action(), /cpu_pending/);
  assert.equal(actions, 1);
  let abandonedWaitMs = 0;
  await assert.rejects(
    runNativeResourceAction(
      () =>
        awaitNativeResourceHealth({
          repo,
          leaseRoot,
          env,
          clock: () => start + elapsed,
          monotonicClock: () => abandonedWaitMs,
          wait: async () => {
            abandonedWaitMs = 75_000;
          },
        }),
      () => ++actions,
    ),
    /cpu_pending_timeout/,
  );
  assert.equal(actions, 1);
  let waits = 0;
  assert.equal(
    await runNativeResourceAction(
      () =>
        awaitNativeResourceHealth({
          repo,
          leaseRoot,
          env,
          clock: () => start + elapsed,
          monotonicClock: () => elapsed,
          wait: async () => {
            assert.equal(actions, 1, 'no action while the guard owns a CPU candidate');
            elapsed += 16_000;
            waits++;
            const state = cpu.observe([]);
            emit(state === 'recovered' ? 'RESOURCE_CPU_RECOVERED' : 'RESOURCE_CPU_PENDING');
          },
        }),
      () => ++actions,
    ),
    2,
  );
  assert.equal(waits, 3);
  assert.equal(cpu.pending, false);
  const events = (await readFile(journal.path, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(
    events.map((event) => event.code),
    [
      'RESOURCE_ADMITTED',
      'RESOURCE_WATCH_HEALTHY',
      'RESOURCE_WATCH_HEALTHY',
      'RESOURCE_CPU_PENDING',
      'RESOURCE_CPU_PENDING',
      'RESOURCE_CPU_PENDING',
      'RESOURCE_CPU_RECOVERED',
    ],
  );
  assert.equal(
    resourceVerdict({ admitted: true, resourceInvalid: false, exitCode: 0, childFinished: true }),
    'valid',
  );
  journal.close();
});

test('two bad watches, other resource failure, and monotonic expiry never recover', () => {
  let elapsed = 0;
  const sustained = cpuEpisode(policy, () => elapsed);
  assert.equal(sustained.observe(cpuBad), 'pending');
  elapsed += 16_000;
  assert.equal(sustained.observe(cpuBad), 'unsafe');
  assert.equal(sustained.observe([]), 'unsafe');
  assert.equal(
    cpuEpisode({ ...policy, unsafeSamplesToStop: 1 }, () => elapsed).observe(cpuBad),
    'unsafe',
  );
  assert.equal(
    resourceVerdict({ admitted: true, resourceInvalid: true, exitCode: 0, childFinished: true }),
    'invalid',
  );

  const other = cpuEpisode(policy, () => elapsed);
  assert.equal(other.observe(diskBad), 'unsafe');
  assert.equal(other.observe(cpuBad), 'unsafe');
  assert.equal(other.observe(diskBad), 'unsafe');

  const expiry = cpuEpisode(policy, () => elapsed);
  assert.equal(expiry.observe(cpuBad), 'pending');
  elapsed += 74_999;
  assert.equal(expiry.observe([]), 'pending_watch');
  elapsed += 1;
  assert.equal(expiry.observe([]), 'expired');
  assert.equal(
    resourceVerdict({
      admitted: true,
      resourceInvalid: false,
      cpuPending: true,
      exitCode: 0,
      childFinished: true,
    }),
    'invalid',
  );
  assert.equal(
    resourceVerdict({ admitted: true, resourceInvalid: false, exitCode: 1, childFinished: true }),
    'child_failed',
  );
});
