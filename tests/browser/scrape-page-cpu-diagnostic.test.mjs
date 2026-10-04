import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticCpuRate, withOwnedPageCpuThrottle } from './scrape-page-cpu-diagnostic.mjs';

const intake = 'http://localhost:38541/intake';

function pageFor(url = intake, target = { type: 'page', url: intake, targetId: 'owned-intake' }) {
  const calls = [];
  const session = {
    async send(method, args) {
      calls.push([method, args]);
      if (method === 'Target.getTargetInfo') return { targetInfo: target };
      return {};
    },
    async detach() {
      calls.push(['detach']);
    },
  };
  return {
    calls,
    url: () => url,
    context: () => ({ newCDPSession: async () => session }),
  };
}

test('a real diagnostic callback runs only while the owned page is throttled and rate 1 is restored', async () => {
  const page = pageFor();
  const outcome = await withOwnedPageCpuThrottle(page, intake, 4, async ({ target }) => {
    assert.deepEqual(page.calls.at(-1), ['Emulation.setCPUThrottlingRate', { rate: 4 }]);
    return { article: 'Harbor Dental intake guide', targetId: target.id };
  });
  assert.equal(outcome.result.article, 'Harbor Dental intake guide');
  assert.equal(outcome.target.id, 'owned-intake');
  assert.deepEqual(outcome.cleanup, { rate_restored: true, session_detached: true });
  assert.deepEqual(page.calls.slice(-2), [
    ['Emulation.setCPUThrottlingRate', { rate: 1 }],
    ['detach'],
  ]);
});

test('failed extraction still restores rate 1 and detaches', async () => {
  const page = pageFor();
  await assert.rejects(
    withOwnedPageCpuThrottle(page, intake, 4, async () => {
      throw new Error('extraction_failed');
    }),
    /extraction_failed/,
  );
  assert.deepEqual(page.calls.slice(-2), [
    ['Emulation.setCPUThrottlingRate', { rate: 1 }],
    ['detach'],
  ]);
});

test('foreign and panel pages never receive a throttling command', async () => {
  for (const url of ['https://example.com/intake', 'chrome-extension://extension/sidepanel.html']) {
    const page = pageFor(url);
    await assert.rejects(withOwnedPageCpuThrottle(page, intake, 4, async () => {}));
    assert.deepEqual(page.calls, []);
  }
  for (const target of [
    { type: 'page', url: 'http://localhost:38541/referrals', targetId: 'foreign' },
    { type: 'page', url: 'chrome-extension://extension/sidepanel.html', targetId: 'panel' },
    { type: 'service_worker', url: intake, targetId: 'worker' },
  ]) {
    const page = pageFor(intake, target);
    await assert.rejects(withOwnedPageCpuThrottle(page, intake, 4, async () => {}));
    assert.deepEqual(page.calls, [['Target.getTargetInfo', undefined], ['detach']]);
  }
});

test('the explicit rate must be finite and bounded', () => {
  assert.equal(diagnosticCpuRate(''), null);
  assert.equal(diagnosticCpuRate('4'), 4);
  for (const value of ['NaN', 'Infinity', '0', '1', '21', 'abc'])
    assert.throws(() => diagnosticCpuRate(value), /scrape_diagnostic_cpu_rate_invalid/);
});
