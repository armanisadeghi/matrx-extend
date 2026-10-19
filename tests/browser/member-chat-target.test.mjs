import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { sendMemberChatOnTarget } from './member-chat-target.mjs';

function scenario({
  expectedUrl,
  marker,
  activeUrl = expectedUrl,
  activeMarker = marker,
  webUrl = expectedUrl,
  closed = false,
}) {
  const sent = [];
  const active = new URL(activeUrl);
  const chrome = {
    tabs: {
      query: async (query) => {
        assert.deepEqual(JSON.parse(JSON.stringify(query)), { active: true, currentWindow: true });
        return [{ id: 91 }];
      },
    },
    scripting: {
      executeScript: async ({ target, func }) => {
        assert.equal(target.tabId, 91);
        return [{ result: func() }];
      },
    },
  };
  return {
    sent,
    options: {
      web: { isClosed: () => closed, url: () => webUrl },
      panel: {},
      evaluate: async (_panel, expression) =>
        vm.runInNewContext(expression, {
          chrome,
          location: { origin: active.origin, pathname: active.pathname },
          document: { documentElement: { getAttribute: () => activeMarker } },
        }),
      expectedUrl,
      marker,
      send: async () => {
        sent.push('model_send');
      },
    },
  };
}

test('member Chat sends only when the active tab is the marked intended document', async () => {
  for (const [expectedUrl, marker] of [
    ['https://www.aimatrx.com/matrx-extend-demo', 'demo-one'],
    ['https://example.org/second-demo', 'demo-two'],
  ]) {
    const correct = scenario({ expectedUrl, marker });
    await sendMemberChatOnTarget(correct.options);
    assert.deepEqual(correct.sent, ['model_send']);

    for (const change of [
      { activeUrl: 'http://localhost:8123/research-brief' },
      { activeMarker: 'other-tab' },
      { webUrl: 'https://example.org/elsewhere' },
      { closed: true },
    ]) {
      const wrong = scenario({ expectedUrl, marker, ...change });
      await assert.rejects(
        sendMemberChatOnTarget(wrong.options),
        /reviewer_chat_target_unverified/,
      );
      assert.deepEqual(wrong.sent, []);
    }
  }
});
