import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
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
