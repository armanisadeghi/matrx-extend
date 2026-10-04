import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { openResourceJournal } from './stabilization-resource-journal.mjs';
import { resourceVerdict } from './stabilization-resource-verdict.mjs';

const repo = resolve(import.meta.dirname, '..');
const journalPath = (runId) =>
  resolve(repo, 'docs/stabilization/resource-journals', `${runId}.jsonl`);

test('a refused guard launch durably records its exact run and terminal decision before any permit', async () => {
  const runId = `journal-refusal-${randomUUID()}`;
  const path = journalPath(runId);
  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/stabilization-resource.mjs',
        'run',
        '--run-id',
        runId,
        '--',
        'node',
        '-e',
        'secret',
      ],
      { cwd: repo, encoding: 'utf8' },
    );
    assert.equal(result.status, 2);
    const events = (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      events.map((event) => event.code),
      [
        'RESOURCE_JOURNAL_OPENED',
        'RESOURCE_COMMAND_NOT_ALLOWED:see docs/stabilization/resource-policy.json',
        'RESOURCE_FINAL_DECISION',
      ],
    );
    assert(events.every((event) => event.runId === runId));
    assert.deepEqual(events.at(-1), {
      schema: 1,
      at: events.at(-1).at,
      runId,
      admitted: false,
      resourceInvalid: false,
      exitCode: 2,
      decision: 'refused',
      code: 'RESOURCE_FINAL_DECISION',
    });
    assert(!JSON.stringify(events).includes('secret'));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const before = await readFile(path);
    const duplicate = spawnSync(
      process.execPath,
      [
        'scripts/stabilization-resource.mjs',
        'run',
        '--run-id',
        runId,
        '--',
        'node',
        '-e',
        'secret',
      ],
      { cwd: repo, encoding: 'utf8' },
    );
    assert.equal(duplicate.status, 2);
    assert.match(duplicate.stdout, /RESOURCE_RUN_ID_ALREADY_JOURNALED/);
    assert.deepEqual(await readFile(path), before);
  } finally {
    await rm(path, { force: true });
  }
});

test('final verdict separates denied launch, invalid resources, failed child and success', () => {
  // A TypeScript compile may exit 1 after admission, as d59-compile-2 did.
  // The wrapper's exit code alone cannot distinguish it from a denied launch.
  const cases = [
    [{ admitted: false, resourceInvalid: false, exitCode: 2 }, 'refused'],
    [{ admitted: false, resourceInvalid: true, exitCode: 3 }, 'refused'],
    [{ admitted: true, resourceInvalid: true, exitCode: 3, childFinished: true }, 'invalid'],
    [{ admitted: true, resourceInvalid: false, exitCode: 1, childFinished: true }, 'child_failed'],
    [{ admitted: true, resourceInvalid: false, exitCode: 0, childFinished: true }, 'valid'],
    [
      { admitted: true, resourceInvalid: false, exitCode: 130, operatorStopped: true },
      'interrupted',
    ],
    [{ admitted: true, resourceInvalid: false, exitCode: 2 }, 'invalid'],
  ];
  for (const [input, expected] of cases) assert.equal(resourceVerdict(input), expected);
});

test('journal writes only guard fields and refuses overwrite', async () => {
  const runId = `journal-fields-${randomUUID()}`;
  const path = journalPath(runId);
  const journal = openResourceJournal(repo, runId);
  try {
    journal.write({
      schema: 1,
      at: '2026-09-28T00:00:00.000Z',
      code: 'RESOURCE_WATCH_HEALTHY',
      runId,
      reasons: [],
      sample: { pressureLevel: 1 },
      childStdout: 'private child output',
      detail: 'private detail',
    });
    assert.throws(() => openResourceJournal(repo, runId), /RESOURCE_RUN_ID_ALREADY_JOURNALED/);
    assert.deepEqual(JSON.parse((await readFile(journal.path, 'utf8')).trim()), {
      schema: 1,
      at: '2026-09-28T00:00:00.000Z',
      code: 'RESOURCE_WATCH_HEALTHY',
      runId,
      reasons: [],
      sample: { pressureLevel: 1 },
    });
  } finally {
    journal.close();
    await rm(path, { force: true });
  }
});

