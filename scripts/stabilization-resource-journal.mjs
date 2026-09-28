import {
  closeSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, writeSync,
} from 'node:fs';
import { join } from 'node:path';

const RUN_ID = /^[A-Za-z0-9_.-]+$/;
const JOURNAL_FIELDS = new Set([
  'schema', 'at', 'code', 'runId', 'mode', 'policySchema', 'sample',
  'reasons', 'cpuBusySamples', 'swapWindowSeconds', 'groupId', 'reason',
  'signal', 'resourceInvalid', 'exitCode', 'decision', 'instruction',
  'recovery', 'previousRunId', 'childExitCode', 'childSignal',
]);

// This writer receives guard-owned events only. Child stdout still goes directly
// to the caller's terminal and is never copied into the journal.
export function openResourceJournal(repo, runId) {
  if (!runId || !RUN_ID.test(runId)) throw new Error('RESOURCE_RUN_ID_INVALID');
  const canonicalRepo = realpathSync(repo);
  const parent = join(canonicalRepo, 'docs/stabilization');
  if (realpathSync(parent) !== parent) throw new Error('RESOURCE_JOURNAL_PATH_INVALID');
  const dir = join(parent, 'resource-journals');
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw new Error('RESOURCE_JOURNAL_OPEN_FAILED');
  }
  if (!lstatSync(dir).isDirectory() || realpathSync(dir) !== dir)
    throw new Error('RESOURCE_JOURNAL_PATH_INVALID');
  const path = join(dir, `${runId}.jsonl`);
  let fd;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (error) {
    throw new Error(
      error.code === 'EEXIST' ? 'RESOURCE_RUN_ID_ALREADY_JOURNALED' : 'RESOURCE_JOURNAL_OPEN_FAILED',
    );
  }
  return {
    path,
    write(event) {
      try {
        const safe = Object.fromEntries(
          Object.entries(event).filter(([key]) => JOURNAL_FIELDS.has(key)),
        );
        const bytes = Buffer.from(`${JSON.stringify(safe)}\n`);
        for (let offset = 0; offset < bytes.length;) {
          const written = writeSync(fd, bytes, offset, bytes.length - offset);
          if (written <= 0) throw new Error('short journal write');
          offset += written;
        }
        fsyncSync(fd);
      } catch {
        throw new Error('RESOURCE_JOURNAL_WRITE_FAILED');
      }
    },
    close() {
      closeSync(fd);
    },
  };
}
