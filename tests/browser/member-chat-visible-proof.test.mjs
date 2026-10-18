import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  recordReviewerFailure,
  requireMemberAnswerEvidence,
  runMemberAnswerProofBoundary,
  sanitizeMemberAnswerDiagnostic,
} from './member-chat-visible-proof.mjs';

test('member diagnostic retains only bounded paint and animation evidence across probes', async () => {
  const secret = 'Bearer private-message-id-and-answer';
  const report = { screenshots: {} };
  const phases = [];
  const diagnostic = (opacity, phase) => ({
    document_visibility: phase === 'immediate' ? 'hidden' : 'visible',
    document_has_focus: phase !== 'immediate',
    selected_chat_tab_count: 1,
    active_chat_pane_count: 1,
    chat_column_count: 1,
    transcript_count: 1,
    selected_transcript_index: 0,
    assistant_article_count: 2,
    selected_article_index: 1,
    article_candidates: [
      {
        article_id_hash: '0123456789abcdef',
        article_rect: { x: 16, y: 90, width: 320, height: 50 },
        painted: false,
        rejected_ancestor: {
          scope: 'above_article',
          opacity: 0,
          class_hash: 'ab3882204ea95060',
          display: 'block',
          visibility: 'visible',
          tag: 'DIV',
          depth: 9,
        },
        raw_id: secret,
      },
      {
        article_id_hash: 'fedcba9876543210',
        article_rect: { x: 16, y: 134, width: 320, height: 35 },
        painted: opacity > 0,
        rejected_ancestor:
          opacity > 0
            ? null
            : {
                scope: 'above_article',
                opacity: 0,
                class_hash: 'ab3882204ea95060',
                display: 'block',
                visibility: 'visible',
                tag: 'DIV',
                depth: 9,
              },
        raw_text: secret,
      },
    ],
    transcript: {
      class_hash: 'ab3882204ea95060',
      opacity,
      animation_count: 1,
      animation_probe_failed: false,
      animations: [
        {
          play_state: opacity === 0 ? 'paused' : 'finished',
          current_time_ms: opacity === 0 ? 17 : 200,
          delay_ms: 50,
          duration_ms: 200,
          progress: opacity,
          unsafe: secret,
        },
      ],
      unsafe: secret,
    },
    secret,
  });
  await assert.rejects(
    requireMemberAnswerEvidence({
      panel: {},
      expectedTerms: ['Understand'],
      report,
      artifacts: '/private',
      evaluateProof: async (_panel, _terms, phase) => {
        phases.push(phase);
        const opacity = phase === 'immediate' ? 0 : 1;
        return {
          eligible: phase !== 'immediate',
          reason: phase === 'immediate' ? 'answer_unpainted' : 'eligible',
          painted: opacity > 0,
          term_visible: [true],
          diagnostic: diagnostic(opacity, phase),
        };
      },
      capture: async (_panel, _artifacts, label) => `/private/${label}.png`,
    }),
    /reviewer_chat_visible_answer_unverified/,
  );
  assert.deepEqual(phases, ['immediate', 'next_frame', 'scroll_bottom']);
  assert.equal(report.member_answer_diagnostic.immediate.transcript.opacity, 0);
  assert.equal(report.member_answer_diagnostic.next_frame.transcript.opacity, 1);
  assert.equal(
    report.member_answer_diagnostic.scroll_bottom.transcript.animations[0].play_state,
    'finished',
  );
  assert.equal(
    report.member_answer_diagnostic.immediate.article_candidates[1].article_id_hash,
    'fedcba9876543210',
  );
  assert.equal(report.member_answer_diagnostic.immediate.document_visibility, 'hidden');
  assert.equal(
    report.member_answer_proof.eligible,
    false,
    'later paint cannot weaken the immediate gate',
  );
  assert.doesNotMatch(
    JSON.stringify(report),
    /Bearer|private-message-id|raw_id|raw_text|unsafe|secret/,
  );
  const malformed = sanitizeMemberAnswerDiagnostic({
    diagnostic: {
      document_visibility: secret,
      article_candidates: [
        {
          article_id_hash: secret,
          article_rect: { x: Number.POSITIVE_INFINITY },
          rejected_ancestor: { scope: secret, class_hash: secret },
        },
      ],
      transcript: {
        class_hash: secret,
        opacity: 3,
        animations: [
          { play_state: secret, current_time_ms: Number.POSITIVE_INFINITY, progress: 2 },
        ],
      },
    },
  });
  assert.equal(malformed.document_visibility, null);
  assert.equal(malformed.article_candidates[0].article_id_hash, null);
  assert.equal(malformed.transcript.opacity, null);
  assert.equal(malformed.transcript.animations[0].play_state, 'other');
  assert.doesNotMatch(JSON.stringify(malformed), /Bearer|private-message-id/);
});

