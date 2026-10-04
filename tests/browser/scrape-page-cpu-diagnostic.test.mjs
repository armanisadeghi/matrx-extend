import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diagnosticCpuRate,
  runSupplementalCpuDiagnostic,
  withOwnedPageCpuThrottle,
} from './scrape-page-cpu-diagnostic.mjs';

const intake = 'http://localhost:38541/intake';

function pageFor(
  url = intake,
  target = { type: 'page', url: intake, targetId: 'owned-intake' },
  failure = null,
) {
  const calls = [];
  const session = {
    async send(method, args) {
      calls.push([method, args]);
      if (method === 'Target.getTargetInfo') return { targetInfo: target };
      if (failure === 'restore' && method === 'Emulation.setCPUThrottlingRate' && args.rate === 1)
        throw new Error('restore_failed');
      return {};
    },
    async detach() {
      calls.push(['detach']);
      if (failure === 'detach') throw new Error('detach_failed');
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

test('cleanup failure stops downstream original native actions while retaining diagnostic evidence', async () => {
  for (const failure of ['restore', 'detach']) {
    const page = pageFor(intake, undefined, failure);
    const diagnostic = { status: 'unverified', cleanup: null, error: null };
    const actions = [];
    await assert.rejects(async () => {
      await runSupplementalCpuDiagnostic({
        page,
        expectedUrl: intake,
        rate: 4,
        diagnostic,
        capture: async () => {
          actions.push('real_capture');
        },
      });
      actions.push('original_result_tabs');
    });
    assert.deepEqual(actions, ['real_capture']);
    assert.match(diagnostic.error, /cleanup_failed/);
    assert.equal(
      diagnostic.cleanup?.[failure === 'restore' ? 'rate_restored' : 'session_detached'],
      false,
    );
  }
});

test('a diagnostic capture failure with successful cleanup allows original checks to continue', async () => {
  const page = pageFor();
  const diagnostic = { status: 'unverified', cleanup: null, error: null };
  const actions = [];
  await runSupplementalCpuDiagnostic({
    page,
    expectedUrl: intake,
    rate: 4,
    diagnostic,
    capture: async () => {
      actions.push('real_capture');
      throw new Error('capture_failed');
    },
  });
  actions.push('original_result_tabs');
  assert.deepEqual(actions, ['real_capture', 'original_result_tabs']);
  assert.match(diagnostic.error, /capture_failed/);
  assert.equal(diagnostic.cleanup.rate_restored, true);
  assert.equal(diagnostic.cleanup.session_detached, true);
});

test('the explicit rate must be finite and greater than normal speed', () => {
  assert.equal(diagnosticCpuRate(''), null);
  assert.equal(diagnosticCpuRate('4'), 4);
  assert.equal(diagnosticCpuRate('21'), 21);
  for (const value of ['NaN', 'Infinity', '0', '1', 'abc'])
    assert.throws(() => diagnosticCpuRate(value), /scrape_diagnostic_cpu_rate_invalid/);
});
