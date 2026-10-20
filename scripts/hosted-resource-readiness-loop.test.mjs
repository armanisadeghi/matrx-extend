import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { waitForResourceReadiness } from './hosted-resource-readiness-loop.mjs';
import {
  linuxPressureUnsafe,
  linuxProcessGroupMembers,
  parseLinuxProcessStat,
  parseLinuxPsi,
  sampleLinuxHost,
  sampleLinuxReadiness,
  stopLinuxOwnedGroup,
} from './stabilization-linux-host.mjs';

const policy = JSON.parse(
  await readFile(new URL('../docs/stabilization/resource-policy.json', import.meta.url)),
);

async function replay(samples, activePolicy = policy) {
  let calls = 0;
  const observations = [];
  const task = waitForResourceReadiness(activePolicy, {
    sample: async () => samples[calls++],
    sleep: async () => {},
    onSample: (result) => observations.push(result),
  });
  return { task, observations, calls: () => calls };
}

test('waits through the observed startup load before admitting three healthy samples', async () => {
  // The first seven measurements are from hosted guest Chat run 38770173860.
  // An eighth healthy measurement exercises its interrupted recovery trajectory.
  const measurements = [
    [0.62, 2.83],
    [0.1, 2.17],
    [0.64, 1.71],
    [0.22, 1.4225],
    [0.99, 1.37],
    [0.01, 1.19],
    [0.01, 0.945],
    [0.01, 0.8],
  ].map(([busy, loadPerCpu]) => ({ busy, loadPerCpu }));
  const oldWindow = await replay(measurements, { ...policy, hostedReadinessWaitSeconds: 60 });
  await assert.rejects(oldWindow.task, /RESOURCE_READINESS_EXPIRED/);
  assert.equal(oldWindow.calls(), 7);
  const result = await replay(measurements);
  await result.task;
  assert.equal(result.calls(), 8);
  assert.deepEqual(
    result.observations.map(({ healthy }) => healthy),
    [0, 1, 0, 1, 0, 1, 2, 3],
  );
});

test('admits the prior Scrape startup after two more healthy samples', async () => {
  // The first seven measurements are from hosted Scrape run 38328930763.
  const measurements = [
    [0.16, 2.975],
    [1, 2.375],
    [0.99, 2.6725],
    [0.15, 2.225],
    [0.93, 2.0175],
    [0.93, 1.7925],
    [0.15, 1.49],
    [0.15, 1.2],
    [0.15, 0.9],
  ].map(([busy, loadPerCpu]) => ({ busy, loadPerCpu }));
  const oldWindow = await replay(measurements, { ...policy, hostedReadinessWaitSeconds: 60 });
  await assert.rejects(oldWindow.task, /RESOURCE_READINESS_EXPIRED/);
  assert.equal(oldWindow.calls(), 7);
  const result = await replay(measurements);
  await result.task;
  assert.equal(result.calls(), 9);
  assert.deepEqual(
    result.observations.slice(-3).map(({ healthy }) => healthy),
    [1, 2, 3],
  );
});

test('still refuses when the longer wait never finds three consecutive healthy samples', async () => {
  const result = await replay(
    Array.from({ length: 20 }, (_, i) => ({ busy: i % 2 ? 0.1 : 0.99, loadPerCpu: 1.2 })),
  );
  await assert.rejects(result.task, /RESOURCE_READINESS_EXPIRED/);
  assert.equal(result.calls(), 9);
  assert.equal(Math.max(...result.observations.map(({ healthy }) => healthy)), 1);
});

test('refuses missing, nonfinite and over-limit readiness wait policies before sampling', async () => {
  for (const hostedReadinessWaitSeconds of [undefined, 0, Number.POSITIVE_INFINITY, 91, 1e12]) {
    const candidate = { ...policy, hostedReadinessWaitSeconds };
    const result = await replay([], candidate);
    await assert.rejects(result.task, /RESOURCE_READINESS_POLICY_INVALID/);
    assert.equal(result.calls(), 0);
  }
});

