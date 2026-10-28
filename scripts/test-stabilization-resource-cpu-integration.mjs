import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  requireNativeResourceHealth,
  runNativeResourceAction,
} from '../tests/browser/native-resource-boundary.mjs';
import {
  copyResourceGuardModules,
  setHealthyHostMeasurements,
} from './stabilization-resource-test-measurements.mjs';

const source = resolve(import.meta.dirname, '..');
const watchCodes = new Set([
  'RESOURCE_CPU_PENDING',
  'RESOURCE_CPU_RECOVERED',
  'RESOURCE_WATCH_HEALTHY',
  'RESOURCE_WATCH_UNSAFE',
]);
const safeReasonCodes = new Set([
  'RESOURCE_PRESSURE_UNSAFE',
  'RESOURCE_MEMORY_LOW',
  'RESOURCE_CPU_BUSY',
  'RESOURCE_CPU_HIGH_LOAD_BUSY',
  'RESOURCE_DISK_LOW',
  'RESOURCE_SWAP_BASELINE_MISSING',
  'RESOURCE_SWAP_GROWTH',
  'RESOURCE_CPU_CONFIRMATION_EXPIRED',
]);
const safeEventCodes = new Set([
  ...watchCodes,
  ...safeReasonCodes,
  'RESOURCE_ADMITTED',
  'RESOURCE_BROWSER_LEASE_RETIRED',
  'RESOURCE_BROWSER_OPERATOR_STOP_REQUIRED',
  'RESOURCE_BROWSER_STOP_CONFIRMED',
  'RESOURCE_COMPLETION_RECOVERY_PENDING',
  'RESOURCE_FINAL_DECISION',
  'RESOURCE_GROUP_ESCALATED',
  'RESOURCE_GROUP_STILL_RUNNING',
  'RESOURCE_GROUP_STOP_REQUESTED',
  'RESOURCE_GROUP_UNCONFIRMED',
  'RESOURCE_GROUP_CENSUS_INVALID',
  'RESOURCE_GROUP_SIGNAL_EPERM_CENSUS',
  'RESOURCE_GROUP_SIGNAL_UNCONFIRMED',
  'RESOURCE_JOB_EXIT',
  'RESOURCE_JOURNAL_OPENED',
  'RESOURCE_MEASUREMENT_FAILED',
  'RESOURCE_MEASUREMENT_INVALID',
  'RESOURCE_OWNED_PROCESS_STILL_RUNNING',
  'RESOURCE_OWNER_CHANGED',
  'RESOURCE_PROCESS_ATTRIBUTION',
  'RESOURCE_RECOVERY_SAMPLES_READY',
  'RESOURCE_SAFETY_STATE_WRITE_FAILED',
  'RESOURCE_STARTUP_INTERVAL_BRACKET',
  'RESOURCE_STOP_AT_SAFE_BOUNDARY',
  'RESOURCE_STOP_REQUESTED',
  'RESOURCE_UNSAFE_HOLD',
]);

function diagnosticReasonCode(reason) {
  if (safeReasonCodes.has(reason)) return reason;
  if (typeof reason === 'string' && reason.startsWith('RESOURCE_MEASUREMENT_FAILED:'))
    return 'RESOURCE_MEASUREMENT_FAILED';
  return 'RESOURCE_REASON_OTHER';
}

const safeDiagnosticStages = new Set([
  'watchdog_group_stop',
  'owned_process_census',
  'final_group_check',
  'attribution_settle',
  'lease_release',
]);
const safeDiagnosticResourceCodes = new Set([
  'RESOURCE_GROUP_CENSUS_INVALID',
  'RESOURCE_GROUP_UNCONFIRMED',
  'RESOURCE_GROUP_STILL_RUNNING',
  'RESOURCE_MEASUREMENT_FAILED',
  'RESOURCE_MEASUREMENT_INVALID',
  'RESOURCE_OWNER_CHANGED',
  'RESOURCE_OWNED_PROCESS_STILL_RUNNING',
]);
const safeDiagnosticOsCodes = new Set([
  'EACCES',
  'EBUSY',
  'EIO',
  'EINVAL',
  'EPIPE',
  'ETIMEDOUT',
  'ENOENT',
  'ENOTEMPTY',
  'EPERM',
  'ESRCH',
]);
const safeDiagnosticErrorNames = new Set(['Error', 'TypeError', 'RangeError', 'SystemError']);
const groupSignalEventCodes = new Set([
  'RESOURCE_GROUP_SIGNAL_EPERM_CENSUS',
  'RESOURCE_GROUP_SIGNAL_UNCONFIRMED',
]);
const groupSignalErrorClasses = new Set([...safeDiagnosticErrorNames, 'Other']);
const safeDiagnosticStderrCodes = new Set([
  'RESOURCE_GROUP_STOP_REQUESTED',
  'RESOURCE_GROUP_ESCALATED',
  'RESOURCE_JOURNAL_WRITE_FAILED',
  'RESOURCE_SAFETY_STATE_WRITE_FAILED',
]);

function safeStderrSummary(stderr) {
  const codes = stderr.match(/RESOURCE_[A-Z0-9_]+/g) ?? [];
  return [...new Set(codes.filter((code) => safeDiagnosticStderrCodes.has(code)))];
}

function safeFailureSummary(event) {
  if (!event || event.code !== 'RESOURCE_MEASUREMENT_FAILED') return null;
  const summary = event.syntheticDiagnostic;
  if (!summary || typeof summary !== 'object') return { stage: 'unknown', errorClass: 'unknown' };
  return {
    stage: safeDiagnosticStages.has(summary.stage) ? summary.stage : 'unknown',
    errorClass: safeDiagnosticErrorNames.has(summary.errorClass) ? summary.errorClass : 'Other',
    ...(safeDiagnosticResourceCodes.has(summary.resourceCode) && {
      resourceCode: summary.resourceCode,
    }),
    ...(safeDiagnosticOsCodes.has(summary.osCode) && { osCode: summary.osCode }),
    ...(Number.isInteger(summary.commandExitCode) &&
      summary.commandExitCode >= 0 &&
      summary.commandExitCode <= 255 && {
        commandExitCode: summary.commandExitCode,
      }),
    ...(summary.commandKind === 'ps' || summary.commandKind === 'sysctl'
      ? { commandKind: summary.commandKind }
      : {}),
  };
}

function safeEventSummary(event) {
  const groupSignalEvent = groupSignalEventCodes.has(event?.code);
  return {
    code: safeEventCodes.has(event?.code) ? event.code : 'OTHER_EVENT',
    ...(Array.isArray(event?.reasons) && {
      reasons: [...new Set(event.reasons.slice(0, 10).map(diagnosticReasonCode))],
    }),
    ...((event?.childExitCode === null ||
      (Number.isInteger(event?.childExitCode) &&
        event.childExitCode >= 0 &&
        event.childExitCode <= 255)) && {
      childExitCode: event.childExitCode,
    }),
    ...(groupSignalEvent &&
      ['SIGTERM', 'SIGKILL'].includes(event?.signal) && {
        signal: event.signal,
      }),
    ...(groupSignalEvent &&
      groupSignalErrorClasses.has(event?.errorClass) && {
        errorClass: event.errorClass,
      }),
    ...(groupSignalEvent && safeDiagnosticOsCodes.has(event?.osCode) && { osCode: event.osCode }),
    ...(groupSignalEvent &&
      typeof event?.freshZeroProof === 'boolean' && {
        freshZeroProof: event.freshZeroProof,
      }),
    ...(groupSignalEvent &&
      groupSignalErrorClasses.has(event?.censusErrorClass) && {
        censusErrorClass: event.censusErrorClass,
      }),
    ...(groupSignalEvent &&
      safeDiagnosticOsCodes.has(event?.censusOsCode) && {
        censusOsCode: event.censusOsCode,
      }),
    ...(groupSignalEvent &&
      event?.censusResourceCode === 'RESOURCE_GROUP_CENSUS_INVALID' && {
        censusResourceCode: event.censusResourceCode,
      }),
    ...(safeFailureSummary(event) && {
      failure: safeFailureSummary(event),
    }),
  };
}

