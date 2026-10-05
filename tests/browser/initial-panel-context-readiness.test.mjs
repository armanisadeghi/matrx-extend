#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { waitForInitialPanelReady } from './native-sidepanel-qa-harness.mjs';

// Captured guest205 run 37246354075: empty global SIDE_PANEL documentUrl,
// then exact context 103 ms later. Only external CDP responses/time are doubled.
const panelUrl = 'chrome-extension://cihdmkcdjjckfhjpgoedmgfpoljebaml/sidepanel.html';
const target = { targetId: 'owned-panel', type: 'page', url: panelUrl };
const empty = { contextType: 'SIDE_PANEL', documentUrl: '', tabId: -1 };
const exact = { contextType: 'SIDE_PANEL', documentUrl: panelUrl, tabId: -1 };

function environment({
  samples = [[empty], [exact]],
  targets,
  queryFails = false,
  readCost = 0,
  waitCost = 103,
  attempts = 3,
} = {}) {
  let now = 0;
  let reads = 0;
  let targetReads = 0;
  let waits = 0;
  let attached = 0;
  let detached = 0;
  const calls = [];
  const cdp = {
    async send(method, params, sessionId) {
      calls.push(method);
      if (method === 'Target.getTargets') {
        const next = targets?.[Math.min(targetReads, targets.length - 1)] ?? [target];
        targetReads += 1;
        return { targetInfos: next };
      }
      if (method === 'Target.attachToTarget') {
        assert.equal(params.targetId, 'owned-worker');
        attached += 1;
        return { sessionId: `worker-session-${attached}` };
      }
      if (method === 'Target.detachFromTarget') {
        detached += 1;
        return {};
      }
      assert.equal(method, 'Runtime.evaluate');
      assert.ok(sessionId.startsWith('worker-session-'));
      assert.equal(
        params.expression,
        "chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })",
      );
      now += readCost;
      const value = samples[Math.min(reads, samples.length - 1)];
      reads += 1;
      return queryFails ? { exceptionDetails: {} } : { result: { value } };
    },
  };
  return {
    cdp,
    timing: {
      attempts,
      clock: () => now,
      waitBetween: async () => {
        waits += 1;
        now += waitCost;
      },
    },
    run: () =>
      waitForInitialPanelReady({
        cdp,
        panelUrl,
        serviceWorkerTargetId: 'owned-worker',
        normalTargetId: 'owned-root',
        attempts,
        clock: () => now,
        waitBetween: async () => {
          waits += 1;
          now += waitCost;
        },
      }),
    stats: () => ({ reads, targetReads, waits, attached, detached, calls }),
  };
}

test('initial readiness waits for exact context on the same owned target', async () => {
  const env = environment();
  const ready = await env.run();
  assert.equal(ready.panelTarget.targetId, 'owned-panel');
  assert.equal(ready.contextBoundary.first.emptyDocumentUrlCount, 1);
  assert.equal(ready.contextBoundary.first.exactContextCount, 0);
  assert.equal(ready.contextBoundary.last.exactContextCount, 1);
  assert.equal(ready.contextBoundary.attempts, 2);
  assert.equal(ready.contextBoundary.elapsed_ms, 103);
  assert.equal(ready.contextBoundary.exact_expected_appeared, true);
  assert.equal(env.stats().reads, 2);
  assert.equal(env.stats().attached, env.stats().detached);
});

test('initial exact context needs no extra wait', async () => {
  const env = environment({ samples: [[exact]] });
  const ready = await env.run();
  assert.equal(ready.contextBoundary.attempts, 1);
  assert.equal(ready.contextBoundary.first.exactContextCount, 1);
  assert.equal(env.stats().waits, 0);
});

for (const [name, context] of [
  ['empty', empty],
  ['missing', { contextType: 'SIDE_PANEL', tabId: -1 }],
  ['foreign', { ...exact, documentUrl: 'chrome-extension://foreign/sidepanel.html' }],
  ['wrong tab', { ...exact, tabId: 7 }],
  ['wrong type', { ...exact, contextType: 'TAB' }],
  ['absent', null],
]) {
  test(`never matching ${name} context fails closed within the existing budget`, async () => {
    const env = environment({ samples: [context ? [context] : []] });
    await assert.rejects(env.run(), (error) => {
      assert.equal(error.message, 'native_sidepanel_runtime_context_missing');
      assert.equal(error.contextBoundary.exact_expected_appeared, false);
      assert.equal(error.contextBoundary.last.exactContextCount, 0);
      return true;
    });
    assert.equal(env.stats().reads, 3);
    assert.equal(env.stats().waits, 2);
    assert.equal(env.stats().attached, env.stats().detached);
  });
}

for (const replacement of [
  [],
  [{ ...target, targetId: 'replacement-panel' }],
  [{ ...target, url: `${panelUrl}?foreign` }],
]) {
  test('exact context cannot rescue lost, replacement or foreign owned target', async () => {
    const env = environment({ targets: [[target], replacement], samples: [[exact]] });
    await assert.rejects(env.run(), /native_sidepanel_owned_target_lost/);
    assert.equal(env.stats().reads, 1);
    assert.equal(env.stats().waits, 0);
  });
}

