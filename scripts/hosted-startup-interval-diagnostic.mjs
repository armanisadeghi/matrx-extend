import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from '../tests/browser/native-sidepanel-qa-harness.mjs';

const policy = JSON.parse(
  await readFile(new URL('../docs/stabilization/resource-policy.json', import.meta.url)),
);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function safeStartupEndpointObservation(value) {
  assert.ok(
    ['cdp_connected', 'cdp_timeout', 'post_timeout'].includes(value?.phase),
    'startup_endpoint_phase_refused',
  );
  for (const key of ['endpointPresent', 'inspectionFailed', 'exitObserved'])
    assert.equal(typeof value[key], 'boolean', 'startup_endpoint_boolean_refused');
  for (const key of ['elapsedMs', 'polls'])
    assert.ok(
      Number.isSafeInteger(value[key]) && value[key] >= 0,
      'startup_endpoint_count_refused',
    );
  return {
    phase: value.phase,
    endpointPresent: value.endpointPresent,
    inspectionFailed: value.inspectionFailed,
    exitObserved: value.exitObserved,
    elapsedMs: value.elapsedMs,
    polls: value.polls,
  };
}

export async function runHostedStartupIntervalDiagnostic({
  executable,
  extensionDir,
  relocatedReceipt,
  sourceSha,
  runId,
  artifactId,
  nativeRunner = runNativeSidepanelQa,
  displayMode = process.env.MATRX_STARTUP_DISPLAY_MODE ?? 'headed',
}) {
  assert.ok(['headed', 'headless'].includes(displayMode), 'hosted_startup_display_mode_required');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'hosted_startup_runner_required');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'hosted_startup_vm_required');
  assert.ok(['ARM64', 'X64'].includes(process.env.RUNNER_ARCH), 'hosted_startup_arch_required');
  assert.ok(process.env.MATRX_RESOURCE_OWNER, 'hosted_startup_permit_required');
  assert.equal(process.env.MATRX_STARTUP_INTERVAL_DIAGNOSTIC, '1');
  assert.ok(process.env.MATRX_HOSTED_GUEST_OUTPUT_DIR, 'hosted_startup_output_required');
  const outputDir = resolve(process.env.MATRX_HOSTED_GUEST_OUTPUT_DIR);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const path = join(outputDir, 'startup-interval-diagnostic.json');
  const receipt = JSON.parse(await readFile(relocatedReceipt, 'utf8'));
  const report = {
    schema: 2,
    verdict: 'DIAGNOSTIC_ONLY_NO_PRODUCT_ACCEPTANCE',
    sourceSha,
    runId,
    artifactId,
    startedAt: new Date().toISOString(),
    lastNativeStage: null,
    nativeStages: [],
    runnerArch: process.env.RUNNER_ARCH,
    requestedDisplayMode: displayMode,
    browserLaunch: null,
    startupEndpointObservations: [],
    gpuObservation: { status: 'UNKNOWN' },
    panelReadyAt: null,
    completedAt: null,
    guardJournal: `docs/stabilization/resource-journals/${process.env.MATRX_RESOURCE_RUN_ID}.jsonl`,
  };
  let pendingSave = Promise.resolve();
  const save = () => {
    const snapshot = `${JSON.stringify(report, null, 2)}\n`;
    pendingSave = pendingSave.then(() => writeFile(path, snapshot, { mode: 0o600 }));
    return pendingSave;
  };
  await save();
  try {
    await nativeRunner({
      headed: displayMode === 'headed',
      onBrowserLaunchObservation: (observation) => {
        report.browserLaunch = observation;
        void save().catch(() => {});
      },
      extensionDir,
      localDevReceiptPath: relocatedReceipt,
      expectedRelease: receipt,
      chromeExecutable: executable,
      artifactRoot: outputDir,
      startupEndpointObservationMs: policy.watchIntervalSeconds * 1000,
      onStartupEndpointObservation: async (observation) => {
        report.startupEndpointObservations.push({
          ...safeStartupEndpointObservation(observation),
          at: new Date().toISOString(),
        });
        await save();
      },
      onStage: (stage) => {
        report.lastNativeStage = stage;
        report.nativeStages.push({ stage, at: new Date().toISOString() });
        void save().catch(() => {});
      },
      onStartupGpuObservation: (observation) => {
        report.gpuObservation = observation;
        void save().catch(() => {});
      },
      exercisePanel: async ({ requireResourceHealth }) => {
        // This is the same pre-exercise boundary that refused the failed native
        // run. No identity, Scrape action, or product assertion follows it.
        report.panelReadyAt = new Date().toISOString();
        await save();
        await requireResourceHealth();
        await sleep((2 * policy.watchIntervalSeconds + policy.cpuSampleIntervalSeconds) * 1000);
        await requireResourceHealth();
      },
    });
    // The harness returns only after its owned Chromium child has terminated.
    report.completedAt = new Date().toISOString();
    await save();
    console.log('STARTUP_INTERVAL_DIAGNOSTIC_COMPLETE');
  } catch (error) {
    report.failureCode =
      /NATIVE_RESOURCE_BOUNDARY_REFUSED|native_owned_child_termination_unconfirmed/.test(
        String(error?.message),
      )
        ? String(error.message).split(':')[0]
        : 'STARTUP_PANEL_DIAGNOSTIC_FAILED';
    await save();
    throw error;
  }
}
