import assert from 'node:assert/strict';

/** The admin Screenshots case uses the original native T04/T05 driver. */
export function hostedScreenshotRoute(acceptanceCase, prepared, lane) {
  if (acceptanceCase !== 'screenshots-capture-admin') return null;
  assert.equal(lane, 'A', 'hosted_screenshot_admin_lane_a_required');
  assert.equal(prepared?.kind, 'ci_development_test', 'hosted_screenshot_ci_artifact_required');
  assert.match(prepared.sourceSha ?? '', /^[a-f0-9]{40}$/, 'hosted_screenshot_source_required');
  assert.match(String(prepared.runId ?? ''), /^[1-9][0-9]*$/, 'hosted_screenshot_run_required');
  assert.match(
    String(prepared.artifactId ?? ''),
    /^[1-9][0-9]*$/,
    'hosted_screenshot_artifact_required',
  );
  assert.equal(
    prepared.ciEvidence?.sourceSha,
    prepared.sourceSha,
    'hosted_screenshot_evidence_required',
  );
  return Object.freeze({ driver: 'tests/browser/screenshot-capture-acceptance.mjs' });
}
