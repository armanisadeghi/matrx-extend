import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  copyHostedResourceJournal,
  sanitizeHostedResourceJournal,
} from '../../scripts/copy-hosted-resource-journal.mjs';

const runId = 'hosted-guest-journal-copy-001';
const event = (code: string, fields: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 1, at: '2026-10-09T00:00:00.000Z', runId, ...fields, code });
const recoveryEvent = (code: string, fields: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 1, at: '2026-10-09T00:00:00.000Z', ...fields, code });

const final = (fields: Record<string, unknown> = {}) =>
  event('RESOURCE_FINAL_DECISION', {
    admitted: true,
    resourceInvalid: false,
    exitCode: 1,
    decision: 'child_failed',
    ...fields,
  });

const startupBracket = {
  iostatStartedAt: '2026-10-04T20:02:59.757Z',
  iostatCompletedAt: '2026-10-04T20:03:00.840Z',
  beforeStartedAt: '2026-10-04T20:02:59.740Z',
  beforeCompletedAt: '2026-10-04T20:02:59.757Z',
  afterStartedAt: '2026-10-04T20:03:00.840Z',
  afterCompletedAt: '2026-10-04T20:03:00.856Z',
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
    { pid: 12803, executable: 'Chromium Helper', category: 'ownedChromium', cpuSecondsDelta: 0.36 },
  ],
  otherHostObservedProcessCount: 523,
  limitation:
    'ps CPU time displays centiseconds; snapshots bracket but do not equal the iostat interval. Exited, newly spawned, reparented, or PID-reused processes cannot be assigned exact interval CPU time.',
};

