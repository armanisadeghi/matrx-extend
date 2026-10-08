import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { parseProcessTimes, processTimeBracket } from './startup-interval-attribution.mjs';

async function readProcesses() {
  const policy = JSON.parse(
    await readFile(new URL('../docs/stabilization/resource-policy.json', import.meta.url)),
  );
  const { stdout } = await promisify(execFile)('/bin/ps', ['-A', '-o', 'pid=,ppid=,time=,ucomm='], {
    timeout: 5000,
    maxBuffer: policy.processSnapshotMaxBytes,
  });
  return stdout;
}

// Evidence only: this never supplies a guard measurement, permit, or verdict.
// Bracket the actual CDP startup, which can fall entirely between guard ticks.
export async function beginStartupProcessInterval({
  read = readProcesses,
  rootPid = process.pid,
} = {}) {
  const capture = async () => {
    const startedAt = new Date().toISOString();
    try {
      const processes = parseProcessTimes(await read());
      return { startedAt, completedAt: new Date().toISOString(), processes };
    } catch {
      return { startedAt, completedAt: new Date().toISOString(), unavailable: true };
    }
  };
  const before = await capture();
  return async (outcome) => {
    const after = await capture();
    const timing = {
      beforeStartedAt: before.startedAt,
      beforeCompletedAt: before.completedAt,
      afterStartedAt: after.startedAt,
      afterCompletedAt: after.completedAt,
    };
    if (before.unavailable || after.unavailable) return { ...timing, outcome, unavailable: true };
    const bracket = processTimeBracket(before.processes, after.processes, rootPid);
    const appeared = new Set(bracket.appearedPids);
    const owned = new Set(bracket.ownedAtEnd);
    return {
      ...timing,
      outcome,
      ...bracket,
      // Chrome is born inside this bracket. Do not silently omit it, or label
      // lifetime time an exact interval delta (reparenting/PID reuse is possible).
      appearedProcesses: after.processes
        .filter((item) => appeared.has(item.pid))
        .map((item) => ({
          pid: item.pid,
          executable: item.executable,
          ownedAtEnd: owned.has(item.pid),
          lifetimeCpuSeconds: item.cpuCentiseconds / 100,
        })),
      verdict: 'DIAGNOSTIC_ONLY_NO_PRODUCT_ACCEPTANCE',
    };
  };
}
