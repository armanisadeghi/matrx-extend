import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { restoreMemberForeground } from './member-foreground-diagnostic.mjs';
import { waitFor } from './settings-panel-driver.mjs';

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
  'reviewer_chat_target_unverified',
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
  if (report.failure_code && report.failure_code !== 'unclassified_failure') {
    report.status = 'unverified';
    return;
  }
  report.failure_stage = stage;
  const code = typeof error?.message === 'string' ? error.message.split('\n', 1)[0] : null;
  report.failure_code = SAFE_FAILURE_CODES.has(code) ? code : 'unclassified_failure';
  report.status = 'unverified';
}

export async function writeReviewerReport(output, report) {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

/** Persist the foreground failure while its native targets are still owned. */
export async function persistMemberForegroundFailure(output, report, stage, error) {
  recordReviewerFailure(report, stage, error);
  await writeReviewerReport(output, report);
}

export async function restoreMemberForegroundWithReport({ output, report, stage, ...options }) {
  await restoreMemberForeground({
    ...options,
    diagnostic: report.foreground_diagnostic,
    onFailure: (error) => persistMemberForegroundFailure(output, report, stage, error),
  });
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

/** Numeric geometry and fixed style fields only; no DOM text or raw IDs enter evidence. */
export function sanitizeMemberAnswerDiagnostic(proof) {
  const integer = (value) =>
    Number.isFinite(value) && Math.abs(value) <= 10_000_000 ? Math.round(value) : null;
  const opacity = (value) => (Number.isFinite(value) && value >= 0 && value <= 1 ? value : null);
  const rect = (value) =>
    value && typeof value === 'object'
      ? Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, integer(value[key])]))
      : null;
  const fingerprint = (value) =>
    typeof value === 'string' && /^[0-9a-f]{16}$/.test(value) ? value : null;
  const source = proof?.diagnostic;
  const sanitizedAncestor = (ancestor) =>
    ancestor
      ? {
          depth: integer(ancestor.depth),
          tag:
            typeof ancestor.tag === 'string' && /^[A-Z]{1,12}$/.test(ancestor.tag)
              ? ancestor.tag
              : null,
          scope: ['pane', 'article', 'inside_article', 'above_article', 'above_pane'].includes(
            ancestor.scope,
          )
            ? ancestor.scope
            : null,
          class_hash: fingerprint(ancestor.class_hash),
          opacity: opacity(ancestor.opacity),
          display: ['none', 'block', 'flex', 'grid', 'contents', 'inline', 'inline-block'].includes(
            ancestor.display,
          )
            ? ancestor.display
            : 'other',
          visibility: ['visible', 'hidden', 'collapse'].includes(ancestor.visibility)
            ? ancestor.visibility
            : 'other',
        }
      : null;
  const transcript = source?.transcript;
  return {
    ...sanitizeMemberAnswerProof(proof),
    document_visibility: ['visible', 'hidden', 'prerender'].includes(source?.document_visibility)
      ? source.document_visibility
      : null,
    document_has_focus:
      typeof source?.document_has_focus === 'boolean' ? source.document_has_focus : null,
    selected_chat_tab_count: integer(source?.selected_chat_tab_count),
    active_chat_pane_count: integer(source?.active_chat_pane_count),
    chat_column_count: integer(source?.chat_column_count),
    transcript_count: integer(source?.transcript_count),
    selected_transcript_index: integer(source?.selected_transcript_index),
    assistant_article_count: integer(source?.assistant_article_count),
    selected_article_index: integer(source?.selected_article_index),
    article_candidates: Array.isArray(source?.article_candidates)
      ? source.article_candidates.slice(-2).map((candidate) => ({
          article_id_hash: fingerprint(candidate?.article_id_hash),
          article_rect: rect(candidate?.article_rect),
          painted: candidate?.painted === true,
          rejected_ancestor: sanitizedAncestor(candidate?.rejected_ancestor),
        }))
      : [],
    transcript: transcript
      ? {
          class_hash: fingerprint(transcript.class_hash),
          opacity: opacity(transcript.opacity),
          animation_count: integer(transcript.animation_count),
          animation_probe_failed: transcript.animation_probe_failed === true,
          animations: Array.isArray(transcript.animations)
            ? transcript.animations.slice(0, 3).map((animation) => ({
                play_state: ['idle', 'running', 'paused', 'finished'].includes(
                  animation?.play_state,
                )
                  ? animation.play_state
                  : 'other',
                current_time_ms: integer(animation?.current_time_ms),
                delay_ms: integer(animation?.delay_ms),
                duration_ms: integer(animation?.duration_ms),
                progress: opacity(animation?.progress),
              }))
            : [],
        }
      : null,
    article_id_hash: fingerprint(source?.article_id_hash),
    article_rect: rect(source?.article_rect),
    body_rect: rect(source?.body_rect),
    scroll: source?.scroll
      ? {
          top: integer(source.scroll.top),
          client_height: integer(source.scroll.client_height),
          scroll_height: integer(source.scroll.scroll_height),
        }
      : null,
    composer_top: integer(source?.composer_top),
    rejected_ancestor: sanitizedAncestor(source?.rejected_ancestor),
  };
}

