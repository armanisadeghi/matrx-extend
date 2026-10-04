import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

const RUN_ID = /^[A-Za-z0-9_.-]+$/;
const JOURNAL_FIELDS = new Set([
  'schema',
  'at',
  'code',
  'runId',
  'mode',
  'policySchema',
  'sample',
  'reasons',
  'cpuBusySamples',
  'swapWindowSeconds',
  'groupId',
  'reason',
  'signal',
  'resourceInvalid',
  'admitted',
  'exitCode',
  'decision',
  'instruction',
  'recovery',
  'previousRunId',
  'childExitCode',
  'childSignal',
  'processEvidence',
  'processes',
  'unavailable',
  'bracket',
]);

const BRACKET_LIMITATIONS = new Set([
  'ps CPU time displays centiseconds; snapshots bracket but do not equal the iostat interval. Exited, newly spawned, reparented, or PID-reused processes cannot be assigned exact interval CPU time.',
  'A process snapshot failed; no process attribution is available for this guard sample.',
  'Process bracket calculation failed; guard sampling is unchanged.',
]);
const BRACKET_CATEGORIES = ['ownedChromium', 'ownedOther', 'hostProvisioner', 'otherHost'];
const validTime = (value) =>
  value === null ||
  (typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)));
const validPid = (value) => Number.isSafeInteger(value) && value >= 0;
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
const validCpuTime = (value) => Number.isFinite(value) && value >= 0;
const safeExecutable = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.includes('/') &&
  !value.includes('\\') &&
  [...value].every((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  });

function sanitizeStartupBracket(bracket) {
  if (!bracket || typeof bracket !== 'object' || Array.isArray(bracket))
    throw new Error('invalid startup bracket');
  const timestamps = Object.fromEntries(
    [
      'iostatStartedAt',
      'iostatCompletedAt',
      'beforeStartedAt',
      'beforeCompletedAt',
      'afterStartedAt',
      'afterCompletedAt',
    ]
      .filter((key) => Object.hasOwn(bracket, key))
      .map((key) => {
        if (!validTime(bracket[key])) throw new Error('invalid startup time');
        return [key, bracket[key]];
      }),
  );
  if (bracket.unavailable === true) {
    if (Object.hasOwn(bracket, 'limitation') && !BRACKET_LIMITATIONS.has(bracket.limitation))
      throw new Error('invalid startup limitation');
    return {
      ...timestamps,
      unavailable: true,
      ...(bracket.limitation && { limitation: bracket.limitation }),
    };
  }
  if (
    Object.keys(timestamps).length !== 6 ||
    Object.values(timestamps).some((value) => value === null) ||
    bracket.resolutionSeconds !== 0.01 ||
    !BRACKET_LIMITATIONS.has(bracket.limitation) ||
    !['ownedAtStart', 'ownedAtEnd', 'exitedOrUnmatchedPids', 'appearedPids'].every(
      (key) => Array.isArray(bracket[key]) && bracket[key].every(validPid),
    ) ||
    !bracket.categoryTotalsSeconds ||
    !BRACKET_CATEGORIES.every((key) => validCpuTime(bracket.categoryTotalsSeconds[key])) ||
    !Array.isArray(bracket.observed) ||
    !validCount(bracket.otherHostObservedProcessCount)
  )
    throw new Error('invalid startup bracket');
  return {
    ...timestamps,
    resolutionSeconds: bracket.resolutionSeconds,
    ownedAtStart: [...bracket.ownedAtStart],
    ownedAtEnd: [...bracket.ownedAtEnd],
    exitedOrUnmatchedPids: [...bracket.exitedOrUnmatchedPids],
    appearedPids: [...bracket.appearedPids],
    categoryTotalsSeconds: Object.fromEntries(
      BRACKET_CATEGORIES.map((key) => [key, bracket.categoryTotalsSeconds[key]]),
    ),
    observed: bracket.observed.map(({ pid, executable, category, cpuSecondsDelta }) => {
      if (
        !validPid(pid) ||
        !safeExecutable(executable) ||
        !BRACKET_CATEGORIES.includes(category) ||
        !validCpuTime(cpuSecondsDelta)
      )
        throw new Error('invalid startup process');
      return { pid, executable, category, cpuSecondsDelta };
    }),
    otherHostObservedProcessCount: bracket.otherHostObservedProcessCount,
    limitation: bracket.limitation,
  };
}

