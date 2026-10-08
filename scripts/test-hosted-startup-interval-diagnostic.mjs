import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { observeOwnedEndpointAfterTimeout } from '../tests/browser/native-sidepanel-qa-harness.mjs';
import {
  runHostedStartupIntervalDiagnostic,
  safeStartupEndpointObservation,
} from './hosted-startup-interval-diagnostic.mjs';

test('owned endpoint observer separates late file, absent file, and child exit', async () => {
  let elapsed = 0;
  let reads = 0;
  const missing = () => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  };
  const common = {
    profile: '/owned/profile',
    child: { exitCode: null, signalCode: null },
    clock: { now: () => elapsed },
    sleep: async (ms) => {
      elapsed += ms;
    },
  };
  const late = await observeOwnedEndpointAfterTimeout({
    ...common,
    windowMs: 300,
    fileSystem: {
      lstat: async () => {
        reads += 1;
        if (reads < 3) missing();
      },
    },
  });
  assert.deepEqual(late, {
    phase: 'post_timeout',
    endpointPresent: true,
    inspectionFailed: false,
    exitObserved: false,
    elapsedMs: 200,
    polls: 3,
  });
  elapsed = 0;
  const absent = await observeOwnedEndpointAfterTimeout({
    ...common,
    windowMs: 200,
    fileSystem: { lstat: missing },
  });
  assert.deepEqual(absent, {
    phase: 'post_timeout',
    endpointPresent: false,
    inspectionFailed: false,
    exitObserved: false,
    elapsedMs: 200,
    polls: 2,
  });
  const exited = await observeOwnedEndpointAfterTimeout({
    ...common,
    child: { exitCode: 1, signalCode: null },
    windowMs: 200,
    fileSystem: { lstat: missing },
  });
  assert.equal(exited.exitObserved, true);
  assert.equal(exited.polls, 1);
});

test('workflow permits diagnostic on Intel and ARM without changing guarded launch', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /if: inputs\.acceptance_case == 'startup-resource-diagnostic'\n/);
  assert.match(workflow, /MATRX_HOSTED_PHASE: startup-diagnostic/);
  assert.match(workflow, /node scripts\/stabilization-resource\.mjs run --run-id "hosted-startup-/);
  assert.doesNotMatch(workflow, /Startup diagnostic requires the configured ARM runner/);
});

test('endpoint observation strips private fields and rejects malformed state', () => {
  const safe = safeStartupEndpointObservation({
    phase: 'post_timeout',
    endpointPresent: false,
    inspectionFailed: false,
    exitObserved: true,
    elapsedMs: 5037,
    polls: 99,
    privatePath: '/private/profile',
    rawError: 'private',
  });
  assert.equal(Object.hasOwn(safe, 'privatePath'), false);
  assert.equal(Object.hasOwn(safe, 'rawError'), false);
  assert.throws(
    () => safeStartupEndpointObservation({ ...safe, phase: 'private' }),
    /startup_endpoint_phase_refused/,
  );
  assert.throws(
    () => safeStartupEndpointObservation({ ...safe, polls: 'private' }),
    /startup_endpoint_count_refused/,
  );
});

