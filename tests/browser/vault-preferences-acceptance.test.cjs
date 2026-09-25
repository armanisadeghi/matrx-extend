'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  _classifyQuietFillTerminal: classifyQuietFillTerminal,
} = require('./vault-preferences-acceptance.cjs');

const completeFocus = { beforeClick: true, afterClick: true };
const delivered = { nativeClickCount: 1, panelMessageCount: 1 };
const filledFixture = { usernameMatches: true, passwordMatches: true };

test('quiet Fill classifies focus loss between the website assertion and native click', () => {
  assert.equal(
    classifyQuietFillTerminal({
      counters: { nativeClickCount: 0, panelMessageCount: 0 },
      focus: { beforeClick: true, afterClick: false },
      ui: {},
      fixture: {},
    }),
    'focus_lost_before_quiet_fill_click',
  );
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