function linuxReadings({ stalled = false, malformed = false, counterReset = false } = {}) {
  const responses = new Map([
    [
      '/proc/stat',
      [
        'cpu  100 0 50 850 0 0 0 0 0 0\ncpu0 1 0 0 0\ncpu1 1 0 0 0\n',
        counterReset
          ? 'cpu  90 0 70 930 0 0 0 0 0 0\ncpu0 1 0 0 0\ncpu1 1 0 0 0\n'
          : 'cpu  110 0 60 930 0 0 0 0 0 0\ncpu0 1 0 0 0\ncpu1 1 0 0 0\n',
      ],
    ],
    [
      '/proc/pressure/memory',
      [
        'some avg10=0.00 avg60=0.00 avg300=0.00 total=100\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=20\n',
        malformed
          ? 'some bad total=101\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=20\n'
          : `some avg10=0.00 avg60=0.00 avg300=0.00 total=${stalled ? 101 : 100}\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=20\n`,
      ],
    ],
    [
      '/proc/meminfo',
      [
        'MemTotal:       16777216 kB\nMemAvailable:   12582912 kB\nActive(anon):      65536 kB\nHugePages_Total:       0\nSwapTotal:      1048576 kB\nSwapFree:       1048576 kB\n',
      ],
    ],
    ['/proc/loadavg', ['0.60 0.50 0.40 1/100 123\n']],
  ]);
  const reads = [];
  return {
    reads,
    read: async (path) => {
      reads.push(path);
      const values = responses.get(path);
      assert.ok(values, `unexpected kernel path ${path}`);
      return values.length === 1 ? values[0] : values.shift();
    },
    sleep: async (ms) => assert.equal(ms, 1000),
  };
}

test('Linux readiness consumes a full CPU and PSI interval with the unchanged load thresholds', async () => {
  const fixture = linuxReadings();
  const sample = await sampleLinuxHost(policy, fixture);
  assert.deepEqual(
    {
      busy: sample.cpuBusyFraction,
      loadPerCpu: sample.oneMinuteLoad / sample.logicalCpus,
      availableGiB: sample.availableMemoryGiB,
      swapMiB: sample.swapUsedMiB,
      pressure: [sample.memoryPressureSomeStallUs, sample.memoryPressureFullStallUs],
    },
    { busy: 0.2, loadPerCpu: 0.3, availableGiB: 12, swapMiB: 0, pressure: [0, 0] },
  );
  assert.equal(fixture.reads.filter((path) => path === '/proc/stat').length, 2);
  assert.equal(fixture.reads.filter((path) => path === '/proc/pressure/memory').length, 2);
  assert.deepEqual(await sampleLinuxReadiness(policy, linuxReadings()), {
    busy: 0.2,
    loadPerCpu: 0.3,
  });
});

test('Linux pressure growth and malformed PSI refuse before readiness can count a healthy sample', async () => {
  const pressured = await sampleLinuxHost(policy, linuxReadings({ stalled: true }));
  assert.equal(
    linuxPressureUnsafe(pressured, policy.maximumLinuxMemoryPressureStallUsPerSample),
    true,
  );
  await assert.rejects(
    sampleLinuxReadiness(policy, linuxReadings({ stalled: true })),
    /RESOURCE_PRESSURE_UNSAFE/,
  );
  await assert.rejects(
    sampleLinuxHost(policy, linuxReadings({ malformed: true })),
    /RESOURCE_MEASUREMENT_INVALID:linux-pressure/,
  );
  await assert.rejects(
    () => sampleLinuxReadiness({ ...policy, linuxCpuMeasurementIntervalMs: 0 }, linuxReadings()),
    /RESOURCE_MEASUREMENT_INVALID:linux-policy/,
  );
  assert.throws(
    () => parseLinuxPsi('some avg10=0.00 avg60=0.00 avg300=0.00 total=1\n'),
    /RESOURCE_MEASUREMENT_INVALID:linux-pressure/,
  );
});

test('Linux CPU interval refuses a reset user counter even when aggregate busy looks healthy', async () => {
  await assert.rejects(
    sampleLinuxHost(policy, linuxReadings({ counterReset: true })),
    /RESOURCE_MEASUREMENT_INVALID:linux-cpu-interval/,
  );
});

