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
    {
      send(method) {
        assert.equal(method, 'SystemInfo.getInfo');
        return query;
      },
    },
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
    { send: () => Promise.reject(new Error('private transport error')) },
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
    { send: () => Promise.resolve({ gpu: { auxAttributes: {}, featureStatus: {} } }) },
    (value) => observations.push(value),
  );
  assert.equal(observations[1].status, 'UNKNOWN');
  assert.equal(observations[1].skiaBackendType, 'UNKNOWN');
  assert.match(observations[1].resolvedAt, /^20\d\d-/);
});