test('diagnostic writer selects headed startup on both hosted architectures', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'startup-observation-'));
  const original = Object.fromEntries(
    [
      'GITHUB_ACTIONS',
      'RUNNER_ENVIRONMENT',
      'RUNNER_ARCH',
      'MATRX_RESOURCE_OWNER',
      'MATRX_STARTUP_INTERVAL_DIAGNOSTIC',
      'MATRX_HOSTED_GUEST_OUTPUT_DIR',
      'MATRX_RESOURCE_RUN_ID',
    ].map((key) => [key, process.env[key]]),
  );
  try {
    Object.assign(process.env, {
      GITHUB_ACTIONS: 'true',
      RUNNER_ENVIRONMENT: 'github-hosted',
      RUNNER_ARCH: 'ARM64',
      MATRX_RESOURCE_OWNER: 'resource-lease',
      MATRX_STARTUP_INTERVAL_DIAGNOSTIC: '1',
      MATRX_HOSTED_GUEST_OUTPUT_DIR: outputDir,
      MATRX_RESOURCE_RUN_ID: 'observation-lease',
    });
    const receiptPath = join(outputDir, 'receipt.json');
    await writeFile(receiptPath, '{}');
    const invoke = async (runnerArch) => {
      process.env.RUNNER_ARCH = runnerArch;
      await runHostedStartupIntervalDiagnostic({
        executable: '/owned/chromium',
        extensionDir: '/owned/extension',
        relocatedReceipt: receiptPath,
        sourceSha: 'source',
        runId: 'diagnostic-run',
        artifactId: 'artifact',
        nativeRunner: async ({
          headed,
          startupEndpointObservationMs,
          onStartupEndpointObservation,
          onStage,
          onStartupGpuObservation,
        }) => {
          assert.equal(headed, true);
          assert.equal(startupEndpointObservationMs, 15_000);
          await onStartupEndpointObservation({
            phase: 'cdp_timeout',
            endpointPresent: false,
            exitObserved: false,
            inspectionFailed: false,
            elapsedMs: 5000,
            polls: 149,
            privatePath: '/private/profile',
          });
          onStage('browser_spawn');
          onStartupGpuObservation({ status: 'UNKNOWN', requestedAt: '2026-10-04T20:00:00.000Z' });
          onStage('panel_open');
          onStage('panel_settle');
          onStage('screenshot');
          onStage('exercise_panel');
          onStartupGpuObservation({
            status: 'RESOLVED',
            requestedAt: '2026-10-04T20:00:00.000Z',
            resolvedAt: '2026-10-04T20:00:01.000Z',
            skiaBackendType: 'Graphite',
            glRenderer: 'ANGLE Metal',
            featureStatus: { rasterization: 'enabled' },
          });
        },
      });
    };
    await invoke('X64');
    const report = JSON.parse(await readFile(join(outputDir, 'startup-interval-diagnostic.json')));
    assert.deepEqual(
      report.nativeStages.map(({ stage }) => stage),
      ['browser_spawn', 'panel_open', 'panel_settle', 'screenshot', 'exercise_panel'],
    );
    for (const event of report.nativeStages) assert.match(event.at, /^20\d\d-/);
    assert.equal(report.lastNativeStage, 'exercise_panel');
    assert.equal(report.gpuObservation.skiaBackendType, 'Graphite');
    assert.equal(report.gpuObservation.glRenderer, 'ANGLE Metal');
    assert.equal(report.runnerArch, 'X64');
    assert.equal(report.startupEndpointObservations[0].endpointPresent, false);
    assert.equal(report.startupEndpointObservations[0].phase, 'cdp_timeout');
    assert.equal(Object.hasOwn(report.startupEndpointObservations[0], 'privatePath'), false);
    assert.match(report.completedAt, /^20\d\d-/);
    await invoke('ARM64');
    assert.equal(
      JSON.parse(await readFile(join(outputDir, 'startup-interval-diagnostic.json'))).runnerArch,
      'ARM64',
    );
    process.env.RUNNER_ARCH = 'UNKNOWN';
    await assert.rejects(invoke('UNKNOWN'), /hosted_startup_arch_required/);
    process.env.RUNNER_ARCH = 'X64';
    await assert.rejects(
      runHostedStartupIntervalDiagnostic({
        executable: '/owned/chromium',
        extensionDir: '/owned/extension',
        relocatedReceipt: receiptPath,
        sourceSha: 'source',
        runId: 'diagnostic-run',
        artifactId: 'artifact',
        nativeRunner: async ({ onStartupEndpointObservation }) => {
          await onStartupEndpointObservation({
            phase: 'cdp_timeout',
            endpointPresent: false,
            inspectionFailed: false,
            exitObserved: false,
            elapsedMs: 5000,
            polls: 149,
          });
          await onStartupEndpointObservation({
            phase: 'post_timeout',
            endpointPresent: true,
            inspectionFailed: false,
            exitObserved: false,
            elapsedMs: 400,
            polls: 5,
          });
          throw new Error('owned_cdp_endpoint_timeout');
        },
      }),
      /owned_cdp_endpoint_timeout/,
    );
    const failedReport = JSON.parse(
      await readFile(join(outputDir, 'startup-interval-diagnostic.json')),
    );
    assert.deepEqual(
      failedReport.startupEndpointObservations.map(({ phase }) => phase),
      ['cdp_timeout', 'post_timeout'],
    );
    assert.equal(failedReport.startupEndpointObservations[1].endpointPresent, true);
    assert.equal(failedReport.completedAt, null);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(outputDir, { recursive: true, force: true });
  }
});
