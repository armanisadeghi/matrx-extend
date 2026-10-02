import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const source = resolve(import.meta.dirname, '..');

test(
  'a marker write failure in a running guard invalidates the run and retains its lease',
  {
    timeout: 120_000,
  },
  async () => {
    assert.equal(process.platform, 'darwin', 'this integration fixture needs the macOS guard host');
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
      for (const name of [
        'stabilization-resource.mjs',
        'stabilization-resource-safety.mjs',
        'stabilization-resource-journal.mjs',
        'stabilization-resource-lease.mjs',
        'stabilization-resource-process.mjs',
        'stabilization-resource-verdict.mjs',
      ])
        await copyFile(join(source, 'scripts', name), join(scripts, name));

      // Isolate the real ownership protocol from other runs on the host. The
      // copied guard still samples the independent / volume and the real lease.
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

      assert.equal(markerReady, true, stdout);
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
