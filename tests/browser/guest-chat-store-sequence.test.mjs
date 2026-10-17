import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { Window } from 'happy-dom';

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

// A native send dispatch can return successfully while no click reaches the
// package button. The boundary must retain that difference without message text.
test('guest send boundary distinguishes a reached button from a missed native click', async () => {
  const body = source.slice(
    source.indexOf('async function installGuestSendClickProbe('),
    source.indexOf('async function submitQuestion('),
  );
  assert.ok(body.startsWith('async function installGuestSendClickProbe('));
  const install = new Function('evaluate', `${body}; return installGuestSendClickProbe;`);
  for (const shouldClick of [true, false]) {
    const window = new Window();
    window.document.body.innerHTML =
      '<button role="tab" title="Chat" aria-controls="chat"></button><div id="chat" data-state="active"><textarea></textarea><button aria-label="Send message"></button></div>';
    const pane = window.document.getElementById('chat');
    const button = pane.querySelector('button');
    pane.querySelector('textarea').value = 'Read the current page.';
    const probe = install(async (_panel, expression) => window.eval(expression));
    assert.deepEqual(JSON.parse(JSON.stringify(await probe({}))), {
      installed: true,
      beforeClick: {
        clickEvents: 0,
        bubbleClickEvents: 0,
        trustedClickEvents: 0,
        buttonConnected: true,
        composerLength: 22,
        userMessageCount: 0,
        sendEnabled: true,
      },
    });
    button.addEventListener('click', () => {
      pane.querySelector('textarea').value = '';
      pane.insertAdjacentHTML(
        'beforeend',
        '<article role="article" aria-label="Your message"></article>',
      );
    });
    if (shouldClick) button.click();
    const result = await window.eval('window.__guestChatSendClickProbe.stop()');
    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
      clickEvents: shouldClick ? 1 : 0,
      bubbleClickEvents: shouldClick ? 1 : 0,
      trustedClickEvents: 0,
      buttonConnected: true,
      composerLength: shouldClick ? 0 : 22,
      userMessageCount: shouldClick ? 1 : 0,
      sendEnabled: true,
    });
    await window.happyDOM.abort();
  }
});

test('guest send boundary exposes a click stopped before the React root', async () => {
  const body = source.slice(
    source.indexOf('async function installGuestSendClickProbe('),
    source.indexOf('async function submitQuestion('),
  );
  const install = new Function('evaluate', `${body}; return installGuestSendClickProbe;`);
  const window = new Window();
  window.document.body.innerHTML =
    '<button role="tab" title="Chat" aria-controls="chat"></button><div id="chat" data-state="active"><textarea></textarea><button aria-label="Send message"></button></div>';
  const button = window.document.querySelector('#chat button');
  await install(async (_panel, expression) => window.eval(expression))({});
  button.addEventListener('click', (event) => event.stopPropagation());
  button.click();
  const result = await window.eval('window.__guestChatSendClickProbe.stop()');
  assert.equal(result.clickEvents, 1);
  assert.equal(result.bubbleClickEvents, 0);
  assert.equal(result.buttonConnected, true);
  await window.happyDOM.abort();
});

test('guest send records native dispatch phases and reached-button outcome before answer wait', async () => {
  const body = source.slice(
    source.indexOf('async function submitQuestion('),
    source.indexOf('async function requireActiveFixtureTab('),
  );
  for (const reachedButton of [true, false]) {
    const report = { composer_input_boundaries: [] };
    let dispatched = false;
    const submit = new Function(
      'assert',
      'evaluate',
      'installGuestComposerProbe',
      'guestComposerSnapshot',
      'waitFor',
      'observe',
      'installGuestSendClickProbe',
      'click',
      'report',
      `${body}; return submitQuestion;`,
    )(
      assert,
      async (_panel, expression) => {
        if (expression.includes('textarea?.focus()')) return true;
        if (expression.includes('__guestChatSendClickProbe?.stop()'))
          return {
            clickEvents: dispatched && reachedButton ? 1 : 0,
            composerLength: 139,
            userMessageCount: 0,
            sendEnabled: true,
          };
        return null;
      },
      async () => ({ currentValueLength: 0 }),
      async () => ({ currentValueLength: 139, sendEnabled: true }),
      async (_stage, read, accepts) => assert.equal(accepts(await read()), true),
      async () => ({ sendEnabled: true }),
      async () => ({
        installed: true,
        beforeClick: {
          clickEvents: 0,
          composerLength: 139,
          userMessageCount: 0,
          sendEnabled: true,
        },
      }),
      async (_panel, kind, label, onPhase) => {
        assert.equal(kind, 'chat-send');
        assert.equal(label, '');
        onPhase('press_attempted');
        onPhase('press_returned');
        onPhase('release_attempted');
        onPhase('release_returned');
        dispatched = true;
      },
      report,
    );
    await submit(
      { send: async () => ({}) },
      'Read the current page.',
      'opening_question',
      'package',
    );
    assert.deepEqual(report.composer_input_boundaries[0].click, {
      phases: ['press_attempted', 'press_returned', 'release_attempted', 'release_returned'],
      beforeClick: {
        clickEvents: 0,
        composerLength: 139,
        userMessageCount: 0,
        sendEnabled: true,
      },
      afterClick: {
        clickEvents: reachedButton ? 1 : 0,
        composerLength: 139,
        userMessageCount: 0,
        sendEnabled: true,
      },
    });
  }
});

