import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runHostedStartupIntervalDiagnostic } from './hosted-startup-interval-diagnostic.mjs';

test('diagnostic writer retains native stage times and the bounded backend result', async () => {
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
    await runHostedStartupIntervalDiagnostic({
      executable: '/owned/chromium',
      extensionDir: '/owned/extension',
      relocatedReceipt: receiptPath,
      sourceSha: 'source',
      runId: 'diagnostic-run',
      artifactId: 'artifact',
      nativeRunner: async ({ onStage, onStartupGpuObservation }) => {
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
    const report = JSON.parse(await readFile(join(outputDir, 'startup-interval-diagnostic.json')));
    assert.deepEqual(
      report.nativeStages.map(({ stage }) => stage),
      ['browser_spawn', 'panel_open', 'panel_settle', 'screenshot', 'exercise_panel'],
    );
    for (const event of report.nativeStages) assert.match(event.at, /^20\d\d-/);
    assert.equal(report.lastNativeStage, 'exercise_panel');
    assert.equal(report.gpuObservation.skiaBackendType, 'Graphite');
    assert.equal(report.gpuObservation.glRenderer, 'ANGLE Metal');
    assert.match(report.completedAt, /^20\d\d-/);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(outputDir, { recursive: true, force: true });
  }
});
