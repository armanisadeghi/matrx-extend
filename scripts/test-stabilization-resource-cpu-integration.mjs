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
const safeReasonCodes = new Set([
  'RESOURCE_PRESSURE_UNSAFE',
  'RESOURCE_MEMORY_LOW',
  'RESOURCE_CPU_BUSY',
  'RESOURCE_CPU_HIGH_LOAD_BUSY',
  'RESOURCE_DISK_LOW',
  'RESOURCE_SWAP_BASELINE_MISSING',
  'RESOURCE_SWAP_GROWTH',
  'RESOURCE_CPU_CONFIRMATION_EXPIRED',
]);

function diagnosticReasonCode(reason) {
  if (safeReasonCodes.has(reason)) return reason;
  if (typeof reason === 'string' && reason.startsWith('RESOURCE_MEASUREMENT_FAILED:'))
    return 'RESOURCE_MEASUREMENT_FAILED';
  return 'RESOURCE_REASON_OTHER';
}

async function fixture({ pauseOwnerRewrite = false, simulateChildError = false } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'resource-cpu-wrapper-'));
  const scripts = join(scratch, 'scripts');
  const docs = join(scratch, 'docs/stabilization');
  const leaseRoot = join(scratch, 'lease');
  const cpuPhase = join(scratch, 'cpu-phase');
  const memoryPhase = join(scratch, 'memory-phase');
  const childPhase = join(scratch, 'child-phase');
  const ownerRewriteRelease = join(scratch, 'owner-rewrite-release');
  await mkdir(scripts);
  await mkdir(docs, { recursive: true });
  await copyResourceGuardModules(join(source, 'scripts'), scripts);
  await setHealthyHostMeasurements(scripts);
  const guardPath = join(scripts, 'stabilization-resource.mjs');
  let guardSource = await readFile(guardPath, 'utf8');
  const healthyMemory = "Promise.resolve('System-wide memory free percentage: 80%'),";
  assert.equal(guardSource.split(healthyMemory).length, 2);
  guardSource = guardSource.replace(
    healthyMemory,
    `readFile(${JSON.stringify(memoryPhase)}, 'utf8').then((value) =>
      'System-wide memory free percentage: ' + value.trim() + '%'),`,
  );
  // Only the external CPU measurement is controlled. The real wrapper owns
  // preflight, watch decisions, journal writes, child lifecycle and verdict.
  assert.equal(guardSource.split('Promise.resolve(0.1),').length, 2);
  guardSource = guardSource.replace(
    'Promise.resolve(0.1),',
    `readFile(${JSON.stringify(cpuPhase)}, 'utf8').then(async (raw) => {
      if (raw.trim() === 'slow-healthy') {
        await sleep(3000);
        return 0.1;
      }
      return Number(raw);
    }),`,
  );
  // The outer real-host guard owns admission for this test. Nested scratch
  // guards exercise watch/lifecycle behavior and must not refuse their
  // legitimate ancestor as another live host runner.
  const hostOwnershipCheck = 'await assertNoLegacyWork();';
  assert.equal(guardSource.split(hostOwnershipCheck).length, 2);
  if (process.env.MATRX_RESOURCE_OWNER)
    guardSource = guardSource.replace(hostOwnershipCheck, '/* outer guard owns host admission */');
  if (process.env.MATRX_CPU_COMPLETION_SELF_TEST === '1') {
    const successfulExit = 'cpu.pending &&\n          result.childExitCode === 0 &&';
    assert.equal(guardSource.split(successfulExit).length, 2);
    guardSource = guardSource.replace(
      successfulExit,
      'false &&\n          result.childExitCode === 0 &&',
    );
  }
  if (simulateChildError) {
    // Simulate the external ChildProcess error event only. The copied guard
    // still owns settlement, descendant cleanup, journal, and final verdict.
    const errorListener = "child.once('error', (error) =>";
    assert.equal(guardSource.split(errorListener).length, 2);
    guardSource = guardSource.replace(
      errorListener,
      `const errorProbe = setInterval(async () => {
          if ((await readFile(${JSON.stringify(childPhase)}, 'utf8')).trim() === 'error') {
            clearInterval(errorProbe);
            child.emit('error', new Error('synthetic child error'));
          }
        }, 20);
        errorProbe.unref();
        ${errorListener}`,
    );
  }
  if (pauseOwnerRewrite) {
    // Hold the real startup writer after truncation. The parent must wait for
    // watch readiness rather than treating admission as completed child setup.
    const startupWrite = 'owner.childPending = true;';
    assert.equal(guardSource.split(startupWrite).length, 2);
    guardSource = guardSource.replace(
      startupWrite,
      `${startupWrite}
      await writeFile(join(lock, 'owner.json'), '');
      console.log(JSON.stringify({ code: 'TEST_OWNER_REWRITE_PAUSED' }));
      while (!stop && !existsSync(${JSON.stringify(ownerRewriteRelease)})) await sleep(5);
    `,
    );
  }
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
  await writeFile(memoryPhase, '80\n');
  await writeFile(childPhase, 'run\n');
  await writeFile(
    join(scripts, 'prove-desktop-settings-guards.mjs'),
    `import { readFile } from 'node:fs/promises';
     setInterval(async () => {
       const phase = (await readFile(${JSON.stringify(childPhase)}, 'utf8')).trim();
       if (phase === 'exit0') process.exit(0);
       if (phase === 'exit1') process.exit(1);
     }, 20);
    `,
  );
  return {
    scratch,
    docs,
    leaseRoot,
    cpuPhase,
    memoryPhase,
    childPhase,
    guardPath,
    ownerRewriteRelease,
  };
}

