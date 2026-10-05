import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const source = await readFile(
  new URL('./guest-chat-store-acceptance.mjs', import.meta.url),
  'utf8',
);
const openingVerdict = source.indexOf("'real guest answer must contain the page-specific code");
const openingScreenshot = source.indexOf("'guest-chat-real-answer.png'");
const sameSend = source.indexOf("networkWatch.arm('same_conversation_followup')");
const sameVerdict = source.indexOf(
  "'same conversation must produce an independent grounded assistant reply'",
);
const sameScreenshot = source.indexOf("'guest-chat-same-conversation-followup.png'");
const panelReload = source.indexOf("markStage('real_panel_reload')");
const followupVerdict = source.indexOf("'new guest conversation after reload must ground");
const followupScreenshot = source.indexOf('        report.followup_screenshot = await capture(');
const cleanup = source.indexOf('      } catch (error) {', followupScreenshot);
const tail = source.slice(followupScreenshot, cleanup);

test('guest acceptance requires both offscreen HTTP observations before transport proof', () => {
  const firstProof = source.indexOf("requireGuestTransport(report.guest_ai_requests, 'opening')");
  const secondProof = source.indexOf(
    "requireGuestTransport(report.guest_ai_requests, 'post_reload_new_conversation')",
  );
  const sameProof = source.indexOf(
    "requireGuestTransport(report.guest_ai_requests, 'same_conversation_followup')",
  );
  const identityProof = source.indexOf(
    'requireGuestConversationSequence(report.guest_ai_requests)',
  );
  const proofClaim = source.indexOf('report.guest_ai_transport_proven = true');
  assert.ok(firstProof > 0 && firstProof < openingVerdict);
  assert.ok(sameProof > sameSend && sameProof < sameVerdict);
  assert.ok(secondProof > openingScreenshot && secondProof < followupVerdict);
  assert.ok(identityProof > secondProof && identityProof < followupVerdict);
  assert.ok(proofClaim > identityProof && proofClaim < cleanup);
});

test('guest acceptance sends and verifies an independent same-conversation turn before reload', () => {
  const boundary = source.indexOf(
    'const sameConversationBoundary = await guestTurnBoundary(panel)',
  );
  assert.ok(
    openingScreenshot < sameSend &&
      boundary > openingScreenshot &&
      boundary < sameSend &&
      sameSend < sameVerdict &&
      sameVerdict < sameScreenshot &&
      sameScreenshot < panelReload,
    'same-conversation answer must complete before panel reload',
  );
  assert.match(source.slice(sameSend, sameVerdict), /fixture\.followupCode/);
  assert.match(source.slice(sameSend, sameVerdict), /replyCount > answered\.replyCount/);
  assert.match(source.slice(sameSend, sameVerdict), /sameConversationBoundary,/);
  assert.match(source.slice(0, openingVerdict), /\.\.\.turnBoundary/);
});

// Regressions caught: an owner-table GET aborts before either answer is checked,
// or the final owner-table check silently allows a GET after both screenshots.
test('guest owner-table verdict executes after both Chat verdicts and screenshots', async () => {
  assert.ok(
    openingVerdict > 0 &&
      openingScreenshot > openingVerdict &&
      followupVerdict > openingScreenshot &&
      followupScreenshot > followupVerdict &&
      cleanup > followupScreenshot,
    'both Chat verdicts and screenshots must precede the final owner-table verdict',
  );
  assert.equal((source.match(/owner-table GET/g) ?? []).length, 1);

  const runActualTail = new Function(
    'panel',
    'artifacts',
    'join',
    'capture',
    'report',
    'contextReadWatch',
    'assert',
    `return (async () => { ${tail} })();`,
  );
  for (const [reads, fails] of [
    [[], false],
    [[{ stage: 'chip_open', method: 'GET', status: 403 }], true],
    [[{ stage: 'post_reload_send', method: 'GET', status: 403 }], true],
  ]) {
    const report = {
      opening_turn_verdict: 'terminal_answer',
      followup_turn_verdict: 'terminal_answer',
    };
    const captures = [];
    const execute = () =>
      runActualTail(
        {},
        '/artifact',
        join,
        async (_panel, path) => {
          captures.push(path);
          return path;
        },
        report,
        { snapshot: () => reads.map((read) => ({ ...read })) },
        assert,
      );
    if (fails) await assert.rejects(execute, /owner-table GET/);
    else await execute();
    assert.deepEqual(captures, [join('/artifact', 'guest-chat-real-followup-answer.png')]);
    assert.deepEqual(report.context_rule_reads, reads);
    assert.equal(report.followup_screenshot, captures[0]);
  }
});
