import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'vitest';
import {
  copyResourceGuardModules,
  setHealthyHostMeasurements,
} from '../../scripts/stabilization-resource-test-measurements.mjs';

const source = resolve(import.meta.dirname, '../..');

async function fixture(kind: string, uncancelledWatch = false) {
  const scratch = await mkdtemp(join(source, '.output', 'resource-stop-test-'));
  const scripts = join(scratch, 'scripts');
  const docs = join(scratch, 'docs/stabilization');
  const lease = join(scratch, 'lease');
  const memoryPhase = join(scratch, 'memory-phase');
  await writeFile(memoryPhase, '80');
  await mkdir(scripts);
  await mkdir(docs, { recursive: true });
  await copyResourceGuardModules(join(source, 'scripts'), scripts);
  await setHealthyHostMeasurements(scripts);
  const guard = join(scripts, 'stabilization-resource.mjs');
  let text = await readFile(guard, 'utf8');
  // The real outer guard owns host admission. Only the nested fixture's lease
  // location and external telemetry are isolated; stop/cleanup/verdict stay real.
  if (process.env.MATRX_RESOURCE_OWNER)
    text = text.replace('await assertNoLegacyWork();', '/* admitted outer test guard */');
  if (uncancelledWatch) {
    // Mutation check: keep every decision real but restore the original losing
    // timer. The natural-exit assertion must reject this otherwise-valid run.
    const start = text.indexOf('      let watchTimer;');
    const end = text.indexOf('      if (result?.stop)', start);
    assert(start >= 0 && end > start);
    text = `${text.slice(0, start)}      const result = await Promise.race([
        sleep(policy.watchIntervalSeconds * 1000).then(() => null),
        settled ?? new Promise(() => {}),
        stopEvent,
      ]);
${text.slice(end)}`;
  }
  const close = 'const closed = journal.close();';
  assert.equal(text.split(close).length, 2);
  if (kind === 'unsafe') {
    const memory = "Promise.resolve('System-wide memory free percentage: 80%'),";
    assert.equal(text.split(memory).length, 2);
    text = text.replace(
      memory,
      `readFile(${JSON.stringify(memoryPhase)}, 'utf8').then(value => 'System-wide memory free percentage: ' + value + '%'),`,
    );
  }
  if (kind === 'late' || kind === 'unsafe' || kind === 'check-complete')
    text = text.replace(
      close,
      `${close}\n      console.log('TEST_JOURNAL_CLOSED');\n      await sleep(300);`,
    );
  if (kind === 'cleanup') {
    const cleanup = '// Once launch begins, no exception path may release before the all-session';
    assert.equal(text.split(cleanup).length, 2);
    text = text.replace(
      cleanup,
      `console.log('TEST_CLEANUP_STARTED');\n    await sleep(300);\n    ${cleanup}`,
    );
  }
  await writeFile(guard, text);
  const leaseFile = join(scripts, 'stabilization-resource-lease.mjs');
  text = await readFile(leaseFile, 'utf8');
  await writeFile(
    leaseFile,
    text.replace("return join('/var/tmp', leaseName(uid));", `return ${JSON.stringify(lease)};`),
  );
  const safety = join(scripts, 'stabilization-resource-safety.mjs');
  text = await readFile(safety, 'utf8');
  await writeFile(
    safety,
    text.replace(
      'statfsFn = statfs',
      'statfsFn = async () => ({ bavail: 1600 * 1024 * 1024, bsize: 1024 })',
    ),
  );
  if (kind === 'journal-failure') {
    const writer = join(scripts, 'stabilization-resource-journal.mjs');
    text = await readFile(writer, 'utf8');
    const write = 'writeSync(fd,';
    assert.equal(text.split(write).length, 2);
    // A real filesystem dependency failure, not a replacement guard decision.
    text = text.replace(
      write,
      `(() => { if (event.code === 'RESOURCE_STOP_REQUESTED') throw Object.assign(new Error('injected disk failure'), { code: 'EIO' }); return writeSync; })()(fd,`,
    );
    await writeFile(writer, text);
  }
  const policy = JSON.parse(
    await readFile(join(source, 'docs/stabilization/resource-policy.json'), 'utf8'),
  );
  policy.swapWindowSeconds = 0.04;
  policy.cpuSampleIntervalSeconds = 0.02;
  policy.watchIntervalSeconds = kind === 'prompt' ? 5 : 2;
  await writeFile(join(docs, 'resource-policy.json'), JSON.stringify(policy));
  return { scratch, guard, docs, lease, memoryPhase };
}

