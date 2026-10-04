import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from '../tests/browser/native-sidepanel-qa-harness.mjs';

const policy = JSON.parse(
  await readFile(new URL('../docs/stabilization/resource-policy.json', import.meta.url)),
);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export async function runHostedStartupIntervalDiagnostic({
  executable,
  extensionDir,
  relocatedReceipt,
  sourceSha,
  runId,
  artifactId,
}) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'hosted_startup_runner_required');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'hosted_startup_vm_required');
  assert.equal(process.env.RUNNER_ARCH, 'ARM64', 'hosted_startup_arm_required');
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
    panelReadyAt: null,
    completedAt: null,
    guardJournal: `docs/stabilization/resource-journals/${process.env.MATRX_RESOURCE_RUN_ID}.jsonl`,
  };
  const save = () => writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await save();
  try {
    await runNativeSidepanelQa({
      extensionDir,
      localDevReceiptPath: relocatedReceipt,
      expectedRelease: receipt,
      chromeExecutable: executable,
      artifactRoot: outputDir,
      onStage: (stage) => {
        report.lastNativeStage = stage;
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
