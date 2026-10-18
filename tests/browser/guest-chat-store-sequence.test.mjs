import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createGuestInputDriver } from './guest-chat-input-driver.mjs';

const { configureStore } = createRequire(
  import.meta.resolve('@ai-matrx/chat/store/create-chat-store'),
)('@reduxjs/toolkit');

const source = await readFile(
  new URL('./guest-chat-store-acceptance.mjs', import.meta.url),
  'utf8',
);
const inputSource = await readFile(
  new URL('./guest-chat-input-driver.mjs', import.meta.url),
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

// A failed optional Values close must never prevent the three real guest Chat
// turns from being sent and judged. Values still runs before the final verdict.
test('guest Values observation follows all strict Chat proofs', () => {
  const transportProof = source.indexOf('report.guest_ai_transport_proven = true');
  const valuesStage = source.indexOf("markStage('guest_values_chip_observation')");
  const valuesCall = source.indexOf(
    'report.guest.values_control = await openAndCloseGuestValuesChip(panel)',
  );
  const ownerReadVerdict = source.indexOf(
    "'guest panel, optional Values control, and all three sends must not issue an owner-table GET'",
  );
  assert.ok(
    openingVerdict > 0 &&
      sameVerdict > openingVerdict &&
      followupVerdict > sameVerdict &&
      transportProof > followupVerdict &&
      valuesStage > transportProof &&
      valuesCall > valuesStage &&
      ownerReadVerdict > valuesCall &&
      cleanup > ownerReadVerdict,
    'Values must remain a strict UI check after all three Chat answers and before owner-read verdict',
  );
});

// A native send dispatch can return successfully while no click reaches the
// package button. The boundary must retain that difference without message text.
test('guest send boundary distinguishes a reached button from a missed native click', async () => {
  const body = inputSource.slice(
    inputSource.indexOf('async function installGuestSendClickProbe('),
    inputSource.indexOf('async function submitQuestion('),
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
        intentMatchedAtClick: null,
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
      intentMatchedAtClick: null,
      buttonConnected: true,
      composerLength: shouldClick ? 0 : 22,
      userMessageCount: shouldClick ? 1 : 0,
      sendEnabled: true,
    });
    await window.happyDOM.abort();
  }
});