test('startup bracket survives durable journal publication with only scoped CPU accounting', async () => {
  // EXT-D-0129: run 37230193583 printed this event but the journal dropped bracket.
  const runId = `journal-startup-bracket-${randomUUID()}`;
  const path = journalPath(runId);
  const journal = openResourceJournal(repo, runId);
  const bracket = {
    iostatStartedAt: '2026-10-04T20:02:59.757Z',
    iostatCompletedAt: '2026-10-04T20:03:00.840Z',
    beforeCompletedAt: '2026-10-04T20:02:59.757Z',
    afterStartedAt: '2026-10-04T20:03:00.840Z',
    resolutionSeconds: 0.01,
    ownedAtStart: [12669, 12803],
    ownedAtEnd: [12669, 12803],
    exitedOrUnmatchedPids: [13103],
    appearedPids: [13188],
    categoryTotalsSeconds: {
      ownedChromium: 0.36,
      ownedOther: 0.03,
      hostProvisioner: 0,
      otherHost: 1.69,
    },
    observed: [
      {
        pid: 12803,
        executable: 'Chromium Helper',
        category: 'ownedChromium',
        cpuSecondsDelta: 0.36,
        argv: '--token=private',
        environment: 'PRIVATE=private',
      },
    ],
    otherHostObservedProcessCount: 523,
    limitation:
      'ps CPU time displays centiseconds; snapshots bracket but do not equal the iostat interval. Exited, newly spawned, reparented, or PID-reused processes cannot be assigned exact interval CPU time.',
    rawCommand: '--token=private',
  };
  try {
    for (const corrupt of [
      {
        ...bracket,
        observed: [
          {
            pid: 12803,
            executable: '/private/Chromium',
            category: 'ownedChromium',
            cpuSecondsDelta: 0.36,
          },
        ],
      },
      {
        ...bracket,
        categoryTotalsSeconds: { ...bracket.categoryTotalsSeconds, otherHost: Number.NaN },
      },
    ])
      assert.throws(
        () =>
          journal.write({
            schema: 1,
            code: 'RESOURCE_STARTUP_INTERVAL_BRACKET',
            runId,
            bracket: corrupt,
          }),
        /RESOURCE_JOURNAL_WRITE_FAILED/,
      );
    journal.write({
      schema: 1,
      at: '2026-10-04T20:03:00.871Z',
      code: 'RESOURCE_STARTUP_INTERVAL_BRACKET',
      runId,
      bracket,
    });
    journal.close();
    const events = (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);
    const { rawCommand, ...safeBracket } = bracket;
    safeBracket.observed = [
      {
        pid: 12803,
        executable: 'Chromium Helper',
        category: 'ownedChromium',
        cpuSecondsDelta: 0.36,
      },
    ];
    assert.deepEqual(events[0].bracket, safeBracket);
    assert.doesNotMatch(JSON.stringify(events), /private|argv|environment|rawCommand/);
  } finally {
    await rm(path, { force: true });
  }
});

test('startup bracket refuses malformed accounting and preserves unavailable evidence', async () => {
  const runId = `journal-startup-refusal-${randomUUID()}`;
  const path = journalPath(runId);
  const journal = openResourceJournal(repo, runId);
  try {
    for (const bracket of [
      undefined,
      { unavailable: false },
      { unavailable: true, limitation: 'private environment' },
      { unavailable: true, iostatStartedAt: 'private command' },
    ])
      assert.throws(
        () =>
          journal.write({ schema: 1, code: 'RESOURCE_STARTUP_INTERVAL_BRACKET', runId, bracket }),
        /RESOURCE_JOURNAL_WRITE_FAILED/,
      );
    journal.write({
      schema: 1,
      code: 'RESOURCE_STARTUP_INTERVAL_BRACKET',
      runId,
      bracket: { unavailable: true, rawError: 'private environment' },
    });
    journal.close();
    const events = (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      events.map((event) => event.bracket),
      [{ unavailable: true }],
    );
    assert.doesNotMatch(JSON.stringify(events), /private|rawError/);
  } finally {
    await rm(path, { force: true });
  }
});