/** Fixed categories only; browser exception messages may include page text or credentials. */
function probeExceptionCategory(error) {
  if (error?.name === 'TimeoutError' || /timed? out/i.test(error?.message ?? '')) return 'timeout';
  if (/target closed|session closed|connection closed|disconnected/i.test(error?.message ?? ''))
    return 'transport_closed';
  return error instanceof Error ? 'evaluation_error' : 'non_error_throw';
}

/** Persist the panel proof before the strict eligibility assertion can abort acceptance. */
export async function requireMemberAnswerEvidence({
  panel,
  expectedTerms,
  report,
  artifacts,
  evaluateProof,
  capture,
  waitForReady = waitFor,
}) {
  report.member_answer_diagnostic = { phase_timing: {} };
  const probe = async (phase) => {
    const startedAt = new Date();
    const startedMs = performance.now();
    let exceptionCategory = null;
    try {
      return await evaluateProof(panel, expectedTerms, phase);
    } catch (error) {
      exceptionCategory = probeExceptionCategory(error);
      throw error;
    } finally {
      report.member_answer_diagnostic.phase_timing[phase] = {
        started_at_utc: startedAt.toISOString(),
        finished_at_utc: new Date().toISOString(),
        elapsed_ms: Math.max(0, Math.round(performance.now() - startedMs)),
        exception_category: exceptionCategory,
      };
    }
  };
  const immediate = await probe('immediate');
  const eligiblePaint = (proof) =>
    proof?.eligible === true &&
    proof.painted === true &&
    expectedTerms.length > 0 &&
    expectedTerms.every((_term, index) => proof.term_visible?.[index] === true);
  report.member_answer_proof = sanitizeMemberAnswerProof(immediate);
  report.member_answer_diagnostic.immediate = sanitizeMemberAnswerDiagnostic(immediate);
  let ready = immediate;
  if (!eligiblePaint(ready)) {
    try {
      ready = await waitForReady(
        'reviewer_answer_paint_ready',
        async () => {
          const sample = await probe('paint_ready');
          report.member_answer_diagnostic.paint_ready = sanitizeMemberAnswerDiagnostic(sample);
          return sample;
        },
        eligiblePaint,
        undefined,
        sanitizeMemberAnswerProof,
      );
    } catch {
      report.member_answer_diagnostic.paint_ready_failed = true;
      try {
        report.screenshots.visible_answer_initial = await capture(
          panel,
          artifacts,
          'reviewer-chat-visible-answer-initial',
        );
      } catch {
        report.member_answer_diagnostic.initial_screenshot_capture_failed = true;
      }
      throw new Error('reviewer_chat_visible_answer_unverified');
    }
  }
  const initialArticle = immediate?.diagnostic?.article_id_hash;
  const initialArticleIndex = immediate?.diagnostic?.selected_article_index;
  const initialTranscriptIndex = immediate?.diagnostic?.selected_transcript_index;
  const identity = ready?.diagnostic?.article_id_hash;
  if (
    !eligiblePaint(ready) ||
    !/^[0-9a-f]{16}$/.test(identity ?? '') ||
    identity !== initialArticle ||
    !Number.isInteger(ready?.diagnostic?.selected_article_index) ||
    ready.diagnostic.selected_article_index < 0 ||
    ready.diagnostic.selected_article_index !== initialArticleIndex ||
    !Number.isInteger(ready?.diagnostic?.selected_transcript_index) ||
    ready.diagnostic.selected_transcript_index < 0 ||
    ready.diagnostic.selected_transcript_index !== initialTranscriptIndex ||
    ready?.diagnostic?.selected_chat_tab_count !== 1 ||
    ready?.diagnostic?.active_chat_pane_count !== 1
  ) {
    report.member_answer_proof = {
      ...sanitizeMemberAnswerProof(ready),
      eligible: false,
      reason: 'paired_proof_unverified',
    };
    throw new Error('reviewer_chat_visible_answer_unverified');
  }
  try {
    report.screenshots.visible_answer_proof = await capture(
      panel,
      artifacts,
      'reviewer-chat-visible-answer-proof',
    );
  } catch {
    report.member_answer_proof = {
      ...sanitizeMemberAnswerProof(ready),
      eligible: false,
      reason: 'screenshot_missing',
      screenshot_capture_failed: true,
    };
    throw new Error('reviewer_chat_visible_answer_screenshot_missing');
  }
  let afterCapture;
  try {
    afterCapture = await probe('post_capture');
  } catch {
    report.member_answer_proof = {
      ...sanitizeMemberAnswerProof(ready),
      eligible: false,
      reason: 'paired_proof_unverified',
    };
    report.member_answer_diagnostic.post_capture_failed = true;
    throw new Error('reviewer_chat_visible_answer_unverified');
  }
  report.member_answer_diagnostic.post_capture = sanitizeMemberAnswerDiagnostic(afterCapture);
  report.member_answer_proof = sanitizeMemberAnswerProof(afterCapture);
  if (
    !eligiblePaint(afterCapture) ||
    afterCapture?.diagnostic?.article_id_hash !== identity ||
    afterCapture?.diagnostic?.selected_article_index !==
      ready?.diagnostic?.selected_article_index ||
    afterCapture?.diagnostic?.selected_transcript_index !==
      ready?.diagnostic?.selected_transcript_index ||
    afterCapture?.diagnostic?.selected_chat_tab_count !== 1 ||
    afterCapture?.diagnostic?.active_chat_pane_count !== 1
  ) {
    report.member_answer_proof = {
      ...sanitizeMemberAnswerProof(afterCapture),
      eligible: false,
      reason: 'paired_proof_unverified',
    };
    throw new Error('reviewer_chat_visible_answer_unverified');
  }
  return afterCapture;
}

/** Runner seam: retain actual CDP image and failure report even when the proof rejects. */
export async function runMemberAnswerProofBoundary({
  panel,
  expectedTerms,
  report,
  artifacts,
  output,
  evaluateProof,
  waitForReady,
}) {
  try {
    return await requireMemberAnswerEvidence({
      panel,
      expectedTerms,
      report,
      artifacts,
      evaluateProof,
      capture: captureReviewerPanel,
      ...(waitForReady && { waitForReady }),
    });
  } catch (error) {
    recordReviewerFailure(report, 'reviewer_two_turn_terminal_proof', error);
    await writeReviewerReport(output, report);
    throw error;
  }
}
