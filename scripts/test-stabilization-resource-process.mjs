import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { classifyLegacyRunner, parseProcessIdentity } from './stabilization-resource-process.mjs';

test('a shell containing runner text is not a runner', () => {
  assert.equal(
    classifyLegacyRunner(
      '/bin/zsh',
      "/bin/zsh -lc '/opt/homebrew/bin/node scripts/stabilization-resource.mjs run'",
    ),
    null,
  );
});

test('Node eval source mentioning the guard is not a runner', () => {
  assert.equal(
    classifyLegacyRunner(
      '/opt/homebrew/bin/node',
      `/opt/homebrew/bin/node -e 'const note = "scripts/stabilization-resource.mjs run"'`,
    ),
    null,
  );
  assert.equal(
    classifyLegacyRunner(
      '/opt/homebrew/bin/node',
      `/opt/homebrew/bin/node --input-type=module -e 'const note = "scripts/stabilization-resource.mjs run"'`,
    ),
    null,
  );
});

test('a direct Node script operand is a runner', () => {
  assert.equal(
    classifyLegacyRunner(
      '/opt/homebrew/bin/node',
      '/opt/homebrew/bin/node scripts/stabilization-resource.mjs run --run-id old',
    ),
    'script-operand',
  );
});

test('an uncertain Node process mentioning the guard fails closed', () => {
  assert.equal(
    classifyLegacyRunner(
      '/opt/homebrew/bin/node',
      '/opt/homebrew/bin/node --unknown preload.js scripts/stabilization-resource.mjs run',
    ),
    'ambiguous-arguments',
  );
});

test('another Node script passing runner text as data is not a runner', () => {
  assert.equal(
    classifyLegacyRunner(
      '/opt/homebrew/bin/node',
      '/opt/homebrew/bin/node scripts/report.mjs "stabilization-resource.mjs"',
    ),
    null,
  );
});

test('Node options before the actual guard script still identify the runner', () => {
  assert.equal(
    classifyLegacyRunner(
      '/opt/homebrew/bin/node',
      '/opt/homebrew/bin/node --no-warnings -r preload.js scripts/stabilization-resource.mjs run',
    ),
    'script-operand',
  );
});

test('process identity reads pid, parent and start without command text', () => {
  assert.deepEqual(
    parseProcessIdentity('4242  101 Mon Sep 28 06:59:03 2026     /opt/homebrew/bin/node'),
    {
      pid: 4242,
      ppid: 101,
      processStart: 'Mon Sep 28 06:59:03 2026',
      executable: '/opt/homebrew/bin/node',
    },
  );
});

test('macOS ps identifies a live direct Node runner by executable and script operand', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'legacy-runner-identity-'));
  const script = join(scratch, 'stabilization-resource.mjs');
  await writeFile(script, "process.stdout.write('READY\\n'); process.stdin.resume();\n");
  const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await new Promise((resolveReady, reject) => {
      child.once('error', reject);
      child.stdout.once('data', (value) =>
        value.toString().includes('READY')
          ? resolveReady()
          : reject(new Error('runner did not become ready')),
      );
    });
    const executable = execFileSync('/bin/ps', ['-p', String(child.pid), '-o', 'comm='], {
      encoding: 'utf8',
    }).trim();
    const command = execFileSync('/bin/ps', ['-p', String(child.pid), '-o', 'command='], {
      encoding: 'utf8',
    }).trim();
    assert.equal(classifyLegacyRunner(executable, command), 'script-operand');
  } finally {
    child.stdin.end();
    await new Promise((resolveExit) => child.once('exit', resolveExit));
    await rm(scratch, { recursive: true });
  }
});

test('guard refuses a live old runner and journals bounded process identity', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'legacy-runner-admission-'));
  const scripts = join(scratch, 'scripts');
  const docs = join(scratch, 'docs/stabilization');
  await mkdir(scripts);
  await mkdir(docs, { recursive: true });
  const source = resolve(import.meta.dirname, '..');
  for (const name of [
    'stabilization-resource.mjs',
    'stabilization-resource-safety.mjs',
    'stabilization-resource-lease.mjs',
    'stabilization-resource-journal.mjs',
    'stabilization-resource-process.mjs',
    'stabilization-resource-verdict.mjs',
  ])
    await copyFile(join(source, 'scripts', name), join(scripts, name));
  await copyFile(
    join(source, 'docs/stabilization/resource-policy.json'),
    join(docs, 'resource-policy.json'),
  );
  // If admission regresses, fail before the 60-second preflight. The copied
  // guard still uses the real canonical lease and process scan.
  const guardPath = join(scripts, 'stabilization-resource.mjs');
  const guardSource = await readFile(guardPath, 'utf8');
  const probeSource = guardSource.replace(
    'const pre = await preflight(profileDir);',
    "throw new Error('RESOURCE_TEST_REACHED_PREFLIGHT');",
  );
  assert.notEqual(probeSource, guardSource);
  await writeFile(guardPath, probeSource);
  const oldRunner = join(scratch, 'stabilization-resource.mjs');
  await writeFile(oldRunner, "process.stdout.write('READY\\n'); process.stdin.resume();\n");
  const child = spawn(process.execPath, [oldRunner], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await new Promise((resolveReady, reject) => {
      child.once('error', reject);
      child.stdout.once('data', (value) =>
        value.toString().includes('READY')
          ? resolveReady()
          : reject(new Error('old runner did not become ready')),
      );
    });
    const runId = 'legacy-process-probe';
    const guard = await new Promise((resolveResult, reject) => {
      const probe = spawn(
        process.execPath,
        [guardPath, 'check', '--run-id', runId, '--profile-dir', scratch],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      probe.stdout.on('data', (data) => {
        stdout += data;
      });
      probe.stderr.on('data', (data) => {
        stderr += data;
      });
      probe.once('error', reject);
      probe.once('close', (status) => resolveResult({ status, stdout, stderr }));
    });
    assert.equal(guard.status, 2, guard.stderr);
    const events = (await readFile(join(docs, 'resource-journals', `${runId}.jsonl`), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const refusal = events.find((event) => event.code === 'RESOURCE_LEGACY_RUNNER_BUSY');
    assert.equal(refusal?.processEvidence.matches[0].pid, child.pid);
    assert.equal(refusal?.processEvidence.matches[0].reason, 'script-operand');
    assert.equal(refusal?.processEvidence.matches[0].executable, 'node');
    assert.equal(events.at(-1).decision, 'refused');
    assert.doesNotMatch(
      JSON.stringify(events),
      /READY|process\.stdin\.resume|MATRX_RESOURCE_OWNER=/,
    );
  } finally {
    child.stdin.end();
    await new Promise((resolveExit) => child.once('exit', resolveExit));
    await rm(scratch, { recursive: true });
  }
});
