import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  requireNativeResourceHealth,
  runNativeResourceAction,
} from '../tests/browser/native-resource-boundary.mjs';
import {
  copyResourceGuardModules,
  setHealthyHostMeasurements,
} from './stabilization-resource-test-measurements.mjs';

const source = resolve(import.meta.dirname, '..');
const watchCodes = new Set([
  'RESOURCE_CPU_PENDING',
  'RESOURCE_CPU_RECOVERED',
  'RESOURCE_WATCH_HEALTHY',
  'RESOURCE_WATCH_UNSAFE',
]);

async function fixture() {
  const scratch = await mkdtemp(join(tmpdir(), 'resource-cpu-wrapper-'));
  const scripts = join(scratch, 'scripts');
  const docs = join(scratch, 'docs/stabilization');
  const leaseRoot = join(scratch, 'lease');
  const cpuPhase = join(scratch, 'cpu-phase');
  const childPhase = join(scratch, 'child-phase');
  await mkdir(scripts);
  await mkdir(docs, { recursive: true });
  await copyResourceGuardModules(join(source, 'scripts'), scripts);
  await setHealthyHostMeasurements(scripts);
  const guardPath = join(scripts, 'stabilization-resource.mjs');
  let guardSource = await readFile(guardPath, 'utf8');
  // Only the external CPU measurement is controlled. The real wrapper owns
  // preflight, watch decisions, journal writes, child lifecycle and verdict.
  assert.equal(guardSource.split('Promise.resolve(0.1),').length, 2);
  guardSource = guardSource.replace(
    'Promise.resolve(0.1),',
    `readFile(${JSON.stringify(cpuPhase)}, 'utf8').then(Number),`,
  );
  await writeFile(guardPath, guardSource);
  const safetyPath = join(scripts, 'stabilization-resource-safety.mjs');
  const safetySource = await readFile(safetyPath, 'utf8');
  assert.equal(safetySource.split('statfsFn = statfs').length, 2);
  await writeFile(
    safetyPath,
    safetySource.replace(
      'statfsFn = statfs',
      'statfsFn = async () => ({ bavail: 1600 * 1024 * 1024, bsize: 1024 })',
    ),
  );
  const leasePath = join(scripts, 'stabilization-resource-lease.mjs');
  const leaseSource = await readFile(leasePath, 'utf8');
  assert.equal(leaseSource.split("return join('/var/tmp', leaseName(uid));").length, 2);
  await writeFile(
    leasePath,
    leaseSource.replace(
      "return join('/var/tmp', leaseName(uid));",
      `return ${JSON.stringify(leaseRoot)};`,
    ),
  );
  const policy = JSON.parse(
    await readFile(join(source, 'docs/stabilization/resource-policy.json')),
  );
  assert.equal(policy.unsafeSamplesToStop, 2);
  assert.equal(policy.healthySamplesToResume, 3);
  assert.equal(policy.minimumFreeDiskGiB, 20);
  policy.swapWindowSeconds = 1;
  policy.cpuSampleIntervalSeconds = 0.5;
  policy.watchIntervalSeconds = 0.5;
  await writeFile(join(docs, 'resource-policy.json'), `${JSON.stringify(policy)}\n`);
  await writeFile(cpuPhase, '0.1\n');
  await writeFile(childPhase, 'run\n');
  await writeFile(
    join(scripts, 'prove-desktop-settings-guards.mjs'),
    `import { readFile } from 'node:fs/promises';
     setInterval(async () => {
       if ((await readFile(${JSON.stringify(childPhase)}, 'utf8')).trim() === 'exit0') process.exit(0);
     }, 20);
    `,
  );
  return { scratch, docs, leaseRoot, cpuPhase, childPhase, guardPath };
}

function observe(child) {
  const events = [];
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    const lines = stdout.split('\n');
    stdout = lines.pop();
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // The owned test child may print ordinary output.
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  let consumed = 0;
  return {
    async next(predicate) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        while (consumed < events.length) {
          const event = events[consumed++];
          if (predicate(event)) return event;
        }
        if (child.exitCode !== null)
          throw new Error(`guard exited before expected event: ${stderr}`);
        await new Promise((done) => setTimeout(done, 10));
      }
      throw new Error(`guard event timeout: ${stderr}`);
    },
    get stderr() {
      return stderr;
    },
  };
}

