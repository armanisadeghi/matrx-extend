import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planNoticeViewports,
  restoreNativeNoticeViewport,
  setNoticeViewport,
} from './seo-notice-viewport.mjs';

test('hosted native 360px panel still exercises a distinct wider notice viewport', async () => {
  let width = 360;
  const commands = [];
  const panel = {
    send: async (method, params) => {
      commands.push([method, params]);
      width = method === 'Emulation.clearDeviceMetricsOverride' ? 360 : params.width;
    },
  };
  const plan = planNoticeViewports({ width: 360, height: 373 });
  const narrow = await setNoticeViewport(panel, plan, 'narrow', () => width);
  const wide = await setNoticeViewport(panel, plan, 'wide', () => width);
  const restored = await restoreNativeNoticeViewport(panel, plan, () => width);
  assert.deepEqual(narrow, { width: 360, source: 'native' });
  assert.deepEqual(wide, { width: 480, source: 'emulated' });
  assert.deepEqual(restored, { width: 360, source: 'native' });
  assert.deepEqual(
    commands.map(([method, params]) => [method, params?.width]),
    [
      ['Emulation.clearDeviceMetricsOverride', undefined],
      ['Emulation.setDeviceMetricsOverride', 480],
      ['Emulation.clearDeviceMetricsOverride', undefined],
    ],
  );
});

test('hosted panel wider than 360px restores its measured native width', async () => {
  let width = 428;
  const commands = [];
  const panel = {
    send: async (method, params) => {
      commands.push(method);
      width = method === 'Emulation.clearDeviceMetricsOverride' ? 428 : params.width;
    },
  };
  const plan = planNoticeViewports({ width: 428, height: 700 });
  const narrow = await setNoticeViewport(panel, plan, 'narrow', () => width);
  assert.deepEqual(narrow, { width: 360, source: 'emulated' });
  const wide = await setNoticeViewport(panel, plan, 'wide', () => width);
  const restored = await restoreNativeNoticeViewport(panel, plan, () => width);
  assert.deepEqual(wide, { width: 428, source: 'native' });
  assert.deepEqual(restored, { width: 428, source: 'native' });
  assert.deepEqual(commands, [
    'Emulation.setDeviceMetricsOverride',
    'Emulation.clearDeviceMetricsOverride',
    'Emulation.clearDeviceMetricsOverride',
  ]);
});

test('notice native restoration refuses a viewport still held by emulation', async () => {
  const panel = { send: async () => {} };
  const plan = planNoticeViewports({ width: 360, height: 373 });
  await assert.rejects(
    restoreNativeNoticeViewport(panel, plan, () => 480),
    /notice native panel width restored after emulation/,
  );
});
