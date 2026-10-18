import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SAFE_REASONS = new Set([
  'eligible',
  'chat_inactive',
  'answer_missing',
  'answer_unpainted',
  'expected_terms_missing',
  'answer_not_readable_above_composer',
]);

const SAFE_FAILURE_CODES = new Set([
  'native_sidepanel_release_receipt_missing',
  'native_sidepanel_release_receipt_refused',
  'native_sidepanel_override_provenance_refused',
  'native_sidepanel_local_build_receipt_missing',
  'native_sidepanel_local_build_provenance_refused',
  'approval_action_completion_not_observed',
  'reviewer_extension_identity_unverified',
  'reviewer_canonical_role_unverified',
  'reviewer_composer_input_unverified',
  'reviewer_chat_terminal_answer_unverified',
  'reviewer_chat_visible_answer_unverified',
  'reviewer_chat_visible_answer_screenshot_missing',
]);

/** Capture only the native side panel; never include the web authentication form. */
export async function captureReviewerPanel(panel, artifacts, label) {
  const { data } = await panel.send('Page.captureScreenshot', { format: 'png' });
  const file = join(artifacts, `${label}.png`);
  await writeFile(file, Buffer.from(data, 'base64'), { mode: 0o600 });
  return file;
}

export function recordReviewerFailure(report, stage, error) {
  report.failure_stage = stage;
  const code = typeof error?.message === 'string' ? error.message.split('\n', 1)[0] : null;
  report.failure_code = SAFE_FAILURE_CODES.has(code) ? code : 'unclassified_failure';
  report.status = 'unverified';
}

export async function writeReviewerReport(output, report) {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

/** Keep only fixed diagnostic values; browser DOM text never enters the report. */
export function sanitizeMemberAnswerProof(proof) {
  return {
    eligible: proof?.eligible === true,
    reason: SAFE_REASONS.has(proof?.reason) ? proof.reason : 'unclassified',
    painted: proof?.painted === true,
    term_visible: Array.isArray(proof?.term_visible)
      ? proof.term_visible.slice(0, 3).map((value) => value === true)
      : [],
  };
}

/** Persist the panel proof before the strict eligibility assertion can abort acceptance. */
export async function requireMemberAnswerEvidence({
  panel,
  expectedTerms,
  report,
  artifacts,
  evaluateProof,
  capture,
}) {
  const proof = await evaluateProof(panel, expectedTerms);
  report.member_answer_proof = sanitizeMemberAnswerProof(proof);
  let screenshotCaptured = false;
  try {
    report.screenshots.visible_answer_proof = await capture(
      panel,
      artifacts,
      'reviewer-chat-visible-answer-proof',
    );
    screenshotCaptured = true;
  } catch {
    report.member_answer_proof.screenshot_capture_failed = true;
  }
  assert.equal(proof?.eligible, true, 'reviewer_chat_visible_answer_unverified');
  assert.equal(screenshotCaptured, true, 'reviewer_chat_visible_answer_screenshot_missing');
  return proof;
}

/** Runner seam: retain actual CDP image and failure report even when the proof rejects. */
export async function runMemberAnswerProofBoundary({
  panel,
  expectedTerms,
  report,
  artifacts,
  output,
  evaluateProof,
}) {
  try {
    return await requireMemberAnswerEvidence({
      panel,
      expectedTerms,
      report,
      artifacts,
      evaluateProof,
      capture: captureReviewerPanel,
    });
  } catch (error) {
    recordReviewerFailure(report, 'reviewer_two_turn_terminal_proof', error);
    await writeReviewerReport(output, report);
    throw error;
  }
}
