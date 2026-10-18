import assert from 'node:assert/strict';

const SAFE_REASONS = new Set([
  'eligible',
  'chat_inactive',
  'answer_missing',
  'answer_unpainted',
  'expected_terms_missing',
  'answer_not_readable_above_composer',
]);

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
