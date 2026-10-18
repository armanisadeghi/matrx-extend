import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  requireMemberAnswerEvidence,
  runMemberAnswerProofBoundary,
} from './member-chat-visible-proof.mjs';

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
    assert.equal(report.member_answer_diagnostic?.next_frame?.painted, true);
    assert.equal(report.member_answer_diagnostic?.scroll_bottom?.painted, true);
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
  assert.doesNotMatch(JSON.stringify(report), /private browser failure/);
});
