import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
const limit =
  Math.ceil(policy.swapWindowSeconds / policy.watchIntervalSeconds) + policy.healthySamplesToResume;
let healthy = 0;
for (let i = 0; i < limit; i++) {
  const [busy, load, cpus] = await Promise.all([
    cpuBusyFraction(output),
    output('/usr/sbin/sysctl', ['-n', 'vm.loadavg']),
    output('/usr/sbin/sysctl', ['-n', 'hw.logicalcpu']),
  ]);
  const ratio = Number(load.match(/\{\s*([\d.]+)/)?.[1]) / Number(cpus);
  if (!Number.isFinite(ratio) || Number(cpus) <= 0)
    throw new Error('RESOURCE_READINESS_MEASUREMENT_INVALID');
  healthy =
    busy < policy.maximumSustainedCpuBusyFraction &&
    (ratio < policy.maximumOneMinuteLoadPerLogicalCpu ||
      busy < policy.maximumBusyFractionAtHighLoad)
      ? healthy + 1
      : 0;
  console.log(
    JSON.stringify({ code: 'RESOURCE_READINESS_SAMPLE', busy, loadPerCpu: ratio, healthy }),
  );
  if (healthy >= policy.healthySamplesToResume) process.exit(0);
  if (i + 1 < limit)
    await new Promise((done) => setTimeout(done, policy.watchIntervalSeconds * 1000));
}
throw new Error('RESOURCE_READINESS_EXPIRED');