test('process attribution survives journal publication with only sanitized accounting fields', async () => {
  for (const [suffix, detail, expected] of [
    [
      'success',
      {
        processes: [
          {
            pid: 413,
            parentPid: 201,
            cpuPercent: 72.5,
            executable: 'Google Chrome fo',
            argv: '--password=private',
            environment: 'PRIVATE_TOKEN=private',
            path: '/Applications/private',
          },
          { pid: 921, parentPid: 1, cpuPercent: 1.25, executable: 'node' },
        ],
        rawError: 'private error',
      },
      {
        processes: [
          { pid: 413, parentPid: 201, cpuPercent: 72.5, executable: 'Google Chrome fo' },
          { pid: 921, parentPid: 1, cpuPercent: 1.25, executable: 'node' },
        ],
      },
    ],
    ['unavailable', { unavailable: true, rawError: 'private error' }, { unavailable: true }],
  ]) {
    const runId = `journal-attribution-${suffix}-${randomUUID()}`;
    const path = journalPath(runId);
    const journal = openResourceJournal(repo, runId);
    try {
      journal.write({
        schema: 1,
        at: '2026-10-04T00:00:00.000Z',
        code: 'RESOURCE_WATCH_UNSAFE',
        runId,
      });
      journal.write({
        schema: 1,
        at: '2026-10-04T00:00:00.100Z',
        code: 'RESOURCE_PROCESS_ATTRIBUTION',
        runId,
        ...detail,
      });
      journal.close();
      const events = (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);
      assert.deepEqual(
        events.map((event) => event.code),
        ['RESOURCE_WATCH_UNSAFE', 'RESOURCE_PROCESS_ATTRIBUTION'],
      );
      assert.deepEqual(events[1], {
        schema: 1,
        at: '2026-10-04T00:00:00.100Z',
        code: 'RESOURCE_PROCESS_ATTRIBUTION',
        runId,
        ...expected,
      });
      assert.doesNotMatch(JSON.stringify(events), /private|argv|environment|rawError|path/);
    } finally {
      await rm(path, { force: true });
    }
  }
});

test('journal refuses path-like or malformed process attribution instead of persisting it', async () => {
  const runId = `journal-attribution-invalid-${randomUUID()}`;
  const path = journalPath(runId);
  const journal = openResourceJournal(repo, runId);
  try {
    journal.write({ schema: 1, code: 'RESOURCE_WATCH_UNSAFE', runId });
    for (const detail of [
      { processes: [{ pid: 4, parentPid: 1, cpuPercent: 5, executable: '/private/Chrome' }] },
      { processes: [{ pid: 4, parentPid: 1, cpuPercent: Number.NaN, executable: 'Chrome' }] },
      { processes: [], unavailable: true },
      { unavailable: false },
    ]) {
      assert.throws(
        () => journal.write({ schema: 1, code: 'RESOURCE_PROCESS_ATTRIBUTION', runId, ...detail }),
        /RESOURCE_JOURNAL_WRITE_FAILED/,
      );
    }
    journal.close();
    const events = (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      events.map((event) => event.code),
      ['RESOURCE_WATCH_UNSAFE'],
    );
  } finally {
    await rm(path, { force: true });
  }
});

test('legacy refusal journal retains bounded identity without command or environment', async () => {
  const runId = `legacy-evidence-${randomUUID()}`;
  const path = journalPath(runId);
  const journal = openResourceJournal(repo, runId);
  try {
    journal.write({
      schema: 1,
      at: '2026-09-28T00:00:00.000Z',
      code: 'RESOURCE_LEGACY_RUNNER_BUSY',
      runId,
      processEvidence: {
        matches: [
          {
            pid: 4242,
            ppid: 101,
            processStart: 'Mon Sep 28 06:59:03 2026',
            executable: 'node',
            reason: 'script-operand',
            command: 'private command',
            environment: 'private environment',
          },
        ],
        overflow: 0,
      },
    });
    const saved = JSON.parse((await readFile(journal.path, 'utf8')).trim());
    assert.deepEqual(saved.processEvidence, {
      matches: [
        {
          pid: 4242,
          ppid: 101,
          processStart: 'Mon Sep 28 06:59:03 2026',
          executable: 'node',
          reason: 'script-operand',
        },
      ],
      overflow: 0,
    });
    assert.doesNotMatch(JSON.stringify(saved), /private command|private environment/);
  } finally {
    journal.close();
    await rm(path, { force: true });
  }
});