function observe(child, onEvent) {
  const events = [];
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    const lines = stdout.split('\n');
    stdout = lines.pop();
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        events.push(event);
        if (event && typeof event.code === 'string') onEvent(event);
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
          throw new Error(
            `guard exited before expected event: ${stderr} ${JSON.stringify(events)}`,
          );
        await new Promise((done) => setTimeout(done, 10));
      }
      throw new Error(`guard event timeout: ${stderr}`);
    },
    get stderr() {
      return stderr;
    },
  };
}

function scenarioDiagnostic(kind, groupStartedAt) {
  const startedAt = process.hrtime.bigint();
  const elapsedMs = (start) => Number((process.hrtime.bigint() - start) / 1_000_000n);
  let stage = 'fixture';
  let lastGuardEvent = null;
  let child = null;
  let childClosed = false;
  let cleanup = 'not_started';
  const report = (point) => {
    console.error(
      `resource-cpu-scenario ${JSON.stringify({
        kind,
        point,
        elapsedMs: elapsedMs(startedAt),
        groupElapsedMs: elapsedMs(groupStartedAt),
        stage,
        lastGuardEvent,
        child: child
          ? {
              pid: child.pid ?? null,
              exitCode: child.exitCode,
              signalCode: child.signalCode,
              closed: childClosed,
            }
          : null,
        cleanup,
      })}`,
    );
  };
  // Node's test timeout can fire while a scenario is awaiting a guard event.
  // A live, unref'ed status line preserves the active scenario in CI output.
  const ticker = setInterval(() => report('progress'), 1_000);
  ticker.unref();
  report('start');
  return {
    report,
    stop: () => clearInterval(ticker),
    setStage: (value) => {
      stage = value;
    },
    setChild: (value) => {
      child = value;
    },
    setChildClosed: () => {
      childClosed = true;
    },
    setCleanup: (value) => {
      cleanup = value;
    },
    onEvent: (event) => {
      lastGuardEvent = {
        code: event.code,
        ...(Array.isArray(event.reasons) && {
          reasons: [...new Set(event.reasons.slice(0, 10).map(diagnosticReasonCode))],
        }),
        ...(event.childExitCode !== undefined && { childExitCode: event.childExitCode }),
      };
      report('guard_event');
    },
  };
}

