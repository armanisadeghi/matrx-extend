import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  requireNativeResourceHealth,
  runNativeResourceAction,
} from '../tests/browser/native-resource-boundary.mjs';
import {
  copyResourceGuardModules,
  setHealthyHostMeasurements,
} from './stabilization-resource-test-measurements.mjs';

const source = resolve(import.meta.dirname, '..');
const highBlocks = 1600 * 1024 * 1024;
const lowBlocks = 116 * 1024;

async function requireHealthyHost(context) {
  assert.equal(process.platform, 'darwin', 'the real guard requires macOS');
  const disk = await statfs('/');
  const freeGiB = (Number(disk.bavail) * Number(disk.bsize)) / 1024 ** 3;
  if (freeGiB < 20) {
    context.skip(`host system volume has ${freeGiB.toFixed(2)} GiB free; no workload is admitted`);
    return false;
  }
  return true;
}

async function fixture() {
  const scratch = await mkdtemp(join(tmpdir(), 'resource-disk-guard-'));
  const scripts = join(scratch, 'scripts');
  const docs = join(scratch, 'docs/stabilization');
  const leaseRoot = join(scratch, 'lease');
  const phasePath = join(scratch, 'disk-phase');
  await mkdir(scripts);
  await mkdir(docs, { recursive: true });
  await copyResourceGuardModules(join(source, 'scripts'), scripts);
  await setHealthyHostMeasurements(scripts);

  const leasePath = join(scripts, 'stabilization-resource-lease.mjs');
  const leaseSource = await readFile(leasePath, 'utf8');
  const isolatedLease = leaseSource.replace(
    "return join('/var/tmp', leaseName(uid));",
    `return ${JSON.stringify(leaseRoot)};`,
  );
  assert.notEqual(isolatedLease, leaseSource);
  await writeFile(leasePath, isolatedLease);

  // Only resource measurements are replaced in this scratch copy. The real
  // sampleDiskSpace, reasons, preflight, watchdog, ownership and verdict run.
  const safetyPath = join(scripts, 'stabilization-resource-safety.mjs');
  const safetySource = await readFile(safetyPath, 'utf8');
  const measured = safetySource
    .replace(
      "import { statfs, writeFile } from 'node:fs/promises';",
      "import { readFile, statfs, writeFile } from 'node:fs/promises';",
    )
    .replace(
      'statfsFn = statfs',
      `statfsFn = async (path) => {
        const phase = (await readFile(${JSON.stringify(phasePath)}, 'utf8')).trim();
        const low = (phase === 'low-system' && path === '/') ||
          (phase === 'low-lease' && path === ${JSON.stringify(leaseRoot)});
        return { bavail: low ? ${lowBlocks} : ${highBlocks}, bsize: 1024 };
      }`,
    );
  assert.notEqual(measured, safetySource);
  assert(measured.includes('import { readFile, statfs, writeFile }'));
  await writeFile(safetyPath, measured);

  const policy = JSON.parse(
    await readFile(join(source, 'docs/stabilization/resource-policy.json')),
  );
  assert.equal(policy.minimumFreeDiskGiB, 20);
  policy.swapWindowSeconds = 2;
  policy.cpuSampleIntervalSeconds = 1;
  policy.watchIntervalSeconds = 2;
  policy.allowedCommands.push(['node', 'scripts/disk-workload.mjs']);
  await writeFile(join(docs, 'resource-policy.json'), `${JSON.stringify(policy)}\n`);
  await writeFile(
    join(scripts, 'disk-workload.mjs'),
    'process.stdout.write(`WORKLOAD_ALIVE:${process.pid}\\n`); setInterval(() => {}, 1000);\n',
  );
  return { scratch, scripts, docs, leaseRoot, phasePath };
}