test('guest send boundary exposes a click stopped before the React root', async () => {
  const body = inputSource.slice(
    inputSource.indexOf('async function installGuestSendClickProbe('),
    inputSource.indexOf('async function submitQuestion('),
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
    'fixture',
    'markStage',
    'openAndCloseGuestValuesChip',
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
      guest: {},
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
        { arm: () => {}, snapshot: () => reads.map((read) => ({ ...read })) },
        assert,
        { followupCode: 'NEW-791', title: 'Field guide' },
        () => {},
        async () => ({ present: true, exercised: true }),
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
const failureSanitizersSource = source.slice(
  source.indexOf('function safeFailure('),
  source.indexOf('function safeVisibleText('),
);
const { safeFailure, safeValuesCloseDiagnostic } = new Function(
  `${failureSanitizersSource}; return { safeFailure, safeValuesCloseDiagnostic };`,
)();

function valuesControlHarness(count, blocked = null) {
  let open = false;
  let hiddenAfterEscape = false;
  let onKeyDown = null;
  const calls = [];
  const buttons = Array.from({ length: count }, () => ({
    getAttribute: (name) => (name === 'aria-label' ? '0 included' : null),
  }));
  // The Store's desktop Values popover has Open full view, but this host omits
  // onToggleAll/onSetInclude, so the optional Send everything switch is absent.
  const hiddenAncestor = { parentElement: null };
  const dialog = {
    parentElement: blocked === 'ancestor-opacity-hidden' ? hiddenAncestor : null,
    contains: () => true,
    getBoundingClientRect: () => ({ width: blocked === 'zero-size' ? 0 : 340, height: 260 }),
    checkVisibility: () => blocked !== 'check-visibility-hidden',
    querySelector: (selector) =>
      selector === '[aria-label="Open full view"]' && blocked !== 'unrelated'
        ? {
            getBoundingClientRect: () => ({
              width: blocked === 'button-zero-size' ? 0 : 28,
              height: 28,
            }),
          }
        : null,
  };
  const document = {
    activeElement: null,
    hasFocus: () => blocked !== 'unfocused',
    addEventListener: (type, listener) => {
      if (type === 'keydown') onKeyDown = listener;
    },
    removeEventListener: (type, listener) => {
      if (type === 'keydown' && onKeyDown === listener) onKeyDown = null;
    },
    querySelector: () => ({ getAttribute: () => 'chat-pane' }),
    getElementById: () => ({ querySelectorAll: () => buttons }),
    querySelectorAll: (selector) =>
      open &&
      (selector === '[role="dialog"]' ||
        (selector === '[role="dialog"][data-state="open"]' && blocked !== 'closed-remnant'))
        ? [dialog]
        : [],
  };
  const panel = {
    send: async (method, args) => {
      calls.push([method, args.type]);
      if (
        method === 'Input.dispatchKeyEvent' &&
        args.type === 'keyDown' &&
        blocked !== 'key-missed'
      )
        onKeyDown?.({ key: 'Escape', isTrusted: true });
      if (method === 'Input.dispatchKeyEvent' && args.type === 'keyUp') {
        if (blocked === 'hidden-close') hiddenAfterEscape = true;
        else if (blocked !== 'close' && blocked !== 'key-missed') open = false;
      }
    },
  };
  const run = valuesDriver(
    async (_panel, expression) =>
      new Function('document', 'getComputedStyle', `return ${expression}`)(document, (element) => ({
        display: blocked === 'display-none' ? 'none' : 'block',
        visibility: blocked === 'visibility-hidden' ? 'hidden' : 'visible',
        opacity:
          ((blocked === 'opacity-hidden' || (blocked === 'hidden-close' && hiddenAfterEscape)) &&
            element === dialog) ||
          (blocked === 'ancestor-opacity-hidden' && element === hiddenAncestor)
            ? '0'
            : '1',
      })),
    async (_panel, kind, label) => {
      calls.push([kind, label]);
      if (blocked !== 'open') open = true;
    },
    async (stage, read, accepts) => {
      const state = await read();
      if (!accepts(state)) throw new Error(`${stage}_not_observed:${JSON.stringify(state)}`);
      return state;
    },
    assert,
  );
  return { run: () => run(panel), calls };
}

test('package guest Chat without Values continues without a fabricated control verdict', async () => {
  const harness = valuesControlHarness(0);
  assert.deepEqual(await harness.run(), { present: false, exercised: false });
  assert.deepEqual(harness.calls, []);
});

test('published guest Chat Values must actually open and close when present', async () => {
  const harness = valuesControlHarness(1);
  assert.deepEqual(await harness.run(), {
    present: true,
    exercised: true,
    escape_keydown_count: 1,
    trusted_escape_keydown_count: 1,
  });
  assert.deepEqual(harness.calls, [
    ['context-values', ''],
    ['Input.dispatchKeyEvent', 'keyDown'],
    ['Input.dispatchKeyEvent', 'keyUp'],
  ]);
});

test('optional Values does not silently accept duplicate controls or a failed interaction', async () => {
  const duplicates = valuesControlHarness(2);
  await assert.rejects(duplicates.run, /absent or uniquely present/);
  assert.deepEqual(duplicates.calls, []);
  await assert.rejects(valuesControlHarness(1, 'open').run, /guest_values_chip_open/);
  await assert.rejects(valuesControlHarness(1, 'unrelated').run, /guest_values_chip_open/);
  await assert.rejects(valuesControlHarness(1, 'closed-remnant').run, /guest_values_chip_open/);
  await assert.rejects(valuesControlHarness(1, 'zero-size').run, /guest_values_chip_open/);
  await assert.rejects(valuesControlHarness(1, 'button-zero-size').run, /guest_values_chip_open/);
  await assert.rejects(valuesControlHarness(1, 'display-none').run, /guest_values_chip_open/);
  await assert.rejects(valuesControlHarness(1, 'visibility-hidden').run, /guest_values_chip_open/);
  await assert.rejects(valuesControlHarness(1, 'opacity-hidden').run, /guest_values_chip_open/);
  await assert.rejects(
    valuesControlHarness(1, 'ancestor-opacity-hidden').run,
    /guest_values_chip_open/,
  );
  await assert.rejects(
    valuesControlHarness(1, 'check-visibility-hidden').run,
    /guest_values_chip_open/,
  );
  await assert.rejects(valuesControlHarness(1, 'close').run, /guest_values_chip_closed/);
  await assert.rejects(valuesControlHarness(1, 'key-missed').run, /guest_values_chip_closed/);
  await assert.rejects(valuesControlHarness(1, 'hidden-close').run, /guest_values_chip_closed/);
});

test('long Values close failure keeps key delivery and focus in structured receipt diagnostics', async () => {
  assert.ok(
    source.includes('report.values_close_diagnostic = safeValuesCloseDiagnostic(error)'),
    'the sanitized Values fields must be assigned to the emitted report',
  );
  for (const [blocked, expectedKeyCount] of [
    ['close', 1],
    ['key-missed', 0],
  ]) {
    let failure;
    await assert.rejects(valuesControlHarness(1, blocked).run, (error) => {
      failure = error;
      return /guest_values_chip_closed_not_observed/.test(error.message);
    });
    const truncated = safeFailure(failure);
    assert.equal(truncated.reason.length, 120);
    assert.equal(truncated.reason.includes('trustedEscapeKeyDownCount'), false);
    assert.deepEqual(safeValuesCloseDiagnostic(failure), {
      chip_count: 1,
      visible_open_popovers: 1,
      open_state_popovers: 1,
      escape_keydown_count: expectedKeyCount,
      trusted_escape_keydown_count: expectedKeyCount,
      document_focused: true,
      focus_inside_popover: true,
    });
  }
});

// EXT-D-0230: a focus-driven React remount must preserve the user intent, not node identity.
// SUT: the guest submission driver. DOM, probe, and draft inspection run for real;
// only native CDP input/pointer delivery are emulated at the browser boundary.
function harness({ remount = true, breakAt = null, observeAsyncSubmission = false } = {}) {
  const window = new Window();
  window.document.body.innerHTML =
    '<button role="tab" title="Chat" aria-controls="chat"></button><div id="chat" data-state="active"><textarea></textarea><button aria-label="Send message" disabled></button></div>';
  const pane = window.document.getElementById('chat');
  let reduxText = '';
  let conversationId = 'opening-guest-conversation';
  let deferredSubmission = null;
  const initialState = {
    conversations: { byConversationId: { [conversationId]: {} } },
    instanceUserInput: {
      byConversationId: {
        [conversationId]: { text: reduxText, submissionPhase: 'idle' },
      },
    },
    chatHost: {
      identity: { authReady: true, isAuthenticated: false, fingerprintId: 'private-signature' },
    },
  };
  const store = observeAsyncSubmission
    ? configureStore({
        reducer: (state = initialState, action = {}) => {
          if (action.type !== 'draft' && action.type !== 'submit') return state;
          const input = state.instanceUserInput.byConversationId[conversationId];
          return {
            ...state,
            instanceUserInput: {
              byConversationId: {
                ...state.instanceUserInput.byConversationId,
                [conversationId]: {
                  ...input,
                  ...(action.type === 'draft' && { text: action.text }),
                  ...(action.type === 'submit' && { submissionPhase: 'pending' }),
                },
              },
            },
          };
        },
      })
    : {
        getState: () => ({
          instanceUserInput: {
            byConversationId: { [conversationId]: { text: reduxText, submissionPhase: 'idle' } },
          },
        }),
      };
  let nativeClicks = 0;
  let sentText = null;
  const report = { composer_input_boundaries: [] };
  const textarea = () => pane.querySelector('textarea');
  const commit = (text) => {
    textarea().value = text;
    textarea().__reactProps$guest = { value: breakAt === 'react' ? '' : text, onChange() {} };
    textarea().__reactFiber$guest = {
      memoizedProps: { conversationId },
      dependencies: { firstContext: { memoizedValue: { store } } },
    };
    reduxText = breakAt === 'redux' ? '' : text;
    if (observeAsyncSubmission) store.dispatch({ type: 'draft', text: reduxText });
    pane.querySelector('button').disabled = !text;
  };
  commit('');
  textarea().addEventListener(
    'focus',
    () => {
      if (!remount) return;
      queueMicrotask(() => {
        const replacement = window.document.createElement('textarea');
        textarea().replaceWith(replacement);
        if (breakAt === 'conversation') conversationId = 'different-guest-conversation';
        commit('');
        if (breakAt === 'pane') pane.setAttribute('data-state', 'inactive');
        if (breakAt === 'duplicate') pane.append(window.document.createElement('textarea'));
        if (breakAt !== 'focus') replacement.focus();
      });
    },
    { once: true },
  );
  const evaluate = async (_panel, expression) => window.eval(expression);
  const submit = createGuestInputDriver({
    evaluate,
    waitFor: async (label, read, accept) => assert.ok(accept(await read()), label),
    observe: async () => ({ sendEnabled: !pane.querySelector('button').disabled }),
    click: async (_panel, kind, _label, onPhase) => {
      assert.equal(kind, 'chat-send');
      nativeClicks++;
      onPhase('press_attempted');
      onPhase('press_returned');
      onPhase('release_attempted');
      onPhase('release_returned');
      if (breakAt === 'missed_click') return;
      if (breakAt === 'stale_click') {
        const stale = pane.querySelector('button');
        stale.replaceWith(stale.cloneNode(true));
        stale.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        return;
      }
      if (breakAt === 'click_intent') commit('A different question.');
      const event = new window.MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'isTrusted', { value: breakAt !== 'untrusted_click' });
      pane.querySelector('button').dispatchEvent(event);
    },
    report,
  });
  pane.querySelector('button').addEventListener('click', (event) => {
    if (breakAt === 'stopped_click') event.stopPropagation();
  });
  // React's delegated send handler is at an ancestor, not the native button.
  pane.addEventListener('click', () => {
    sentText = textarea().value;
    if (observeAsyncSubmission) deferredSubmission = () => store.dispatch({ type: 'submit' });
  });
  const panel = {
    send: async (method, args) => {
      if (breakAt === 'focus' && window.document.activeElement !== textarea()) return;
      if (method === 'Input.insertText') commit(args.text);
      if (
        method === 'Input.dispatchKeyEvent' &&
        args.type === 'keyDown' &&
        args.key === 'Backspace'
      )
        commit('');
      if (method === 'Input.dispatchKeyEvent' && args.text && breakAt !== 'skip_keyboard')
        commit(textarea().value + (breakAt === 'wrong_dom' ? '?' : args.text));
    },
  };
  return {
    run: (question) => submit(panel, question, 'opening_question', 'package'),
    report,
    sent: () => sentText,
    clicks: () => nativeClicks,
    dispatchDeferredSubmission: () => deferredSubmission?.(),
    executionSnapshot: () => window.__guestChatSendExecutionProbe?.snapshot() ?? null,
    stopExecution: () => window.__guestChatSendExecutionProbe?.stop() ?? null,
    dispatchAfterStop: () => store.dispatch({ type: 'after-stop' }),
    close: () => window.happyDOM.abort(),
  };
}

for (const question of [
  'Read the current page.',
  'Name the heading above the check codes.',
  'Read the unique opening check code from the article on my current tab. What are the three workflow stages in order? Include the exact code.',
]) {
  test(`focused composer replacement submits the committed intent (${question.length} characters)`, async () => {
    const driver = harness();
    try {
      await driver.run(question);
      assert.equal(driver.sent(), question);
      assert.equal(driver.clicks(), 1);
      assert.deepEqual(driver.report.composer_input_boundaries[0].click.phases, [
        'press_attempted',
        'press_returned',
        'release_attempted',
        'release_returned',
      ]);
      assert.equal(
        driver.report.composer_input_boundaries[0].after_keyboard.currentNodeSame,
        false,
      );
    } finally {
      await driver.close();
    }
  });
}

for (const [breakAt, reason] of [
  ['focus', /currentNodeFocused/],
  ['pane', /sameActivePane/],
  ['conversation', /sameConversation/],
  ['duplicate', /uniqueComposer/],
  ['react', /reactValueMatchesExpected/],
  ['redux', /reduxDraftMatchesExpected/],
  ['wrong_dom', /domMatchesExpected/],
  ['skip_keyboard', /domMatchesExpected/],
  ['missed_click', /exactly one click/],
  ['stale_click', /exactly one click/],
  ['untrusted_click', /trusted native click/],
  ['stopped_click', /bubble to the document/],
  ['click_intent', /committed input intent/],
]) {
  test(`refuses a guest submission with ${breakAt}`, async () => {
    const driver = harness({ breakAt });
    try {
      await assert.rejects(() => driver.run('Read the current page.'), reason);
      if (!breakAt.endsWith('click') && breakAt !== 'click_intent') {
        assert.equal(driver.clicks(), 0);
        assert.equal(driver.sent(), null);
      }
      if (['click_intent', 'untrusted_click', 'missed_click', 'stopped_click'].includes(breakAt))
        assert.equal(driver.sent(), null);
    } finally {
      await driver.close();
    }
  });
}

test('a composer that stays mounted still receives the native Send', async () => {
  const driver = harness({ remount: false });
  try {
    await driver.run('Name the workflow stages.');
    assert.equal(driver.sent(), 'Name the workflow stages.');
    assert.equal(driver.report.composer_input_boundaries[0].after_keyboard.currentNodeSame, true);
    assert.equal(driver.report.composer_input_boundaries[0].click.afterClick.trustedClickEvents, 1);
    assert.equal(JSON.stringify(driver.report).includes('Name the workflow stages.'), false);
    assert.equal(JSON.stringify(driver.report).includes('opening-guest-conversation'), false);
  } finally {
    await driver.close();
  }
});

test('driver retains observation through delayed Redux submission until final cleanup', async () => {
  const driver = harness({ observeAsyncSubmission: true });
  try {
    await driver.run('Read the current page.');
    const clickReturn = driver.report.composer_input_boundaries[0].execution_after_click;
    assert.equal(clickReturn.storeLocated, true);
    assert.equal(clickReturn.pendingSubmissionObserved, false);
    assert.equal(clickReturn.storeNotificationsAfterClick, 0);

    driver.dispatchDeferredSubmission();
    const afterSubmission = driver.executionSnapshot();
    assert.equal(afterSubmission.pendingSubmissionObserved, true);
    assert.equal(afterSubmission.submissionPhase, 'pending');
    assert.equal(afterSubmission.storeNotificationsAfterClick, 1);

    const finalReceipt = driver.stopExecution();
    driver.dispatchAfterStop();
    assert.equal(finalReceipt.pendingSubmissionObserved, true);
    assert.equal(driver.executionSnapshot().storeNotificationsAfterClick, 1);
  } finally {
    await driver.close();
  }
});
