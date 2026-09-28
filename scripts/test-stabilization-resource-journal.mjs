import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { openResourceJournal } from './stabilization-resource-journal.mjs';

const repo = resolve(import.meta.dirname, '..');
const journalPath = (runId) => resolve(repo, 'docs/stabilization/resource-journals', `${runId}.jsonl`);

test('a refused guard launch durably records its exact run and terminal decision before any permit', async () => {
  const runId = `journal-refusal-${randomUUID()}`;
  const path = journalPath(runId);
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/stabilization-resource.mjs', 'run', '--run-id', runId, '--', 'node', '-e', 'secret'],
      { cwd: repo, encoding: 'utf8' },
    );
    assert.equal(result.status, 2);
    const events = (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.map((event) => event.code), [
      'RESOURCE_JOURNAL_OPENED',
      'RESOURCE_COMMAND_NOT_ALLOWED:see docs/stabilization/resource-policy.json',
      'RESOURCE_FINAL_DECISION',
    ]);
    assert(events.every((event) => event.runId === runId));
    assert.deepEqual(events.at(-1), {
      schema: 1,
      at: events.at(-1).at,
      runId,
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
      ['scripts/stabilization-resource.mjs', 'run', '--run-id', runId, '--', 'node', '-e', 'secret'],
      { cwd: repo, encoding: 'utf8' },
    );
    assert.equal(duplicate.status, 2);
    assert.match(duplicate.stdout, /RESOURCE_RUN_ID_ALREADY_JOURNALED/);
    assert.deepEqual(await readFile(path), before);
  } finally {
    await rm(path, { force: true });
  }
});

test('journal writes only guard fields and refuses overwrite', async () => {
  const runId = `journal-fields-${randomUUID()}`;
  const path = journalPath(runId);
  const journal = openResourceJournal(repo, runId);
  try {
    journal.write({
      schema: 1, at: '2026-09-28T00:00:00.000Z', code: 'RESOURCE_WATCH_HEALTHY', runId,
      reasons: [], sample: { pressureLevel: 1 }, childStdout: 'private child output',
      detail: 'private detail',
    });
    assert.throws(() => openResourceJournal(repo, runId), /RESOURCE_RUN_ID_ALREADY_JOURNALED/);
    assert.deepEqual(JSON.parse((await readFile(path, 'utf8')).trim()), {
      schema: 1, at: '2026-09-28T00:00:00.000Z', code: 'RESOURCE_WATCH_HEALTHY', runId,
      reasons: [], sample: { pressureLevel: 1 },
    });
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
    assert.equal((await readFile(resolve(fixtureRepo, 'docs/stabilization/resource-journals', `${runId}.jsonl`), 'utf8')).includes('RESOURCE_ADMITTED'), true);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
