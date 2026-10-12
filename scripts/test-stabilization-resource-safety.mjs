import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  cpuBusyFraction,
  diskIsLow,
  processCpuAttribution,
  sampleDiskSpace,
  writeSafetyState,
} from './stabilization-resource-safety.mjs';
import { copyResourceGuardModules } from './stabilization-resource-test-measurements.mjs';

test('focused acceptance admits only its exact command before profile validation', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'focused-command-admission-'));
  const scripts = join(scratch, 'scripts');
  const docs = join(scratch, 'docs/stabilization');
  try {
    await mkdir(scripts);
    await mkdir(docs, { recursive: true });
    await copyResourceGuardModules(import.meta.dirname, scripts);
    await copyFile(
      new URL('../docs/stabilization/resource-policy.json', import.meta.url),
      join(docs, 'resource-policy.json'),
    );
    // A regular file stops the real guard after command validation, before any
    // host lease or test workload. Admission and near-miss refusal stay real.
    const profile = join(scratch, 'profile-file');
    await writeFile(profile, 'not a directory');
    for (const [index, command] of [
      ['pnpm', 'test:focused-acceptance'],
      ['pnpm', 'test:focused-acceptance', '--'],
      ['pnpm', 'test:focused-acceptance', '--test-concurrency=1'],
      ['pnpm', 'test:focused-acceptance-extra'],
      ['pnpm', 'run', 'test:focused-acceptance'],
    ].entries()) {
      const result = spawnSync(
        process.execPath,
        [
          join(scripts, 'stabilization-resource.mjs'),
          'run',
          '--run-id',
          `focused-${index}`,
          '--profile-dir',
          profile,
          '--',
          ...command,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 2, result.stderr);
      const events = result.stdout.trim().split('\n').map(JSON.parse);
      assert.equal(
        events.at(-2).code,
        index === 0
          ? 'RESOURCE_PROFILE_INVALID'
          : 'RESOURCE_COMMAND_NOT_ALLOWED:see docs/stabilization/resource-policy.json',
      );
      assert.equal(events.at(-1).admitted, false);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('Desktop preflight test descendants preserve the resource owner without inheriting unrelated environment', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'focused-owner-inheritance-'));
  const preload = join(scratch, 'require-owner.mjs');
  try {
    // Wrap the external spawn boundary, then execute the real route tests and
    // their real preflight children. A scrubbed token must fail at that seam.
    await writeFile(
      preload,
      `import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => {
  assert.equal(options?.env?.MATRX_RESOURCE_OWNER, process.env.MATRX_RESOURCE_OWNER, 'preflight child lost resource owner');
  assert.equal(options?.env?.MATRX_RESOURCE_RUN_ID, process.env.MATRX_RESOURCE_RUN_ID, 'preflight child lost run identity');
  assert.equal(options?.env?.MATRX_RESOURCE_STOP_FILE, process.env.MATRX_RESOURCE_STOP_FILE, 'preflight child lost stop boundary');
  assert.equal(options?.env?.MATRX_UNRELATED_ENV_PROBE, undefined, 'isolated preflight inherited unrelated configuration');
  return original(command, args, options);
};
syncBuiltinESMExports();
`,
    );
    const { NODE_TEST_CONTEXT: _testContext, ...environment } = process.env;
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        preload,
        '--test',
        '--test-reporter=tap',
        'scripts/hosted-desktop-settings-route.test.mjs',
      ],
      {
        cwd: join(import.meta.dirname, '..'),
        encoding: 'utf8',
        env: {
          ...environment,
          MATRX_RESOURCE_OWNER: process.env.MATRX_RESOURCE_OWNER ?? 'focused-owner-inheritance',
          MATRX_RESOURCE_RUN_ID: process.env.MATRX_RESOURCE_RUN_ID ?? 'focused-inheritance',
          MATRX_RESOURCE_STOP_FILE:
            process.env.MATRX_RESOURCE_STOP_FILE ?? join(scratch, 'stop.json'),
          MATRX_UNRELATED_ENV_PROBE: 'must-stay-isolated',
        },
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# pass 5/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('CPU sampler uses the second interval and refuses a missing reading', async () => {
  const rows = [
    '      cpu    load average\n us sy id   1m   5m   15m\n  9  4 87  2.61 2.60 2.84\n 12  7 80  2.61 2.60 2.84',
    '      cpu    load average\n us sy id   1m   5m   15m\n  9  4 87  2.61 2.60 2.84\n 35 10 55  2.61 2.60 2.84',
  ];
  for (const [index, raw] of rows.entries()) {
    assert.equal(
      await cpuBusyFraction(async (command, args) => {
        assert.equal(command, '/usr/sbin/iostat');
        assert.deepEqual(args, ['-c', '2', '-w', '1', '-n', '0']);
        return raw;
      }),
      index === 0 ? 0.2 : 0.45,
    );
  }
  await assert.rejects(
    cpuBusyFraction(async () => rows[0].split('\n').slice(0, 3).join('\n')),
    /RESOURCE_MEASUREMENT_INVALID:cpu-busy/,
  );
  await assert.rejects(
    cpuBusyFraction(async () => rows[0].replace(' 12  7 80 ', ' 12  7 101 ')),
    /RESOURCE_MEASUREMENT_INVALID:cpu-idle/,
  );
  await assert.rejects(
    cpuBusyFraction(async () => {
      throw Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' });
    }),
    /timed out/,
  );
});

// Hosted resource admission must identify a malformed iostat shape without
// recording command output. These inputs exercise the real parser, not iostat.
const cpuHeader = '      cpu    load average\n us sy id   1m   5m   15m';
const cpuBootRow = '  9  4 87  2.61 2.60 2.84';
const cpuIntervalRow = ' 12  7 80  2.61 2.60 2.84';

test('CPU sampler identifies malformed headers with a fixed refusal code', async () => {
  for (const header of [
    '',
    cpuHeader.replace('cpu', 'private-header-probe'),
    cpuHeader.replace('us sy id', 'us id sy'),
    cpuHeader.replace('15m', 'private-column-probe'),
  ]) {
    await assert.rejects(
      cpuBusyFraction(async () => [header, cpuBootRow, cpuIntervalRow].join('\n')),
      { message: 'RESOURCE_MEASUREMENT_INVALID:cpu-busy:header' },
    );
  }
});

test('CPU sampler identifies missing or extra samples with a fixed refusal code', async () => {
  for (const rows of [[], [cpuBootRow], [cpuBootRow, cpuIntervalRow, cpuIntervalRow]]) {
    await assert.rejects(
      cpuBusyFraction(async () => [cpuHeader, ...rows].join('\n')),
      { message: 'RESOURCE_MEASUREMENT_INVALID:cpu-busy:sample-count' },
    );
  }
});

test('CPU sampler identifies malformed boot or interval rows with a fixed refusal code', async () => {
  for (const malformed of [
    'private-row-probe',
    ' 12  7 80  2.61 2.60',
    ' 12  7 80  2.61 2.60 2.84 extra',
    ' 12  7 80  NaN 2.60 2.84',
    ' 12  7 -1  2.61 2.60 2.84',
  ]) {
    for (const rows of [
      [malformed, cpuIntervalRow],
      [cpuBootRow, malformed],
    ]) {
      await assert.rejects(
        cpuBusyFraction(async () => [cpuHeader, ...rows].join('\n')),
        { message: 'RESOURCE_MEASUREMENT_INVALID:cpu-busy:row-format' },
      );
    }
  }
});

test('unsafe CPU attribution keeps only bounded numeric process identity and executable basenames', async () => {
  const raw = [
    '  413  201  72.5 /private/credential=secret/Chromium',
    '  829  413  18.2 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '  992    1   0.0 /usr/sbin/syslogd',
  ].join('\n');
  const processes = await processCpuAttribution(async (command, args) => {
    assert.equal(command, '/bin/ps');
    assert.deepEqual(args, ['-A', '-o', 'pid=,ppid=,%cpu=,ucomm=']);
    return raw;
  });
  assert.deepEqual(processes, [
    { pid: 413, parentPid: 201, cpuPercent: 72.5, executable: 'Chromium' },
    { pid: 829, parentPid: 413, cpuPercent: 18.2, executable: 'Google Chrome' },
  ]);
  assert.doesNotMatch(JSON.stringify(processes), /credential|secret|Applications|MacOS/);
  assert.deepEqual(
    await processCpuAttribution(async () =>
      [
        '  100  1  0.0 /usr/sbin/syslogd',
        '  202  100  7.1 /private/another-sensitive-directory/node',
      ].join('\n'),
    ),
    [{ pid: 202, parentPid: 100, cpuPercent: 7.1, executable: 'node' }],
  );
  await assert.rejects(
    processCpuAttribution(async () => 'not a process row'),
    /RESOURCE_PROCESS_DIAGNOSTIC_INVALID/,
  );
});

test('a full system volume refuses despite external repo, profile and lease volumes', async () => {
  const paths = {
    repo: '/Volumes/external/repo',
    profileDir: '/Volumes/external/profile',
    leaseRoot: '/Volumes/external/lease',
  };
  const measured = [];
  const sample = await sampleDiskSpace(paths, {
    statfsFn: async (path) => {
      measured.push(path);
      return { bavail: path === '/' ? 116 * 1024 : 1600 * 1024 * 1024, bsize: 1024 };
    },
  });

  assert.deepEqual(measured, [paths.repo, paths.profileDir, paths.leaseRoot, '/']);
  assert.equal(sample.repoFreeGiB, 1600);
  assert.equal(sample.profileFreeGiB, 1600);
  assert.equal(sample.safetyFreeGiB, 1600);
  assert.equal(sample.systemFreeGiB, 116 / 1024);
  assert.equal(diskIsLow(sample, 20), true);
  assert.equal(diskIsLow({ ...sample, systemFreeGiB: 20 }, 20), false);
  assert.equal(diskIsLow({ ...sample, safetyFreeGiB: 19.9, systemFreeGiB: 20 }, 20), true);
});

test('disk sampler reads actual mounted paths and refuses invalid measurements', async () => {
  const sample = await sampleDiskSpace({ repo: '/', profileDir: '/', leaseRoot: '/' });
  assert(
    [sample.repoFreeGiB, sample.profileFreeGiB, sample.safetyFreeGiB, sample.systemFreeGiB].every(
      (free) => Number.isFinite(free) && free >= 0,
    ),
  );
  await assert.rejects(
    sampleDiskSpace(
      { repo: '/', profileDir: '/', leaseRoot: '/' },
      { statfsFn: async () => ({ bavail: 1, bsize: 0 }) },
    ),
    /RESOURCE_MEASUREMENT_INVALID/,
  );
});

test('safety state is private and ENOSPC remains an explicit failure without payload reflection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'resource-safety-'));
  const path = join(dir, 'unsafe-hold.json');
  try {
    await writeSafetyState(path, { schema: 1, reason: 'disk-low' });
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
      schema: 1,
      reason: 'disk-low',
    });
    assert.equal((await stat(path)).mode & 0o777, 0o600);

    const enospc = Object.assign(new Error('private payload was rejected'), { code: 'ENOSPC' });
    await assert.rejects(
      writeSafetyState(
        path,
        { secret: 'synthetic-private-payload' },
        {
          writeFileFn: async () => {
            throw enospc;
          },
        },
      ),
      (error) => {
        assert.equal(error.message, 'RESOURCE_SAFETY_STATE_WRITE_FAILED');
        assert.equal(error.cause.code, 'ENOSPC');
        assert.doesNotMatch(String(error), /synthetic-private-payload|private payload/);
        return true;
      },
    );
    assert.doesNotMatch(await readFile(path, 'utf8'), /synthetic-private-payload/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
