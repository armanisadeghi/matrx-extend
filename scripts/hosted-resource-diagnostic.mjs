import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { promisify } from 'node:util';
import { cpuBusyFraction } from './stabilization-resource-safety.mjs';

const policy = JSON.parse(
  await readFile(new URL('../docs/stabilization/resource-policy.json', import.meta.url)),
);
const output = async (command, args) =>
  (
    await promisify(execFile)(command, args, {
      timeout: 5000,
      maxBuffer: policy.processSnapshotMaxBytes,
    })
  ).stdout.trim();
const capture = async (measure) => {
  const startedAt = new Date().toISOString();
  try {
    const value = await measure();
    return { startedAt, completedAt: new Date().toISOString(), value };
  } catch {
    return { startedAt, completedAt: new Date().toISOString(), unavailable: true };
  }
};
const limit =
  Math.ceil(policy.swapWindowSeconds / policy.watchIntervalSeconds) + policy.healthySamplesToResume;
const samples = [];
for (let i = 0; i < limit; i++) {
  const [iostat, top, processes, load, cpus] = await Promise.all([
    capture(() => cpuBusyFraction(output)),
    capture(async () => {
      const raw = await output('/usr/bin/top', ['-l', '2', '-s', '1', '-n', '0']);
      const matches = [
        ...raw.matchAll(/CPU usage: ([\d.]+)% user, ([\d.]+)% sys, ([\d.]+)% idle/g),
      ];
      if (matches.length !== 2) throw new Error('CPU_SAMPLE_MISSING');
      return (100 - Number(matches[1][3])) / 100;
    }),
    capture(async () => {
      const raw = await output('/bin/ps', ['-A', '-o', 'pid=,ppid=,%cpu=,comm=']);
      return raw
        .split('\n')
        .map((line) => {
          const fields = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
          if (!fields) throw new Error('PROCESS_SAMPLE_INVALID');
          return {
            pid: Number(fields[1]),
            parentPid: Number(fields[2]),
            cpuPercent: Number(fields[3]),
            executable: basename(fields[4]),
          };
        })
        .filter((item) => item.cpuPercent > 0)
        .sort((a, b) => b.cpuPercent - a.cpuPercent);
    }),
    capture(async () => {
      const raw = await output('/usr/sbin/sysctl', ['-n', 'vm.loadavg']);
      const value = Number(raw.match(/\{\s*([\d.]+)/)?.[1]);
      if (!Number.isFinite(value)) throw new Error('LOAD_SAMPLE_INVALID');
      return value;
    }),
    capture(async () => {
      const value = Number(await output('/usr/sbin/sysctl', ['-n', 'hw.logicalcpu']));
      if (!Number.isFinite(value) || value <= 0) throw new Error('CPU_COUNT_INVALID');
      return value;
    }),
  ]);
  samples.push({ iostat, top, processes, load, cpus });
  console.log(JSON.stringify({ sample: i + 1, iostat, top, load, cpus }));
  if (i + 1 < limit)
    await new Promise((done) => setTimeout(done, policy.watchIntervalSeconds * 1000));
}
const destination = 'test-results/hosted-resource-diagnostic.json';
await mkdir(dirname(destination), { recursive: true });
await writeFile(
  destination,
  `${JSON.stringify({ schema: 1, verdict: 'DIAGNOSTIC_ONLY_NO_ADMISSION_OR_PRODUCT_RESULT', samples }, null, 2)}\n`,
  { mode: 0o600 },
);