async function fixture({
  pauseOwnerRewrite = false,
  simulateChildError = false,
  simulateAttributionError = false,
  groupSignalMode = null,
  bracketMode = null,
  bracketMutation = null,
  bracketFailure = null,
} = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'resource-cpu-wrapper-'));
  const scripts = join(scratch, 'scripts');
  const docs = join(scratch, 'docs/stabilization');
  const leaseRoot = join(scratch, 'lease');
  const cpuPhase = join(scratch, 'cpu-phase');
  const memoryPhase = join(scratch, 'memory-phase');
  const childPhase = join(scratch, 'child-phase');
  const ownerRewriteRelease = join(scratch, 'owner-rewrite-release');
  await mkdir(scripts);
  await mkdir(docs, { recursive: true });
  await copyResourceGuardModules(join(source, 'scripts'), scripts);
  await setHealthyHostMeasurements(scripts);
  const guardPath = join(scripts, 'stabilization-resource.mjs');
  let guardSource = await readFile(guardPath, 'utf8');
  if (bracketMode) {
    // Preserve the production CPU parser and bracket; replace only external telemetry.
    guardSource = guardSource.replace('Promise.resolve(0.1),', 'cpuBusyFraction(cpuOutput),');
    const sampleEntry = 'async function sample(profileDir, attributionRootPid) {';
    assert.equal(guardSource.split(sampleEntry).length, 2);
    guardSource = guardSource.replace(
      sampleEntry,
      `${sampleEntry}\n  syntheticRoot = attributionRootPid;`,
    );
    const outputStart = 'const output = async (cmd, args) =>\n';
    assert.equal(guardSource.split(outputStart).length, 2);
    guardSource = guardSource.replace(
      outputStart,
      `let psReads = 0;
let syntheticRoot;
const output = async (cmd, args) => {
  if (cmd === '/usr/sbin/iostat') {
    const busy = Number((await readFile(${JSON.stringify(cpuPhase)}, 'utf8')).trim());
    return 'cpu load average\\n us sy id 1m 5m 15m\\n 5 5 90 0.5 0.5 0.5\\n ' + Math.round(busy * 100) + ' 0 ' + (100 - Math.round(busy * 100)) + ' 0.5 0.5 0.5';
  }
  if (cmd === '/bin/ps' && JSON.stringify(args) === JSON.stringify(['-A', '-o', 'pid=,ppid=,time=,ucomm='])) {
    psReads++;
    if (${JSON.stringify(bracketMode)} === 'before-fail' && psReads % 2 === 1) throw new Error('ps unavailable');
    if (${JSON.stringify(bracketMode)} === 'after-fail' && psReads % 2 === 0) throw new Error('ps unavailable');
    if (${JSON.stringify(bracketMode)} === 'malformed') return 'malformed';
    return psReads % 2 === 1 ? syntheticRoot + ' 1 0:01.00 node\\n1 0 0:02.00 launchd' : syntheticRoot + ' 1 0:03.00 node\\n1 0 0:05.00 launchd';
  }
  return (
    await run(cmd, args, { timeout: 5000, maxBuffer: policy.processSnapshotMaxBytes })
  ).stdout.trim();
};
const unusedOriginalOutput = async (cmd, args) =>\n`,
    );
  }
  if (bracketMode === 'calculation-fail') {
    const calculation = 'processTimeBracket(before.processes, after.processes, attributionRootPid)';
    assert.equal(guardSource.split(calculation).length, 2);
    guardSource = guardSource.replace(
      calculation,
      "(() => { throw new Error('calculation unavailable'); })()",
    );
  }
  if (bracketFailure === 'write') {
    const write = '      journal.write(event);';
    assert.equal(guardSource.split(write).length, 2);
    guardSource = guardSource.replace(
      write,
      "      if (code === 'RESOURCE_STARTUP_INTERVAL_BRACKET') throw new Error('synthetic journal write failure');\n" +
        write,
    );
  } else if (bracketFailure === 'invalid') {
    const bracket = 'bracket: startupBracket ?? { unavailable: true },';
    assert.equal(guardSource.split(bracket).length, 2);
    guardSource = guardSource.replace(
      bracket,
      "bracket: { unavailable: true, iostatStartedAt: 'invalid' },",
    );
  }
  if (bracketMutation) {
    const condition =
      /process\.env\.MATRX_STARTUP_INTERVAL_DIAGNOSTIC === '1' \|\|\s*process\.env\.MATRX_GUARD_INTERVAL_DIAGNOSTIC === '1'/g;
    assert.equal(
      [...guardSource.matchAll(condition)].length,
      2,
      'mutant must target both actual guard decisions',
    );
    let index = 0;
    guardSource = guardSource.replace(condition, (original) => {
      const decision = index++ === 0 ? 'sampling-off' : 'emission-off';
      if (bracketMutation === 'always-on') return 'true';
      if (bracketMutation === 'always-off' || bracketMutation === decision) return 'false';
      return original;
    });
  }
  const groupMembersRead = "const raw = await output('/bin/ps', ['-axo', 'pid=,pgid=,stat=']);";
  assert.equal(guardSource.split(groupMembersRead).length, 2);
  guardSource = guardSource.replace(
    groupMembersRead,
    `${groupMembersRead.replace('const raw', 'let raw')}
  if (strict && ${JSON.stringify(groupSignalMode)} === 'term-census-error')
    throw Object.assign(new Error('synthetic census error'), { code: 'EIO' });
  if (strict && ${JSON.stringify(groupSignalMode)} === 'term-malformed')
    raw += '\\nmalformed census row';`,
  );
  const stopGroupDeclaration = 'async function stopOwnedGroup(groupId, runId, reason) {';
  assert.equal(guardSource.split(stopGroupDeclaration).length, 2);
  guardSource = guardSource.replace(
    stopGroupDeclaration,
    `const originalGroupKill = process.kill.bind(process);
const groupSignalMode = ${JSON.stringify(groupSignalMode)};
async function syntheticGroupSignal(groupId, signal) {
  if (!groupSignalMode) return originalGroupKill(-groupId, signal);
  if (groupSignalMode === 'kill-gone' && signal === 'SIGTERM') return;
  if (groupSignalMode === 'kill-live' && signal === 'SIGTERM') return;
  if (
    (groupSignalMode === 'term-gone' && signal === 'SIGTERM') ||
    (groupSignalMode === 'kill-gone' && signal === 'SIGKILL')
  ) {
    originalGroupKill(-groupId, signal);
    const gone = await waitGroupGone(groupId, policy.ownedGroupKillWaitSeconds);
    if (!gone) throw new Error('TEST_SIGNAL_GROUP_DID_NOT_EXIT');
  } else if (
    (['term-live', 'term-census-error', 'term-malformed'].includes(groupSignalMode) &&
      signal === 'SIGTERM') ||
    (groupSignalMode === 'kill-live' && signal === 'SIGKILL')
  ) {
    // Leave the real group alive so production must reject the EPERM census.
  } else {
    return originalGroupKill(-groupId, signal);
  }
  throw Object.assign(new Error('synthetic EPERM'), { code: 'EPERM' });
}
${stopGroupDeclaration}`,
  );
  for (const [call, signal] of [
    ["process.kill(-groupId, 'SIGTERM');", 'SIGTERM'],
    ["process.kill(-groupId, 'SIGKILL');", 'SIGKILL'],
  ]) {
    assert.equal(guardSource.split(call).length, 2);
    guardSource = guardSource.replace(call, `await syntheticGroupSignal(groupId, '${signal}');`);
  }
  const diagnosticDeclaration = 'let startupBracket;';
  assert.equal(guardSource.split(diagnosticDeclaration).length, 2);
  guardSource = guardSource.replace(
    diagnosticDeclaration,
    `${diagnosticDeclaration}
let syntheticFinalizationStage = 'watch';
let syntheticFailureStage = null;
const syntheticAtStage = async (stage, operation) => {
  syntheticFinalizationStage = stage;
  try {
    return await operation();
  } catch (error) {
    syntheticFailureStage = stage;
    throw error;
  }
};
const syntheticFailureSummary = (error) => {
  const message = typeof error?.message === 'string' ? error.message : '';
  const resourceMatch = message.match(/^(RESOURCE_[A-Z0-9_]+)/);
  const resourceCodes = new Set(${JSON.stringify([...safeDiagnosticResourceCodes])});
  const osCodes = new Set(${JSON.stringify([...safeDiagnosticOsCodes])});
  const errorNames = new Set(['Error', 'TypeError', 'RangeError', 'SystemError']);
  const errorName = error && typeof error.name === 'string' ? error.name : '';
  const commandKind = message.startsWith('Command failed: /bin/ps ')
    ? 'ps'
    : message.startsWith('Command failed: /usr/sbin/sysctl ')
      ? 'sysctl'
      : null;
  return {
    stage: syntheticFailureStage ?? syntheticFinalizationStage,
    errorClass: errorNames.has(errorName) ? errorName : 'Other',
    ...(resourceMatch && resourceCodes.has(resourceMatch[1]) && { resourceCode: resourceMatch[1] }),
    ...(osCodes.has(error?.code) && { osCode: error.code }),
    ...(Number.isInteger(error?.code) && error.code >= 0 && error.code <= 255 && {
      commandExitCode: error.code,
    }),
    ...(commandKind && { commandKind }),
  };
};
`,
  );
  const instrumentFinalization = (before, after) => {
    assert.equal(guardSource.split(before).length, 2);
    guardSource = guardSource.replace(before, after);
  };
  instrumentFinalization(
    "if (groupId && !(await stopOwnedGroup(groupId, runId, 'watchdog')))",
    "if (groupId && !(await syntheticAtStage('watchdog_group_stop', () => " +
      "stopOwnedGroup(groupId, runId, 'watchdog'))))",
  );
  instrumentFinalization(
    'if (owner.ownership && !(await stopOwnedProcesses(owner))) {',
    [
      "if (owner.ownership && !(await syntheticAtStage('owned_process_census', async () => {",
      '    const stopped = await stopOwnedProcesses(owner);',
      "    if (runId.includes('noncpu-attribution-cleanup-error'))",
      "      throw Object.assign(new Error('synthetic cleanup diagnostic'), { code: 'EIO' });",
      '    return stopped;',
      '  }))) {',
    ].join('\n'),
  );
  instrumentFinalization(
    '} else if (groupId && !(await groupGone(groupId))) {',
    "} else if (groupId && !(await syntheticAtStage('final_group_check', () => " +
      'groupGone(groupId)))) {',
  );
  instrumentFinalization(
    'if (attributionPending.size) await Promise.allSettled([...attributionPending]);',
    "if (attributionPending.size) await syntheticAtStage('attribution_settle', () => " +
      'Promise.allSettled([...attributionPending]));',
  );
  instrumentFinalization(
    '      await release(owner);',
    "      await syntheticAtStage('lease_release', () => release(owner));",
  );
  instrumentFinalization(
    '        detail: error.message,',
    '        syntheticDiagnostic: syntheticFailureSummary(error),\n        detail: error.message,',
  );
  const healthyMemory = "Promise.resolve('System-wide memory free percentage: 80%'),";
  assert.equal(guardSource.split(healthyMemory).length, 2);
  guardSource = guardSource.replace(
    healthyMemory,
    `readFile(${JSON.stringify(memoryPhase)}, 'utf8').then((value) =>
      'System-wide memory free percentage: ' + value.trim() + '%'),`,
  );
  // Only the external CPU measurement is controlled. The real wrapper owns
  // preflight, watch decisions, journal writes, child lifecycle and verdict.
  if (!bracketMode) {
    assert.equal(guardSource.split('Promise.resolve(0.1),').length, 2);
    guardSource = guardSource.replace(
      'Promise.resolve(0.1),',
      `readFile(${JSON.stringify(cpuPhase)}, 'utf8').then(async (raw) => {
      if (raw.trim() === 'slow-healthy') {
        await sleep(3000);
        return 0.1;
      }
      return Number(raw);
    }),`,
    );
  }
  // The outer real-host guard owns admission for this test. Nested scratch
  // guards exercise watch/lifecycle behavior and must not refuse their
  // legitimate ancestor as another live host runner.
  const hostOwnershipCheck = 'await assertNoLegacyWork();';
  assert.equal(guardSource.split(hostOwnershipCheck).length, 2);
  if (process.env.MATRX_RESOURCE_OWNER)
    guardSource = guardSource.replace(hostOwnershipCheck, '/* outer guard owns host admission */');
  if (process.env.MATRX_CPU_COMPLETION_SELF_TEST === '1') {
    const successfulExit = 'cpu.pending &&\n          result.childExitCode === 0 &&';
    assert.equal(guardSource.split(successfulExit).length, 2);
    guardSource = guardSource.replace(
      successfulExit,
      'false &&\n          result.childExitCode === 0 &&',
    );
  }
  if (simulateChildError) {
    // Simulate the external ChildProcess error event only. The copied guard
    // still owns settlement, descendant cleanup, journal, and final verdict.
    const errorListener = "child.once('error', (error) =>";
    assert.equal(guardSource.split(errorListener).length, 2);
    guardSource = guardSource.replace(
      errorListener,
      `const errorProbe = setInterval(async () => {
          if ((await readFile(${JSON.stringify(childPhase)}, 'utf8')).trim() === 'error') {
            clearInterval(errorProbe);
            child.emit('error', new Error('synthetic child error'));
          }
        }, 20);
        errorProbe.unref();
        ${errorListener}`,
    );
  }
  const attributionCall = 'processCpuAttribution(output)';
  assert.equal(guardSource.split(attributionCall).length, 2);
  guardSource = guardSource.replace(
    attributionCall,
    `processCpuAttribution(async (cmd, args) => {
      if (
        cmd === '/bin/ps' &&
        JSON.stringify(args) === JSON.stringify(['-A', '-o', 'pid=,ppid=,%cpu=,ucomm='])
      ) {
        if (${simulateAttributionError}) throw new Error('TEST_PROCESS_ATTRIBUTION_REFUSED');
        return '42 1 1.0 fixture-worker';
      }
      return output(cmd, args);
    })`,
  );
  if (pauseOwnerRewrite) {
    // Hold the real startup writer after truncation. The parent must wait for
    // watch readiness rather than treating admission as completed child setup.
    const startupWrite = 'owner.childPending = true;';
    assert.equal(guardSource.split(startupWrite).length, 2);
    guardSource = guardSource.replace(
      startupWrite,
      `${startupWrite}
      await writeFile(join(lock, 'owner.json'), '');
      console.log(JSON.stringify({ code: 'TEST_OWNER_REWRITE_PAUSED' }));
      while (!stop && !existsSync(${JSON.stringify(ownerRewriteRelease)})) await sleep(5);
    `,
    );
  }
  await writeFile(guardPath, guardSource);
  const safetyPath = join(scripts, 'stabilization-resource-safety.mjs');
  const safetySource = await readFile(safetyPath, 'utf8');
  assert.equal(safetySource.split('statfsFn = statfs').length, 2);
  await writeFile(
    safetyPath,
    safetySource.replace(
      'statfsFn = statfs',
      'statfsFn = async () => ({ bavail: 1600 * 1024 * 1024, bsize: 1024 })',
    ),
  );
  const leasePath = join(scripts, 'stabilization-resource-lease.mjs');
  const leaseSource = await readFile(leasePath, 'utf8');
  assert.equal(leaseSource.split("return join('/var/tmp', leaseName(uid));").length, 2);
  await writeFile(
    leasePath,
    leaseSource.replace(
      "return join('/var/tmp', leaseName(uid));",
      `return ${JSON.stringify(leaseRoot)};`,
    ),
  );
  const policy = JSON.parse(
    await readFile(join(source, 'docs/stabilization/resource-policy.json')),
  );
  assert.equal(policy.unsafeSamplesToStop, 2);
  assert.equal(policy.healthySamplesToResume, 3);
  assert.equal(policy.minimumFreeDiskGiB, 20);
  policy.swapWindowSeconds = 1;
  policy.cpuSampleIntervalSeconds = 0.5;
  policy.watchIntervalSeconds = 0.5;
  await writeFile(join(docs, 'resource-policy.json'), `${JSON.stringify(policy)}\n`);
  await writeFile(cpuPhase, '0.1\n');
  await writeFile(memoryPhase, '80\n');
  await writeFile(childPhase, 'run\n');
  await writeFile(
    join(scripts, 'prove-desktop-settings-guards.mjs'),
    `import { readFile } from 'node:fs/promises';
     setInterval(async () => {
       const phase = (await readFile(${JSON.stringify(childPhase)}, 'utf8')).trim();
       if (phase === 'exit0') process.exit(0);
       if (phase === 'exit1') process.exit(1);
     }, 20);
    `,
  );
  return {
    scratch,
    docs,
    leaseRoot,
    cpuPhase,
    memoryPhase,
    childPhase,
    guardPath,
    ownerRewriteRelease,
    simulateAttributionError,
  };
}

