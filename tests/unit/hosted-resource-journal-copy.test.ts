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

const final = (fields: Record<string, unknown> = {}) =>
  event('RESOURCE_FINAL_DECISION', {
    admitted: true,
    resourceInvalid: false,
    exitCode: 1,
    decision: 'child_failed',
    ...fields,
  });

describe('hosted resource journal evidence copy', () => {
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
        `${event('RESOURCE_STARTUP_INTERVAL_BRACKET', { bracket: { pid: 8124 } })}\n${final()}`,
        runId,
      ),
    ).toThrow('JOURNAL_EVENT_UNSUPPORTED');
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
    const source = `${event('RESOURCE_JOURNAL_OPENED', { path: sourcePath })}\n${event('RESOURCE_ADMITTED', { mode: 'run' })}\n${final()}\n`;
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
