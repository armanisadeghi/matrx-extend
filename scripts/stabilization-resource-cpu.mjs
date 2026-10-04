// The guard is the sole owner of temporal CPU classification. A pending
// episode keeps the heavy lease and blocks native actions until it resolves.
export function cpuEpisode(policy, monotonicClock) {
  const limitMs =
    (policy.unsafeSamplesToStop + policy.healthySamplesToResume) *
    policy.watchIntervalSeconds *
    1000;
  let pending = false;
  let startedAt = 0;
  let badCount = 0;
  let goodCount = 0;
  let terminal = false;
  return {
    get pending() {
      return pending;
    },
    expired() {
      return pending && monotonicClock() - startedAt >= limitMs;
    },
    observe(reasons) {
      if (terminal) return 'unsafe';
      if (this.expired()) {
        terminal = true;
        return 'expired';
      }
      if (reasons.some((reason) => !reason.startsWith('RESOURCE_CPU_'))) {
        terminal = true;
        return 'unsafe';
      }
      if (reasons.length) {
        goodCount = 0;
        badCount++;
        if (!pending) {
          pending = true;
          startedAt = monotonicClock();
          if (badCount >= policy.unsafeSamplesToStop) {
            terminal = true;
            return 'unsafe';
          }
          return 'pending';
        }
        if (badCount >= policy.unsafeSamplesToStop) {
          terminal = true;
          return 'unsafe';
        }
        return 'pending_watch';
      }
      badCount = 0;
      if (!pending) return 'healthy';
      goodCount++;
      if (goodCount < policy.healthySamplesToResume) return 'pending_watch';
      pending = false;
      goodCount = 0;
      return 'recovered';
    },
  };
}
