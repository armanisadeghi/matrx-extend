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

test('a later painted sample of the same assistant becomes proof only with a paired screenshot', async () => {
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
  const accepted = await requireMemberAnswerEvidence({
    panel: {},
    expectedTerms: ['Understand'],
    report,
    artifacts: '/private',
    waitForReady: async (_label, read, accept) => {
      const value = await read();
      assert.equal(accept(value), true);
      return value;
    },
    evaluateProof: async (_panel, _terms, phase) => {
      phases.push(phase);
      const opacity = phase === 'immediate' ? 0 : 1;
      return {
        eligible: phase !== 'immediate',
        reason: phase === 'immediate' ? 'answer_unpainted' : 'eligible',
        painted: opacity > 0,
        term_visible: [true],
        diagnostic: {
          ...diagnostic(opacity, phase),
          article_id_hash: 'fedcba9876543210',
          selected_article_index: 1,
          selected_transcript_index: 0,
        },
      };
    },
    capture: async (_panel, _artifacts, label) => `/private/${label}.png`,
  });
  assert.equal(accepted.eligible, true);
  assert.deepEqual(phases, ['immediate', 'paint_ready', 'post_capture']);
  assert.equal(report.member_answer_diagnostic.immediate.transcript.opacity, 0);
  assert.equal(report.member_answer_diagnostic.paint_ready.transcript.opacity, 1);
  assert.equal(report.member_answer_diagnostic.post_capture.transcript.opacity, 1);
  assert.equal(
    report.member_answer_diagnostic.immediate.article_candidates[1].article_id_hash,
    'fedcba9876543210',
  );
  assert.equal(report.member_answer_diagnostic.immediate.document_visibility, 'hidden');
  assert.equal(report.member_answer_proof.eligible, true);
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
        waitForReady: async (_label, read, accept) => {
          const value = await read();
          assert.equal(accept(value), false);
          throw new Error('paint not ready');
        },
        evaluateProof: async (_panel, _terms, phase) => {
          phases.push(phase);
          return proof;
        },
      }),
      /reviewer_chat_visible_answer_unverified/,
    );
    assert.equal(captureObservedReport, true);
    assert.deepEqual(phases, ['immediate', 'paint_ready']);
    assert.equal(captureCallCount, 1);
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
    assert.equal(report.member_answer_diagnostic?.paint_ready_failed, true);
    assert.equal(report.member_answer_diagnostic?.paint_ready?.eligible, false);
    for (const phase of ['immediate', 'paint_ready']) {
      const timing = report.member_answer_diagnostic.phase_timing[phase];
      assert.match(timing.started_at_utc, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      assert.match(timing.finished_at_utc, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      assert.ok(timing.elapsed_ms >= 0);
      assert.equal(timing.exception_category, null);
    }
    const imagePath = join(artifacts, 'reviewer-chat-visible-answer-initial.png');
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
    assert.equal(persisted.screenshots.visible_answer_initial, imagePath);
    assert.equal(persisted.member_answer_diagnostic.immediate.article_id_hash, '0123456789abcdef');
    assert.equal(
      persisted.member_answer_diagnostic.immediate.rejected_ancestor.class_hash,
      'fedcba9876543210',
    );
    assert.deepEqual(await readFile(persisted.screenshots.visible_answer_initial), png);
    assert.equal((await stat(persisted.screenshots.visible_answer_initial)).mode & 0o777, 0o600);
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
    diagnostic: {
      article_id_hash: '0123456789abcdef',
      selected_chat_tab_count: 1,
      active_chat_pane_count: 1,
      selected_article_index: 1,
      selected_transcript_index: 0,
    },
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
      waitForReady: async (_label, read) => {
        await assert.rejects(read, /private browser failure/);
        throw new Error('paint not ready');
      },
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
  assert.deepEqual(phases, ['immediate', 'paint_ready']);
  assert.equal(report.member_answer_diagnostic.paint_ready_failed, true);
  assert.equal(report.member_answer_diagnostic.phase_timing.immediate.exception_category, null);
  assert.equal(
    report.member_answer_diagnostic.phase_timing.paint_ready.exception_category,
    'evaluation_error',
  );
  assert.doesNotMatch(JSON.stringify(report), /private browser failure/);
});

