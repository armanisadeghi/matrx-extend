import assert from 'node:assert/strict';
import test from 'node:test';
import { requestOwnedPanelOpen } from './native-sidepanel-qa-harness.mjs';

test('owned Open panel request records a fresh callback without exposing its error text', async () => {
  for (const [response, expected] of [
    [{ ok: true, result: { opened: true } }, 'opened'],
    [{ ok: true, result: { opened: false, reason: 'private URL token' } }, 'open_refused'],
    [{ ok: false, error: 'private URL token' }, 'rpc_refused'],
  ]) {
    let result = '{"ok":true,"result":{"opened":true}}';
    const locator = {
      evaluate: async (mutate) => {
        const element = { textContent: result };
        mutate(element);
        result = element.textContent;
      },
      click: async () => {
        assert.equal(result, '', 'stale initial reply must be cleared');
        result = JSON.stringify(response);
      },
      filter: () => locator,
      waitFor: async () => assert.notEqual(result, ''),
      textContent: async () => result,
    };
    const outcome = await requestOwnedPanelOpen({ locator: () => locator });
    assert.equal(outcome.category, expected);
    assert.equal(outcome.received, true);
    assert.doesNotMatch(JSON.stringify(outcome), /private|token/);
  }
});

test('reply read failure remains distinct from a failed click', async () => {
  let cleared = false;
  const locator = {
    evaluate: async (mutate) => {
      const element = { textContent: 'stale' };
      mutate(element);
      cleared = element.textContent === '';
    },
    click: async () => assert.equal(cleared, true),
    filter: () => locator,
    waitFor: async () => {},
    textContent: async () => {
      throw new Error('private URL token');
    },
  };
  const outcome = await requestOwnedPanelOpen({ locator: () => locator });
  assert.deepEqual(outcome, {
    received: false,
    ok: null,
    opened: null,
    category: 'reply_read_failed',
  });
});
