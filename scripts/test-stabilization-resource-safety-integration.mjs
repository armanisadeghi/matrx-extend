import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  copyResourceGuardModules,
  setHealthyHostMeasurements,
} from './stabilization-resource-test-measurements.mjs';

const source = resolve(import.meta.dirname, '..');

test('scratch guard loads its complete local module graph before resource admission', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'resource-guard-bootstrap-'));
  const scripts = join(scratch, 'scripts');
  const docs = join(scratch, 'docs/stabilization');
  try {
    await mkdir(scripts);
    await mkdir(docs, { recursive: true });
    await copyResourceGuardModules(join(source, 'scripts'), scripts);
    await copyFile(
      join(source, 'docs/stabilization/resource-policy.json'),
      join(docs, 'resource-policy.json'),
    );
    const guardPath = join(scripts, 'stabilization-resource.mjs');
    const run = () =>
      spawnSync(process.execPath, [guardPath, 'invalid-mode'], { encoding: 'utf8' });
    const loaded = run();
    assert.equal(loaded.status, 2, loaded.stderr);
    assert.match(loaded.stdout, /"code":"RESOURCE_ARGUMENT_INVALID"/);

    await rm(join(scripts, 'startup-interval-attribution.mjs'));
    const missing = run();
    assert.equal(missing.status, 1, missing.stderr);
    assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test(
  'a marker write failure in a running guard invalidates the run and retains its lease',
  {
    timeout: 120_000,
  },
  async (context) => {
    assert.equal(process.platform, 'darwin', 'this integration fixture needs the macOS guard host');
    const system = await statfs('/');
    const systemFreeGiB = (Number(system.bavail) * Number(system.bsize)) / 1024 ** 3;
    if (systemFreeGiB < 20) {
      context.skip(
        `system volume has ${systemFreeGiB.toFixed(2)} GiB free; guard correctly refuses below 20 GiB`,
      );
      return;
    }
    const scratch = await mkdtemp(join(tmpdir(), 'resource-safety-guard-'));
    const scripts = join(scratch, 'scripts');
    const docs = join(scratch, 'docs/stabilization');
    const leaseRoot = join(scratch, 'lease');
    const runId = `safety-write-${randomUUID()}`;
    let guard;
    let guardClosed = false;
    let workloadPid;
    let markerWriteError;
    let timeout;
    try {
      await mkdir(scripts);
      await mkdir(docs, { recursive: true });
      await copyResourceGuardModules(join(source, 'scripts'), scripts);
      await setHealthyHostMeasurements(scripts);

      // Isolate the real ownership protocol from other runs on the host. The
      // copied guard still samples actual disk volumes; unrelated CPU, memory,
      // pressure and swap readings are deterministic for this failure case.
      const leasePath = join(scripts, 'stabilization-resource-lease.mjs');
      const leaseSource = await readFile(leasePath, 'utf8');
      const isolatedLease = leaseSource.replace(
        "return join('/var/tmp', leaseName(uid));",
        `return ${JSON.stringify(leaseRoot)};`,
      );
      assert.notEqual(isolatedLease, leaseSource);
      await writeFile(leasePath, isolatedLease);

      const policy = JSON.parse(
        await readFile(join(source, 'docs/stabilization/resource-policy.json')),
      );
      assert.equal(policy.minimumFreeDiskGiB, 20);
      policy.swapWindowSeconds = 2;
      policy.cpuSampleIntervalSeconds = 1;
      policy.watchIntervalSeconds = 2;
      policy.healthySamplesToResume = 1;
      policy.allowedCommands.push(['node', 'scripts/safety-workload.mjs']);
      await writeFile(join(docs, 'resource-policy.json'), `${JSON.stringify(policy)}\n`);
      await writeFile(
        join(scripts, 'safety-workload.mjs'),
        'process.stdout.write(`WORKLOAD_ALIVE:${process.pid}\\n`); setInterval(() => {}, 1000);\n',
      );

      guard = spawn(
        process.execPath,
        [
          join(scripts, 'stabilization-resource.mjs'),
          'run',
          '--run-id',
          runId,
          '--profile-dir',
          scratch,
          '--',
          'node',
          'scripts/safety-workload.mjs',
        ],
        { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      guard.once('close', () => {
        guardClosed = true;
      });
      let stdout = '';
      let stderr = '';
      let markerReady = false;
      guard.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (markerReady) return;
        const match = stdout.match(/WORKLOAD_ALIVE:(\d+)/);
        if (!match) return;
        markerReady = true;
        workloadPid = Number(match[1]);
        const hold = join(leaseRoot, 'unsafe-hold.json');
        void (async () => {
          try {
            await writeFile(
              hold,
              `${JSON.stringify({ schema: 1, runId, healthySamples: 0, reason: ['private payload'] })}\n`,
              {
                mode: 0o400,
              },
            );
            await chmod(hold, 0o400);
          } catch (error) {
            markerWriteError = error;
            guard.kill('SIGTERM');
          }
        })();
      });
      guard.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      timeout = setTimeout(() => guard.kill('SIGTERM'), 45_000);
      const exit = await new Promise((resolveExit, reject) => {
        guard.once('error', reject);
        guard.once('close', (code, signal) => resolveExit({ code, signal }));
      });

      assert.equal(markerReady, true, stdout + stderr);
      assert.equal(markerWriteError, undefined);
      assert.deepEqual(exit, { code: 3, signal: null }, stderr);
      const journal = (await readFile(join(docs, 'resource-journals', `${runId}.jsonl`), 'utf8'))
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert(journal.some((event) => event.code === 'RESOURCE_ADMITTED'));
      assert(journal.some((event) => event.code === 'RESOURCE_SAFETY_STATE_WRITE_FAILED'));
      assert.deepEqual(
        {
          decision: journal.at(-1).decision,
          resourceInvalid: journal.at(-1).resourceInvalid,
          exitCode: journal.at(-1).exitCode,
        },
        { decision: 'invalid', resourceInvalid: true, exitCode: 3 },
      );
      assert.equal((await stat(join(leaseRoot, 'heavy', 'owner.json'))).isFile(), true);
      assert.equal((await stat(join(leaseRoot, 'unsafe-hold.json'))).mode & 0o777, 0o400);
      assert.throws(() => process.kill(workloadPid, 0), { code: 'ESRCH' });
      assert.doesNotMatch(stdout + stderr + JSON.stringify(journal), /private payload/);
    } finally {
      clearTimeout(timeout);
      if (guard && !guardClosed) {
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
      if (!workloadAlive) await rm(scratch, { recursive: true, force: true });
    }
  },
);
