import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { beginReloadPanelReplyObservation, testPage } from './native-sidepanel-qa-harness.mjs';

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
    assert.equal((await observation.close()).category, category);
    assert.doesNotMatch(JSON.stringify(observation.outcome), /private|token/);
  }
});

test('reply read failure stays bounded, and no callback remains unobserved', async () => {
  const unreadable = await beginReloadPanelReplyObservation(
    ownedPage({ ok: true, result: { opened: true } }, true),
    () => {},
  );
  await unreadable.settled();
  assert.equal((await unreadable.close()).category, 'reply_read_failed');
  const absent = await beginReloadPanelReplyObservation(ownedPage(null), () => {});
  assert.equal((await absent.close()).category, 'reply_not_observed');
});

test('real fixture click records send and callback milestones without retaining reply text', () => {
  const html = testPage('cihdmkcdjjckfhjpgoedmgfpoljebaml');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const elements = new Map([
    [
      '#open-panel',
      {
        addEventListener(_name, handler) {
          this.click = handler;
        },
      },
    ],
    ['#open-trace', { textContent: '' }],
    ['#result', { textContent: '' }],
  ]);
  let callback;
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage(id, message, cb) {
        assert.equal(id, 'cihdmkcdjjckfhjpgoedmgfpoljebaml');
        assert.equal(message.requestId, 'native-sidepanel-qa');
        callback = cb;
      },
    },
  };
  runInNewContext(script, {
    chrome,
    document: { querySelector: (selector) => elements.get(selector) },
  });
  elements.get('#open-panel').click();
  assert.deepEqual(JSON.parse(elements.get('#open-trace').textContent), {
    click_received: true,
    send_invoked: true,
    send_returned: true,
    callback_entered: false,
    callback_has_reply: false,
    callback_last_error: false,
    send_threw: false,
  });
  chrome.runtime.lastError = { message: 'private token' };
  callback(undefined);
  const trace = elements.get('#open-trace').textContent;
  assert.equal(JSON.parse(trace).callback_last_error, true);
  assert.equal(JSON.parse(trace).callback_has_reply, false);
  assert.doesNotMatch(trace, /private|token/);
});
