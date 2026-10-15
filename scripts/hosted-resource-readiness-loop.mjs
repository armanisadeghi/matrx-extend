export async function waitForResourceReadiness(policy, { sample, sleep, onSample }) {
  if (
    !Number.isSafeInteger(policy.hostedReadinessWaitSeconds) ||
    policy.hostedReadinessWaitSeconds <= 0 ||
    !Number.isSafeInteger(policy.maximumHostedReadinessWaitSeconds) ||
    policy.maximumHostedReadinessWaitSeconds <= 0 ||
    policy.hostedReadinessWaitSeconds > policy.maximumHostedReadinessWaitSeconds ||
    !Number.isSafeInteger(policy.watchIntervalSeconds) ||
    policy.watchIntervalSeconds <= 0 ||
    !Number.isSafeInteger(policy.healthySamplesToResume) ||
    policy.healthySamplesToResume <= 0
  )
    throw new Error('RESOURCE_READINESS_POLICY_INVALID');
  const limit =
    Math.ceil(policy.hostedReadinessWaitSeconds / policy.watchIntervalSeconds) +
    policy.healthySamplesToResume;
  let healthy = 0;
  for (let i = 0; i < limit; i++) {
    const { busy, loadPerCpu } = await sample();
    if (!Number.isFinite(busy) || !Number.isFinite(loadPerCpu))
      throw new Error('RESOURCE_READINESS_MEASUREMENT_INVALID');
    healthy =
      busy < policy.maximumSustainedCpuBusyFraction &&
      (loadPerCpu < policy.maximumOneMinuteLoadPerLogicalCpu ||
        busy < policy.maximumBusyFractionAtHighLoad)
        ? healthy + 1
        : 0;
    onSample({ code: 'RESOURCE_READINESS_SAMPLE', busy, loadPerCpu, healthy });
    if (healthy >= policy.healthySamplesToResume) return;
    if (i + 1 < limit) await sleep(policy.watchIntervalSeconds * 1000);
  }
  throw new Error('RESOURCE_READINESS_EXPIRED');
}
