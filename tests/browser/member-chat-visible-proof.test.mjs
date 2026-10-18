import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { requireMemberAnswerEvidence } from './member-chat-visible-proof.mjs';

// A reviewer receives two terminal turns, but the final answer may be offscreen.
test('an ineligible member answer keeps a private screenshot and sanitized reason before failure', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'member-visible-proof-'));
  try {
    const report = { screenshots: { result: null } };
    const panel = { kind: 'native-panel' };
    let captureObservedReport = false;
    const unsafe = 'Bearer sensitive-session-value';
    const proof = {
      eligible: false,
      reason: 'answer_not_readable_above_composer',
      painted: true,
      term_visible: [false],
      answer_text: unsafe,
      token: unsafe,
    };
    const capture = async (target, directory, label) => {
      assert.equal(target, panel);
      assert.equal(directory, artifacts);
      assert.equal(label, 'reviewer-chat-visible-answer-proof');
      captureObservedReport = report.member_answer_proof?.reason === proof.reason;
      const path = join(directory, `${label}.png`);
      await writeFile(path, Buffer.from('panel-image'), { mode: 0o600 });
      return path;
    };
    await assert.rejects(
      requireMemberAnswerEvidence({
        panel,
        expectedTerms: ['Understand'],
        report,
        artifacts,
        evaluateProof: async () => proof,
        capture,
      }),
      /reviewer_chat_visible_answer_unverified/,
    );
    assert.equal(captureObservedReport, true);
    assert.deepEqual(report.member_answer_proof, {
      eligible: false,
      reason: 'answer_not_readable_above_composer',
      painted: true,
      term_visible: [false],
    });
    assert.equal(report.screenshots.result, null);
    assert.equal(await readFile(report.screenshots.visible_answer_proof, 'utf8'), 'panel-image');
    const persisted = join(artifacts, 'report.json');
    await writeFile(persisted, JSON.stringify({ status: 'unverified', ...report }), {
      mode: 0o600,
    });
    const evidence = await readFile(persisted, 'utf8');
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
