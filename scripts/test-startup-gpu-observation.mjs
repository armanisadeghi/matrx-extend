import assert from 'node:assert/strict';
import test from 'node:test';
import { observeStartupGpu } from './startup-gpu-observation.mjs';

test('verified browser query starts without blocking and retains only backend fields', async () => {
  let resolveQuery;
  const query = new Promise((resolve) => {
    resolveQuery = resolve;
  });
  const observations = [];
  const pending = observeStartupGpu(
    async () => ({
      send(method) {
        assert.equal(method, 'SystemInfo.getInfo');
        return query;
      },
      detach: async () => {},
    }),
    (value) => observations.push(value),
  );
  assert.equal(observations[0].status, 'UNKNOWN');
  assert.match(observations[0].requestedAt, /^2026-|^20\d\d-/);
  resolveQuery({
    commandLine: '--credential=private',
    gpu: {
      auxAttributes: {
        skiaBackendType: 'Graphite',
        glRenderer: 'ANGLE Metal',
        privateAttribute: '--credential=private',
      },
      featureStatus: {
        gpu_compositing: 'enabled',
        rasterization: 'enabled',
        privateFeature: '--credential=private',
      },
    },
  });
  await pending;
  assert.deepEqual(
    {
      status: observations[1].status,
      skiaBackendType: observations[1].skiaBackendType,
      glRenderer: observations[1].glRenderer,
      featureStatus: observations[1].featureStatus,
    },
    {
      status: 'RESOLVED',
      skiaBackendType: 'Graphite',
      glRenderer: 'ANGLE Metal',
      featureStatus: { gpu_compositing: 'enabled', rasterization: 'enabled' },
    },
  );
  assert.match(observations[1].resolvedAt, /^20\d\d-/);
  assert.doesNotMatch(JSON.stringify(observations), /private|commandLine/);
});

test('failed backend query remains UNKNOWN with a failure timestamp', async () => {
  const observations = [];
  await observeStartupGpu(
    async () => ({
      send: () => Promise.reject(new Error('private transport error')),
      detach: async () => {},
    }),
    (value) => observations.push(value),
  );
  assert.deepEqual(
    observations.map((value) => value.status),
    ['UNKNOWN', 'UNKNOWN'],
  );
  assert.match(observations[1].failedAt, /^20\d\d-/);
  assert.doesNotMatch(JSON.stringify(observations), /private/);
});

test('a successful but missing backend response remains UNKNOWN', async () => {
  const observations = [];
  await observeStartupGpu(
    async () => ({
      send: () => Promise.resolve({ gpu: { auxAttributes: {}, featureStatus: {} } }),
      detach: async () => {},
    }),
    (value) => observations.push(value),
  );
  assert.equal(observations[1].status, 'UNKNOWN');
  assert.equal(observations[1].skiaBackendType, 'UNKNOWN');
  assert.match(observations[1].resolvedAt, /^20\d\d-/);
});

test('teardown classifies a pending connection UNKNOWN without waiting or sending', async () => {
  let resolveConnection;
  const connection = new Promise((resolve) => {
    resolveConnection = resolve;
  });
  const controller = new AbortController();
  const observations = [];
  let sends = 0;
  let detaches = 0;
  const pending = observeStartupGpu(
    () => connection,
    (value) => observations.push(value),
    controller.signal,
  );
  controller.abort();
  assert.equal(observations[1].status, 'UNKNOWN');
  assert.match(observations[1].failedAt, /^20\d\d-/);
  resolveConnection({
    send: () => {
      sends += 1;
      return Promise.resolve({});
    },
    detach: async () => {
      detaches += 1;
    },
  });
  await pending;
  assert.equal(sends, 0);
  assert.equal(detaches, 1);
  assert.equal(observations.length, 2);
});