// This writer receives guard-owned events only. Child stdout still goes directly
// to the caller's terminal and is never copied into the journal.
export function openResourceJournal(repo, runId, { closeFd = closeSync } = {}) {
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
  const finalPath = join(dir, `${runId}.jsonl`);
  const path = join(dir, `${runId}.pending.jsonl`);
  if (existsSync(finalPath)) throw new Error('RESOURCE_RUN_ID_ALREADY_JOURNALED');
  let fd;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (error) {
    throw new Error(
      error.code === 'EEXIST'
        ? 'RESOURCE_RUN_ID_ALREADY_JOURNALED'
        : 'RESOURCE_JOURNAL_OPEN_FAILED',
    );
  }
  return {
    path,
    write(event) {
      try {
        const safe = Object.fromEntries(
          Object.entries(event).filter(([key]) => JOURNAL_FIELDS.has(key)),
        );
        if (safe.code === 'RESOURCE_PROCESS_ATTRIBUTION') {
          const hasProcesses = Object.hasOwn(safe, 'processes');
          const hasUnavailable = Object.hasOwn(safe, 'unavailable');
          if (hasProcesses === hasUnavailable) throw new Error('invalid process attribution');
          if (hasUnavailable) {
            if (safe.unavailable !== true) throw new Error('invalid process availability');
          } else {
            if (!Array.isArray(safe.processes)) throw new Error('invalid process attribution');
            safe.processes = safe.processes.map(({ pid, parentPid, cpuPercent, executable }) => {
              if (
                ![pid, parentPid].every((value) => Number.isSafeInteger(value) && value >= 0) ||
                !Number.isFinite(cpuPercent) ||
                cpuPercent < 0 ||
                typeof executable !== 'string' ||
                executable.length === 0 ||
                executable.includes('/') ||
                executable.includes('\\') ||
                [...executable].some((character) => {
                  const code = character.charCodeAt(0);
                  return code < 32 || code === 127;
                })
              )
                throw new Error('invalid process attribution');
              return { pid, parentPid, cpuPercent, executable };
            });
          }
        } else if (Object.hasOwn(safe, 'processes') || Object.hasOwn(safe, 'unavailable')) {
          throw new Error('unexpected process attribution');
        }
        if (safe.code === 'RESOURCE_STARTUP_INTERVAL_BRACKET')
          safe.bracket = sanitizeStartupBracket(safe.bracket);
        else if (Object.hasOwn(safe, 'bracket')) throw new Error('unexpected startup bracket');
        if (safe.processEvidence) {
          const evidence = safe.processEvidence;
          if (
            !Array.isArray(evidence.matches) ||
            evidence.matches.length > 5 ||
            !Number.isSafeInteger(evidence.overflow) ||
            evidence.overflow < 0
          )
            throw new Error('invalid process evidence');
          safe.processEvidence = {
            matches: evidence.matches.map(({ pid, ppid, processStart, executable, reason }) => {
              if (
                ![pid, ppid].every((value) => Number.isSafeInteger(value) && value >= 0) ||
                !/^[A-Za-z]{3} [A-Za-z]{3} [\d ]\d \d\d:\d\d:\d\d \d{4}$/.test(processStart) ||
                executable !== 'node' ||
                !['script-operand', 'ambiguous-command', 'ambiguous-arguments'].includes(reason)
              )
                throw new Error('invalid process identity');
              return { pid, ppid, processStart, executable, reason };
            }),
            overflow: evidence.overflow,
          };
        }
        const bytes = Buffer.from(`${JSON.stringify(safe)}\n`);
        for (let offset = 0; offset < bytes.length; ) {
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
      // Publication is the commit point. A failed close leaves only the
      // pending file, so no completed journal can claim a valid exit.
      closeFd(fd);
      linkSync(path, finalPath);
      try {
        unlinkSync(path);
      } catch {
        return { pendingCleanupFailed: true };
      }
      return { pendingCleanupFailed: false };
    },
  };
}
