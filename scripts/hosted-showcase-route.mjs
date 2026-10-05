import assert from 'node:assert/strict';
import { join } from 'node:path';

export function hostedShowcaseRoute(acceptanceCase, prepared, runner) {
  if (!['showcase-picker-admin', 'showcase-stale-admin'].includes(acceptanceCase)) return null;
  assert.equal(prepared.kind, 'ci_development_test', 'showcase_ci_artifact_required');
  assert.match(prepared.sourceSha ?? '', /^[a-f0-9]{40}$/, 'showcase_ci_source_required');
  assert.match(String(prepared.runId ?? ''), /^[1-9][0-9]*$/, 'showcase_ci_run_required');
  assert.match(String(prepared.artifactId ?? ''), /^[1-9][0-9]*$/, 'showcase_ci_artifact_required');
  assert.ok(prepared.extensionDir && prepared.relocatedReceipt, 'showcase_receipt_required');
  assert.ok(runner.temp && runner.runId && runner.attempt, 'showcase_hosted_output_required');
  return {
    driver: 'tests/browser/showcase-picker-native-acceptance.mjs',
    env: {
      MATRX_SHOWCASE_EXTENSION_DIR: prepared.extensionDir,
      MATRX_SHOWCASE_RECEIPT: prepared.relocatedReceipt,
      MATRX_SHOWCASE_CI_SOURCE_SHA: prepared.sourceSha,
      MATRX_SHOWCASE_CI_RUN_ID: String(prepared.runId),
      MATRX_SHOWCASE_CI_ARTIFACT_ID: String(prepared.artifactId),
      MATRX_SHOWCASE_OUTPUT: join(
        runner.temp,
        `showcase-picker-native-${runner.runId}-${runner.attempt}.json`,
      ),
      MATRX_SHOWCASE_STALE_BOUNDARY: acceptanceCase === 'showcase-stale-admin' ? '1' : undefined,
    },
  };
}
