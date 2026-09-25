'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  _classifyQuietFillTerminal: classifyQuietFillTerminal,
  _mergeQuietFillDiagnostic: mergeQuietFillDiagnostic,
  _waitForQuietFillMessageTarget: waitForQuietFillMessageTarget,
  _armQuietFillAfterFocus: armQuietFillAfterFocus,
} = require('./vault-preferences-acceptance.cjs');

const completeFocus = {
  before: { tabWindowFocused: true, documentFocused: true, credentialFocused: true },
  after: { tabWindowFocused: true, documentFocused: true, credentialFocused: true },
};
const delivered = { nativeClickCount: 1, panelMessageCount: 1 };
const filledFixture = { usernameMatches: true, passwordMatches: true };

test('quiet Fill preserves pre-click focus evidence when panel diagnostics are collected', () => {
  const focus = {
    before: { tabWindowFocused: true, documentFocused: true, credentialFocused: true },
    after: { tabWindowFocused: true, documentFocused: false, credentialFocused: false },
  };
  const diagnostic = mergeQuietFillDiagnostic(
    {
      disposition: 'product_stale_or_refusal',
      focus,
      targetResolution: {
        target: null,
        attempts: 3,
        observation: { status: 'ready', targetMatchCount: 0 },
      },
      collected: false,
    },
    { collected: true, ui: { noOffer: true }, panelStatus: { status: 'none' } },
  );
  assert.equal(diagnostic.focus, focus);
  assert.deepEqual(diagnostic.targetResolution, {
    target: null,
    attempts: 3,
    observation: { status: 'ready', targetMatchCount: 0 },
  });
  assert.equal(diagnostic.collected, true);
});

test('quiet Fill accepts a legitimate post-click page-document focus transition when product reports success', () => {
  assert.equal(
    classifyQuietFillTerminal({
      counters: delivered,
      focus: {
        before: { tabWindowFocused: true, documentFocused: true, credentialFocused: true },
        after: { tabWindowFocused: true, documentFocused: false, credentialFocused: false },
      },
      ui: { filledFeedback: true },
      fixture: filledFixture,
    }),
    'success',
  );
});

test('quiet Fill arms the focus-refreshed offer before dispatching the native click', async () => {
  let offerId = 'offer-before-focus';
  const events = [];
  const result = await armQuietFillAfterFocus({
    focusCredential: async () => {
      events.push('focus');
      offerId = 'offer-after-focus';
    },
    readFocus: async () => ({ tabWindowFocused: true }),
    resolveMessageTarget: async () => {
      events.push(`target:${offerId}`);
      return {
        target: { offerId },
        observation: { status: 'ready', targetMatchCount: 1 },
      };
    },
    armMessageObserver: async (target) => {
      events.push(`arm:${target.offerId}`);
    },
    click: async () => {
      events.push('click');
    },
    wait: async () => {},
  });
  assert.equal(result.armed, true);
  assert.deepEqual(events, ['focus', 'target:offer-after-focus', 'arm:offer-after-focus', 'click']);
});

test('quiet Fill waits for a focus-refreshed target and reports a never-ready target without clicking', async () => {
  let delayedReads = 0;
  let delayedWaits = 0;
  const delayed = await waitForQuietFillMessageTarget({
    resolve: async () => {
      delayedReads += 1;
      return delayedReads < 3
        ? { target: null, observation: { status: 'ready', targetMatchCount: 0 } }
        : {
            target: { offerId: 'refreshed-offer' },
            observation: { status: 'ready', targetMatchCount: 1 },
          };
    },
    wait: async () => {
      delayedWaits += 1;
    },
    maxAttempts: 3,
  });
  assert.equal(delayed.attempts, 3);
  assert.equal(delayed.target?.offerId, 'refreshed-offer');
  assert.equal(delayedWaits, 2);

  let neverWaits = 0;
  let neverClicked = false;
  const never = await armQuietFillAfterFocus({
    focusCredential: async () => {},
    readFocus: async () => ({ tabWindowFocused: true }),
    resolveMessageTarget: async () => ({
      target: null,
      observation: { status: 'ready', targetMatchCount: 0 },
    }),
    armMessageObserver: async () => {
      throw new Error('never-ready target must not arm observer');
    },
    click: async () => {
      neverClicked = true;
    },
    wait: async () => {
      neverWaits += 1;
    },
    maxTargetAttempts: 3,
  });
  assert.equal(never.armed, false);
  assert.deepEqual(never.targetResolution, {
    target: null,
    attempts: 3,
    observation: { status: 'ready', targetMatchCount: 0 },
  });
  assert.equal(neverWaits, 2);
  assert.equal(neverClicked, false);
});

test('quiet Fill separates CDP click delivery, panel routing, product refusal, and success', () => {
  const cases = [
    [{ nativeClickCount: 0, panelMessageCount: 0 }, {}, {}, 'click_not_delivered'],
    [{ nativeClickCount: 1, panelMessageCount: 0 }, {}, {}, 'panel_message_not_sent'],
    [delivered, { admissionRefused: true }, {}, 'product_stale_or_refusal'],
    [delivered, { filledFeedback: true }, filledFixture, 'success'],
  ];
  for (const [counters, ui, fixture, expected] of cases)
    assert.equal(
      classifyQuietFillTerminal({ counters, focus: completeFocus, ui, fixture }),
      expected,
    );
});
