import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const policy = JSON.parse(
  await readFile(new URL('../docs/stabilization/resource-policy.json', import.meta.url)),
);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export async function runHostedStartupIntervalDiagnostic({
  executable,
  extensionDir,
  sourceSha,
  runId,
  artifactId,
}) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'hosted_startup_runner_required');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'hosted_startup_vm_required');
  assert.equal(process.env.RUNNER_ARCH, 'ARM64', 'hosted_startup_arm_required');
  assert.ok(process.env.MATRX_RESOURCE_OWNER, 'hosted_startup_permit_required');
  assert.equal(process.env.MATRX_STARTUP_INTERVAL_DIAGNOSTIC, '1');
  await access(executable);
  await access(join(extensionDir, 'manifest.json'));
  assert.ok(process.env.MATRX_HOSTED_GUEST_OUTPUT_DIR, 'hosted_startup_output_required');
  const root = await mkdtemp(join(tmpdir(), 'matrx-startup-interval-'));
  const profile = join(root, 'profile');
  const outputDir = resolve(process.env.MATRX_HOSTED_GUEST_OUTPUT_DIR ?? '');
  await mkdir(profile, { mode: 0o700 });
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const path = join(outputDir, 'startup-interval-diagnostic.json');
  const report = {
    schema: 1,
    verdict: 'DIAGNOSTIC_ONLY_NO_PRODUCT_ACCEPTANCE',
    sourceSha,
    runId,
    artifactId,
    startedAt: new Date().toISOString(),
    browserReadyAt: null,
    completedAt: null,
    guardJournal: `docs/stabilization/resource-journals/${process.env.MATRX_RESOURCE_RUN_ID}.jsonl`,
  };
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  let child;
  try {
    child = spawn(
      executable,
      [
        '--headless=new',
        '--enable-automation',
        '--no-first-run',
        '--no-default-browser-check',
        '--use-mock-keychain',
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    await new Promise((done, reject) => {
      child.once('spawn', done);
      child.once('error', reject);
    });
    const deadline =
      Date.now() + (2 * policy.watchIntervalSeconds + policy.cpuSampleIntervalSeconds) * 1000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error('STARTUP_BROWSER_EXITED');
      if (!report.browserReadyAt) {
        try {
          await access(join(profile, 'DevToolsActivePort'));
          report.browserReadyAt = new Date().toISOString();
          await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
        } catch {
          /* Keep watching the same owned startup. */
        }
      }
      await sleep(250);
    }
    assert.ok(report.browserReadyAt, 'STARTUP_BROWSER_ENDPOINT_MISSING');
    report.completedAt = new Date().toISOString();
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log('STARTUP_INTERVAL_DIAGNOSTIC_COMPLETE');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((done) => child.once('close', done)), sleep(1000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await rm(root, { recursive: true, force: true });
  }
}