test('journal refuses a symlinked directory without creating evidence outside the repository', async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), 'resource-journal-containment-'));
  const fixtureRepo = resolve(scratch, 'repo');
  const outside = resolve(scratch, 'outside');
  const runId = 'containment-probe';
  try {
    await mkdir(resolve(fixtureRepo, 'docs/stabilization'), { recursive: true });
    await mkdir(outside);
    await symlink(outside, resolve(fixtureRepo, 'docs/stabilization/resource-journals'));
    assert.throws(() => openResourceJournal(fixtureRepo, runId), /RESOURCE_JOURNAL_PATH_INVALID/);
    await assert.rejects(stat(resolve(outside, `${runId}.jsonl`)), { code: 'ENOENT' });
    const alias = resolve(scratch, 'repo-alias');
    await symlink(fixtureRepo, alias);
    await rm(resolve(fixtureRepo, 'docs/stabilization/resource-journals'));
    const journal = openResourceJournal(alias, runId);
    journal.write({ schema: 1, at: '2026-09-28T00:00:00.000Z', code: 'RESOURCE_ADMITTED', runId });
    journal.close();
    assert.equal(
      (
        await readFile(
          resolve(fixtureRepo, 'docs/stabilization/resource-journals', `${runId}.jsonl`),
          'utf8',
        )
      ).includes('RESOURCE_ADMITTED'),
      true,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('a close failure leaves a valid-looking decision uncommitted', async () => {
  const runId = `journal-close-fault-${randomUUID()}`;
  const finalPath = journalPath(runId);
  const pendingPath = resolve(
    repo,
    'docs/stabilization/resource-journals',
    `${runId}.pending.jsonl`,
  );
  const journal = openResourceJournal(repo, runId, {
    closeFd: (fd) => {
      closeSync(fd);
      throw new Error('injected close failure');
    },
  });
  try {
    journal.write({
      schema: 1,
      at: '2026-09-28T00:00:00.000Z',
      code: 'RESOURCE_FINAL_DECISION',
      runId,
      resourceInvalid: false,
      exitCode: 0,
      decision: 'valid',
    });
    assert.throws(() => journal.close(), /injected close failure/);
    await assert.rejects(stat(finalPath), { code: 'ENOENT' });
    assert.match(await readFile(pendingPath, 'utf8'), /RESOURCE_FINAL_DECISION/);
    assert.throws(() => openResourceJournal(repo, runId), /RESOURCE_RUN_ID_ALREADY_JOURNALED/);
  } finally {
    await rm(finalPath, { force: true });
    await rm(pendingPath, { force: true });
  }
});

test('guard exits invalid and leaves no completed journal when close fails', async () => {
  const fixtureRepo = await mkdtemp(resolve(tmpdir(), 'resource-guard-close-'));
  const scripts = resolve(fixtureRepo, 'scripts');
  const docs = resolve(fixtureRepo, 'docs/stabilization');
  try {
    await mkdir(scripts);
    await mkdir(docs, { recursive: true });
    for (const name of [
      'stabilization-resource.mjs',
      'stabilization-resource-safety.mjs',
      'stabilization-resource-journal.mjs',
      'stabilization-resource-lease.mjs',
      'stabilization-resource-process.mjs',
      'stabilization-resource-verdict.mjs',
      'startup-interval-attribution.mjs',
    ])
      await copyFile(resolve(repo, 'scripts', name), resolve(scripts, name));
    await copyFile(
      resolve(repo, 'docs/stabilization/resource-policy.json'),
      resolve(docs, 'resource-policy.json'),
    );
    const helperPath = resolve(scripts, 'stabilization-resource-journal.mjs');
    const helper = await readFile(helperPath, 'utf8');
    const faulted = helper.replace(
      'closeFd(fd);\n      linkSync',
      "closeFd(fd);\n      throw new Error('injected close failure');\n      linkSync",
    );
    assert.notEqual(faulted, helper);
    await writeFile(helperPath, faulted);
    const runId = 'close-fault-run';
    const result = spawnSync(
      process.execPath,
      [
        resolve(scripts, 'stabilization-resource.mjs'),
        'run',
        '--run-id',
        runId,
        '--',
        'node',
        '-e',
        'secret',
      ],
      { cwd: fixtureRepo, encoding: 'utf8' },
    );
    assert.equal(result.status, 3);
    assert.match(result.stderr, /RESOURCE_JOURNAL_FINALIZE_FAILED/);
    const pending = resolve(docs, 'resource-journals', `${runId}.pending.jsonl`);
    const completed = resolve(docs, 'resource-journals', `${runId}.jsonl`);
    assert.match(await readFile(pending, 'utf8'), /RESOURCE_FINAL_DECISION/);
    await assert.rejects(stat(completed), { code: 'ENOENT' });
  } finally {
    await rm(fixtureRepo, { recursive: true, force: true });
  }
});
