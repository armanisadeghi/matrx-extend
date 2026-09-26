#!/usr/bin/env node
/** Record file-bound guard/result provenance without copying private result data. */
import { createHash } from 'node:crypto';
import { open, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RUN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/;
const RESULT_STATUSES = new Set(['pass', 'partial', 'unverified', 'fail', 'diagnostic_only']);
const TERMINAL_GUARD_FAILURES = new Set([
  'RESOURCE_OWNED_PROCESS_STILL_RUNNING',
  'RESOURCE_GROUP_STILL_RUNNING',
  'RESOURCE_GROUP_UNCONFIRMED',
  'RESOURCE_STOP_AT_SAFE_BOUNDARY',
]);

function refuse(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function guardEvent(line) {
  try {
    const event = JSON.parse(line);
    return event &&
      typeof event === 'object' &&
      event.schema === 1 &&
      typeof event.code === 'string' &&
      event.code.startsWith('RESOURCE_')
      ? event
      : null;
  } catch {
    // Child stdout is not a guard event and must never enter the receipt.
    return null;
  }
}

function guardSummary(bytes, runId) {
  const events = bytes.toString('utf8').split(/\r?\n/).map(guardEvent).filter(Boolean);
  if (events.some((event) => event.runId !== undefined && event.runId !== runId))
    refuse('GUARD_RUN_ID_MISMATCH');
  if (events.some((event) => TERMINAL_GUARD_FAILURES.has(event.code)))
    refuse('GUARD_TERMINAL_FAILURE');
  if (events.some((event) => event.runId !== runId)) refuse('GUARD_RUN_ID_MISMATCH');
  const admitted = events.filter((event) => event.code === 'RESOURCE_ADMITTED');
  const exits = events.filter((event) => event.code === 'RESOURCE_JOB_EXIT');
  if (admitted.length !== 1 || exits.length !== 1) refuse('GUARD_EVENTS_MISSING_OR_DUPLICATE');
  const validTime = (value) =>
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT/.test(value) &&
    value.endsWith('Z') &&
    Number.isFinite(Date.parse(value));
  if (
    !validTime(admitted[0].at) ||
    !validTime(exits[0].at) ||
    Date.parse(admitted[0].at) > Date.parse(exits[0].at) ||
    !Number.isInteger(exits[0].childExitCode) ||
    exits[0].childExitCode < 0
  )
    refuse('GUARD_METADATA_INVALID');
  return {
    admitted_at: admitted[0].at,
    child_exit_at: exits[0].at,
    child_exit_code: exits[0].childExitCode,
  };
}

function safeResultSummary(bytes) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    refuse('RESULT_JSON_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) refuse('RESULT_JSON_INVALID');
  const build =
    parsed.build && typeof parsed.build === 'object' && !Array.isArray(parsed.build)
      ? parsed.build
      : null;
  const version = build?.version;
  const tree = build?.treeSha256 ?? build?.tree_sha256;
  return {
    status: RESULT_STATUSES.has(parsed.status) ? parsed.status : 'unclassified',
    build: build
      ? {
          version: typeof version === 'string' && VERSION.test(version) ? version : null,
          tree_sha256: typeof tree === 'string' && SHA256.test(tree) ? tree : null,
        }
      : null,
  };
}

export async function buildEvidenceRecord({ runId, guardLogPath, resultPath }) {
  if (!RUN_ID.test(runId ?? '')) refuse('RUN_ID_INVALID');
  if (typeof guardLogPath !== 'string' || typeof resultPath !== 'string')
    refuse('SOURCE_PATH_INVALID');
  const [guardReal, resultReal] = await Promise.all([realpath(guardLogPath), realpath(resultPath)]);
  if (guardReal === resultReal) refuse('SOURCE_FILES_NOT_DISTINCT');
  const [guardBytes, resultBytes] = await Promise.all([readFile(guardReal), readFile(resultReal)]);
  const guard = guardSummary(guardBytes, runId);
  const rawResult = safeResultSummary(resultBytes);
  if (guard.child_exit_code !== 0 && rawResult.status === 'pass')
    refuse('RESULT_GUARD_CONTRADICTION');
  return {
    schema_version: 1,
    run_id: runId,
    source: {
      guard_log_path: guardLogPath,
      guard_log_sha256: digest(guardBytes),
      raw_result_path: resultPath,
      raw_result_sha256: digest(resultBytes),
    },
    guard,
    raw_result: rawResult,
    execution_evidence: {
      child_exit: guard.child_exit_code === 0 ? 'zero' : 'nonzero',
      wrapper_completion: 'unverified_from_guard_log',
      overall_acceptance: 'not_adjudicated',
    },
  };
}

export async function writeEvidenceRecord({ runId, guardLogPath, resultPath, outputPath }) {
  if (typeof outputPath !== 'string' || !outputPath) refuse('OUTPUT_PATH_INVALID');
  const [guardReal, resultReal] = await Promise.all([realpath(guardLogPath), realpath(resultPath)]);
  const output = resolve(outputPath);
  if (output === guardReal || output === resultReal) refuse('OUTPUT_OVERLAPS_SOURCE');
  const record = await buildEvidenceRecord({ runId, guardLogPath, resultPath });
  const handle = await open(output, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return record;
}

function cliArgs(argv) {
  const allowed = new Set(['--run-id', '--guard-log', '--result', '--output']);
  const args = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.has(argv[i]) || !argv[i + 1] || args.has(argv[i])) refuse('ARGUMENT_INVALID');
    args.set(argv[i], argv[i + 1]);
  }
  if (args.size !== allowed.size) refuse('ARGUMENT_INVALID');
  return {
    runId: args.get('--run-id'),
    guardLogPath: args.get('--guard-log'),
    resultPath: args.get('--result'),
    outputPath: args.get('--output'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await writeEvidenceRecord(cliArgs(process.argv.slice(2)));
    process.stdout.write('EVIDENCE_RECORDED\n');
  } catch (error) {
    process.stderr.write(`EVIDENCE_REFUSED ${error?.code ?? 'SOURCE_UNAVAILABLE'}\n`);
    process.exitCode = 1;
  }
}
