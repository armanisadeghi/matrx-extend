import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Replace only host telemetry in a scratch guard; policy and decisions stay real. */
export async function setHealthyHostMeasurements(scripts) {
  const path = join(scripts, 'stabilization-resource.mjs');
  let source = await readFile(path, 'utf8');
  const substitutions = [
    [
      "output('/usr/bin/memory_pressure', ['-Q']),",
      "Promise.resolve('System-wide memory free percentage: 80%'),",
    ],
    ["sysctl('kern.memorystatus_vm_pressure_level'),", "Promise.resolve('1'),"],
    ["sysctl('hw.memsize'),", 'Promise.resolve(String(16 * 1024 ** 3)),'],
    ["sysctl('hw.logicalcpu'),", "Promise.resolve('8'),"],
    ["sysctl('vm.loadavg'),", "Promise.resolve('{ 0.5 0.5 0.5 }'),"],
    ["sysctl('vm.swapusage'),", "Promise.resolve('used = 0M'),"],
    ['cpuBusyFraction(),', 'Promise.resolve(0.1),'],
  ];
  for (const [original, replacement] of substitutions) {
    assert.equal(source.split(original).length, 2, `missing unique host measurement: ${original}`);
    source = source.replace(original, replacement);
  }
  await writeFile(path, source);
}
