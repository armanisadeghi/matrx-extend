import { basename } from 'node:path';

// macOS ps time has centisecond display resolution. These snapshots bracket the iostat call;
// they are diagnostic evidence, never the guard's CPU or safety measurement.
export function parseProcessTimes(raw) {
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(
        /^\s*(\d+)\s+(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d{1,2})?)\s+(.+)$/,
      );
      if (!match) throw new Error('STARTUP_PROCESS_SAMPLE_INVALID');
      const [, pid, parentPid, days, hours, minutes, seconds, executable] = match;
      const cpuCentiseconds =
        Number(days ?? 0) * 8640000 +
        Number(hours ?? 0) * 360000 +
        Number(minutes) * 6000 +
        Math.round(Number(seconds) * 100);
      if (
        ![pid, parentPid].every((value) => Number.isSafeInteger(Number(value))) ||
        !Number.isSafeInteger(cpuCentiseconds)
      )
        throw new Error('STARTUP_PROCESS_SAMPLE_INVALID');
      return {
        pid: Number(pid),
        parentPid: Number(parentPid),
        cpuCentiseconds,
        executable: basename(executable.trim()),
      };
    });
}

function descendants(processes, rootPid) {
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const owned = new Set([rootPid]);
  for (let i = 0; i < processes.length; i++) {
    let changed = false;
    for (const item of processes) {
      if (!owned.has(item.pid) && owned.has(item.parentPid)) {
        owned.add(item.pid);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return new Set([...owned].filter((pid) => byPid.has(pid)));
}

export function processTimeBracket(before, after, rootPid) {
  const first = new Map(before.map((item) => [item.pid, item]));
  const last = new Map(after.map((item) => [item.pid, item]));
  const ownedBefore = descendants(before, rootPid);
  const ownedAfter = descendants(after, rootPid);
  const observed = [];
  for (const item of after) {
    const prior = first.get(item.pid);
    if (
      !prior ||
      prior.executable !== item.executable ||
      item.cpuCentiseconds < prior.cpuCentiseconds
    )
      continue;
    const category =
      ownedBefore.has(item.pid) && ownedAfter.has(item.pid)
        ? item.executable.includes('Chromium')
          ? 'ownedChromium'
          : 'ownedOther'
        : item.executable.startsWith('provjobd')
          ? 'hostProvisioner'
          : 'otherHost';
    observed.push({
      pid: item.pid,
      executable: item.executable,
      category,
      cpuSecondsDelta: (item.cpuCentiseconds - prior.cpuCentiseconds) / 100,
    });
  }
  const categoryTotalsSeconds = Object.fromEntries(
    ['ownedChromium', 'ownedOther', 'hostProvisioner', 'otherHost'].map((category) => [
      category,
      Math.round(
        observed
          .filter((item) => item.category === category)
          .reduce((sum, item) => sum + item.cpuSecondsDelta, 0) * 100,
      ) / 100,
    ]),
  );
  return {
    resolutionSeconds: 0.01,
    ownedAtStart: [...ownedBefore].sort((a, b) => a - b),
    ownedAtEnd: [...ownedAfter].sort((a, b) => a - b),
    exitedOrUnmatchedPids: [...first.keys()].filter((pid) => !last.has(pid)).sort((a, b) => a - b),
    appearedPids: [...last.keys()].filter((pid) => !first.has(pid)).sort((a, b) => a - b),
    categoryTotalsSeconds,
    observed: observed.filter((item) => item.category !== 'otherHost' || item.cpuSecondsDelta > 0),
    otherHostObservedProcessCount: observed.filter((item) => item.category === 'otherHost').length,
    limitation:
      'ps CPU time displays centiseconds; snapshots bracket but do not equal the iostat interval. Exited, newly spawned, reparented, or PID-reused processes cannot be assigned exact interval CPU time.',
  };
}