async function readWatchReadyOwner(stream, item) {
  // Admission precedes truncate/writeFile updates to owner.json. A watch event
  // is emitted only after child setup and all startup owner writes complete.
  const ready = await stream.next((event) => watchCodes.has(event.code));
  assert.equal(ready.code, 'RESOURCE_WATCH_HEALTHY');
  return JSON.parse(await readFile(join(item.leaseRoot, 'heavy/owner.json'), 'utf8'));
}

async function runScenario(kind, groupStartedAt, { pauseOwnerRewrite = false } = {}) {
  const diagnostic = scenarioDiagnostic(kind, groupStartedAt);
  let item;
  let child;
  let closed;
  let finished = false;
  let scenarioError;
  try {
    item = await fixture({
      pauseOwnerRewrite,
      simulateChildError: kind === 'pending-child-error',
    });
    const runId = `cpu-${kind}-${randomUUID()}`;
    diagnostic.setStage('guard_spawn');
    child = spawn(
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
    diagnostic.setChild(child);
    const stream = observe(child, diagnostic.onEvent);
    closed = new Promise((done) =>
      child.once('close', (code, signal) => {
        diagnostic.setChildClosed();
        done({ code, signal });
      }),
    );
    diagnostic.setStage('admission');
    await stream.next((event) => event.code === 'RESOURCE_ADMITTED');
    if (pauseOwnerRewrite) {
      await stream.next((event) => event.code === 'TEST_OWNER_REWRITE_PAUSED');
      const incomplete = await readFile(join(item.leaseRoot, 'heavy/owner.json'), 'utf8');
      assert.equal(incomplete, '');
      assert.throws(() => JSON.parse(incomplete), /Unexpected end of JSON input/);
    }
    // Release the writer only when readiness starts waiting for a watch. If
    // that wait is removed, the owner read deterministically sees empty JSON.
    const readinessStream = pauseOwnerRewrite
      ? {
          async next(predicate) {
            await writeFile(item.ownerRewriteRelease, 'release\n');
            return stream.next(predicate);
          },
        }
      : stream;
    const owner = await readWatchReadyOwner(readinessStream, item);
    diagnostic.setStage('watch');
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
    if (
      [
        'recovered',
        'completion-recovered',
        'completion-unsafe',
        'completion-expired',
        'completion-memory-unsafe',
        'completion-stop',
      ].includes(kind)
    ) {
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
      if (kind.startsWith('completion-')) {
        await writeFile(item.childPhase, 'exit0\n');
        await stream.next((event) => event.code === 'RESOURCE_JOB_EXIT');
        assert.equal(child.exitCode, null, 'lease holder must remain alive while CPU is pending');
        const heldOwner = JSON.parse(
          await readFile(join(item.leaseRoot, 'heavy/owner.json'), 'utf8'),
        );
        assert.equal(heldOwner.nonce, owner.nonce, 'same lease must remain held after child exit');
        await assert.rejects(
          runNativeResourceAction(check, () => ++actions),
          /run_stopped/,
        );
        if (kind === 'completion-unsafe') await writeFile(item.cpuPhase, '0.88\n');
        if (kind === 'completion-expired') await writeFile(item.cpuPhase, 'slow-healthy\n');
        if (kind === 'completion-memory-unsafe') await writeFile(item.memoryPhase, '10\n');
        if (kind === 'completion-stop') {
          child.kill('SIGTERM');
          await stream.next((event) => event.code === 'RESOURCE_STOP_REQUESTED');
        }
      }
      if (kind !== 'completion-stop') {
        const next = await stream.next((event) => watchCodes.has(event.code));
        assert.equal(
          next.code,
          kind === 'completion-unsafe'
            ? 'RESOURCE_CPU_PENDING'
            : kind === 'completion-expired' || kind === 'completion-memory-unsafe'
              ? 'RESOURCE_WATCH_UNSAFE'
              : 'RESOURCE_CPU_RECOVERED',
        );
        if (kind === 'completion-expired')
          assert.deepEqual(next.reasons, ['RESOURCE_CPU_CONFIRMATION_EXPIRED']);
        if (kind === 'completion-memory-unsafe')
          assert.deepEqual(next.reasons, ['RESOURCE_MEMORY_LOW']);
        if (kind === 'completion-unsafe') {
          const unsafe = await stream.next((event) => watchCodes.has(event.code));
          assert.equal(unsafe.code, 'RESOURCE_WATCH_UNSAFE');
        }
        if (
          !['completion-unsafe', 'completion-expired', 'completion-memory-unsafe'].includes(kind)
        ) {
          assert.deepEqual(next.reasons, []);
          if (kind === 'recovered') {
            assert.equal(await runNativeResourceAction(check, () => ++actions), 1);
            await writeFile(item.childPhase, 'exit0\n');
          }
        }
      }
    } else if (kind === 'confirmed') {
      const second = await stream.next((event) => watchCodes.has(event.code));
      assert.equal(second.code, 'RESOURCE_WATCH_UNSAFE');
      await assert.rejects(
        runNativeResourceAction(check, () => ++actions),
        /unsafe_sample|stop_requested|unsafe_hold/,
      );
    } else {
      await writeFile(
        item.childPhase,
        kind === 'pending-failed-child'
          ? 'exit1\n'
          : kind === 'pending-child-error'
            ? 'error\n'
            : 'exit0\n',
      );
      if (kind === 'pending-failed-child' || kind === 'pending-child-error') {
        const job = await stream.next((event) => event.code === 'RESOURCE_JOB_EXIT');
        if (kind === 'pending-failed-child') assert.equal(job.childExitCode, 1);
        else assert.equal(job.childError, 'synthetic child error');
      }
    }
    diagnostic.setStage('awaiting_child_close');
    const exit = await closed;
    finished = true;
    diagnostic.setStage('journal_assertions');
    assert.deepEqual(
      exit,
      { code: ['recovered', 'completion-recovered'].includes(kind) ? 0 : 3, signal: null },
      stream.stderr,
    );
    const journal = (await readFile(join(item.docs, 'resource-journals', `${runId}.jsonl`), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(
      journal.at(-1).decision,
      ['recovered', 'completion-recovered'].includes(kind) ? 'valid' : 'invalid',
    );
    assert.equal(
      journal.at(-1).resourceInvalid,
      !['recovered', 'completion-recovered'].includes(kind),
    );
    if (
      ['confirmed', 'completion-unsafe', 'completion-expired', 'completion-memory-unsafe'].includes(
        kind,
      )
    ) {
      assert(journal.some((event) => event.code === 'RESOURCE_STOP_AT_SAFE_BOUNDARY'));
      assert.equal((await stat(join(item.leaseRoot, 'unsafe-hold.json'))).isFile(), true);
    }
    if (kind === 'pending-failed-child')
      assert(
        journal.some((event) => event.code === 'RESOURCE_JOB_EXIT' && event.childExitCode === 1),
      );
    if (kind === 'pending-child-error')
      assert(
        journal.some(
          (event) =>
            event.code === 'RESOURCE_JOB_EXIT' &&
            event.childExitCode === null &&
            event.childSignal === null,
        ),
      );
    if (kind === 'completion-stop')
      assert(journal.some((event) => event.code === 'RESOURCE_STOP_REQUESTED'));
    assert.equal(actions, kind === 'recovered' ? 1 : 0);
  } catch (error) {
    diagnostic.report('failure');
    scenarioError = error;
  }
  diagnostic.setCleanup('started');
  diagnostic.report('cleanup_start');
  try {
    if (child && closed && !finished) {
      child.kill('SIGTERM');
      await closed;
    }
    if (item) await rm(item.scratch, { recursive: true, force: true });
    diagnostic.setCleanup(item ? 'done' : 'unavailable');
  } catch (error) {
    diagnostic.setCleanup('failed');
    diagnostic.report('cleanup_failure');
    throw error;
  } finally {
    diagnostic.setStage('complete');
    diagnostic.report('end');
    diagnostic.stop();
  }
  if (scenarioError) throw scenarioError;
}

async function runScenarioGroup(kinds, options) {
  const groupStartedAt = process.hrtime.bigint();
  for (const kind of kinds) await runScenario(kind, groupStartedAt, options);
}

if (process.env.MATRX_RESOURCE_CPU_DIAGNOSTIC_SELF_TEST === '1') {
  test('scenario diagnostic reports each distinct lifecycle without running a guard', () => {
    const lines = [];
    const originalError = console.error;
    console.error = (line) => lines.push(line);
    try {
      const groupStartedAt = process.hrtime.bigint();
      const first = scenarioDiagnostic('recovered', groupStartedAt);
      first.setChild({ pid: 123, exitCode: null, signalCode: null });
      first.onEvent({ code: 'RESOURCE_CPU_RECOVERED', reasons: [] });
      first.setChildClosed();
      first.setCleanup('done');
      first.report('end');
      first.stop();
      const second = scenarioDiagnostic('completion-expired', groupStartedAt);
      second.onEvent({
        code: 'RESOURCE_WATCH_UNSAFE',
        reasons: ['RESOURCE_CPU_CONFIRMATION_EXPIRED'],
      });
      second.setCleanup('unavailable');
      second.report('end');
      second.stop();
      const third = scenarioDiagnostic('measurement-error', groupStartedAt);
      third.onEvent({
        code: 'RESOURCE_WATCH_UNSAFE',
        reasons: [
          "RESOURCE_MEASUREMENT_FAILED:ENOENT: open '/private/tmp/resource-cpu-wrapper-secret/cpu-phase'",
          'RESOURCE_FUTURE:--secret-token=fixture-private',
        ],
      });
      third.setCleanup('failed');
      third.report('end');
      third.stop();
    } finally {
      console.error = originalError;
    }
    const entries = lines.map((line) => JSON.parse(line.slice('resource-cpu-scenario '.length)));
    const ends = entries.filter((entry) => entry.point === 'end');
    assert.deepEqual(
      ends.map(({ kind, lastGuardEvent, child, cleanup }) => ({
        kind,
        lastGuardEvent,
        child,
        cleanup,
      })),
      [
        {
          kind: 'recovered',
          lastGuardEvent: { code: 'RESOURCE_CPU_RECOVERED', reasons: [] },
          child: { pid: 123, exitCode: null, signalCode: null, closed: true },
          cleanup: 'done',
        },
        {
          kind: 'completion-expired',
          lastGuardEvent: {
            code: 'RESOURCE_WATCH_UNSAFE',
            reasons: ['RESOURCE_CPU_CONFIRMATION_EXPIRED'],
          },
          child: null,
          cleanup: 'unavailable',
        },
        {
          kind: 'measurement-error',
          lastGuardEvent: {
            code: 'RESOURCE_WATCH_UNSAFE',
            reasons: ['RESOURCE_MEASUREMENT_FAILED', 'RESOURCE_REASON_OTHER'],
          },
          child: null,
          cleanup: 'failed',
        },
      ],
    );
    assert(!lines.join('\n').includes('/private/tmp/resource-cpu-wrapper-secret/cpu-phase'));
    assert(!lines.join('\n').includes('--secret-token=fixture-private'));
    assert(entries.every(({ elapsedMs, groupElapsedMs }) => elapsedMs >= 0 && groupElapsedMs >= 0));
    assert.equal(entries.filter(({ point }) => point === 'guard_event').length, 3);
  });
}

test(
  'actual guard watch journal controls recovery, confirmation, and pending child exit',
  { timeout: 30_000 },
  async () => {
    await runScenarioGroup([
      'recovered',
      'confirmed',
      'pending-exit',
      'completion-recovered',
      'completion-unsafe',
      'completion-expired',
      'completion-memory-unsafe',
    ]);
  },
);

test(
  'pending child failure, child error, and operator stop remain invalid',
  { timeout: 30_000 },
  async () => {
    await runScenarioGroup(['pending-failed-child', 'pending-child-error', 'completion-stop']);
  },
);

test(
  'CPU boundary waits for startup owner rewrite before reading identity',
  { timeout: 30_000 },
  async () => {
    await runScenarioGroup(['recovered', 'confirmed', 'pending-exit'], {
      pauseOwnerRewrite: true,
    });
  },
);
