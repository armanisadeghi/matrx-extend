import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { waitForResourceReadiness } from './hosted-resource-readiness-loop.mjs';

const policy = JSON.parse(
  await readFile(new URL('../docs/stabilization/resource-policy.json', import.meta.url)),
);

async function replay(samples, activePolicy = policy) {
  let calls = 0;
  const observations = [];
  const task = waitForResourceReadiness(activePolicy, {
    sample: async () => samples[calls++],
    sleep: async () => {},
    onSample: (result) => observations.push(result),
  });
  return { task, observations, calls: () => calls };
}

test('waits through the observed startup load before admitting three healthy samples', async () => {
  // The first seven measurements are from hosted guest Chat run 38770173860.
  // An eighth healthy measurement exercises its interrupted recovery trajectory.
  const measurements = [
    [0.62, 2.83],
    [0.1, 2.17],
    [0.64, 1.71],
    [0.22, 1.4225],
    [0.99, 1.37],
    [0.01, 1.19],
    [0.01, 0.945],
    [0.01, 0.8],
  ].map(([busy, loadPerCpu]) => ({ busy, loadPerCpu }));
  const oldWindow = await replay(measurements, { ...policy, hostedReadinessWaitSeconds: 60 });
  await assert.rejects(oldWindow.task, /RESOURCE_READINESS_EXPIRED/);
  assert.equal(oldWindow.calls(), 7);
  const result = await replay(measurements);
  await result.task;
  assert.equal(result.calls(), 8);
  assert.deepEqual(
    result.observations.map(({ healthy }) => healthy),
    [0, 1, 0, 1, 0, 1, 2, 3],
  );
});

test('admits the prior Scrape startup after two more healthy samples', async () => {
  // The first seven measurements are from hosted Scrape run 38328930763.
  const measurements = [
    [0.16, 2.975],
    [1, 2.375],
    [0.99, 2.6725],
    [0.15, 2.225],
    [0.93, 2.0175],
    [0.93, 1.7925],
    [0.15, 1.49],
    [0.15, 1.2],
    [0.15, 0.9],
  ].map(([busy, loadPerCpu]) => ({ busy, loadPerCpu }));
  const oldWindow = await replay(measurements, { ...policy, hostedReadinessWaitSeconds: 60 });
  await assert.rejects(oldWindow.task, /RESOURCE_READINESS_EXPIRED/);
  assert.equal(oldWindow.calls(), 7);
  const result = await replay(measurements);
  await result.task;
  assert.equal(result.calls(), 9);
  assert.deepEqual(
    result.observations.slice(-3).map(({ healthy }) => healthy),
    [1, 2, 3],
  );
});

test('still refuses when the longer wait never finds three consecutive healthy samples', async () => {
  const result = await replay(
    Array.from({ length: 20 }, (_, i) => ({ busy: i % 2 ? 0.1 : 0.99, loadPerCpu: 1.2 })),
  );
  await assert.rejects(result.task, /RESOURCE_READINESS_EXPIRED/);
  assert.equal(result.calls(), 9);
  assert.equal(Math.max(...result.observations.map(({ healthy }) => healthy)), 1);
});

test('refuses missing, nonfinite and over-limit readiness wait policies before sampling', async () => {
  for (const hostedReadinessWaitSeconds of [undefined, 0, Number.POSITIVE_INFINITY, 91, 1e12]) {
    const candidate = { ...policy, hostedReadinessWaitSeconds };
    const result = await replay([], candidate);
    await assert.rejects(result.task, /RESOURCE_READINESS_POLICY_INVALID/);
    assert.equal(result.calls(), 0);
  }
});
