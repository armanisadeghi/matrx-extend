import assert from 'node:assert/strict';

/** A diagnostic route only: no native-AI product acceptance credit. */
export function hostedNativeAiProbeRoute(acceptanceCase, prepared) {
  assert.equal(acceptanceCase, 'native-ai-member-probe', 'native_ai_probe_case_refused');
  assert.equal(prepared?.kind, 'ci_development_test', 'native_ai_probe_ci_artifact_required');
  assert.match(prepared.sourceSha ?? '', /^[a-f0-9]{40}$/, 'native_ai_probe_source_required');
  assert.match(String(prepared.runId ?? ''), /^[1-9][0-9]*$/, 'native_ai_probe_run_required');
  assert.match(
    String(prepared.artifactId ?? ''),
    /^[1-9][0-9]*$/,
    'native_ai_probe_artifact_required',
  );
  assert.ok(prepared.extensionDir?.startsWith('/'), 'native_ai_probe_extension_required');
  assert.ok(prepared.relocatedReceipt?.startsWith('/'), 'native_ai_probe_receipt_required');
  return {
    driver: 'tests/browser/native-ai-member-probe.mjs',
    env: {
      MATRX_NATIVE_AI_EXTENSION_DIR: prepared.extensionDir,
      MATRX_NATIVE_AI_RECEIPT: prepared.relocatedReceipt,
      MATRX_NATIVE_AI_SOURCE_SHA: prepared.sourceSha,
      MATRX_NATIVE_AI_CI_RUN_ID: String(prepared.runId),
      MATRX_NATIVE_AI_CI_ARTIFACT_ID: String(prepared.artifactId),
    },
  };
}