function observe(child, onEvent) {
  const events = [];
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    const lines = stdout.split('\n');
    stdout = lines.pop();
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        events.push(event);
        if (event && typeof event.code === 'string') onEvent(event);
      } catch {
        // The owned test child may print ordinary output.
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  let consumed = 0;
  return {
    async next(predicate) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        while (consumed < events.length) {
          const event = events[consumed++];
          if (predicate(event)) return event;
        }
        if (child.exitCode !== null) {
          const eventSummary = JSON.stringify(events.map(safeEventSummary));
          const stderrCodes = JSON.stringify(safeStderrSummary(stderr));
          throw new Error(
            `guard exited before expected event: ${eventSummary}; stderrCodes=${stderrCodes}`,
          );
        }
        await new Promise((done) => setTimeout(done, 10));
      }
      throw new Error(
        `guard event timeout; stderrCodes=${JSON.stringify(safeStderrSummary(stderr))}`,
      );
    },
    get stderr() {
      return JSON.stringify(safeStderrSummary(stderr));
    },
  };
}

function scenarioDiagnostic(kind, groupStartedAt) {
  const startedAt = process.hrtime.bigint();
  const elapsedMs = (start) => Number((process.hrtime.bigint() - start) / 1_000_000n);
  let stage = 'fixture';
  let lastGuardEvent = null;
  let child = null;
  let childClosed = false;
  let cleanup = 'not_started';
  let failure = null;
  const report = (point) => {
    console.error(
      `resource-cpu-scenario ${JSON.stringify({
        kind,
        point,
        elapsedMs: elapsedMs(startedAt),
        groupElapsedMs: elapsedMs(groupStartedAt),
        stage,
        lastGuardEvent,
        failure,
        child: child
          ? {
              pid: child.pid ?? null,
              exitCode: child.exitCode,
              signalCode: child.signalCode,
              closed: childClosed,
            }
          : null,
        cleanup,
      })}`,
    );
  };
  // Node's test timeout can fire while a scenario is awaiting a guard event.
  // A live, unref'ed status line preserves the active scenario in CI output.
  const ticker = setInterval(() => report('progress'), 1_000);
  ticker.unref();
  report('start');
  return {
    report,
    stop: () => clearInterval(ticker),
    setStage: (value) => {
      stage = value;
    },
    setChild: (value) => {
      child = value;
    },
    setChildClosed: () => {
      childClosed = true;
    },
    setCleanup: (value) => {
      cleanup = value;
    },
    onEvent: (event) => {
      failure = safeFailureSummary(event) ?? failure;
      lastGuardEvent = safeEventSummary(event);
      report('guard_event');
    },
  };
}

