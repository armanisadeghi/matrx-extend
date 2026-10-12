import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { runStackedSeoNotices } from './seo-stacked-notice-fixture.mjs';

function harness({ hitPoints = 9, truncateLong = false, hiddenLongDismiss = false } = {}) {
  const bus = new EventEmitter();
  const notices = new Map();
  let reauditCount = 0;
  const calls = [];
  const browserSession = {
    on: bus.on.bind(bus),
    off: bus.off.bind(bus),
    async send(method, params) {
      calls.push(method);
      if (method === 'Target.getTargets')
        return {
          targetInfos: [
            {
              type: 'service_worker',
              targetId: 'owned-worker',
              url: 'chrome-extension://fixture/background.js',
            },
          ],
        };
      if (method === 'Target.attachToTarget') return { sessionId: 'owned-worker-session' };
      if (method === 'Runtime.evaluate') {
        const envelope = JSON.parse(
          params.expression.slice('chrome.runtime.sendMessage('.length, -1),
        );
        const notice = envelope.payload;
        notices.set(
          notice.title,
          truncateLong && notice.title.endsWith('B') ? notice.message.slice(0, -1) : notice.message,
        );
        return { result: { value: { ok: true } } };
      }
      if (method === 'Target.detachFromTarget') return {};
      throw new Error(`unexpected ${method}`);
    },
  };
  const titles = ['SEO fixture notice A', 'SEO fixture notice B'];
  const sample = () => ({
    width: 360,
    title_counts: titles.map((title) => Number(notices.has(title))),
    message_lengths: titles.map((title) => notices.get(title)?.length ?? 0),
    dismiss_counts: titles.map((title, index) =>
      Number(notices.has(title) && !(hiddenLongDismiss && index === 1)),
    ),
    notice_visible: titles.map((title) => notices.has(title)),
    target_count: 1,
    target_enabled: true,
    hit_point_count: hitPoints,
    notice_hit_point_count: 0,
  });
  const io = {
    evaluate: async () => 360,
    sample: async () => sample(),
    waitFor: async (_label, read, accept) => {
      const state = await read();
      assert.equal(accept(state), true, 'fixture condition must become observable');
      return state;
    },
    click: async (_panel, kind, title) => {
      assert.equal(kind, 'seo-owned-notice-dismiss');
      assert.equal(notices.delete(title), true, 'each owned notice is dismissed once');
    },
  };
  return {
    browserSession,
    io,
    calls,
    get remaining() {
      return notices.size;
    },
    get reauditCount() {
      return reauditCount;
    },
    runReaudit: async () => {
      reauditCount++;
    },
  };
}

async function run(h, expectedMessageLengths = [77, 199]) {
  return runStackedSeoNotices({
    panel: {},
    browserSession: h.browserSession,
    panelTarget: { url: 'chrome-extension://fixture/sidepanel.html' },
    currentTitle: 'Example Domain',
    expectedMessageLengths,
    seoContent: async () => ({
      scopeValid: true,
      title: 'Example Domain',
      reAudit: true,
      auditButtonDisabled: false,
      error: false,
    }),
    runReaudit: h.runReaudit,
    io: h.io,
  });
}

test('owned relay injects two distinct notices and dismisses each after re-audit', async () => {
  const h = harness();
  const result = await run(h);
  assert.equal(result.notice_count, 2);
  assert.equal(result.long_message_length, 199);
  assert.deepEqual(result.independently_dismissed, [
    [0, 1],
    [0, 0],
  ]);
  assert.equal(h.reauditCount, 1);
  assert.equal(h.remaining, 0);
  assert.equal(h.calls.filter((call) => call === 'Runtime.evaluate').length, 2);
  assert.equal(h.calls.at(-1), 'Target.detachFromTarget');
});

test('independent length contract rejects a shortened fixture before injection', async () => {
  const h = harness();
  await assert.rejects(run(h, [77, 198]), /independent length contract/);
  assert.equal(h.calls.length, 0);
});

test('hidden owned Dismiss makes cleanup fail and leaves zero product credit', async () => {
  const h = harness({ hitPoints: 8, hiddenLongDismiss: true });
  await assert.rejects(run(h), /owned notice fixture cleanup completed/);
  assert.equal(h.remaining, 1, 'the hidden owned notice is reported, not silently skipped');
  assert.equal(h.calls.at(-1), 'Target.detachFromTarget');
});

for (const [name, options] of [
  ['an occluded Re-audit point', { hitPoints: 8 }],
  ['a truncated long notice', { truncateLong: true }],
])
  test(`stacked native fixture refuses ${name}`, async () => {
    const h = harness(options);
    await assert.rejects(run(h));
    assert.equal(h.reauditCount, 0);
    assert.equal(h.remaining, 0, 'owned notices are cleaned after failed preflight');
  });
