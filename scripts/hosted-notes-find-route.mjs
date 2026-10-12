import assert from 'node:assert/strict';

/** Member T02 and its separate read-only D201 picker check share the guarded native target. */
export function hostedNotesFindRoute(acceptanceCase, prepared, lane) {
  assert.ok(
    ['notes-find-member', 'notes-lazy-general-member'].includes(acceptanceCase),
    'hosted_notes_case_refused',
  );
  assert.equal(lane, 'A', 'hosted_notes_lane_a_required');
  assert.equal(prepared?.kind, 'ci_development_test', 'hosted_notes_ci_artifact_required');
  assert.match(prepared.sourceSha ?? '', /^[a-f0-9]{40}$/, 'hosted_notes_source_required');
  assert.match(String(prepared.runId ?? ''), /^[1-9][0-9]*$/, 'hosted_notes_run_required');
  assert.match(
    String(prepared.artifactId ?? ''),
    /^[1-9][0-9]*$/,
    'hosted_notes_artifact_required',
  );
  assert.ok(prepared.extensionDir?.startsWith('/'), 'hosted_notes_extension_required');
  assert.ok(prepared.relocatedReceipt?.startsWith('/'), 'hosted_notes_receipt_required');
  return {
    driver: 'tests/browser/notes-native-acceptance.mjs',
    env: {
      NOTES_HOSTED_FIND: '1',
      NOTES_ROLE: 'member',
      NOTES_CASE: acceptanceCase === 'notes-find-member' ? 't02' : 'lazy-general-picker',
      NOTES_DEV_BUILD_RECEIPT: prepared.relocatedReceipt,
      NOTES_EXPECTED_SOURCE_SHA: prepared.sourceSha,
      NOTES_EXPECTED_CI_RUN_ID: String(prepared.runId),
      NOTES_EXPECTED_ARTIFACT_ID: String(prepared.artifactId),
    },
  };
}
