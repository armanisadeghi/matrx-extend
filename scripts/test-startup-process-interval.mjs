import assert from 'node:assert/strict';
import test from 'node:test';
import { beginStartupProcessInterval } from './startup-process-interval.mjs';

test('startup bracket retains host deltas and newly born owned Chrome lifetime separately', async () => {
  const snapshots = [
    '100 1 0:01.00 node\n200 1 0:03.00 provjobd\n300 1 0:00.10 mds\n',
    '100 1 0:01.20 node\n101 100 0:02.50 Chromium\n102 101 0:01.25 Chromium Helper\n200 1 0:07.00 provjobd\n300 1 0:00.30 mds\n',
  ];
  const finish = await beginStartupProcessInterval({
    rootPid: 100,
    read: async () => snapshots.shift(),
  });
  const result = await finish('cdp_timeout');
  assert.equal(snapshots.length, 0);
  assert.equal(result.outcome, 'cdp_timeout');
  assert.deepEqual(result.categoryTotalsSeconds, {
    ownedChromium: 0,
    ownedOther: 0.2,
    hostProvisioner: 4,
    otherHost: 0.2,
  });
  assert.deepEqual(result.appearedProcesses, [
    { pid: 101, executable: 'Chromium', ownedAtEnd: true, lifetimeCpuSeconds: 2.5 },
    { pid: 102, executable: 'Chromium Helper', ownedAtEnd: true, lifetimeCpuSeconds: 1.25 },
  ]);
  assert.equal(result.verdict, 'DIAGNOSTIC_ONLY_NO_PRODUCT_ACCEPTANCE');
});

test('failed process capture is explicitly unavailable and does not pretend zero CPU', async () => {
  const finish = await beginStartupProcessInterval({
    read: async () => {
      throw new Error('private');
    },
  });
  const result = await finish('cdp_connected');
  assert.equal(result.unavailable, true);
  assert.equal(result.categoryTotalsSeconds, undefined);
  assert.equal(JSON.stringify(result).includes('private'), false);
});