async function scenario(kind: string, signal: NodeJS.Signals, uncancelledWatch = false) {
  const item = await fixture(kind, uncancelledWatch);
  const runId = `stop-${randomUUID()}`;
  const child = spawn(
    process.execPath,
    [
      item.guard,
      kind === 'check-complete' ? 'check' : 'browser',
      '--run-id',
      runId,
      '--profile-dir',
      item.scratch,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  let pending = '';
  let cleanupLeaseExists = false;
  let first = false;
  let finalAt = 0;
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (line.includes('"code":"RESOURCE_FINAL_DECISION"')) finalAt = performance.now();
      if (line.includes('"code":"RESOURCE_ADMITTED"') && !first) {
        first = true;
        // Let the real admission branch enter its watchdog race before stopping.
        if (kind === 'unsafe') void writeFile(item.memoryPhase, '1');
        else if (kind !== 'check-complete') setTimeout(() => child.kill('SIGINT'), 20);
      }
      if (line.includes('"code":"RESOURCE_BROWSER_OPERATOR_STOP_REQUIRED"')) child.kill('SIGINT');
      if (line === 'TEST_JOURNAL_CLOSED') child.kill(signal);
      if (line === 'TEST_CLEANUP_STARTED') {
        stat(join(item.lease, 'heavy/owner.json')).then(() => {
          cleanupLeaseExists = true;
        });
        child.kill(signal);
      }
    }
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 8000);
  try {
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolveExit) =>
        child.once('close', (code, exitSignal) => resolveExit({ code, signal: exitSignal })),
    );
    const finalPath = join(item.docs, 'resource-journals', `${runId}.jsonl`);
    const journal = await readFile(finalPath, 'utf8').catch(() =>
      readFile(finalPath.replace('.jsonl', '.pending.jsonl'), 'utf8'),
    );
    const events = journal
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    if (kind === 'journal-failure') {
      assert.notEqual(exit.code, 0);
      assert.match(stderr, /RESOURCE_JOURNAL_WRITE_FAILED/);
      assert((await stat(join(item.lease, 'heavy/owner.json'))).isFile());
      assert.equal(
        events.some(
          (event) => event.code === 'RESOURCE_FINAL_DECISION' && event.decision === 'valid',
        ),
        false,
      );
    } else {
      assert.deepEqual(exit, { code: kind === 'unsafe' ? 3 : 0, signal: null }, stderr);
      assert.equal(
        events.filter((event) => event.code === 'RESOURCE_STOP_REQUESTED').length,
        kind === 'check-complete' ? 0 : 1,
        stdout,
      );
      assert.equal(events.at(-1).code, 'RESOURCE_FINAL_DECISION');
      assert.equal(events.at(-1).decision, kind === 'unsafe' ? 'invalid' : 'valid');
      assert.equal(events.at(-1).resourceInvalid, kind === 'unsafe');
      if (kind === 'unsafe') {
        assert(events.some((event) => event.code === 'RESOURCE_STOP_AT_SAFE_BOUNDARY'));
        assert((await stat(join(item.lease, 'unsafe-hold.json'))).isFile());
      }
      assert.equal(events.filter((event) => event.code === 'RESOURCE_FINAL_DECISION').length, 1);
      assert.doesNotMatch(stderr, /RESOURCE_JOURNAL_WRITE_FAILED|FINALIZE_FAILED/);
      await assert.rejects(stat(join(item.lease, 'heavy')), { code: 'ENOENT' });
      if (kind === 'cleanup')
        assert.equal(cleanupLeaseExists, true, 'lease retained until actual cleanup finishes');
      if (kind === 'prompt')
        assert(
          performance.now() - finalAt < 1500,
          'completed guard must not wait out a losing five-second watch timer',
        );
    }
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await rm(item.scratch, { recursive: true, force: true });
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(`completed browser journal survives late ${signal}`, () => scenario('late', signal));
  test(`duplicate ${signal} keeps one stop and ownership until cleanup`, () =>
    scenario('cleanup', signal));
}
test('first stop journal failure stays nonzero and retains ownership', () =>
  scenario('journal-failure', 'SIGINT'));

test('operator stop cancels the losing watchdog wait before process exit', () =>
  scenario('prompt', 'SIGINT'));

test('late signal cannot clear an unsafe browser verdict or durable hold', () =>
  scenario('unsafe', 'SIGTERM'));

test('natural-exit assertion rejects the original uncancelled-watch mutant', async () => {
  await assert.rejects(scenario('prompt', 'SIGINT', true), /completed guard must not wait out/);
});

test('completed check with no prior stop ignores a post-close SIGTERM', () =>
  scenario('check-complete', 'SIGTERM'));
