import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { waitForResourceReadiness } from './hosted-resource-readiness-loop.mjs';
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
await waitForResourceReadiness(policy, {
  sample: async () => {
    const [busy, load, cpus] = await Promise.all([
      cpuBusyFraction(output),
      output('/usr/sbin/sysctl', ['-n', 'vm.loadavg']),
      output('/usr/sbin/sysctl', ['-n', 'hw.logicalcpu']),
    ]);
    const loadPerCpu = Number(load.match(/\{\s*([\d.]+)/)?.[1]) / Number(cpus);
    if (Number(cpus) <= 0) throw new Error('RESOURCE_READINESS_MEASUREMENT_INVALID');
    return { busy, loadPerCpu };
  },
  sleep: (duration) => new Promise((done) => setTimeout(done, duration)),
  onSample: (result) => console.log(JSON.stringify(result)),
});
