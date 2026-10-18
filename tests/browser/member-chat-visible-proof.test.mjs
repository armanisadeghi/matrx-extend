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
    };
    await assert.rejects(
      runMemberAnswerProofBoundary({
        panel,
        expectedTerms: ['Understand'],
        report,
        artifacts,
        output,
        evaluateProof: async () => proof,
      }),
      /reviewer_chat_visible_answer_unverified/,
    );
    assert.equal(captureObservedReport, true);
    assert.equal(captureCallCount, 1);
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
