const assert = require('node:assert/strict');
const {
  observeDelayedCaptureDecisionSettlement,
} = require('./vault-capture-decision-settlement.cjs');

const settledSnapshot = {
  headingPresent: false,
  vaultError: false,
  noAnswer: false,
};

async function legacyInitialDecisionWait(waitForInitialDisappearance) {
  try {
    await waitForInitialDisappearance();
    return true;
  } catch {
    return false;
  }
}

(async () => {
  // Regression: the original ten-second boundary reported this receipt as a
  // failure even though a later exact-heading observation was clean.
  const oldVerdict = await legacyInitialDecisionWait(async () => {
    throw new Error('initial_ten_second_boundary');
  });
  assert.equal(oldVerdict, false, 'legacy_timeout_is_red');

  let tick = 0;
  const lateSettled = await observeDelayedCaptureDecisionSettlement({
    waitForHeadingGone: async () => {},
    snapshot: async () => settledSnapshot,
    pendingCapture: async () => false,
    now: () => (tick++ === 0 ? 1_000 : 1_080),
  });
  assert.deepEqual(
    lateSettled,
    {
      settled: true,
      latencyMs: 80,
      waitTimedOut: false,
      headingPresent: false,
      vaultError: false,
      noAnswer: false,
      pendingCapture: false,
    },
    'late_clean_settlement_is_green',
  );

  for (const [name, snapshot, pendingCapture] of [
    ['heading_visible', { ...settledSnapshot, headingPresent: true }, false],
    ['vault_error', { ...settledSnapshot, vaultError: true }, false],
    ['no_answer', { ...settledSnapshot, noAnswer: true }, false],
    ['pending_capture', settledSnapshot, true],
  ]) {
    const result = await observeDelayedCaptureDecisionSettlement({
      waitForHeadingGone: async () => {},
      snapshot: async () => snapshot,
      pendingCapture: async () => pendingCapture,
    });
    assert.equal(result.settled, false, `${name}_must_remain_red`);
  }

  const timedOut = await observeDelayedCaptureDecisionSettlement({
    waitForHeadingGone: async () => {
      throw new Error('delayed_wait_expired');
    },
    snapshot: async () => settledSnapshot,
    pendingCapture: async () => false,
  });
  assert.equal(timedOut.settled, false, 'unresolved_delayed_wait_must_remain_red');

  process.stdout.write('PASS: delayed capture settlement accepts only a clean completed receipt\n');
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