test('cleanup failure cannot erase the classified visible-answer rejection', () => {
  const report = { status: 'unverified' };
  recordReviewerFailure(
    report,
    'reviewer_two_turn_terminal_proof',
    new Error('reviewer_chat_visible_answer_unverified'),
  );
  recordReviewerFailure(
    report,
    'reviewer_two_turn_terminal_proof',
    new Error('transport cleanup failed'),
  );
  assert.equal(report.failure_code, 'reviewer_chat_visible_answer_unverified');
});

// A reviewer receives two terminal turns, but the final answer may be offscreen.
test('runner persists a real CDP panel image and sanitized failure report before rejecting an ineligible answer', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'member-visible-proof-'));
  try {
    const report = { screenshots: { result: null } };
    const output = join(artifacts, 'report.json');
    let captureObservedReport = false;
    let captureCallCount = 0;
    const phases = [];
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=',
      'base64',
    );
    const panel = {
      async send(method, args) {
        assert.equal(method, 'Page.captureScreenshot');
        assert.deepEqual(args, { format: 'png' });
        captureCallCount += 1;
        captureObservedReport = report.member_answer_proof?.reason === proof.reason;
        return { data: png.toString('base64') };
      },
    };
    const unsafe = 'Bearer sensitive-session-value';
    const proof = {
      eligible: false,
      reason: 'answer_not_readable_above_composer',
      painted: true,
      term_visible: [false],
      answer_text: unsafe,
      token: unsafe,
      diagnostic: {
        article_id_hash: '0123456789abcdef',
        article_rect: { x: 4, y: 274, width: 300, height: 30 },
        scroll: { top: 0, client_height: 180, scroll_height: 520 },
        composer_top: 200,
        rejected_ancestor: {
          depth: 2,
          tag: 'DIV',
          scope: 'above_article',
          class_hash: 'fedcba9876543210',
          opacity: 0,
          display: 'block',
          visibility: 'visible',
        },
        secret: unsafe,
      },
    };
    await assert.rejects(
      runMemberAnswerProofBoundary({
        panel,
        expectedTerms: ['Understand'],
        report,
        artifacts,
        output,
        evaluateProof: async (_panel, _terms, phase) => {
          phases.push(phase);
          if (phase === 'next_frame')
            return { ...proof, painted: true, reason: 'eligible', eligible: true };
          if (phase === 'scroll_bottom')
            return { ...proof, painted: true, reason: 'eligible', eligible: true };
          return proof;
        },
      }),
      /reviewer_chat_visible_answer_unverified/,
    );
    assert.equal(captureObservedReport, true);
    assert.deepEqual(phases, ['immediate', 'next_frame', 'scroll_bottom']);
    assert.equal(captureCallCount, 2);
    assert.deepEqual(
      report.member_answer_diagnostic?.immediate?.article_rect,
      { x: 4, y: 274, width: 300, height: 30 },
      'member_visible_diagnostic_article_rect_missing',
    );
    assert.equal(report.member_answer_diagnostic?.immediate?.rejected_ancestor?.opacity, 0);
    assert.equal(report.member_answer_diagnostic?.immediate?.rejected_ancestor?.depth, 2);
    assert.equal(
      report.member_answer_diagnostic?.immediate?.rejected_ancestor?.scope,
      'above_article',
    );
    assert.equal(report.member_answer_diagnostic?.next_frame?.painted, true);
    assert.equal(report.member_answer_diagnostic?.scroll_bottom?.painted, true);
    for (const phase of ['immediate', 'next_frame', 'scroll_bottom']) {
      const timing = report.member_answer_diagnostic.phase_timing[phase];
      assert.match(timing.started_at_utc, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      assert.match(timing.finished_at_utc, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      assert.ok(timing.elapsed_ms >= 0);
      assert.equal(timing.exception_category, null);
    }
    const imagePath = join(artifacts, 'reviewer-chat-visible-answer-proof.png');
    assert.equal(existsSync(imagePath), true, 'member_visible_proof_screenshot_missing');
    assert.equal(existsSync(output), true, 'member_visible_proof_failure_report_missing');
    const evidence = await readFile(output, 'utf8');
    const persisted = JSON.parse(evidence);
    assert.deepEqual(persisted.member_answer_proof, {
      eligible: false,
      reason: 'answer_not_readable_above_composer',
      painted: true,
      term_visible: [false],
    });
    assert.equal(persisted.status, 'unverified');
    assert.equal(persisted.failure_stage, 'reviewer_two_turn_terminal_proof');
    assert.equal(persisted.failure_code, 'reviewer_chat_visible_answer_unverified');
    assert.equal(persisted.screenshots.result, null);
    assert.equal(persisted.screenshots.visible_answer_proof, imagePath);
    assert.equal(persisted.member_answer_diagnostic.immediate.article_id_hash, '0123456789abcdef');
    assert.equal(
      persisted.member_answer_diagnostic.immediate.rejected_ancestor.class_hash,
      'fedcba9876543210',
    );
    assert.equal(
      existsSync(persisted.screenshots.visible_answer_after_scroll),
      true,
      'member_visible_probe_screenshot_missing',
    );
    assert.deepEqual(await readFile(persisted.screenshots.visible_answer_proof), png);
    assert.equal((await stat(persisted.screenshots.visible_answer_proof)).mode & 0o777, 0o600);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.match(evidence, /answer_not_readable_above_composer/);
    assert.doesNotMatch(evidence, /Bearer|sensitive-session-value|answer_text|token/);
  } finally {
    await rm(artifacts, { recursive: true, force: true });
  }
});