test('guest acceptance requires all three mode-aware HTTP observations before transport proof', () => {
  const proofFor = (attempt) =>
    source.search(
      new RegExp(
        `requireGuestTransport\\(\\s*report\\.guest_ai_requests,\\s*'${attempt}',\\s*transportMode,?\\s*\\)`,
      ),
    );
  const firstProof = proofFor('opening');
  const secondProof = proofFor('post_reload_new_conversation');
  const sameProof = proofFor('same_conversation_followup');
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
  const boundary = source.search(
    /const sameConversationBoundary\s*=\s*await guestTurnBoundary\(\s*panel,\s*transportMode,?\s*\)/,
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

// SUT: the actual optional-control driver. CDP/DOM and native clicks are its
// external dependencies; selection, refusal, and the open/close sequence stay real.
const valuesDriverSource = source.slice(
  source.indexOf('async function openAndCloseGuestValuesChip('),
  source.indexOf('async function installPageFixture('),
);
const valuesDriver = new Function(
  'evaluate',
  'click',
  'waitFor',
  'assert',
  `${valuesDriverSource}; return openAndCloseGuestValuesChip;`,
);

function valuesControlHarness(count, blocked = null) {
  let expanded = 'false';
  const calls = [];
  const buttons = Array.from({ length: count }, () => ({
    getAttribute: (name) => (name === 'aria-label' ? '0 included' : expanded),
  }));
  // Sanitized DOM seam from the .520 failed screenshot: selected Chat and
  // composer, no Values control. The .205 control uses the same accessible name.
  const document = {
    querySelector: () => ({ getAttribute: () => 'chat-pane' }),
    getElementById: () => ({ querySelectorAll: () => buttons }),
  };
  const run = valuesDriver(
    async (_panel, expression) => new Function('document', `return ${expression}`)(document),
    async (_panel, kind, label) => {
      calls.push([kind, label]);
      if (blocked === 'open' || (blocked === 'close' && expanded === 'true')) return;
      expanded = expanded === 'false' ? 'true' : 'false';
    },
    async (stage, read, accepts) => {
      assert.ok(accepts(await read()), stage);
    },
    assert,
  );
  return { run: () => run({}), calls };
}

test('package guest Chat without Values continues without a fabricated control verdict', async () => {
  const harness = valuesControlHarness(0);
  assert.deepEqual(await harness.run(), { present: false, exercised: false });
  assert.deepEqual(harness.calls, []);
});

test('published guest Chat Values must actually open and close when present', async () => {
  const harness = valuesControlHarness(1);
  assert.deepEqual(await harness.run(), { present: true, exercised: true });
  assert.deepEqual(harness.calls, [
    ['context-values', ''],
    ['context-values', ''],
  ]);
});

test('optional Values does not silently accept duplicate controls or a failed interaction', async () => {
  const duplicates = valuesControlHarness(2);
  await assert.rejects(duplicates.run, /absent or uniquely present/);
  assert.deepEqual(duplicates.calls, []);
  await assert.rejects(valuesControlHarness(1, 'open').run, /guest_values_chip_open/);
  await assert.rejects(valuesControlHarness(1, 'close').run, /guest_values_chip_closed/);
});
