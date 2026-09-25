/**
 * The runner's initial card-disappearance observation is intentionally short.
 * A timeout there is not a failed Vault write when the same capture settles
 * shortly afterward. This helper owns the narrow, fail-closed delayed verdict.
 */
async function observeDelayedCaptureDecisionSettlement({
  waitForHeadingGone,
  snapshot,
  pendingCapture,
  now = Date.now,
}) {
  const startedAt = now();
  let waitTimedOut = false;
  try {
    await waitForHeadingGone();
  } catch {
    waitTimedOut = true;
  }

  const observed = await snapshot();
  const pending = await pendingCapture();
  const latencyMs = now() - startedAt;
  const settled =
    !waitTimedOut &&
    observed.headingPresent === false &&
    observed.vaultError === false &&
    observed.noAnswer === false &&
    pending === false;

  return {
    settled,
    latencyMs,
    waitTimedOut,
    headingPresent: observed.headingPresent,
    vaultError: observed.vaultError,
    noAnswer: observed.noAnswer,
    pendingCapture: pending,
  };
}

module.exports = { observeDelayedCaptureDecisionSettlement };