test('Linux census refuses an unreadable live process instead of declaring the group gone', async () => {
  const inaccessible = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  await assert.rejects(
    linuxProcessGroupMembers(101, {
      list: async () => ['101'],
      read: async () => {
        throw inaccessible;
      },
    }),
    /permission denied/,
  );
});

for (const scenario of [
  'matching leader',
  'reused leader',
  'missing leader with descendant',
  'empty census',
]) {
  test(`numeric cleanup refuses ${scenario} without issuing any signal`, async () => {
    const signals = [];
    let censusCalls = 0;
    await assert.rejects(
      stopLinuxOwnedGroup(101, 500, policy, {
        members: async () => {
          censusCalls++;
          return scenario === 'empty census'
            ? []
            : [
                {
                  pid: scenario === 'missing leader with descendant' ? 102 : 101,
                  groupId: 101,
                  startTicks: scenario === 'reused leader' ? 900 : 500,
                  state: 'S',
                },
              ];
        },
        send: (...args) => signals.push(args),
        sleep: async () => {},
      }),
      /RESOURCE_KERNEL_OWNERSHIP_REQUIRED/,
    );
    assert.deepEqual(signals, []);
    assert.equal(censusCalls, 0, 'census cannot grant kernel ownership');
  });
}
test('numeric cleanup retains policy validation', async () => {
  await assert.rejects(
    stopLinuxOwnedGroup(101, 500, { ...policy, ownedGroupGraceSeconds: Number.NaN }),
    /RESOURCE_MEASUREMENT_INVALID:linux-process-owner/,
  );
});

test('Linux process-group parser rejects malformed identity', () => {
  assert.throws(
    () => parseLinuxProcessStat('not a process'),
    /RESOURCE_MEASUREMENT_INVALID:linux-process/,
  );
});

test(
  'Linux process-group parser observes its own live group on Ubuntu',
  { skip: process.platform !== 'linux' && 'requires live Linux /proc' },
  async () => {
    const own = parseLinuxProcessStat(await readFile(`/proc/${process.pid}/stat`, 'utf8'));
    assert.equal(own.pid, process.pid);
    const members = await linuxProcessGroupMembers(own.groupId);
    assert.ok(
      members.some((member) => member.pid === process.pid && member.startTicks === own.startTicks),
    );
  },
);

test(
  'existing light Ubuntu CI captures a genuine Linux CPU and PSI interval without admitting a browser',
  { skip: process.platform !== 'linux' && 'requires live Linux CPU and PSI telemetry' },
  async () => {
    const sample = await sampleLinuxHost(policy);
    assert.equal(sample.platform, 'linux');
    assert.ok(
      Number.isFinite(sample.cpuBusyFraction) &&
        sample.cpuBusyFraction >= 0 &&
        sample.cpuBusyFraction <= 1,
    );
    assert.ok(Number.isFinite(sample.availableMemoryGiB) && sample.availableMemoryGiB > 0);
    console.log(
      'LINUX_KERNEL_INTERVAL',
      JSON.stringify({
        cpuBusyFraction: sample.cpuBusyFraction,
        oneMinuteLoad: sample.oneMinuteLoad,
        logicalCpus: sample.logicalCpus,
        memoryPressureSomeStallUs: sample.memoryPressureSomeStallUs,
        memoryPressureFullStallUs: sample.memoryPressureFullStallUs,
        pressureUnsafe: linuxPressureUnsafe(
          sample,
          policy.maximumLinuxMemoryPressureStallUsPerSample,
        ),
      }),
    );
  },
);

test(
  'Linux refuses retrospective ownership even for its own current live group',
  { skip: process.platform !== 'linux' && 'requires live Linux process groups' },
  async () => {
    const root = parseLinuxProcessStat(await readFile(`/proc/${process.pid}/stat`, 'utf8'));
    await assert.rejects(
      stopLinuxOwnedGroup(root.groupId, root.startTicks, policy),
      /RESOURCE_KERNEL_OWNERSHIP_REQUIRED/,
    );
    assert.ok(
      (await linuxProcessGroupMembers(root.groupId)).some((member) => member.pid === process.pid),
    );
  },
);