test('target replacement between readiness polls fails before another worker query', async () => {
  const env = environment({
    targets: [[target], [target], [{ ...target, targetId: 'replacement-panel' }]],
  });
  await assert.rejects(env.run(), /native_sidepanel_owned_target_lost/);
  assert.equal(env.stats().reads, 1);
});

test('target discovery shares context readiness budget rather than restarting it', async () => {
  const env = environment({
    targets: [[], [target]],
    attempts: 2,
    samples: [[empty], [exact]],
    waitCost: 100,
  });
  await assert.rejects(env.run(), /native_sidepanel_runtime_context_missing/);
  assert.equal(env.stats().reads, 1);
  assert.equal(env.stats().waits, 1);
});

test('missing target exhausts bounded discovery without querying contexts', async () => {
  const env = environment({ targets: [[]] });
  await assert.rejects(env.run(), /native_sidepanel_target_missing/);
  assert.equal(env.stats().reads, 0);
  assert.equal(env.stats().targetReads, 3);
});

test('exact context arriving after setup budget expires cannot pass', async () => {
  const env = environment({ samples: [[exact]], readCost: 300 });
  await assert.rejects(env.run(), /native_sidepanel_runtime_context_missing/);
  assert.equal(env.stats().reads, 1);
  assert.equal(env.stats().waits, 0);
});

test('context query failure stays fatal and detaches the owned worker', async () => {
  const env = environment({ queryFails: true });
  await assert.rejects(env.run(), /native_sidepanel_runtime_context_query_failed/);
  assert.equal(env.stats().reads, 1);
  assert.equal(env.stats().attached, env.stats().detached);
  assert.equal(env.stats().waits, 0);
});

test('normal page cannot satisfy panel ownership', async () => {
  const env = environment({ targets: [[{ ...target, targetId: 'owned-root' }]] });
  await assert.rejects(env.run(), /native_sidepanel_target_not_distinct/);
  assert.equal(env.stats().reads, 0);
});

const harnessSource = await readFile(
  new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
  'utf8',
);
async function actualInitialSetup(env) {
  const start = harnessSource.indexOf(
    '    const panelUrl = `chrome-extension://${expectedExtensionId}/sidepanel.html`;',
  );
  const end = harnessSource.indexOf('    const observeVisibility =', start);
  assert.ok(start >= 0 && end > start);
  const events = [];
  const logs = [];
  const run = new Function(
    'cdp',
    'expectedExtensionId',
    'extensionWorker',
    'normalTarget',
    'waitForInitialPanelReady',
    'waitForSettledGuestPanel',
    'panelContextFailureDiagnostic',
    'sidePanelContexts',
    'panelDocumentDiagnostic',
    'onStage',
    'process',
    `return (async () => { ${harnessSource.slice(start, end)} return panelTarget; })();`,
  );
  const promise = run(
    env.cdp,
    new URL(panelUrl).host,
    { targetId: 'owned-worker' },
    { targetId: 'owned-root' },
    (args) => waitForInitialPanelReady({ ...args, ...env.timing }),
    async (_cdp, targetId) => {
      events.push(['settle', targetId]);
      return {};
    },
    async () => {
      events.push(['failure-diagnostic']);
      return { followUp: { exact_expected_count: 1 } };
    },
    async () => [exact],
    async () => ({}),
    (stage) => events.push([stage]),
    { stderr: { write: (line) => logs.push(line) } },
  );
  return { promise, events, logs };
}

test('actual native initial setup reaches settling only after delayed owned exact context', async () => {
  const env = environment();
  const setup = await actualInitialSetup(env);
  assert.equal((await setup.promise).targetId, 'owned-panel');
  assert.equal(env.stats().reads, 2);
  assert.deepEqual(setup.events.at(-1), ['settle', 'owned-panel']);
  const receipt = JSON.parse(setup.logs[0].slice('BROWSER_PANEL_CONTEXT_READY '.length));
  assert.equal(receipt.first.emptyDocumentUrlCount, 1);
  assert.equal(receipt.last.exactContextCount, 1);
  assert.equal(receipt.exact_expected_appeared, true);
  assert.ok(!setup.logs.join('').includes(panelUrl));
});

test('actual native initial setup preserves failure even when diagnostic follow-up is exact', async () => {
  const env = environment({ samples: [[empty]] });
  const setup = await actualInitialSetup(env);
  await assert.rejects(setup.promise, /native_sidepanel_runtime_context_missing/);
  assert.deepEqual(setup.events.at(-1), ['failure-diagnostic']);
  assert.ok(!setup.events.some(([stage]) => stage === 'settle' || stage === 'panel_settle'));
  assert.ok(setup.logs[0].startsWith('BROWSER_PANEL_CONTEXT_FAILURE '));
});
