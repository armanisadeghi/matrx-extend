import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeEvidenceRecord } from '../../scripts/record-stabilization-evidence.mjs';

const temporaryDirectories: string[] = [];
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function fixtures(
  guardRunId: string,
  options: { childExitCode?: number; resultStatus?: string; afterExitCode?: string } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'matrx-evidence-test-'));
  temporaryDirectories.push(directory);
  const guardLogPath = join(directory, 'guard.log');
  const resultPath = join(directory, 'private-result.json');
  const outputPath = join(directory, 'receipt.json');
  const guard = [
    JSON.stringify({
      schema: 1,
      at: '2026-09-26T23:30:50.404Z',
      runId: guardRunId,
      mode: 'run',
      code: 'RESOURCE_ADMITTED',
    }),
    'PRIVATE CHILD STDOUT MUST NOT ENTER RECEIPT',
    JSON.stringify({
      schema: 1,
      at: '2026-09-26T23:30:54.094Z',
      runId: guardRunId,
      childExitCode: options.childExitCode ?? 0,
      code: 'RESOURCE_JOB_EXIT',
    }),
    ...(options.afterExitCode
      ? [
          JSON.stringify({
            schema: 1,
            at: '2026-09-26T23:30:55.000Z',
            runId: guardRunId,
            code: options.afterExitCode,
          }),
        ]
      : []),
  ].join('\n');
  const result = JSON.stringify({
    status: options.resultStatus ?? 'partial',
    build: { version: '0.2.79', treeSha256: 'a'.repeat(64) },
    privatePayload: 'PRIVATE RESULT MUST NOT ENTER RECEIPT',
  });
  await Promise.all([writeFile(guardLogPath, guard), writeFile(resultPath, result)]);
  return { guardLogPath, resultPath, outputPath, guard, result };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('stabilization evidence record', () => {
  it('refuses a guard log from another run before creating a receipt', async () => {
    const fixture = await fixtures('debug-log-controls-006');
    await expect(
      writeEvidenceRecord({ runId: 'screenshot-guest-001', ...fixture }),
    ).rejects.toMatchObject({ code: 'GUARD_RUN_ID_MISMATCH' });
    await expect(access(fixture.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('hashes each distinct raw file and writes only bounded metadata', async () => {
    const fixture = await fixtures('screenshot-guest-001');
    const record = await writeEvidenceRecord({ runId: 'screenshot-guest-001', ...fixture });
    expect(record.source.guard_log_sha256).toBe(sha256(fixture.guard));
    expect(record.source.raw_result_sha256).toBe(sha256(fixture.result));
    expect(record.source.guard_log_sha256).not.toBe(record.source.raw_result_sha256);
    expect(record.guard.child_exit_code).toBe(0);
    expect(record.raw_result).toEqual({
      status: 'partial',
      build: { version: '0.2.79', tree_sha256: 'a'.repeat(64) },
    });
    expect(record.execution_evidence).toEqual({
      child_exit: 'zero',
      wrapper_completion: 'unverified_from_guard_log',
      overall_acceptance: 'not_adjudicated',
    });
    const saved = await readFile(fixture.outputPath, 'utf8');
    expect(saved).not.toContain('PRIVATE CHILD STDOUT');
    expect(saved).not.toContain('PRIVATE RESULT');
    await expect(
      writeEvidenceRecord({ runId: 'screenshot-guest-001', ...fixture }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('refuses a post-child owned-process cleanup failure', async () => {
    const fixture = await fixtures('screenshot-guest-001', {
      afterExitCode: 'RESOURCE_OWNED_PROCESS_STILL_RUNNING',
    });
    await expect(
      writeEvidenceRecord({ runId: 'screenshot-guest-001', ...fixture }),
    ).rejects.toMatchObject({ code: 'GUARD_TERMINAL_FAILURE' });
    await expect(access(fixture.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a raw pass contradicted by a nonzero child exit', async () => {
    const fixture = await fixtures('screenshot-guest-001', {
      childExitCode: 1,
      resultStatus: 'pass',
    });
    await expect(
      writeEvidenceRecord({ runId: 'screenshot-guest-001', ...fixture }),
    ).rejects.toMatchObject({ code: 'RESULT_GUARD_CONTRADICTION' });
    await expect(access(fixture.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('classifies a nonzero child with a failed raw result without claiming wrapper success', async () => {
    const fixture = await fixtures('screenshot-guest-001', {
      childExitCode: 1,
      resultStatus: 'fail',
    });
    const record = await writeEvidenceRecord({ runId: 'screenshot-guest-001', ...fixture });
    expect(record.raw_result.status).toBe('fail');
    expect(record.execution_evidence).toEqual({
      child_exit: 'nonzero',
      wrapper_completion: 'unverified_from_guard_log',
      overall_acceptance: 'not_adjudicated',
    });
  });
});
