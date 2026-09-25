const assert = require('node:assert/strict');
const {
  waitForReplacementExtensionWorkerTarget,
} = require('./vault-extension-lifecycle-acceptance.cjs');

(async () => {
  const oldTarget = {
    targetId: 'old-worker',
    type: 'service_worker',
    url: 'chrome-extension://extension/background.js',
  };
  const replacement = { ...oldTarget, targetId: 'replacement-worker' };
  const snapshots = [{ targetInfos: [oldTarget] }, { targetInfos: [oldTarget, replacement] }];
  const observed = await waitForReplacementExtensionWorkerTarget({
    cdp: { send: async () => snapshots.shift() },
    workerUrl: oldTarget.url,
    previousTargetId: oldTarget.targetId,
    wait: async () => {},
  });
  assert.equal(observed.targetId, replacement.targetId);

  await assert.rejects(
    () =>
      waitForReplacementExtensionWorkerTarget({
        cdp: { send: async () => ({ targetInfos: [oldTarget] }) },
        workerUrl: oldTarget.url,
        previousTargetId: oldTarget.targetId,
        wait: async () => {},
        attempts: 2,
      }),
    /lifecycle_replacement_worker_target_timeout/,
    'the old target must never be mistaken for a reload replacement',
  );

  process.stdout.write('PASS: lifecycle reload requires a replacement CDP worker target\n');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
