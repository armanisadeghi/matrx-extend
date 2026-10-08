import assert from 'node:assert/strict';
import test from 'node:test';
import { beginReloadPanelReplyObservation } from './native-sidepanel-qa-harness.mjs';

function ownedPage(response, readFails = false) {
  let result = '{"ok":true,"result":{"opened":true}}';
  let resolveReply;
  const locator = {
    evaluate: async (mutate) => {
      const element = { textContent: result };
      mutate(element);
      result = element.textContent;
    },
    click: async () => {
      assert.equal(result, '', 'stale initial-open reply must be cleared');
      if (response !== null)
        result = response === 'malformed' ? '{malformed' : JSON.stringify(response);
      resolveReply?.();
    },
    filter: () => locator,
    waitFor: async () => {
      if (result) return;
      await new Promise((resolve) => {
        resolveReply = resolve;
      });
    },
    textContent: async () => {
      if (readFails) throw new Error('private URL token');
      return result;
    },
  };
  return { locator: () => locator };
}

test('reload observer captures fixed callback classes without changing the trusted click', async () => {
  for (const [response, category] of [
    [{ ok: true, result: { opened: true } }, 'opened'],
    [{ ok: true, result: { opened: false, reason: 'private URL token' } }, 'open_refused'],
    [{ ok: false, error: 'private URL token' }, 'rpc_refused'],
    ['malformed', 'malformed_reply'],
  ]) {
    let clicked = false;
    const observation = await beginReloadPanelReplyObservation(ownedPage(response), () => {
      clicked = true;
    });
    await observation.settled();
    assert.equal(clicked, true);
    assert.equal(observation.close().category, category);
    assert.doesNotMatch(JSON.stringify(observation.outcome), /private|token/);
  }
});

test('reply read failure stays bounded, and no callback remains unobserved', async () => {
  const unreadable = await beginReloadPanelReplyObservation(
    ownedPage({ ok: true, result: { opened: true } }, true),
    () => {},
  );
  await unreadable.settled();
  assert.equal(unreadable.close().category, 'reply_read_failed');
  const absent = await beginReloadPanelReplyObservation(ownedPage(null), () => {});
  assert.equal(absent.close().category, 'reply_not_observed');
});