test('unknown proof fields and reasons cannot leak, while an eligible proof still passes', async () => {
  const report = { screenshots: {} };
  const unsafe = 'password=private-value';
  const proof = {
    eligible: true,
    reason: unsafe,
    painted: true,
    term_visible: [true, unsafe],
    auth: unsafe,
  };
  const returned = await requireMemberAnswerEvidence({
    panel: {},
    expectedTerms: ['Understand'],
    report,
    artifacts: '/unused',
    evaluateProof: async () => proof,
    capture: async () => '/private/reviewer-chat-visible-answer-proof.png',
  });
  assert.equal(returned, proof);
  assert.deepEqual(report.member_answer_proof, {
    eligible: true,
    reason: 'unclassified',
    painted: true,
    term_visible: [true, false],
  });
  assert.doesNotMatch(JSON.stringify(report), /password|private-value|auth/);
});

test('a failed diagnostic probe cannot turn an unpainted answer into acceptance', async () => {
  const report = { screenshots: {} };
  const phases = [];
  await assert.rejects(
    requireMemberAnswerEvidence({
      panel: {},
      expectedTerms: ['Understand'],
      report,
      artifacts: '/unused',
      evaluateProof: async (_panel, _terms, phase) => {
        phases.push(phase);
        if (phase !== 'immediate') throw new Error('private browser failure');
        return {
          eligible: false,
          reason: 'answer_unpainted',
          painted: false,
          term_visible: [true],
        };
      },
      capture: async () => '/private/reviewer-chat-visible-answer-proof.png',
    }),
    /reviewer_chat_visible_answer_unverified/,
  );
  assert.deepEqual(phases, ['immediate', 'next_frame', 'scroll_bottom']);
  assert.equal(report.member_answer_diagnostic.next_frame_failed, true);
  assert.equal(report.member_answer_diagnostic.scroll_probe_failed, true);
  assert.equal(report.member_answer_diagnostic.phase_timing.immediate.exception_category, null);
  assert.equal(
    report.member_answer_diagnostic.phase_timing.next_frame.exception_category,
    'evaluation_error',
  );
  assert.equal(
    report.member_answer_diagnostic.phase_timing.scroll_bottom.exception_category,
    'evaluation_error',
  );
  assert.doesNotMatch(JSON.stringify(report), /private browser failure/);
});

test('diagnostic probe categories distinguish transport loss from timeout without leaking exception text', async () => {
  const report = { screenshots: {} };
  const secret = 'Bearer hidden-value';
  await assert.rejects(
    requireMemberAnswerEvidence({
      panel: {},
      expectedTerms: ['Understand'],
      report,
      artifacts: '/unused',
      evaluateProof: async (_panel, _terms, phase) => {
        if (phase === 'next_frame') throw new Error(`Target closed ${secret}`);
        if (phase === 'scroll_bottom')
          throw Object.assign(new Error(secret), { name: 'TimeoutError' });
        return {
          eligible: false,
          reason: 'answer_unpainted',
          painted: false,
          term_visible: [true],
        };
      },
      capture: async () => '/unused/proof.png',
    }),
    /reviewer_chat_visible_answer_unverified/,
  );
  assert.equal(
    report.member_answer_diagnostic.phase_timing.next_frame.exception_category,
    'transport_closed',
  );
  assert.equal(
    report.member_answer_diagnostic.phase_timing.scroll_bottom.exception_category,
    'timeout',
  );
  assert.doesNotMatch(JSON.stringify(report), /Bearer|hidden-value|Target closed|TimeoutError/);
});