async function eventsFor(docs, runId) {
  return (await readFile(join(docs, 'resource-journals', `${runId}.jsonl`), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
}

test(
  'a low system volume refuses guard admission despite healthy repo, profile and lease',
  {
    timeout: 60_000,
  },
  async (context) => {
    if (!(await requireHealthyHost(context))) return;
    const item = await fixture();
    const runId = `low-system-${randomUUID()}`;
    try {
      await writeFile(item.phasePath, 'low-system\n');
      const result = spawnSync(
        process.execPath,
        [
          join(item.scripts, 'stabilization-resource.mjs'),
          'check',
          '--run-id',
          runId,
          '--profile-dir',
          item.scratch,
        ],
        { cwd: item.scratch, encoding: 'utf8', timeout: 30_000 },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 2, result.stderr);
      const events = await eventsFor(item.docs, runId);
      const refusal = events.find((event) => event.code === 'RESOURCE_PREFLIGHT_REFUSED');
      assert(refusal);
      assert(refusal.reasons.includes('RESOURCE_DISK_LOW'));
      assert.equal(refusal.sample.repoFreeGiB, 1600);
      assert.equal(refusal.sample.profileFreeGiB, 1600);
      assert.equal(refusal.sample.safetyFreeGiB, 1600);
      assert.equal(refusal.sample.systemFreeGiB, 116 / 1024);
      assert.equal(
        events.some((event) => event.code === 'RESOURCE_ADMITTED'),
        false,
      );
      assert.equal(events.at(-1).decision, 'refused');
      await assert.rejects(stat(join(item.leaseRoot, 'heavy')), { code: 'ENOENT' });
    } finally {
      await rm(item.scratch, { recursive: true, force: true });
    }
  },
);

test(
  'a lease volume that falls after admission stops live owned work and invalidates the guard',
  {
    timeout: 90_000,
  },
  async (context) => {
    if (!(await requireHealthyHost(context))) return;
    const item = await fixture();
    const runId = `low-lease-${randomUUID()}`;
    let guard;
    let closed = false;
    let workloadPid;
    let phaseError;
    let refusalPromise;
    let nativeActionRan = false;
    let timeout;
    try {
      await writeFile(item.phasePath, 'high\n');
      guard = spawn(
        process.execPath,
        [
          join(item.scripts, 'stabilization-resource.mjs'),
          'run',
          '--run-id',
          runId,
          '--profile-dir',
          item.scratch,
          '--',
          'node',
          'scripts/disk-workload.mjs',
        ],
        { cwd: item.scratch, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      guard.once('close', () => {
        closed = true;
      });
      let stdout = '';
      let stderr = '';
      guard.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (!refusalPromise && stdout.includes('"code":"RESOURCE_WATCH_UNSAFE"')) {
          refusalPromise = (async () => {
            const owner = JSON.parse(
              await readFile(join(item.leaseRoot, 'heavy', 'owner.json'), 'utf8'),
            );
            await assert.rejects(
              runNativeResourceAction(
                () =>
                  requireNativeResourceHealth({
                    repo: item.scratch,
                    leaseRoot: item.leaseRoot,
                    env: {
                      MATRX_RESOURCE_RUN_ID: runId,
                      MATRX_RESOURCE_OWNER: owner.nonce,
                      MATRX_RESOURCE_STOP_FILE: join(item.leaseRoot, `stop-${owner.nonce}.json`),
                    },
                  }),
                () => {
                  nativeActionRan = true;
                },
              ),
              // The watchdog may persist its hold/stop before this concurrent read.
              /NATIVE_RESOURCE_BOUNDARY_REFUSED:(?:unsafe_sample|unsafe_hold|stop_requested)$/,
            );
          })();
          void refusalPromise.catch(() => {});
        }
        if (workloadPid) return;
        const match = stdout.match(/WORKLOAD_ALIVE:(\d+)/);
        if (!match) return;
        workloadPid = Number(match[1]);
        void writeFile(item.phasePath, 'low-lease\n').catch((error) => {
          phaseError = error;
          guard.kill('SIGTERM');
        });
      });
      guard.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      timeout = setTimeout(() => guard.kill('SIGTERM'), 45_000);
      const exit = await new Promise((resolveExit, reject) => {
        guard.once('error', reject);
        guard.once('close', (code, signal) => resolveExit({ code, signal }));
      });
      assert.equal(phaseError, undefined);
      assert(workloadPid, stdout);
      assert(refusalPromise, stdout);
      await refusalPromise;
      assert.equal(nativeActionRan, false);
      assert.deepEqual(exit, { code: 3, signal: null }, stderr);
      const events = await eventsFor(item.docs, runId);
      assert(events.some((event) => event.code === 'RESOURCE_ADMITTED'));
      const unsafe = events.find((event) => event.code === 'RESOURCE_WATCH_UNSAFE');
      assert(unsafe);
      assert(unsafe.reasons.includes('RESOURCE_DISK_LOW'));
      const attribution = events.find((event) => event.code === 'RESOURCE_PROCESS_ATTRIBUTION');
      assert(attribution);
      assert.equal(attribution.unavailable, undefined);
      assert(Array.isArray(attribution.processes));
      for (const process of attribution.processes) {
        assert.deepEqual(Object.keys(process).sort(), [
          'cpuPercent',
          'executable',
          'parentPid',
          'pid',
        ]);
        assert.equal(process.executable.includes('/'), false);
      }
      assert.equal(unsafe.sample.repoFreeGiB, 1600);
      assert.equal(unsafe.sample.profileFreeGiB, 1600);
      assert.equal(unsafe.sample.safetyFreeGiB, 116 / 1024);
      assert.equal(unsafe.sample.systemFreeGiB, 1600);
      assert(events.some((event) => event.code === 'RESOURCE_STOP_AT_SAFE_BOUNDARY'));
      assert.deepEqual(
        { decision: events.at(-1).decision, resourceInvalid: events.at(-1).resourceInvalid },
        { decision: 'invalid', resourceInvalid: true },
      );
      assert.throws(() => process.kill(workloadPid, 0), { code: 'ESRCH' });
      assert.equal((await stat(join(item.leaseRoot, 'unsafe-hold.json'))).isFile(), true);
    } finally {
      clearTimeout(timeout);
      if (guard && !closed) {
        guard.kill('SIGTERM');
        await new Promise((resolveExit) => guard.once('close', resolveExit));
      }
      let workloadAlive = false;
      if (workloadPid) {
        try {
          process.kill(workloadPid, 0);
          workloadAlive = true;
        } catch (error) {
          if (error.code !== 'ESRCH') workloadAlive = true;
        }
      }
      if (!workloadAlive) await rm(item.scratch, { recursive: true, force: true });
    }
  },
);
