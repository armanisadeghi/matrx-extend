#!/usr/bin/env node
/** Copy supported hosted journal events after removing process attribution.
 * Unknown events/fields are refused so diagnostic payloads stay in the private source artifact.
 */
import { open, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FINAL_DECISIONS = new Set(['refused', 'invalid', 'valid', 'child_failed', 'interrupted']);
const COMMON_FIELDS = ['schema', 'at', 'runId', 'code'];
const SAMPLE_FIELDS = new Set([
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
]);
const EVENT_FIELDS = new Map([
  ['RESOURCE_JOURNAL_OPENED', ['path']],
  ['RESOURCE_PREFLIGHT_REFUSED', ['sample', 'cpuBusySamples', 'reasons', 'swapWindowSeconds']],
  ['RESOURCE_STOP_REQUESTED', ['signal']],
  [
    'RESOURCE_ADMITTED',
    ['mode', 'policySchema', 'sample', 'cpuBusySamples', 'reasons', 'swapWindowSeconds'],
  ],
  ['RESOURCE_BROWSER_STOP_CONFIRMED', ['resourceInvalid']],
  ['RESOURCE_JOB_EXIT', ['childExitCode', 'childSignal']],
  ['RESOURCE_COMPLETION_RECOVERY_PENDING', []],
  ['RESOURCE_CPU_PENDING', ['reasons', 'sample']],
  ['RESOURCE_WATCH_UNSAFE', ['reasons', 'sample']],
  ['RESOURCE_CPU_RECOVERED', ['reasons', 'sample']],
  ['RESOURCE_WATCH_HEALTHY', ['reasons', 'sample']],
  ['RESOURCE_PROCESS_ATTRIBUTION', ['processes', 'unavailable']],
  ['RESOURCE_STOP_AT_SAFE_BOUNDARY', ['reasons']],
  ['RESOURCE_BROWSER_OPERATOR_STOP_REQUIRED', ['instruction']],
  ['RESOURCE_RECOVERY_SAMPLES_READY', ['previousRunId']],
  ['RESOURCE_OWNED_PROCESS_STILL_RUNNING', ['recovery']],
  ['RESOURCE_GROUP_STILL_RUNNING', ['groupId']],
  ['RESOURCE_SAFETY_STATE_WRITE_FAILED', []],
  ['RESOURCE_GROUP_STOP_REQUESTED', ['groupId', 'reason', 'signal']],
  ['RESOURCE_GROUP_ESCALATED', ['groupId', 'signal']],
  ['RESOURCE_OWNERLESS_RETIRED', ['root']],
  ['RESOURCE_BROWSER_LEASE_RETIRED', []],
  ['RESOURCE_FINAL_DECISION', ['admitted', 'resourceInvalid', 'exitCode', 'decision']],
]);

function refuse(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validFinalDecision(event) {
  if (
    !event ||
    event.schema !== 1 ||
    event.code !== 'RESOURCE_FINAL_DECISION' ||
    typeof event.runId !== 'string' ||
    typeof event.admitted !== 'boolean' ||
    typeof event.resourceInvalid !== 'boolean' ||
    !Number.isSafeInteger(event.exitCode) ||
    !FINAL_DECISIONS.has(event.decision)
  )
    return false;

  if (event.decision === 'refused')
    return event.admitted === false && event.resourceInvalid === false && event.exitCode !== 0;
  if (event.decision === 'invalid')
    return event.admitted === true && event.resourceInvalid === true && event.exitCode !== 0;
  if (event.decision === 'valid')
    return event.admitted === true && event.resourceInvalid === false && event.exitCode === 0;
  return event.admitted === true && event.resourceInvalid === false && event.exitCode !== 0;
}

function validKnownValues(event) {
  if (event.sample !== undefined) {
    if (
      !event.sample ||
      typeof event.sample !== 'object' ||
      Array.isArray(event.sample) ||
      Object.keys(event.sample).some((key) => !SAMPLE_FIELDS.has(key)) ||
      Object.values(event.sample).some(
        (value) => typeof value !== 'number' || !Number.isFinite(value),
      )
    )
      return false;
  }
  if (
    event.reasons !== undefined &&
    (!Array.isArray(event.reasons) ||
      event.reasons.some((reason) => typeof reason !== 'string' || !reason.startsWith('RESOURCE_')))
  )
    return false;
  if (
    event.cpuBusySamples !== undefined &&
    (!Array.isArray(event.cpuBusySamples) ||
      event.cpuBusySamples.some((value) => typeof value !== 'number' || !Number.isFinite(value)))
  )
    return false;
  return true;
}

/** Remove only process-attribution rows, keeping every other source line byte-for-byte. */
export function sanitizeHostedResourceJournal(source, runId) {
  if (typeof source !== 'string' || !source) refuse('SOURCE_CONTENT_INVALID');
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(runId)) refuse('RUN_ID_INVALID');

  const chunks = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const records = [];
  let finalCount = 0;
  let finalRecordIndex = -1;
  const kept = [];

  for (const chunk of chunks) {
    const line = chunk.replace(/\r?\n$/, '');
    if (!line.trim()) {
      kept.push(chunk);
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      refuse('JOURNAL_JSON_INVALID');
    }
    if (
      !event ||
      typeof event !== 'object' ||
      Array.isArray(event) ||
      event.schema !== 1 ||
      typeof event.at !== 'string' ||
      event.runId !== runId ||
      typeof event.code !== 'string' ||
      !event.code.startsWith('RESOURCE_')
    )
      refuse('JOURNAL_EVENT_INVALID');
    const allowedFields = EVENT_FIELDS.get(event.code);
    if (!allowedFields) refuse('JOURNAL_EVENT_UNSUPPORTED');
    const allowedKeys = new Set([...COMMON_FIELDS, ...allowedFields]);
    if (Object.keys(event).some((key) => !allowedKeys.has(key)))
      refuse('JOURNAL_EVENT_FIELD_UNSUPPORTED');
    if (!validKnownValues(event)) refuse('JOURNAL_EVENT_VALUE_UNSUPPORTED');

    records.push(event);
    if (event.code === 'RESOURCE_FINAL_DECISION') {
      finalCount += 1;
      finalRecordIndex = records.length - 1;
      if (!validFinalDecision(event)) refuse('JOURNAL_FINAL_DECISION_INVALID');
    }
    if (event.code !== 'RESOURCE_PROCESS_ATTRIBUTION') kept.push(chunk);
  }

  if (finalCount === 0) refuse('JOURNAL_FINAL_DECISION_MISSING');
  if (finalCount !== 1) refuse('JOURNAL_FINAL_DECISION_DUPLICATE');
  if (finalRecordIndex !== records.length - 1) refuse('JOURNAL_FINAL_DECISION_NOT_LAST');
  return kept.join('');
}

function cliArgs(argv) {
  const allowed = new Set(['--run-id', '--source', '--output']);
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!allowed.has(argv[index]) || !argv[index + 1] || args.has(argv[index]))
      refuse('ARGUMENT_INVALID');
    args.set(argv[index], argv[index + 1]);
  }
  if (args.size !== allowed.size) refuse('ARGUMENT_INVALID');
  return {
    runId: args.get('--run-id'),
    sourcePath: args.get('--source'),
    outputPath: args.get('--output'),
  };
}

export async function copyHostedResourceJournal({ runId, sourcePath, outputPath }) {
  if (typeof sourcePath !== 'string' || typeof outputPath !== 'string')
    refuse('SOURCE_PATH_INVALID');
  const sourceReal = await realpath(sourcePath);
  const output = resolve(outputPath);
  const outputReal = await realpath(output).catch(() => null);
  if (sourceReal === output || sourceReal === outputReal) refuse('SOURCE_OUTPUT_SAME');
  const source = await readFile(sourceReal, 'utf8');
  const sanitized = sanitizeHostedResourceJournal(source, runId);
  const handle = await open(output, 'wx', 0o600);
  try {
    await handle.writeFile(sanitized);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await copyHostedResourceJournal(cliArgs(process.argv.slice(2)));
    process.stdout.write('SANITIZED_RESOURCE_JOURNAL_COPIED\n');
  } catch (error) {
    process.stderr.write(`RESOURCE_JOURNAL_COPY_REFUSED ${error?.code ?? 'SOURCE_UNAVAILABLE'}\n`);
    process.exitCode = 1;
  }
}