test('diagnostic probe categories distinguish transport loss from timeout without leaking exception text', async () => {
  const secret = 'Bearer hidden-value';
  for (const [failure, category] of [
    [new Error(`Target closed ${secret}`), 'transport_closed'],
    [Object.assign(new Error(secret), { name: 'TimeoutError' }), 'timeout'],
  ]) {
    const report = { screenshots: {} };
    await assert.rejects(
      requireMemberAnswerEvidence({
        panel: {},
        expectedTerms: ['Understand'],
        report,
        artifacts: '/unused',
        waitForReady: async (_label, read) => {
          await assert.rejects(read);
          throw new Error('paint not ready');
        },
        evaluateProof: async (_panel, _terms, phase) => {
          if (phase === 'paint_ready') throw failure;
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
      report.member_answer_diagnostic.phase_timing.paint_ready.exception_category,
      category,
    );
    assert.doesNotMatch(JSON.stringify(report), /Bearer|hidden-value|Target closed|TimeoutError/);
  }
});

test('paired proof refuses a changed assistant, hidden paint, unreadable term, inactive pane or missing screenshot', async () => {
  const ready = {
    eligible: true,
    reason: 'eligible',
    painted: true,
    term_visible: [true],
    diagnostic: {
      article_id_hash: '0123456789abcdef',
      selected_article_index: 1,
      selected_transcript_index: 0,
      selected_chat_tab_count: 1,
      active_chat_pane_count: 1,
    },
  };
  for (const [name, post] of [
    [
      'changed assistant',
      { ...ready, diagnostic: { ...ready.diagnostic, article_id_hash: 'fedcba9876543210' } },
    ],
    ['hidden paint', { ...ready, eligible: false, reason: 'answer_unpainted', painted: false }],
    [
      'unreadable term',
      {
        ...ready,
        eligible: false,
        reason: 'answer_not_readable_above_composer',
        term_visible: [false],
      },
    ],
    ['inactive pane', { ...ready, diagnostic: { ...ready.diagnostic, active_chat_pane_count: 0 } }],
    [
      'changed article position',
      { ...ready, diagnostic: { ...ready.diagnostic, selected_article_index: 0 } },
    ],
    [
      'changed transcript',
      { ...ready, diagnostic: { ...ready.diagnostic, selected_transcript_index: 1 } },
    ],
  ]) {
    const report = { screenshots: {} };
    await assert.rejects(
      requireMemberAnswerEvidence({
        panel: {},
        expectedTerms: ['Understand'],
        report,
        artifacts: '/unused',
        evaluateProof: async (_panel, _terms, phase) => (phase === 'post_capture' ? post : ready),
        capture: async () => '/private/paired-proof.png',
      }),
      /reviewer_chat_visible_answer_unverified/,
      name,
    );
    assert.equal(report.screenshots.visible_answer_proof, '/private/paired-proof.png');
    assert.equal(report.member_answer_proof.eligible, false, name);
  }
  for (const [name, diagnostic] of [
    ['missing article index', { ...ready.diagnostic, selected_article_index: undefined }],
    ['missing transcript index', { ...ready.diagnostic, selected_transcript_index: undefined }],
  ]) {
    const report = { screenshots: {} };
    await assert.rejects(
      requireMemberAnswerEvidence({
        panel: {},
        expectedTerms: ['Understand'],
        report,
        artifacts: '/unused',
        evaluateProof: async () => ({ ...ready, diagnostic }),
        capture: async () => '/private/paired-proof.png',
      }),
      /reviewer_chat_visible_answer_unverified/,
      name,
    );
    assert.equal(report.screenshots.visible_answer_proof, undefined, name);
  }
  const report = { screenshots: {} };
  await assert.rejects(
    requireMemberAnswerEvidence({
      panel: {},
      expectedTerms: ['Understand'],
      report,
      artifacts: '/unused',
      evaluateProof: async () => ready,
      capture: async () => {
        throw new Error('private screenshot failure');
      },
    }),
    /reviewer_chat_visible_answer_screenshot_missing/,
  );
  assert.equal(report.member_answer_proof.screenshot_capture_failed, true);
  assert.doesNotMatch(JSON.stringify(report), /private screenshot failure/);
  const lostReport = { screenshots: {} };
  await assert.rejects(
    requireMemberAnswerEvidence({
      panel: {},
      expectedTerms: ['Understand'],
      report: lostReport,
      artifacts: '/unused',
      evaluateProof: async (_panel, _terms, phase) => {
        if (phase === 'post_capture') throw new Error('private target loss');
        return ready;
      },
      capture: async () => '/private/paired-proof.png',
    }),
    /reviewer_chat_visible_answer_unverified/,
  );
  assert.equal(lostReport.member_answer_proof.eligible, false);
  assert.equal(lostReport.member_answer_diagnostic.post_capture_failed, true);
  assert.doesNotMatch(JSON.stringify(lostReport), /private target loss/);
});

test('paint readiness cannot replace the terminal assistant selected by the immediate sample', async () => {
  const original = {
    eligible: false,
    reason: 'answer_unpainted',
    painted: false,
    term_visible: [true],
    diagnostic: {
      article_id_hash: '0123456789abcdef',
      selected_article_index: 1,
      selected_transcript_index: 0,
      selected_chat_tab_count: 1,
      active_chat_pane_count: 1,
    },
  };
  const replacement = {
    ...original,
    eligible: true,
    reason: 'eligible',
    painted: true,
    diagnostic: { ...original.diagnostic, article_id_hash: 'fedcba9876543210' },
  };
  const report = { screenshots: {} };
  let captures = 0;
  await assert.rejects(
    requireMemberAnswerEvidence({
      panel: {},
      expectedTerms: ['Understand'],
      report,
      artifacts: '/unused',
      waitForReady: async (_label, read, accept) => {
        const value = await read();
        assert.equal(accept(value), true);
        return value;
      },
      evaluateProof: async (_panel, _terms, phase) =>
        phase === 'immediate' ? original : replacement,
      capture: async () => {
        captures += 1;
        return '/private/paired-proof.png';
      },
    }),
    /reviewer_chat_visible_answer_unverified/,
  );
  assert.equal(captures, 0);
  assert.equal(report.member_answer_diagnostic.immediate.article_id_hash, '0123456789abcdef');
  assert.equal(report.member_answer_diagnostic.paint_ready.article_id_hash, 'fedcba9876543210');
  assert.equal(report.member_answer_proof.eligible, false);
  assert.equal(report.member_answer_proof.reason, 'paired_proof_unverified');
});