async function runScenario(kind) {
  const item = await fixture();
  const runId = `cpu-${kind}-${randomUUID()}`;
  const child = spawn(
    process.execPath,
    [
      item.guardPath,
      'run',
      '--run-id',
      runId,
      '--profile-dir',
      item.scratch,
      '--',
      'node',
      'scripts/prove-desktop-settings-guards.mjs',
    ],
    { cwd: item.scratch, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const stream = observe(child);
  const closed = new Promise((done) =>
    child.once('close', (code, signal) => done({ code, signal })),
  );
  let finished = false;
  try {
    await stream.next((event) => event.code === 'RESOURCE_ADMITTED');
    const owner = JSON.parse(await readFile(join(item.leaseRoot, 'heavy/owner.json'), 'utf8'));
    const env = {
      MATRX_RESOURCE_RUN_ID: runId,
      MATRX_RESOURCE_OWNER: owner.nonce,
      MATRX_RESOURCE_STOP_FILE: join(item.leaseRoot, `stop-${owner.nonce}.json`),
    };
    const check = () =>
      requireNativeResourceHealth({ repo: item.scratch, leaseRoot: item.leaseRoot, env });
    let actions = 0;
    await writeFile(item.cpuPhase, '0.88\n');
    const first = await stream.next((event) => watchCodes.has(event.code));
    assert.equal(
      first.code,
      'RESOURCE_CPU_PENDING',
      `first CPU watch must block: ${JSON.stringify(first)}`,
    );
    assert.deepEqual(first.reasons, ['RESOURCE_CPU_BUSY']);
    await assert.rejects(
      runNativeResourceAction(check, () => ++actions),
      /cpu_pending/,
    );
    assert.equal(actions, 0);
    if (kind === 'recovered') {
      await writeFile(item.cpuPhase, '0.1\n');
      for (let i = 0; i < 2; i++) {
        const watch = await stream.next((event) => watchCodes.has(event.code));
        assert.equal(watch.code, 'RESOURCE_CPU_PENDING');
        assert.deepEqual(watch.reasons, []);
        await assert.rejects(
          runNativeResourceAction(check, () => ++actions),
          /cpu_pending/,
        );
      }
      const recovered = await stream.next((event) => watchCodes.has(event.code));
      assert.equal(recovered.code, 'RESOURCE_CPU_RECOVERED');
      assert.deepEqual(recovered.reasons, []);
      assert.equal(await runNativeResourceAction(check, () => ++actions), 1);
      await writeFile(item.childPhase, 'exit0\n');
    } else if (kind === 'confirmed') {
      const second = await stream.next((event) => watchCodes.has(event.code));
      assert.equal(second.code, 'RESOURCE_WATCH_UNSAFE');
      await assert.rejects(
        runNativeResourceAction(check, () => ++actions),
        /unsafe_sample|stop_requested|unsafe_hold/,
      );
    } else {
      await writeFile(item.childPhase, 'exit0\n');
    }
    const exit = await closed;
    finished = true;
    assert.deepEqual(exit, { code: kind === 'recovered' ? 0 : 3, signal: null }, stream.stderr);
    const journal = (await readFile(join(item.docs, 'resource-journals', `${runId}.jsonl`), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(journal.at(-1).decision, kind === 'recovered' ? 'valid' : 'invalid');
    assert.equal(journal.at(-1).resourceInvalid, kind !== 'recovered');
    if (kind === 'confirmed') {
      assert(journal.some((event) => event.code === 'RESOURCE_STOP_AT_SAFE_BOUNDARY'));
      assert.equal((await stat(join(item.leaseRoot, 'unsafe-hold.json'))).isFile(), true);
    }
    assert.equal(actions, kind === 'recovered' ? 1 : 0);
  } finally {
    if (!finished) {
      child.kill('SIGTERM');
      await closed;
    }
    await rm(item.scratch, { recursive: true, force: true });
  }
}

test(
  'actual guard watch journal controls recovery, confirmation, and pending child exit',
  { timeout: 30_000 },
  async () => {
    await runScenario('recovered');
    await runScenario('confirmed');
    await runScenario('pending-exit');
  },
);