describe('hosted resource journal evidence copy', () => {
  it('preserves a completed native guard unsafe-hold refusal without changing admission or exit', () => {
    const opened = event('RESOURCE_JOURNAL_OPENED');
    const hold = recoveryEvent('RESOURCE_UNSAFE_HOLD', {
      reasons: ['RESOURCE_CPU_BUSY'],
      sample: {
        pressureLevel: 1,
        availableMemoryGiB: 10,
        requiredMemoryGiB: 12,
        oneMinuteLoad: 4,
        logicalCpus: 8,
        cpuBusyFraction: 0.8,
        swapUsedMiB: 100,
        repoFreeGiB: 50,
        profileFreeGiB: 50,
        safetyFreeGiB: 50,
        systemFreeGiB: 50,
      },
    });
    const refusal = event('RESOURCE_FINAL_DECISION', {
      admitted: false,
      resourceInvalid: false,
      exitCode: 2,
      decision: 'refused',
    });
    expect(sanitizeHostedResourceJournal(`${opened}\n${hold}\n${refusal}\n`, runId)).toBe(
      `${opened}\n${hold}\n${refusal}\n`,
    );
  });

  it('preserves the guard recovery event that precedes admission', () => {
    const ready = recoveryEvent('RESOURCE_RECOVERY_SAMPLES_READY', {
      previousRunId: 'previous-run-001',
    });
    const admitted = event('RESOURCE_ADMITTED', { mode: 'check' });
    const valid = event('RESOURCE_FINAL_DECISION', {
      admitted: true,
      resourceInvalid: false,
      exitCode: 0,
      decision: 'valid',
    });
    const source = `${event('RESOURCE_JOURNAL_OPENED')}\n${ready}\n${admitted}\n${valid}\n`;
    expect(sanitizeHostedResourceJournal(source, runId)).toBe(source);
  });

  it('refuses unsupported recovery fields, values, placement, and contradictory finals', () => {
    const opened = `${event('RESOURCE_JOURNAL_OPENED')}\n`;
    const refused = `${event('RESOURCE_FINAL_DECISION', {
      admitted: false,
      resourceInvalid: false,
      exitCode: 2,
      decision: 'refused',
    })}\n`;
    const hold = recoveryEvent('RESOURCE_UNSAFE_HOLD', {
      reasons: ['RESOURCE_CPU_BUSY'],
      sample: Object.fromEntries(
        [
          'pressureLevel',
          'availableMemoryGiB',
          'requiredMemoryGiB',
          'oneMinuteLoad',
          'logicalCpus',
          'cpuBusyFraction',
          'swapUsedMiB',
          'repoFreeGiB',
          'profileFreeGiB',
          'safetyFreeGiB',
          'systemFreeGiB',
        ].map((key) => [key, 1]),
      ),
    });
    for (const mutated of [
      recoveryEvent('RESOURCE_UNSAFE_HOLD', {
        reasons: ['RESOURCE_CPU_BUSY'],
        sample: { token: 'secret' },
      }),
      recoveryEvent('RESOURCE_UNSAFE_HOLD', {
        reasons: ['RESOURCE_CPU_BUSY'],
        sample: JSON.parse(hold).sample,
        token: 'secret',
      }),
      recoveryEvent('RESOURCE_UNSAFE_HOLD', {
        reasons: ['RESOURCE_SECRET_PATH'],
        sample: JSON.parse(hold).sample,
      }),
      recoveryEvent('RESOURCE_UNSAFE_HOLD', {
        reasons: ['RESOURCE_CPU_BUSY'],
        sample: JSON.parse(hold).sample,
        runId,
      }),
      recoveryEvent('RESOURCE_RECOVERY_SAMPLES_READY', { previousRunId: '/private/path' }),
      recoveryEvent('RESOURCE_RECOVERY_SAMPLES_READY', { previousRunId: 'prior', token: 'secret' }),
    ])
      expect(() => sanitizeHostedResourceJournal(`${opened}${mutated}\n${refused}`, runId)).toThrow(
        /JOURNAL_EVENT_(FIELD|VALUE)_UNSUPPORTED/,
      );
    expect(() => sanitizeHostedResourceJournal(`${hold}\n${refused}`, runId)).toThrow(
      'JOURNAL_EVENT_VALUE_UNSUPPORTED',
    );
    expect(() =>
      sanitizeHostedResourceJournal(
        `${opened}${event('RESOURCE_ADMITTED')}\n${hold}\n${refused}`,
        runId,
      ),
    ).toThrow('JOURNAL_EVENT_VALUE_UNSUPPORTED');
    expect(() =>
      sanitizeHostedResourceJournal(
        `${opened}${hold}\n${event('RESOURCE_FINAL_DECISION', {
          admitted: true,
          resourceInvalid: false,
          exitCode: 0,
          decision: 'valid',
        })}\n`,
        runId,
      ),
    ).toThrow('JOURNAL_FINAL_DECISION_INVALID');
    expect(() =>
      sanitizeHostedResourceJournal(
        `${opened}${event('RESOURCE_UNSAFE_HOLD', {
          reasons: ['RESOURCE_CPU_BUSY'],
          sample: JSON.parse(hold).sample,
          runId: 'other-run',
        })}\n${refused}`,
        runId,
      ),
    ).toThrow('JOURNAL_EVENT_INVALID');
  });
  it.each([
    ['valid', { admitted: true, resourceInvalid: false, exitCode: 0, decision: 'valid' }],
    ['invalid', { admitted: true, resourceInvalid: true, exitCode: 3, decision: 'invalid' }],
  ])('omits a safe writer startup bracket and preserves the exact %s final', (_name, fields) => {
    const finalLine = `${event('RESOURCE_FINAL_DECISION', fields)}\n`;
    const source = `${event('RESOURCE_ADMITTED', { mode: 'run' })}\n${event('RESOURCE_STARTUP_INTERVAL_BRACKET', { bracket: startupBracket })}\n${event('RESOURCE_WATCH_UNSAFE', { reasons: ['RESOURCE_CPU_BUSY'] })}\n${finalLine}`;
    expect(sanitizeHostedResourceJournal(source, runId)).toBe(
      `${event('RESOURCE_ADMITTED', { mode: 'run' })}\n${event('RESOURCE_WATCH_UNSAFE', { reasons: ['RESOURCE_CPU_BUSY'] })}\n${finalLine}`,
    );
  });

  it.each([
    [
      'top-level secret',
      { bracket: startupBracket, token: 'never-copy' },
      'JOURNAL_EVENT_FIELD_UNSUPPORTED',
    ],
    [
      'bracket secret',
      { bracket: { ...startupBracket, accessToken: 'never-copy' } },
      'JOURNAL_EVENT_VALUE_UNSUPPORTED',
    ],
    [
      'nested process secret',
      {
        bracket: {
          ...startupBracket,
          observed: [{ ...startupBracket.observed[0], args: 'never-copy' }],
        },
      },
      'JOURNAL_EVENT_VALUE_UNSUPPORTED',
    ],
    [
      'nested totals secret',
      {
        bracket: {
          ...startupBracket,
          categoryTotalsSeconds: { ...startupBracket.categoryTotalsSeconds, privateTotal: 1 },
        },
      },
      'JOURNAL_EVENT_VALUE_UNSUPPORTED',
    ],
    ['missing bracket', {}, 'JOURNAL_EVENT_VALUE_UNSUPPORTED'],
  ])('refuses %s in a startup bracket', (_name, fields, code) => {
    expect(() =>
      sanitizeHostedResourceJournal(
        `${event('RESOURCE_STARTUP_INTERVAL_BRACKET', fields)}\n${final()}\n`,
        runId,
      ),
    ).toThrow(code);
  });

  it('accepts a safe unavailable bracket without exposing its process detail', () => {
    const source = `${event('RESOURCE_STARTUP_INTERVAL_BRACKET', { bracket: { unavailable: true } })}\n${final()}\n`;
    expect(sanitizeHostedResourceJournal(source, runId)).toBe(`${final()}\n`);
  });
  it('removes only process attribution and preserves the exact child-failed final line', () => {
    const finalLine = `  ${final()}  `;
    const source = [
      event('RESOURCE_ADMITTED', { mode: 'run' }),
      event('RESOURCE_PROCESS_ATTRIBUTION', {
        processes: [
          { pid: 8124, parentPid: 8123, executable: 'Chromium Helper', cpuPercent: 89.5 },
        ],
      }),
      event('RESOURCE_CPU_RECOVERED'),
      finalLine,
    ].join('\n');

    const copied = sanitizeHostedResourceJournal(source, runId);

    expect(copied).toBe(
      [
        event('RESOURCE_ADMITTED', { mode: 'run' }),
        event('RESOURCE_CPU_RECOVERED'),
        finalLine,
      ].join('\n'),
    );
    expect(copied).not.toContain('8124');
    expect(copied).not.toContain('Chromium Helper');
    expect(copied).not.toContain('89.5');
  });

  it.each(['\n', '\r\n', ''])('omits only opened-event path with line ending %j', (ending) => {
    const opened = event('RESOURCE_JOURNAL_OPENED', {
      path: '/owned-runner/resource.pending.jsonl',
    });
    const finalLine = `  ${final()}  `;
    const separator = ending || '\n';
    const copied = sanitizeHostedResourceJournal(
      `${opened}${separator}${finalLine}${ending}`,
      runId,
    );
    expect(copied).toBe(`${event('RESOURCE_JOURNAL_OPENED')}${separator}${finalLine}${ending}`);
    expect(copied).not.toContain('/owned-runner/');
  });

  it('retains an already sanitized opened event byte-for-byte', () => {
    const opened = `  ${event('RESOURCE_JOURNAL_OPENED')}  \r\n`;
    expect(sanitizeHostedResourceJournal(`${opened}${final()}`, runId)).toBe(`${opened}${final()}`);
  });

  it('refuses unknown opened-event fields before removing its path', () => {
    const opened = event('RESOURCE_JOURNAL_OPENED', {
      path: '/owned-runner/resource.pending.jsonl',
      unexpectedDiagnostic: 'do-not-copy',
    });
    expect(() => sanitizeHostedResourceJournal(`${opened}\n${final()}`, runId)).toThrow(
      'JOURNAL_EVENT_FIELD_UNSUPPORTED',
    );
  });

  it.each([
    ['valid', { admitted: true, resourceInvalid: false, exitCode: 0, decision: 'valid' }],
    ['refused', { admitted: false, resourceInvalid: false, exitCode: 2, decision: 'refused' }],
    ['invalid', { admitted: true, resourceInvalid: true, exitCode: 3, decision: 'invalid' }],
    [
      'interrupted',
      { admitted: true, resourceInvalid: false, exitCode: 130, decision: 'interrupted' },
    ],
  ])('preserves a valid %s final decision', (_name, fields) => {
    const finalLine = event('RESOURCE_FINAL_DECISION', fields);
    expect(sanitizeHostedResourceJournal(finalLine, runId)).toBe(finalLine);
  });

  it('removes an unavailable process-attribution row without changing the final verdict', () => {
    const unavailable = event('RESOURCE_PROCESS_ATTRIBUTION', { unavailable: true });
    const finalLine = final({ exitCode: 0, decision: 'valid' });
    expect(sanitizeHostedResourceJournal(`${unavailable}\n${finalLine}\n`, runId)).toBe(
      `${finalLine}\n`,
    );
  });

  it('rejects a journal without exactly one terminal final decision', () => {
    const admission = event('RESOURCE_ADMITTED');
    expect(() => sanitizeHostedResourceJournal(admission, runId)).toThrow(
      'JOURNAL_FINAL_DECISION_MISSING',
    );
    expect(() => sanitizeHostedResourceJournal(`${final()}\n${final()}`, runId)).toThrow(
      'JOURNAL_FINAL_DECISION_DUPLICATE',
    );
    expect(() =>
      sanitizeHostedResourceJournal(`${final()}\n${event('RESOURCE_CPU_RECOVERED')}`, runId),
    ).toThrow('JOURNAL_FINAL_DECISION_NOT_LAST');
  });

  it('rejects malformed or contradictory terminal decisions', () => {
    expect(() =>
      sanitizeHostedResourceJournal(event('RESOURCE_FINAL_DECISION', { exitCode: '1' }), runId),
    ).toThrow('JOURNAL_FINAL_DECISION_INVALID');
    expect(() => sanitizeHostedResourceJournal(final({ exitCode: 0 }), runId)).toThrow(
      'JOURNAL_FINAL_DECISION_INVALID',
    );
    expect(() =>
      sanitizeHostedResourceJournal(
        event('RESOURCE_FINAL_DECISION', {
          admitted: true,
          resourceInvalid: true,
          exitCode: 0,
          decision: 'invalid',
        }),
        runId,
      ),
    ).toThrow('JOURNAL_FINAL_DECISION_INVALID');
    expect(() => sanitizeHostedResourceJournal('{not-json}', runId)).toThrow(
      'JOURNAL_JSON_INVALID',
    );
  });

  it('rejects unexpected event codes and fields instead of copying unknown payloads', () => {
    expect(() =>
      sanitizeHostedResourceJournal(
        event('RESOURCE_UNEXPECTED_SECRET', { token: 'never-copy' }),
        runId,
      ),
    ).toThrow('JOURNAL_EVENT_UNSUPPORTED');
    expect(() =>
      sanitizeHostedResourceJournal(
        `${event('RESOURCE_ADMITTED', { token: 'never-copy' })}\n${final()}`,
        runId,
      ),
    ).toThrow('JOURNAL_EVENT_FIELD_UNSUPPORTED');
    expect(() =>
      sanitizeHostedResourceJournal(
        `${event('RESOURCE_ADMITTED', { sample: { pressureLevel: 1, accessToken: 'never-copy' } })}\n${final()}`,
        runId,
      ),
    ).toThrow('JOURNAL_EVENT_VALUE_UNSUPPORTED');
    expect(() =>
      sanitizeHostedResourceJournal(
        `${event('RESOURCE_PREFLIGHT_REFUSED', {
          sample: {},
          cpuBusySamples: [],
          reasons: [],
          swapWindowSeconds: 60,
          detail: 'unexpected path or secret',
          processEvidence: [{ pid: 8124 }],
        })}\n${final()}`,
        runId,
      ),
    ).toThrow('JOURNAL_EVENT_FIELD_UNSUPPORTED');
    expect(() =>
      sanitizeHostedResourceJournal(
        `${event('RESOURCE_JOB_EXIT', { childExitCode: null, childSignal: null, childError: 'sensitive path' })}\n${final()}`,
        runId,
      ),
    ).toThrow('JOURNAL_EVENT_FIELD_UNSUPPORTED');
  });

  it('writes a new private sanitized copy and refuses source aliases or existing outputs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'resource-journal-copy-'));
    const sourcePath = join(directory, 'source.jsonl');
    const outputPath = join(directory, 'shared.jsonl');
    const source = `${event('RESOURCE_JOURNAL_OPENED', { path: sourcePath })}\n${event('RESOURCE_ADMITTED', { mode: 'run' })}\n${event('RESOURCE_STARTUP_INTERVAL_BRACKET', { bracket: startupBracket })}\n${final()}\n`;
    const expected = `${event('RESOURCE_JOURNAL_OPENED')}\n${event('RESOURCE_ADMITTED', { mode: 'run' })}\n${final()}\n`;
    try {
      await writeFile(sourcePath, source, { mode: 0o600 });
      await expect(
        copyHostedResourceJournal({ runId, sourcePath, outputPath: sourcePath }),
      ).rejects.toMatchObject({ code: 'SOURCE_OUTPUT_SAME' });

      expect(await copyHostedResourceJournal({ runId, sourcePath, outputPath })).toBe(outputPath);
      expect(await readFile(outputPath, 'utf8')).toBe(expected);
      expect(await readFile(sourcePath, 'utf8')).toBe(source);
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);

      await expect(
        copyHostedResourceJournal({ runId, sourcePath, outputPath }),
      ).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(outputPath, 'utf8')).toBe(expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