async function readWatchReadyOwner(stream, item) {
  // Admission precedes truncate/writeFile updates to owner.json. A watch event
  // is emitted only after child setup and all startup owner writes complete.
  const ready = await stream.next((event) => watchCodes.has(event.code));
  assert.equal(ready.code, 'RESOURCE_WATCH_HEALTHY');
  return JSON.parse(await readFile(join(item.leaseRoot, 'heavy/owner.json'), 'utf8'));
}

async function runScenario(
  kind,
  groupStartedAt,
  {
    pauseOwnerRewrite = false,
    simulateAttributionError = false,
    bracketMode = null,
    guardFlag = false,
    oldFlag = false,
    bracketMutation = null,
  } = {},
) {
  const diagnostic = scenarioDiagnostic(kind, groupStartedAt);
  let item;
  let child;
  let closed;
  let finished = false;
  let scenarioError;
  try {
    item = await fixture({
      pauseOwnerRewrite,
      simulateChildError: kind === 'pending-child-error',
      simulateAttributionError,
      bracketMode,
      bracketMutation,
      groupSignalMode: kind.startsWith('eperm-') ? kind.slice('eperm-'.length) : null,
    });
    const runId = `cpu-${kind}-${randomUUID()}`;
    diagnostic.setStage('guard_spawn');
    child = spawn(
      process.execPath,
      [
        item.guardPath,
        'run',
        '--run-id',
        runId,
        '--profile-dir',
        item.scratch,
        '--',
        'node',
        'scripts/prove-desktop-settings-guards.mjs',
      ],
      {
        cwd: item.scratch,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          MATRX_GUARD_INTERVAL_DIAGNOSTIC: guardFlag ? '1' : '0',
          MATRX_STARTUP_INTERVAL_DIAGNOSTIC: oldFlag ? '1' : '0',
        },
      },
    );
    diagnostic.setChild(child);
    const observedEvents = [];
    const stream = observe(child, (event) => {
      observedEvents.push(event);
      diagnostic.onEvent(event);
    });
    closed = new Promise((done) =>
      child.once('close', (code, signal) => {
        diagnostic.setChildClosed();
        done({ code, signal });
      }),
    );
    diagnostic.setStage('admission');
    await stream.next((event) => event.code === 'RESOURCE_ADMITTED');
    if (pauseOwnerRewrite) {
      await stream.next((event) => event.code === 'TEST_OWNER_REWRITE_PAUSED');
      const incomplete = await readFile(join(item.leaseRoot, 'heavy/owner.json'), 'utf8');
      assert.equal(incomplete, '');
      assert.throws(() => JSON.parse(incomplete), /Unexpected end of JSON input/);
    }
    // Release the writer only when readiness starts waiting for a watch. If
    // that wait is removed, the owner read deterministically sees empty JSON.
    const readinessStream = pauseOwnerRewrite
      ? {
          async next(predicate) {
            await writeFile(item.ownerRewriteRelease, 'release\n');
            return stream.next(predicate);
          },
        }
      : stream;
    const owner = await readWatchReadyOwner(readinessStream, item);
    diagnostic.setStage('watch');
    const env = {
      MATRX_RESOURCE_RUN_ID: runId,
      MATRX_RESOURCE_OWNER: owner.nonce,
      MATRX_RESOURCE_STOP_FILE: join(item.leaseRoot, `stop-${owner.nonce}.json`),
    };
    const check = () =>
      requireNativeResourceHealth({ repo: item.scratch, leaseRoot: item.leaseRoot, env });
    let actions = 0;
    if (kind === 'healthy-bracket') {
      await writeFile(item.childPhase, 'exit0\n');
      const job = await stream.next((event) => event.code === 'RESOURCE_JOB_EXIT');
      assert.equal(job.childExitCode, 0);
    } else {
      if (kind.startsWith('noncpu-attribution')) {
        await writeFile(item.memoryPhase, '10\n');
      } else {
        await writeFile(item.cpuPhase, '0.88\n');
      }
      const first = await stream.next((event) => watchCodes.has(event.code));
      assert.equal(
        first.code,
        kind.startsWith('noncpu-attribution') ? 'RESOURCE_WATCH_UNSAFE' : 'RESOURCE_CPU_PENDING',
        `first watch must block: ${JSON.stringify(first)}`,
      );
      assert.deepEqual(
        first.reasons,
        kind.startsWith('noncpu-attribution') ? ['RESOURCE_MEMORY_LOW'] : ['RESOURCE_CPU_BUSY'],
      );
      await assert.rejects(
        runNativeResourceAction(check, () => ++actions),
        kind.startsWith('noncpu-attribution')
          ? /unsafe_sample|stop_requested|unsafe_hold/
          : /cpu_pending/,
      );
      assert.equal(actions, 0);
      if (kind === 'attribution-episodes' || kind === 'attribution-alternation') {
        const nextCpuWatch = async (expectedCode, expectedReasons) => {
          const watch = await stream.next((event) => watchCodes.has(event.code));
          assert.equal(watch.code, expectedCode);
          assert.deepEqual(watch.reasons, expectedReasons);
          return watch;
        };

        if (kind === 'attribution-alternation') {
          // Keep bad/good alternation inside the first pending episode.
          await writeFile(item.cpuPhase, '0.1\n');
          await nextCpuWatch('RESOURCE_CPU_PENDING', []);
          await writeFile(item.cpuPhase, '0.88\n');
          await nextCpuWatch('RESOURCE_CPU_PENDING', ['RESOURCE_CPU_BUSY']);
          await writeFile(item.cpuPhase, '0.1\n');
          await nextCpuWatch('RESOURCE_CPU_PENDING', []);
          await nextCpuWatch('RESOURCE_CPU_PENDING', []);
          const expired = await stream.next((event) => watchCodes.has(event.code));
          assert.equal(expired.code, 'RESOURCE_WATCH_UNSAFE');
          assert.deepEqual(expired.reasons, ['RESOURCE_CPU_CONFIRMATION_EXPIRED']);
          await assert.rejects(
            runNativeResourceAction(check, () => ++actions),
            /unsafe_sample|stop_requested|unsafe_hold/,
          );
        } else {
          // Full recovery before the deadline permits a new CPU episode.
          await writeFile(item.cpuPhase, '0.1\n');
          await nextCpuWatch('RESOURCE_CPU_PENDING', []);
          await nextCpuWatch('RESOURCE_CPU_PENDING', []);
          await nextCpuWatch('RESOURCE_CPU_RECOVERED', []);
          assert.equal(await runNativeResourceAction(check, () => ++actions), 1);

          await writeFile(item.cpuPhase, '0.88\n');
          await nextCpuWatch('RESOURCE_CPU_PENDING', ['RESOURCE_CPU_BUSY']);
          await assert.rejects(
            runNativeResourceAction(check, () => ++actions),
            /cpu_pending/,
          );
          await writeFile(item.cpuPhase, '0.1\n');
          await nextCpuWatch('RESOURCE_CPU_PENDING', []);
          await nextCpuWatch('RESOURCE_CPU_PENDING', []);
          await nextCpuWatch('RESOURCE_CPU_RECOVERED', []);
          assert.equal(await runNativeResourceAction(check, () => ++actions), 2);
          await writeFile(item.childPhase, 'exit0\n');
          const job = await stream.next((event) => event.code === 'RESOURCE_JOB_EXIT');
          assert.equal(job.childExitCode, 0);
        }
      } else if (
        [
          'recovered',
          'completion-recovered',
          'completion-unsafe',
          'completion-expired',
          'completion-memory-unsafe',
          'completion-stop',
        ].includes(kind)
      ) {
        await writeFile(item.cpuPhase, '0.1\n');
        for (let i = 0; i < 2; i++) {
          const watch = await stream.next((event) => watchCodes.has(event.code));
          assert.equal(watch.code, 'RESOURCE_CPU_PENDING');
          assert.deepEqual(watch.reasons, []);
          await assert.rejects(
            runNativeResourceAction(check, () => ++actions),
            /cpu_pending/,
          );
        }
        if (kind.startsWith('completion-')) {
          await writeFile(item.childPhase, 'exit0\n');
          await stream.next((event) => event.code === 'RESOURCE_JOB_EXIT');
          assert.equal(child.exitCode, null, 'lease holder must remain alive while CPU is pending');
          const heldOwner = JSON.parse(
            await readFile(join(item.leaseRoot, 'heavy/owner.json'), 'utf8'),
          );
          assert.equal(
            heldOwner.nonce,
            owner.nonce,
            'same lease must remain held after child exit',
          );
          await assert.rejects(
            runNativeResourceAction(check, () => ++actions),
            /run_stopped/,
          );
          if (kind === 'completion-unsafe') await writeFile(item.cpuPhase, '0.88\n');
          if (kind === 'completion-expired') await writeFile(item.cpuPhase, 'slow-healthy\n');
          if (kind === 'completion-memory-unsafe') await writeFile(item.memoryPhase, '10\n');
          if (kind === 'completion-stop') {
            child.kill('SIGTERM');
            await stream.next((event) => event.code === 'RESOURCE_STOP_REQUESTED');
          }
        }
        if (kind !== 'completion-stop') {
          const next = await stream.next((event) => watchCodes.has(event.code));
          assert.equal(
            next.code,
            kind === 'completion-unsafe'
              ? 'RESOURCE_CPU_PENDING'
              : kind === 'completion-expired' || kind === 'completion-memory-unsafe'
                ? 'RESOURCE_WATCH_UNSAFE'
                : 'RESOURCE_CPU_RECOVERED',
          );
          if (kind === 'completion-expired')
            assert.deepEqual(next.reasons, ['RESOURCE_CPU_CONFIRMATION_EXPIRED']);
          if (kind === 'completion-memory-unsafe')
            assert.deepEqual(next.reasons, ['RESOURCE_MEMORY_LOW']);
          if (kind === 'completion-unsafe') {
            const unsafe = await stream.next((event) => watchCodes.has(event.code));
            assert.equal(unsafe.code, 'RESOURCE_WATCH_UNSAFE');
          }
          if (
            !['completion-unsafe', 'completion-expired', 'completion-memory-unsafe'].includes(kind)
          ) {
            assert.deepEqual(next.reasons, []);
            if (kind === 'recovered') {
              assert.equal(await runNativeResourceAction(check, () => ++actions), 1);
              await writeFile(item.childPhase, 'exit0\n');
            }
          }
        }
      } else if (kind.startsWith('eperm-')) {
        const second = await stream.next((event) => watchCodes.has(event.code));
        assert.equal(second.code, 'RESOURCE_WATCH_UNSAFE');
        assert.deepEqual(second.reasons, ['RESOURCE_CPU_BUSY']);
        await assert.rejects(
          runNativeResourceAction(check, () => ++actions),
          /unsafe_sample|stop_requested|unsafe_hold/,
        );
      } else if (kind === 'confirmed') {
        const second = await stream.next((event) => watchCodes.has(event.code));
        assert.equal(second.code, 'RESOURCE_WATCH_UNSAFE');
        await assert.rejects(
          runNativeResourceAction(check, () => ++actions),
          /unsafe_sample|stop_requested|unsafe_hold/,
        );
      } else if (kind.startsWith('noncpu-attribution')) {
        if (kind === 'noncpu-attribution-cleanup-error') {
          const stop = await stream.next(
            (event) => event.code === 'RESOURCE_STOP_AT_SAFE_BOUNDARY',
          );
          assert.deepEqual(stop.reasons, ['RESOURCE_MEMORY_LOW']);
          const failure = await stream.next(
            (event) => event.code === 'RESOURCE_MEASUREMENT_FAILED',
          );
          assert.deepEqual(failure.syntheticDiagnostic, {
            stage: 'owned_process_census',
            errorClass: 'Error',
            osCode: 'EIO',
          });
        } else {
          await writeFile(item.childPhase, 'exit0\n');
        }
      } else {
        await writeFile(
          item.childPhase,
          kind === 'pending-failed-child'
            ? 'exit1\n'
            : kind === 'pending-child-error'
              ? 'error\n'
              : 'exit0\n',
        );
        if (kind === 'pending-failed-child' || kind === 'pending-child-error') {
          const job = await stream.next((event) => event.code === 'RESOURCE_JOB_EXIT');
          if (kind === 'pending-failed-child') assert.equal(job.childExitCode, 1);
          else assert.equal(job.childError, 'synthetic child error');
        }
      }
    }
    diagnostic.setStage('awaiting_child_close');
    const exit = await closed;
    finished = true;
    diagnostic.setStage('journal_assertions');
    const validRecovery = [
      'healthy-bracket',
      'recovered',
      'completion-recovered',
      'attribution-episodes',
    ].includes(kind);
    assert.deepEqual(exit, { code: validRecovery ? 0 : 3, signal: null }, stream.stderr);
    const journal = (await readFile(join(item.docs, 'resource-journals', `${runId}.jsonl`), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    if (bracketMode) {
      const brackets = journal.filter(
        (entry) => entry.code === 'RESOURCE_STARTUP_INTERVAL_BRACKET',
      );
      assert.equal(
        brackets.length > 0,
        guardFlag || oldFlag,
        'guard flag must control bracket emission',
      );
      if (guardFlag || oldFlag) {
        assert.equal(
          brackets.some((entry) => entry.bracket.unavailable === true),
          bracketMode !== 'valid',
          'guard must sample process brackets',
        );
        if (bracketMode === 'valid') {
          assert.deepEqual(
            brackets[0].bracket.categoryTotalsSeconds,
            { ownedChromium: 0, ownedOther: 2, hostProvisioner: 0, otherHost: 3 },
            'owned and host CPU deltas must use both real snapshots',
          );
        }
      }
    }
    assert.equal(journal.at(-1).decision, validRecovery ? 'valid' : 'invalid');
    assert.equal(journal.at(-1).resourceInvalid, !validRecovery);
    if (
      [
        'confirmed',
        'completion-unsafe',
        'completion-expired',
        'completion-memory-unsafe',
        'noncpu-attribution',
        'noncpu-attribution-cleanup-error',
        ...watchScenarioKinds.filter((scenario) => scenario.startsWith('eperm-')),
        'attribution-alternation',
      ].includes(kind)
    ) {
      assert(journal.some((event) => event.code === 'RESOURCE_STOP_AT_SAFE_BOUNDARY'));
      assert.equal((await stat(join(item.leaseRoot, 'unsafe-hold.json'))).isFile(), true);
    }
    if (kind === 'pending-failed-child')
      assert(
        journal.some((event) => event.code === 'RESOURCE_JOB_EXIT' && event.childExitCode === 1),
      );
    if (kind === 'pending-child-error')
      assert(
        journal.some(
          (event) =>
            event.code === 'RESOURCE_JOB_EXIT' &&
            event.childExitCode === null &&
            event.childSignal === null,
        ),
      );
    if (kind === 'completion-stop')
      assert(journal.some((event) => event.code === 'RESOURCE_STOP_REQUESTED'));
    if (kind.startsWith('eperm-')) {
      const gone = kind.endsWith('-gone');
      const expectedSignal = kind.includes('-kill-') ? 'SIGKILL' : 'SIGTERM';
      const expectedCode = gone
        ? 'RESOURCE_GROUP_SIGNAL_EPERM_CENSUS'
        : 'RESOURCE_GROUP_SIGNAL_UNCONFIRMED';
      const event = journal.find((entry) => entry.code === expectedCode);
      assert(event, `missing ${expectedCode}`);
      assert.equal(event.signal, expectedSignal);
      assert.equal(event.osCode, 'EPERM');
      assert.equal(event.freshZeroProof, gone);
      assert.equal(journal.at(-1).decision, 'invalid');
      assert.equal(journal.at(-1).resourceInvalid, true);
      assert.equal(
        journal.some((entry) => entry.code === 'RESOURCE_GROUP_STILL_RUNNING'),
        false,
      );
      assert.equal(
        journal.some((entry) => entry.code === 'RESOURCE_OWNED_PROCESS_STILL_RUNNING'),
        false,
      );
      if (kind.endsWith('-census-error')) {
        assert.equal(event.censusOsCode, 'EIO');
        assert.equal(event.censusErrorClass, 'Error');
        const stdoutFailure = observedEvents.find(
          (entry) => entry.code === 'RESOURCE_MEASUREMENT_FAILED',
        );
        assert.equal(stdoutFailure?.syntheticDiagnostic?.stage, 'watchdog_group_stop');
        assert.equal(stdoutFailure?.syntheticDiagnostic?.osCode, 'EIO');
        const durableFailure = journal.find(
          (entry) => entry.code === 'RESOURCE_MEASUREMENT_FAILED',
        );
        assert.equal(durableFailure?.runId, runId);
        assert.equal(Object.hasOwn(durableFailure ?? {}, 'syntheticDiagnostic'), false);
      }
      if (kind.endsWith('-malformed')) {
        assert.equal(event.censusResourceCode, 'RESOURCE_GROUP_CENSUS_INVALID');
        assert(
          journal.some((entry) => entry.code === 'RESOURCE_GROUP_CENSUS_INVALID'),
          'malformed strict census must remain an explicit resource failure',
        );
        const durableInvalid = journal.find(
          (entry) => entry.code === 'RESOURCE_GROUP_CENSUS_INVALID',
        );
        assert.equal(durableInvalid?.runId, runId);
        assert.equal(Object.hasOwn(durableInvalid ?? {}, 'syntheticDiagnostic'), false);
        assert.equal(
          journal.some((entry) => entry.code === 'RESOURCE_MEASUREMENT_FAILED'),
          false,
        );
      }
      if (kind.endsWith('-live')) {
        const stdoutFailure = observedEvents.find(
          (entry) => entry.code === 'RESOURCE_MEASUREMENT_FAILED',
        );
        assert.equal(stdoutFailure?.syntheticDiagnostic?.stage, 'watchdog_group_stop');
        assert.equal(stdoutFailure?.syntheticDiagnostic?.osCode, 'EPERM');
        const durableFailure = journal.find(
          (entry) => entry.code === 'RESOURCE_MEASUREMENT_FAILED',
        );
        assert.equal(durableFailure?.runId, runId);
        assert.equal(Object.hasOwn(durableFailure ?? {}, 'syntheticDiagnostic'), false);
      }
      if (gone)
        assert.equal(
          journal.some((entry) => entry.code === 'RESOURCE_MEASUREMENT_FAILED'),
          false,
        );
      const ownerPath = join(item.leaseRoot, 'heavy/owner.json');
      assert.equal((await stat(join(item.leaseRoot, `unsafe-hold.json`))).isFile(), true);
      assert.equal((await stat(join(item.leaseRoot, `stop-${owner.nonce}.json`))).isFile(), true);
      if (gone) {
        await assert.rejects(stat(ownerPath), { code: 'ENOENT' });
      } else {
        const retained = JSON.parse(await readFile(ownerPath, 'utf8'));
        assert.equal(retained.nonce, owner.nonce);
        assert.equal(retained.runId, runId);
      }
    }
    assert.equal(actions, kind === 'recovered' ? 1 : kind === 'attribution-episodes' ? 2 : 0);
    if (kind === 'attribution-episodes') {
      const attribution = journal.filter((event) => event.code === 'RESOURCE_PROCESS_ATTRIBUTION');
      assert.equal(attribution.length, 2);
      assert(attribution.every((event) => event.processes?.[0]?.executable === 'fixture-worker'));
    }
    if (kind === 'attribution-alternation') {
      const attribution = journal.filter((event) => event.code === 'RESOURCE_PROCESS_ATTRIBUTION');
      assert.equal(attribution.length, 1);
      assert.equal(attribution[0]?.processes?.[0]?.executable, 'fixture-worker');
      assert(
        journal.some(
          (event) =>
            event.code === 'RESOURCE_WATCH_UNSAFE' &&
            event.reasons?.includes('RESOURCE_CPU_CONFIRMATION_EXPIRED'),
        ),
      );
    }
    if (kind.startsWith('noncpu-attribution')) {
      const attribution = journal.filter((event) => event.code === 'RESOURCE_PROCESS_ATTRIBUTION');
      assert.equal(attribution.length, 1);
      assert.equal(attribution[0]?.processes?.[0]?.executable, 'fixture-worker');
      if (kind === 'noncpu-attribution-cleanup-error') {
        const failure = journal.find((event) => event.code === 'RESOURCE_MEASUREMENT_FAILED');
        assert.equal(failure?.code, 'RESOURCE_MEASUREMENT_FAILED');
        assert.equal(failure?.runId, runId);
        assert.equal(Object.hasOwn(failure ?? {}, 'syntheticDiagnostic'), false);
        const retainedOwner = JSON.parse(
          await readFile(join(item.leaseRoot, 'heavy/owner.json'), 'utf8'),
        );
        assert.equal(retainedOwner.nonce, owner.nonce);
        assert.equal(retainedOwner.runId, runId);
      } else {
        assert.equal(
          journal.some((event) => event.code === 'RESOURCE_MEASUREMENT_FAILED'),
          false,
        );
      }
    }
    if (item.simulateAttributionError) {
      const attribution = journal.filter((event) => event.code === 'RESOURCE_PROCESS_ATTRIBUTION');
      assert.equal(attribution.length, 1);
      assert.equal(attribution[0]?.unavailable, true);
    }
  } catch (error) {
    diagnostic.report('failure');
    scenarioError = error;
  }
  diagnostic.setCleanup('started');
  diagnostic.report('cleanup_start');
  try {
    if (child && closed && !finished) {
      child.kill('SIGTERM');
      await closed;
    }
    if (item) await rm(item.scratch, { recursive: true, force: true });
    diagnostic.setCleanup(item ? 'done' : 'unavailable');
  } catch (error) {
    diagnostic.setCleanup('failed');
    diagnostic.report('cleanup_failure');
    throw error;
  } finally {
    diagnostic.setStage('complete');
    diagnostic.report('end');
    diagnostic.stop();
  }
  if (scenarioError) throw scenarioError;
}

async function runScenarioGroup(kinds, options) {
  const groupStartedAt = process.hrtime.bigint();
  for (const kind of kinds) await runScenario(kind, groupStartedAt, options);
}

const watchScenarioKinds = [
  'eperm-term-gone',
  'eperm-term-live',
  'eperm-term-census-error',
  'eperm-term-malformed',
  'eperm-kill-gone',
  'eperm-kill-live',
  'recovered',
  'confirmed',
  'pending-exit',
  'completion-recovered',
  'completion-unsafe',
  'completion-expired',
  'completion-memory-unsafe',
  'noncpu-attribution',
  'noncpu-attribution-cleanup-error',
];

function registerWatchScenarioTests(register = test, run = runScenario) {
  for (const kind of watchScenarioKinds) {
    register(
      `actual guard watch journal: ${kind}`,
      { timeout: 30_000, concurrency: false },
      async () => run(kind, process.hrtime.bigint()),
    );
  }
}

if (process.env.MATRX_RESOURCE_CPU_DIAGNOSTIC_SELF_TEST === '1') {
  test('watch scenarios are separate selectable cases and surface their own failure', async () => {
    const cases = new Map();
    const runs = [];
    registerWatchScenarioTests(
      (name, options, body) => cases.set(name, { options, body }),
      async (kind) => {
        runs.push(kind);
        if (kind === 'completion-expired') throw new Error('scenario failure reaches test runner');
      },
    );
    assert.deepEqual(
      [...cases.keys()],
      [
        'actual guard watch journal: eperm-term-gone',
        'actual guard watch journal: eperm-term-live',
        'actual guard watch journal: eperm-term-census-error',
        'actual guard watch journal: eperm-term-malformed',
        'actual guard watch journal: eperm-kill-gone',
        'actual guard watch journal: eperm-kill-live',
        'actual guard watch journal: recovered',
        'actual guard watch journal: confirmed',
        'actual guard watch journal: pending-exit',
        'actual guard watch journal: completion-recovered',
        'actual guard watch journal: completion-unsafe',
        'actual guard watch journal: completion-expired',
        'actual guard watch journal: completion-memory-unsafe',
        'actual guard watch journal: noncpu-attribution',
        'actual guard watch journal: noncpu-attribution-cleanup-error',
      ],
    );
    assert(cases.values().every(({ options }) => options.timeout === 30_000));
    await cases.get('actual guard watch journal: recovered').body();
    assert.deepEqual(runs, ['recovered']);
    await assert.rejects(
      cases.get('actual guard watch journal: completion-expired').body(),
      /scenario failure reaches test runner/,
    );
    assert.deepEqual(runs, ['recovered', 'completion-expired']);
  });
  test('scenario diagnostic reports each distinct lifecycle without running a guard', () => {
    const lines = [];
    const originalError = console.error;
    console.error = (line) => lines.push(line);
    try {
      const groupStartedAt = process.hrtime.bigint();
      const first = scenarioDiagnostic('recovered', groupStartedAt);
      first.setChild({ pid: 123, exitCode: null, signalCode: null });
      first.onEvent({ code: 'RESOURCE_CPU_RECOVERED', reasons: [] });
      first.setChildClosed();
      first.setCleanup('done');
      first.report('end');
      first.stop();
      const second = scenarioDiagnostic('completion-expired', groupStartedAt);
      second.onEvent({
        code: 'RESOURCE_WATCH_UNSAFE',
        reasons: ['RESOURCE_CPU_CONFIRMATION_EXPIRED'],
      });
      second.setCleanup('unavailable');
      second.report('end');
      second.stop();
      const third = scenarioDiagnostic('measurement-error', groupStartedAt);
      third.onEvent({
        code: 'RESOURCE_MEASUREMENT_FAILED',
        syntheticDiagnostic: {
          stage: '/private/tmp/fixture/path-with-token',
          errorClass: 'SecretErrorName',
          resourceCode: 'RESOURCE_PRIVATE_TOKEN',
          osCode: 'PRIVATE_OS_CODE',
          commandKind: '/private/tmp/ps --token=fixture-secret',
          commandExitCode: 'PRIVATE_COMMAND_CODE',
          detail: 'pid=99123 private token /private/tmp/fixture/path',
        },
        reasons: [
          "RESOURCE_MEASUREMENT_FAILED:ENOENT: open '/private/tmp/resource-cpu-wrapper-secret/cpu-phase'",
          'RESOURCE_FUTURE:--secret-token=fixture-private',
        ],
      });
      third.setCleanup('failed');
      third.report('end');
      third.stop();
      const fourth = scenarioDiagnostic('hostile-child-event', groupStartedAt);
      fourth.onEvent({
        code: 'RESOURCE_PRIVATE_TOKEN',
        childExitCode: 'pid=99123 token=private',
        reasons: ['RESOURCE_PRIVATE_TOKEN'],
      });
      fourth.report('end');
      fourth.stop();
    } finally {
      console.error = originalError;
    }
    const entries = lines.map((line) => JSON.parse(line.slice('resource-cpu-scenario '.length)));
    const ends = entries.filter((entry) => entry.point === 'end');
    assert.deepEqual(
      ends.map(({ kind, lastGuardEvent, failure, child, cleanup }) => ({
        kind,
        lastGuardEvent,
        failure,
        child,
        cleanup,
      })),
      [
        {
          kind: 'recovered',
          lastGuardEvent: { code: 'RESOURCE_CPU_RECOVERED', reasons: [] },
          failure: null,
          child: { pid: 123, exitCode: null, signalCode: null, closed: true },
          cleanup: 'done',
        },
        {
          kind: 'completion-expired',
          lastGuardEvent: {
            code: 'RESOURCE_WATCH_UNSAFE',
            reasons: ['RESOURCE_CPU_CONFIRMATION_EXPIRED'],
          },
          failure: null,
          child: null,
          cleanup: 'unavailable',
        },
        {
          kind: 'measurement-error',
          lastGuardEvent: {
            code: 'RESOURCE_MEASUREMENT_FAILED',
            reasons: ['RESOURCE_MEASUREMENT_FAILED', 'RESOURCE_REASON_OTHER'],
            failure: { stage: 'unknown', errorClass: 'Other' },
          },
          failure: { stage: 'unknown', errorClass: 'Other' },
          child: null,
          cleanup: 'failed',
        },
        {
          kind: 'hostile-child-event',
          lastGuardEvent: { code: 'OTHER_EVENT', reasons: ['RESOURCE_REASON_OTHER'] },
          failure: null,
          child: null,
          cleanup: 'not_started',
        },
      ],
    );
    assert(!lines.join('\n').includes('/private/tmp/resource-cpu-wrapper-secret/cpu-phase'));
    assert(!lines.join('\n').includes('--secret-token=fixture-private'));
    assert(!lines.join('\n').includes('PRIVATE_OS_CODE'));
    assert(!lines.join('\n').includes('fixture-secret'));
    assert(!lines.join('\n').includes('99123'));
    assert(!lines.join('\n').includes('SecretErrorName'));
    assert(!lines.join('\n').includes('PRIVATE_TOKEN'));
    assert(!lines.join('\n').includes('pid=99123'));
    assert(entries.every(({ elapsedMs, groupElapsedMs }) => elapsedMs >= 0 && groupElapsedMs >= 0));
    assert.equal(entries.filter(({ point }) => point === 'guard_event').length, 4);
  });
}

registerWatchScenarioTests();

test('strict process-group census validates the production parser against malformed ps rows', async () => {
  const guardSource = await readFile(join(source, 'scripts/stabilization-resource.mjs'), 'utf8');
  const start = guardSource.indexOf('async function groupMembers(groupId, strict = false) {');
  const endMarker = '\n}\n\nfunction groupSignalErrorClass';
  const end = guardSource.indexOf(endMarker, start);
  assert(start >= 0 && end > start, 'production groupMembers source must be extractable');
  let census = '1 1 S';
  const context = {
    output: async (command, args) => {
      assert.equal(command, '/bin/ps');
      assert.equal(JSON.stringify(args), JSON.stringify(['-axo', 'pid=,pgid=,stat=']));
      return census;
    },
  };
  runInNewContext(
    `${guardSource.slice(start, end + 2)}\nglobalThis.extractedGroupMembers = groupMembers;`,
    context,
  );
  assert.deepEqual([...(await context.extractedGroupMembers(50, true))], []);
  census = '50 50 S\n51 50 Z';
  assert.deepEqual([...(await context.extractedGroupMembers(50, true))], [50]);

  for (const invalidCensus of [
    '',
    ' \t\n  ',
    '54 54',
    'malformed census row',
    '1e3 54 S',
    '+1 54 S',
    '0x10 54 S',
    '54 1e3 S',
    '54 +1 S',
    '54 0x10 S',
    '9007199254740992 54 S',
    '54 9007199254740992 S',
    '54 54 S extra',
  ]) {
    census = invalidCensus;
    await assert.rejects(context.extractedGroupMembers(54, true), {
      message: 'RESOURCE_GROUP_CENSUS_INVALID',
    });
  }
});

test('group-signal event projection exposes only closed safe fields', () => {
  const zeroProof = safeEventSummary({
    code: 'RESOURCE_GROUP_SIGNAL_EPERM_CENSUS',
    signal: 'SIGTERM',
    errorClass: 'Other',
    osCode: 'EPERM',
    freshZeroProof: true,
    groupId: 999999,
    runId: 'private-run-id',
    env: { MATRX_RESOURCE_OWNER: 'private-nonce' },
    payload: 'private-payload',
  });
  assert.deepEqual(zeroProof, {
    code: 'RESOURCE_GROUP_SIGNAL_EPERM_CENSUS',
    signal: 'SIGTERM',
    errorClass: 'Other',
    osCode: 'EPERM',
    freshZeroProof: true,
  });

  const unconfirmed = safeEventSummary({
    code: 'RESOURCE_GROUP_SIGNAL_UNCONFIRMED',
    signal: 'SIGKILL',
    errorClass: 'Error',
    osCode: 'EPERM',
    freshZeroProof: false,
    censusErrorClass: 'SystemError',
    censusOsCode: 'EIO',
    censusResourceCode: 'RESOURCE_GROUP_CENSUS_INVALID',
    groupId: 999999,
    runId: 'private-run-id',
    env: { MATRX_RESOURCE_OWNER: 'private-nonce' },
    payload: 'private-payload',
  });
  assert.deepEqual(unconfirmed, {
    code: 'RESOURCE_GROUP_SIGNAL_UNCONFIRMED',
    signal: 'SIGKILL',
    errorClass: 'Error',
    osCode: 'EPERM',
    freshZeroProof: false,
    censusErrorClass: 'SystemError',
    censusOsCode: 'EIO',
    censusResourceCode: 'RESOURCE_GROUP_CENSUS_INVALID',
  });

  const hostileSignal = safeEventSummary({
    code: 'RESOURCE_GROUP_SIGNAL_UNCONFIRMED',
    signal: 'SIGSECRET',
    errorClass: 'PrivateError',
    osCode: 'PRIVATE_OS_CODE',
    freshZeroProof: 'private-proof',
    censusErrorClass: 'PrivateError',
    censusOsCode: 'PRIVATE_CENSUS_CODE',
    censusResourceCode: 'RESOURCE_PRIVATE_TOKEN',
    groupId: 999999,
    runId: 'private-run-id',
    env: { MATRX_RESOURCE_OWNER: 'private-nonce' },
    payload: 'private-payload',
  });
  const hostileUnrelated = safeEventSummary({
    code: 'RESOURCE_ADMITTED',
    signal: 'SIGTERM',
    errorClass: 'Error',
    osCode: 'EPERM',
    freshZeroProof: true,
    censusErrorClass: 'Error',
    censusOsCode: 'EIO',
    censusResourceCode: 'RESOURCE_GROUP_CENSUS_INVALID',
    groupId: 999999,
    runId: 'private-run-id',
    env: { MATRX_RESOURCE_OWNER: 'private-nonce' },
    payload: 'private-payload',
  });
  assert.deepEqual(hostileSignal, { code: 'RESOURCE_GROUP_SIGNAL_UNCONFIRMED' });
  assert.deepEqual(hostileUnrelated, { code: 'RESOURCE_ADMITTED' });
  const rendered = JSON.stringify([zeroProof, unconfirmed, hostileSignal, hostileUnrelated]);
  for (const secret of [
    'private-run-id',
    'private-nonce',
    'private-payload',
    'PRIVATE_OS_CODE',
    'PRIVATE_CENSUS_CODE',
    'RESOURCE_PRIVATE_TOKEN',
    'SIGSECRET',
    'PrivateError',
    '999999',
  ])
    assert.equal(rendered.includes(secret), false, `projector leaked ${secret}`);
});

test('process attribution runs once per recovered CPU episode', { timeout: 30_000 }, async () => {
  await runScenarioGroup(['attribution-episodes']);
});

test(
  'pending-watch alternation stays within one bounded CPU episode',
  { timeout: 30_000 },
  async () => {
    await runScenarioGroup(['attribution-alternation']);
  },
);

test(
  'pending child failure, child error, and operator stop remain invalid',
  { timeout: 30_000 },
  async () => {
    await runScenarioGroup(['pending-failed-child', 'pending-child-error', 'completion-stop'], {
      simulateAttributionError: true,
    });
  },
);

test(
  'CPU boundary waits for startup owner rewrite before reading identity',
  { timeout: 30_000 },
  async () => {
    await runScenarioGroup(['recovered', 'confirmed', 'pending-exit'], {
      pauseOwnerRewrite: true,
    });
  },
);

test(
  'actual guard flags control CPU brackets while preserving watch decisions',
  { timeout: 120_000 },
  async () => {
    for (const options of [
      { bracketMode: 'valid' },
      { bracketMode: 'valid', guardFlag: true },
      { bracketMode: 'valid', oldFlag: true },
      { bracketMode: 'valid', guardFlag: true, oldFlag: true },
      { bracketMode: 'before-fail', guardFlag: true },
      { bracketMode: 'after-fail', guardFlag: true },
      { bracketMode: 'malformed', guardFlag: true },
      { bracketMode: 'calculation-fail', guardFlag: true },
    ])
      await runScenario(
        options.guardFlag && options.bracketMode === 'valid' && !options.oldFlag
          ? 'recovered'
          : 'healthy-bracket',
        process.hrtime.bigint(),
        options,
      );
  },
);

test(
  'scratch guard mutants cannot shortcut bracket sampling or emission',
  { timeout: 90_000 },
  async () => {
    for (const bracketMutation of ['sampling-off', 'emission-off', 'always-on', 'always-off']) {
      await assert.rejects(
        runScenario('healthy-bracket', process.hrtime.bigint(), {
          bracketMode: 'valid',
          guardFlag: bracketMutation !== 'always-on',
          bracketMutation,
        }),
        /guard flag must control bracket emission|guard must sample process brackets/,
      );
    }
  },
);

test('identical iostat samples and timestamps classify alike with and without brackets through expiry', async () => {
  const guard = await readFile(join(source, 'scripts/stabilization-resource.mjs'), 'utf8');
  const from = guard.indexOf('async function sample(profileDir, attributionRootPid) {');
  const to = guard.indexOf('\nasync function preflight(', from);
  assert(from >= 0 && to > from);
  const { cpuBusyFraction, diskIsLow } = await import('./stabilization-resource-safety.mjs');
  const { parseProcessTimes, processTimeBracket } = await import(
    './startup-interval-attribution.mjs'
  );
  const { cpuEpisode } = await import('./stabilization-resource-cpu.mjs');
  const policy = JSON.parse(
    await readFile(join(source, 'docs/stabilization/resource-policy.json')),
  );
  policy.watchIntervalSeconds = 0.5;
  let idle = 12;
  let now = 0;
  const context = {
    platform: () => 'darwin',
    output: async (cmd) =>
      cmd === '/usr/sbin/iostat'
        ? `cpu load average\n us sy id 1m 5m 15m\n 5 5 90 0.5 0.5 0.5\n ${100 - idle} 0 ${idle} 0.5 0.5 0.5`
        : cmd === '/bin/ps'
          ? '1 0 0:01.00 launchd'
          : 'System-wide memory free percentage: 80%',
    sysctl: async (key) =>
      ({
        'kern.memorystatus_vm_pressure_level': '1',
        'hw.memsize': String(16 * 1024 ** 3),
        'hw.logicalcpu': '8',
        'vm.loadavg': '{ 0.5 0.5 0.5 }',
        'vm.swapusage': 'used = 0M',
      })[key],
    sampleDiskSpace: async () => ({
      repoFreeGiB: 100,
      profileFreeGiB: 100,
      safetyFreeGiB: 100,
      systemFreeGiB: 100,
    }),
    cpuBusyFraction,
    parseProcessTimes,
    processTimeBracket,
    diskIsLow,
    repo: '/repo',
    root: '/lease',
    policy,
    GiB: 1024 ** 3,
    number: (value) => Number(value),
    startupBracket: undefined,
    Date,
  };
  const actual = runInNewContext(`${guard.slice(from, to)}; ({ sample, reasons })`, context);
  const run = async (enabled) => {
    const episode = cpuEpisode(policy, () => now);
    const result = [];
    for (const [at, nextIdle] of [
      [0, 12],
      [500, 90],
      [2500, 90],
    ]) {
      now = at;
      idle = nextIdle;
      const sample = await actual.sample('/profile', enabled ? 99 : undefined);
      result.push(episode.observe(actual.reasons(sample, sample)));
    }
    return result;
  };
  assert.deepEqual(await run(false), ['pending', 'pending_watch', 'expired']);
  assert.deepEqual(await run(true), ['pending', 'pending_watch', 'expired']);
});

test(
  'guard invalidates unsafe bracket and bracket journal write failure',
  { timeout: 45_000 },
  async () => {
    for (const bracketFailure of ['invalid', 'write']) {
      const item = await fixture({ bracketMode: 'valid', bracketFailure });
      const runId = `bracket-failure-${randomUUID()}`;
      let child;
      try {
        child = spawn(
          process.execPath,
          [
            item.guardPath,
            'run',
            '--run-id',
            runId,
            '--profile-dir',
            item.scratch,
            '--',
            'node',
            'scripts/prove-desktop-settings-guards.mjs',
          ],
          {
            cwd: item.scratch,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
              ...process.env,
              MATRX_GUARD_INTERVAL_DIAGNOSTIC: '1',
              MATRX_STARTUP_INTERVAL_DIAGNOSTIC: '0',
            },
          },
        );
        const stream = observe(child, () => {});
        const closed = new Promise((done) =>
          child.once('close', (code, signal) => done({ code, signal })),
        );
        await stream.next((event) => event.code === 'RESOURCE_ADMITTED');
        assert.deepEqual(
          await closed,
          { code: 3, signal: null },
          `${bracketFailure} must invalidate the run`,
        );
        const journal = (
          await readFile(join(item.docs, 'resource-journals', `${runId}.jsonl`), 'utf8')
        )
          .trim()
          .split('\n')
          .map(JSON.parse);
        assert.equal(journal.at(-1).resourceInvalid, true);
        assert.equal(journal.at(-1).decision, 'invalid');
      } finally {
        if (child && child.exitCode === null) child.kill('SIGTERM');
        await rm(item.scratch, { recursive: true, force: true });
      }
    }
  },
);
