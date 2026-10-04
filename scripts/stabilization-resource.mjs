#!/usr/bin/env node
// Host-local campaign permit. Campaign launchers must enter here:
//   node scripts/stabilization-resource.mjs run --run-id ID --profile-dir DIR -- pnpm compile
//   node scripts/stabilization-resource.mjs browser --run-id ID --profile-dir DIR
// Keep the browser command alive throughout manual UI work. After an unsafe
// request, stop UI work first; Ctrl-C then confirms it stopped and releases.
// "check" takes the same permit and performs only a 60-second preflight.
// If mkdir won but owner.json was never written, inspect the host and run
// "recover-ownerless --confirm-no-owned-work yes". It retires only an empty,
// 30-second-old lease after checking for another runner; other stale states stay closed.
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { openResourceJournal } from './stabilization-resource-journal.mjs';
import {
  assertNoLegacyLease,
  legacyLeaseRoots,
  reserveHeavyDirectory,
  resourceLeaseRoot,
} from './stabilization-resource-lease.mjs';
import { classifyLegacyRunner, parseProcessIdentity } from './stabilization-resource-process.mjs';
import {
  cpuBusyFraction,
  diskIsLow,
  processCpuAttribution,
  sampleDiskSpace,
  writeSafetyState,
} from './stabilization-resource-safety.mjs';
import { resourceVerdict } from './stabilization-resource-verdict.mjs';
import { parseProcessTimes, processTimeBracket } from './startup-interval-attribution.mjs';

const run = promisify(execFile);
const repo = resolve(import.meta.dirname, '..');
const policy = JSON.parse(
  await readFile(join(repo, 'docs/stabilization/resource-policy.json'), 'utf8'),
);
const root = resourceLeaseRoot();
const lock = join(root, 'heavy');
const reclaimLock = join(root, 'reclaim');
const holdPath = join(root, 'unsafe-hold.json');
const [mode, ...raw] = process.argv.slice(2);
let journal;
let activeRunId;
let resourceInvalid = false;
let journalBroken = false;
let safetyStateBroken = false;
let admitted = false;
let childFinished = false;
let operatorStopped = false;
let startupBracket;
const flags = new Map();
let command = [];
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === '--') {
    command = raw.slice(i + 1);
    break;
  }
  if (!raw[i].startsWith('--') || i + 1 >= raw.length) throw new Error('RESOURCE_ARGUMENT_INVALID');
  flags.set(raw[i], raw[++i]);
}
const emit = (code, extra = {}) => {
  const event = { schema: 1, at: new Date().toISOString(), ...extra, code };
  if (journal) {
    try {
      journal.write(event);
    } catch (error) {
      journalBroken = true;
      resourceInvalid = true;
      process.exitCode = 3;
      process.stderr.write(
        `RESOURCE_JOURNAL_WRITE_FAILED runId=${activeRunId} Stop manual browser work; the permit is retained.\n`,
      );
      throw error;
    }
  }
  console.log(JSON.stringify(event));
};
const fail = (code, extra = {}) => {
  emit(code, extra);
  process.exitCode = 2;
};
const persistSafetyState = async (path, state) => {
  try {
    await writeSafetyState(path, state);
  } catch (error) {
    // A missing hold or stop marker means the permit cannot be safely released.
    safetyStateBroken = true;
    resourceInvalid = true;
    process.exitCode = 3;
    process.stderr.write(
      `RESOURCE_SAFETY_STATE_WRITE_FAILED runId=${activeRunId} Stop manual browser work; the permit is retained.\n`,
    );
    throw error;
  }
};
const number = (value, name) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`RESOURCE_MEASUREMENT_INVALID:${name}`);
  return n;
};
const output = async (cmd, args) =>
  (
    await run(cmd, args, { timeout: 5000, maxBuffer: policy.processSnapshotMaxBytes })
  ).stdout.trim();
const sysctl = (name) => output('/usr/sbin/sysctl', ['-n', name]);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const GiB = 1024 ** 3;
const positive = (key) => Number.isFinite(policy[key]) && policy[key] > 0;
function validatePolicy() {
  if (
    policy.schema !== 1 ||
    !Array.isArray(policy.legacyTempDirectories) ||
    !policy.legacyTempDirectories.every((dir) => typeof dir === 'string' && dir.startsWith('/')) ||
    !Array.isArray(policy.allowedCommands) ||
    !policy.allowedCommands.length ||
    !policy.allowedCommands.every(
      (command) =>
        Array.isArray(command) &&
        command.length &&
        command.every((part) => typeof part === 'string' && part.length),
    ) ||
    ![
      'processSnapshotMaxBytes',
      'watchIntervalSeconds',
      'swapWindowSeconds',
      'unsafeSamplesToStop',
      'healthySamplesToResume',
      'minimumAvailableMemoryGiB',
      'minimumAvailableMemoryFraction',
      'maximumOneMinuteLoadPerLogicalCpu',
      'maximumSustainedCpuBusyFraction',
      'maximumBusyFractionAtHighLoad',
      'cpuSampleIntervalSeconds',
      'ownedGroupGraceSeconds',
      'ownedGroupKillWaitSeconds',
      'minimumFreeDiskGiB',
      'maximumSwapGrowthMiB',
      'normalMacPressureLevel',
    ].every(positive) ||
    policy.cpuSampleIntervalSeconds > policy.swapWindowSeconds ||
    policy.maximumSustainedCpuBusyFraction > 1 ||
    policy.maximumBusyFractionAtHighLoad > 1 ||
    policy.minimumAvailableMemoryFraction > 1 ||
    !['unsafeSamplesToStop', 'healthySamplesToResume'].every((key) => Number.isInteger(policy[key]))
  )
    throw new Error('RESOURCE_POLICY_INVALID');
}

async function processIdentity(pid) {
  try {
    const value = await output('/bin/ps', ['-p', String(pid), '-o', 'lstart=']);
    return value || null;
  } catch (error) {
    if (error.code === 1) return null;
    throw error;
  }
}

async function groupMembers(groupId) {
  const raw = await output('/bin/ps', ['-axo', 'pid=,pgid=,stat=']);
  return raw
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(
      (parts) => parts.length >= 3 && Number(parts[1]) === groupId && !parts[2].startsWith('Z'),
    )
    .map((parts) => Number(parts[0]));
}

async function groupGone(groupId) {
  return (await groupMembers(groupId)).length === 0;
}

async function waitGroupGone(groupId, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await groupGone(groupId)) return true;
    await sleep(250);
  }
  return groupGone(groupId);
}

async function stopOwnedGroup(groupId, runId, reason) {
  if (await groupGone(groupId)) return true;
  emit('RESOURCE_GROUP_STOP_REQUESTED', { runId, groupId, reason, signal: 'SIGTERM' });
  try {
    process.kill(-groupId, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  if (await waitGroupGone(groupId, policy.ownedGroupGraceSeconds)) return true;
  emit('RESOURCE_GROUP_ESCALATED', { runId, groupId, signal: 'SIGKILL' });
  try {
    process.kill(-groupId, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  return waitGroupGone(groupId, policy.ownedGroupKillWaitSeconds);
}

// Cooperative trusted-tool boundary: all children MUST preserve this environment
// token. Detached Node/tool children are discoverable; daemonizing commands,
// protected-system-binary detached children, env -i and brokers are forbidden.
// Never log ps environment output: it can contain unrelated credentials.
async function ownedProcesses(nonce) {
  const raw = await output('/bin/ps', ['eww', '-axo', 'pid=,stat=,command=']);
  const token = `MATRX_RESOURCE_OWNER=${nonce}`;
  const matches = [];
  for (const line of raw.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!match || match[2].startsWith('Z') || !match[3].split(/\s+/).includes(token)) continue;
    const pid = Number(match[1]);
    const identity = await processIdentity(pid);
    if (identity) matches.push({ pid, identity });
  }
  return matches;
}

async function stopOwnedProcesses(owner) {
  // Repeated census also catches children born during shutdown. A bounded failure
  // retains the lease; the next invocation can recover it without human action.
  for (const [signal, seconds] of [
    ['SIGTERM', policy.ownedGroupGraceSeconds],
    ['SIGKILL', policy.ownedGroupKillWaitSeconds],
  ]) {
    const deadline = Date.now() + seconds * 1000;
    do {
      const members = await ownedProcesses(owner.nonce);
      if (!members.length) return true;
      for (const member of members) {
        if ((await processIdentity(member.pid)) !== member.identity) continue;
        try {
          process.kill(member.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      await sleep(250);
    } while (Date.now() < deadline);
  }
  return (await ownedProcesses(owner.nonce)).length === 0;
}

function validateCommand() {
  if (mode !== 'run') return;
  const exact = policy.allowedCommands.some(
    (allowed) => JSON.stringify(command) === JSON.stringify(allowed),
  );
  // Only positional test-file filters may follow the single-worker test command.
  const testPrefix = ['pnpm', 'exec', 'vitest', 'run', '--maxWorkers=1'];
  const filteredTest =
    testPrefix.every((part, i) => command[i] === part) &&
    command
      .slice(testPrefix.length)
      .every(
        (part) =>
          /^[A-Za-z0-9_./-]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(part) && !part.startsWith('-'),
      );
  if (!exact && !filteredTest)
    throw new Error('RESOURCE_COMMAND_NOT_ALLOWED:see docs/stabilization/resource-policy.json');
}

async function sample(profileDir, attributionRootPid) {
  if (platform() !== 'darwin') throw new Error('RESOURCE_UNSUPPORTED_PLATFORM');
  const cpuOutput = async (cmd, args) => {
    if (!attributionRootPid) return output(cmd, args);
    const readProcesses = async () => ({
      at: new Date().toISOString(),
      processes: parseProcessTimes(
        await output('/bin/ps', ['-A', '-o', 'pid=,ppid=,time=,ucomm=']),
      ),
      completedAt: new Date().toISOString(),
    });
    let before;
    let after;
    try {
      before = await readProcesses();
    } catch {
      /* The guard sample still runs. */
    }
    const iostatStartedAt = new Date().toISOString();
    const raw = await output(cmd, args);
    const iostatCompletedAt = new Date().toISOString();
    try {
      after = await readProcesses();
    } catch {
      /* Evidence reports unavailable. */
    }
    let detail;
    try {
      detail =
        before && after
          ? processTimeBracket(before.processes, after.processes, attributionRootPid)
          : {
              unavailable: true,
              limitation:
                'A process snapshot failed; no process attribution is available for this guard sample.',
            };
    } catch {
      detail = {
        unavailable: true,
        limitation: 'Process bracket calculation failed; guard sampling is unchanged.',
      };
    }
    startupBracket = {
      iostatStartedAt,
      iostatCompletedAt,
      beforeCompletedAt: before?.completedAt ?? null,
      afterStartedAt: after?.at ?? null,
      ...detail,
    };
    return raw;
  };
  const [memory, pressure, total, cpus, load, swap, disk, cpuBusy] = await Promise.all([
    output('/usr/bin/memory_pressure', ['-Q']),
    sysctl('kern.memorystatus_vm_pressure_level'),
    sysctl('hw.memsize'),
    sysctl('hw.logicalcpu'),
    sysctl('vm.loadavg'),
    sysctl('vm.swapusage'),
    sampleDiskSpace({ repo, profileDir, leaseRoot: root }),
    cpuBusyFraction(cpuOutput),
  ]);
  const freePercent = number(
    memory.match(/System-wide memory free percentage:\s*([\d.]+)%/)?.[1],
    'available-memory',
  );
  const oneMinuteLoad = number(load.match(/\{\s*([\d.]+)/)?.[1], 'load');
  const swapUsedMiB =
    number(swap.match(/used\s*=\s*([\d.]+)([MG])/)?.[1], 'swap') *
    (swap.match(/used\s*=\s*([\d.]+)([MG])/)?.[2] === 'G' ? 1024 : 1);
  const logicalCpus = number(cpus, 'logical-cpus');
  if (logicalCpus === 0 || freePercent > 100)
    throw new Error('RESOURCE_MEASUREMENT_INVALID:cpu-or-memory');
  return {
    pressureLevel: number(pressure, 'pressure'),
    availableMemoryGiB: (number(total, 'physical-memory') * freePercent) / 100 / GiB,
    requiredMemoryGiB: Math.max(
      policy.minimumAvailableMemoryGiB,
      (number(total, 'physical-memory') * policy.minimumAvailableMemoryFraction) / GiB,
    ),
    oneMinuteLoad,
    logicalCpus,
    cpuBusyFraction: cpuBusy,
    swapUsedMiB,
    ...disk,
  };
}

function reasons(current, previous) {
  const bad = [];
  if (current.pressureLevel !== policy.normalMacPressureLevel) bad.push('RESOURCE_PRESSURE_UNSAFE');
  if (current.availableMemoryGiB < current.requiredMemoryGiB) bad.push('RESOURCE_MEMORY_LOW');
  if (current.cpuBusyFraction >= policy.maximumSustainedCpuBusyFraction)
    bad.push('RESOURCE_CPU_BUSY');
  if (
    current.oneMinuteLoad / current.logicalCpus >= policy.maximumOneMinuteLoadPerLogicalCpu &&
    current.cpuBusyFraction >= policy.maximumBusyFractionAtHighLoad
  )
    bad.push('RESOURCE_CPU_HIGH_LOAD_BUSY');
  if (diskIsLow(current, policy.minimumFreeDiskGiB)) bad.push('RESOURCE_DISK_LOW');
  if (!previous) bad.push('RESOURCE_SWAP_BASELINE_MISSING');
  else if (current.swapUsedMiB - previous.swapUsedMiB > policy.maximumSwapGrowthMiB)
    bad.push('RESOURCE_SWAP_GROWTH');
  return bad;
}

async function preflight(profileDir) {
  const first = await sample(profileDir);
  const samples = [first];
  const intervals = Math.ceil(policy.swapWindowSeconds / policy.cpuSampleIntervalSeconds);
  for (let i = 0; i < intervals; i++) {
    await sleep((policy.swapWindowSeconds * 1000) / intervals);
    samples.push(await sample(profileDir));
  }
  const second = {
    ...samples.at(-1),
    oneMinuteLoad:
      Math.max(...samples.map((item) => item.oneMinuteLoad / item.logicalCpus)) *
      samples.at(-1).logicalCpus,
    cpuBusyFraction: samples.reduce((sum, item) => sum + item.cpuBusyFraction, 0) / samples.length,
  };
  const allReasons = [
    ...new Set(
      samples.flatMap((item) =>
        reasons(item, first).filter((reason) => !reason.startsWith('RESOURCE_CPU_')),
      ),
    ),
  ];
  allReasons.push(...reasons(second, first).filter((reason) => reason.startsWith('RESOURCE_CPU_')));
  return {
    sample: second,
    cpuBusySamples: samples.map((item) => item.cpuBusyFraction),
    reasons: allReasons,
    swapWindowSeconds: policy.swapWindowSeconds,
  };
}

async function recoverHold(profileDir) {
  if (!existsSync(holdPath)) return true;
  let hold = JSON.parse(await readFile(holdPath, 'utf8'));
  if (hold.schema !== 1) throw new Error('RESOURCE_UNSAFE_HOLD_INVALID');
  let baseline = await sample(profileDir);
  while (hold.healthySamples < policy.healthySamplesToResume) {
    await sleep(policy.watchIntervalSeconds * 1000);
    const current = await sample(profileDir);
    const bad = reasons(current, baseline);
    if (bad.length) {
      await persistSafetyState(holdPath, { ...hold, healthySamples: 0, reason: bad });
      fail('RESOURCE_UNSAFE_HOLD', { reasons: bad, sample: current });
      return false;
    }
    hold = { ...hold, healthySamples: hold.healthySamples + 1 };
    await persistSafetyState(holdPath, hold);
    baseline = current;
  }
  emit('RESOURCE_RECOVERY_SAMPLES_READY', { previousRunId: hold.runId });
  return true;
}

async function readOwner() {
  return JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
}

async function acquire(owner) {
  try {
    await reserveHeavyDirectory(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // A fixed reclaim mutex makes stale retirement and reacquisition serial.
    try {
      await mkdir(reclaimLock, { mode: 0o700 });
    } catch (lockError) {
      if (lockError.code === 'EEXIST') throw new Error('RESOURCE_RECLAIM_BUSY');
      throw lockError;
    }
    try {
      const prior = await readOwner().catch(() => {
        throw new Error('RESOURCE_OWNER_UNREADABLE');
      });
      const identity = await processIdentity(prior.pid);
      if (identity === prior.processStart) throw new Error('RESOURCE_HEAVY_BUSY');
      // A reused PID has a different start time: the original owner is gone.
      if (!prior.processStart || !prior.nonce) throw new Error('RESOURCE_OWNER_UNVERIFIED');
      if (prior.kind === 'browser')
        throw new Error(
          'RESOURCE_STALE_BROWSER:stop manual UI work then use recover-browser --confirm-no-owned-work yes',
        );
      if (prior.childPending || prior.groupId) {
        if (prior.ownership !== 'inherited-token-v1')
          throw new Error('RESOURCE_STALE_OWNER_NEEDS_REVIEW');
        if (!(await stopOwnedProcesses(prior)))
          throw new Error('RESOURCE_OWNED_PROCESS_STILL_RUNNING');
      }
      if (prior.groupId && !(await groupGone(prior.groupId)))
        throw new Error('RESOURCE_GROUP_STILL_RUNNING');
      const retired = join(root, `retired-${prior.nonce}`);
      await rename(lock, retired);
      await reserveHeavyDirectory(lock);
      await rm(retired, { recursive: true });
    } finally {
      await rm(reclaimLock, { recursive: true });
    }
  }
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify(owner) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    throw new Error(`RESOURCE_OWNER_WRITE_FAILED:${error.code ?? error.message}`);
  }
}

async function legacyRunnerEvidence() {
  // comm is the kernel's executable identity on macOS. ps command is display
  // text only, so inspect it only after comm establishes an actual Node PID.
  const processes = await output('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,comm=']);
  const matches = [];
  let overflow = 0;
  for (const line of processes.split('\n')) {
    if (!line.trim()) continue;
    const entry = parseProcessIdentity(line);
    if (entry.pid === process.pid || entry.executable.split('/').at(-1) !== 'node') continue;
    let detail;
    try {
      detail = await output('/bin/ps', ['-p', String(entry.pid), '-o', 'lstart=,command=']);
    } catch (error) {
      if (error.code === 1) continue; // Exited before its command could be read.
      throw error;
    }
    const start = detail.slice(0, 24).trim();
    if (start !== entry.processStart) continue; // PID was reused during the scan.
    const reason = classifyLegacyRunner(entry.executable, detail.slice(24).trim());
    if (!reason) continue;
    // Recheck the same PID and start just before attributing the refusal.
    if ((await processIdentity(entry.pid)) !== entry.processStart) continue;
    if (matches.length < 5) {
      matches.push({
        pid: entry.pid,
        ppid: entry.ppid,
        processStart: entry.processStart,
        executable: 'node',
        reason,
      });
    } else overflow++;
  }
  return matches.length ? { matches, overflow } : null;
}

async function assertNoLegacyWork() {
  await assertNoLegacyLease(await legacyLeaseRoots(undefined, policy.legacyTempDirectories));
  // Existing runners may have used an arbitrary external TMPDIR. Refuse while
  // one is alive, even when its old lease directory is outside our known roots.
  const evidence = await legacyRunnerEvidence();
  if (evidence)
    throw Object.assign(new Error('RESOURCE_LEGACY_RUNNER_BUSY'), { processEvidence: evidence });
  // A dead old holder can leave detached owned work. Never admit over it.
  const environment = await output('/bin/ps', ['eww', '-axo', 'pid=,stat=,command=']);
  if (
    environment
      .split('\n')
      .some(
        (line) =>
          /(?:^|\s)MATRX_RESOURCE_OWNER=[0-9a-f-]{36}(?:\s|$)/.test(line) &&
          !/^\s*\d+\s+Z/.test(line),
      )
  )
    throw new Error('RESOURCE_LEGACY_OWNED_PROCESS_BUSY');
}

async function release(owner) {
  const current = await readOwner();
  if (current.nonce !== owner.nonce || current.processStart !== owner.processStart)
    throw new Error('RESOURCE_OWNER_CHANGED');
  await rm(join(lock, 'owner.json'));
  await rmdir(lock);
}

async function recoverBrowser() {
  if (flags.get('--confirm-no-owned-work') !== 'yes')
    throw new Error('RESOURCE_RECOVERY_CONFIRMATION_REQUIRED');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(reclaimLock, { mode: 0o700 });
  try {
    const prior = await readOwner();
    if (
      prior.kind !== 'browser' ||
      !prior.processStart ||
      !prior.nonce ||
      (await processIdentity(prior.pid)) === prior.processStart
    )
      throw new Error('RESOURCE_BROWSER_RECOVERY_NOT_PROVEN');
    await release(prior);
    emit('RESOURCE_BROWSER_LEASE_RETIRED');
  } finally {
    await rmdir(reclaimLock);
  }
}

async function recoverOwnerless() {
  if (flags.get('--confirm-no-owned-work') !== 'yes')
    throw new Error('RESOURCE_RECOVERY_CONFIRMATION_REQUIRED');
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    await mkdir(reclaimLock, { mode: 0o700 });
  } catch (error) {
    throw new Error(error.code === 'EEXIST' ? 'RESOURCE_RECLAIM_BUSY' : 'RESOURCE_RECOVERY_FAILED');
  }
  try {
    const lockStat = await stat(lock).catch(() => {
      throw new Error('RESOURCE_OWNERLESS_NOT_PROVEN');
    });
    if (
      !lockStat.isDirectory() ||
      Date.now() - lockStat.mtimeMs < 30_000 ||
      (await readdir(lock)).length
    )
      throw new Error('RESOURCE_OWNERLESS_NOT_PROVEN');
    if (await legacyRunnerEvidence()) throw new Error('RESOURCE_OWNERLESS_NOT_PROVEN');
    await rmdir(lock);
    emit('RESOURCE_OWNERLESS_RETIRED', { root });
  } finally {
    await rmdir(reclaimLock);
  }
}

async function main() {
  // Establish durable evidence before any policy or command refusal. A reused ID
  // cannot replace a prior run's history or obtain a resource permit.
  if (['check', 'run', 'browser'].includes(mode)) {
    activeRunId = flags.get('--run-id') ?? (mode === 'check' ? `check-${randomUUID()}` : undefined);
    journal = openResourceJournal(repo, activeRunId);
    emit('RESOURCE_JOURNAL_OPENED', { runId: activeRunId, path: journal.path });
  }
  if (
    !['check', 'run', 'browser', 'recover-ownerless', 'recover-browser'].includes(mode) ||
    (mode === 'run' && !command.length) ||
    (mode !== 'run' && command.length)
  )
    throw new Error('RESOURCE_ARGUMENT_INVALID');
  validatePolicy();
  validateCommand();
  if (mode === 'recover-ownerless') return recoverOwnerless();
  if (mode === 'recover-browser') return recoverBrowser();
  const runId = activeRunId;
  const profileDir = resolve(flags.get('--profile-dir') ?? repo);
  if (mode !== 'check' && (!runId || !/^[A-Za-z0-9_.-]+$/.test(runId)))
    throw new Error('RESOURCE_RUN_ID_INVALID');
  const profileStat = await stat(profileDir);
  if (!profileStat.isDirectory()) throw new Error('RESOURCE_PROFILE_INVALID');
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Reserve first: no competing preflights can both see an idle machine and launch.
  const owner = {
    schema: 1,
    pid: process.pid,
    processStart: await processIdentity(process.pid),
    runId: runId ?? 'check',
    kind: mode,
    nonce: randomUUID(),
    acquiredAt: new Date().toISOString(),
  };
  if (!owner.processStart) throw new Error('RESOURCE_PROCESS_IDENTITY_MISSING');
  await acquire(owner);
  let child;
  let settled;
  let groupId;
  let stop = false;
  let wakeStop;
  const stopEvent = new Promise((done) => {
    wakeStop = done;
  });
  let unsafe = 0;
  let healthy = 0;
  let attributionPending;
  let previous;
  let swapWindowAt = 0;
  const stopSignal = (signal) => {
    stop = true;
    emit('RESOURCE_STOP_REQUESTED', { runId, signal });
    wakeStop({ stop: true, signal });
  };
  process.on('SIGINT', () => stopSignal('SIGINT'));
  process.on('SIGTERM', () => stopSignal('SIGTERM'));
  try {
    await assertNoLegacyWork();
    if (!(await recoverHold(profileDir))) return;
    const pre = await preflight(profileDir);
    if (pre.reasons.length) {
      fail('RESOURCE_PREFLIGHT_REFUSED', { runId, ...pre });
      return;
    }
    if (stop) {
      fail('RESOURCE_STOP_REQUESTED', { runId });
      return;
    }
    previous = pre.sample;
    swapWindowAt = Date.now();
    if (existsSync(holdPath)) {
      await rm(holdPath);
    }
    emit('RESOURCE_ADMITTED', { runId, mode, policySchema: policy.schema, ...pre });
    admitted = true;
    if (mode === 'check') return;
    if (mode === 'run') {
      owner.childPending = true;
      await writeFile(join(lock, 'owner.json'), JSON.stringify(owner) + '\n', { mode: 0o600 });
      owner.ownership = 'inherited-token-v1';
      await writeFile(join(lock, 'owner.json'), JSON.stringify(owner) + '\n', { mode: 0o600 });
      child = spawn(command[0], command.slice(1), {
        detached: true,
        stdio: 'inherit',
        cwd: repo,
        env: {
          ...process.env,
          MATRX_RESOURCE_OWNER: owner.nonce,
          MATRX_RESOURCE_RUN_ID: runId,
          MATRX_RESOURCE_STOP_FILE: join(root, `stop-${owner.nonce}.json`),
        },
      });
      // Attach lifecycle listeners before the first await: /usr/bin/true may exit immediately.
      settled = new Promise((done) => {
        child.once('error', (error) =>
          done({ childError: error.message, childExitCode: null, childSignal: null }),
        );
        child.once('close', (code, signal) => done({ childExitCode: code, childSignal: signal }));
      });
      groupId = child.pid;
      owner.groupId = groupId;
      owner.childStart = groupId ? await processIdentity(groupId) : null;
      owner.childPending = !groupId;
      await writeFile(join(lock, 'owner.json'), JSON.stringify(owner) + '\n', { mode: 0o600 });
    }
    while (true) {
      const result = await Promise.race([
        sleep(policy.watchIntervalSeconds * 1000).then(() => null),
        settled ?? new Promise(() => {}),
        stopEvent,
      ]);
      if (result?.stop) {
        operatorStopped = true;
        if (mode === 'browser') {
          emit('RESOURCE_BROWSER_STOP_CONFIRMED', { runId, resourceInvalid });
          process.exitCode = resourceInvalid ? 3 : 0;
          break;
        }
        if (groupId && !(await stopOwnedGroup(groupId, runId, 'operator-signal')))
          throw new Error('RESOURCE_GROUP_UNCONFIRMED');
        process.exitCode = resourceInvalid ? 3 : 130;
        break;
      }
      if (result) {
        emit('RESOURCE_JOB_EXIT', { runId, ...result });
        childFinished = true;
        if (
          groupId &&
          !(await stopOwnedGroup(groupId, runId, 'child-exited-with-owned-descendants'))
        )
          throw new Error('RESOURCE_GROUP_UNCONFIRMED');
        process.exitCode = resourceInvalid ? 3 : (result.childExitCode ?? 1);
        break;
      }
      let current;
      let bad;
      startupBracket = undefined;
      try {
        current = await sample(
          profileDir,
          process.env.MATRX_STARTUP_INTERVAL_DIAGNOSTIC === '1' ? groupId : undefined,
        );
        bad = reasons(current, previous);
      } catch (error) {
        bad = [`RESOURCE_MEASUREMENT_FAILED:${error.message}`];
      }
      if (current && Date.now() - swapWindowAt >= policy.swapWindowSeconds * 1000) {
        previous = current;
        swapWindowAt = Date.now();
      }
      if (bad.length) {
        unsafe++;
        healthy = 0;
      } else {
        unsafe = 0;
        healthy++;
      }
      if (bad.length && existsSync(holdPath)) {
        const hold = JSON.parse(await readFile(holdPath, 'utf8'));
        await persistSafetyState(holdPath, { ...hold, healthySamples: 0 });
      }
      emit(bad.length ? 'RESOURCE_WATCH_UNSAFE' : 'RESOURCE_WATCH_HEALTHY', {
        runId,
        reasons: bad,
        sample: current,
      });
      if (process.env.MATRX_STARTUP_INTERVAL_DIAGNOSTIC === '1')
        emit('RESOURCE_STARTUP_INTERVAL_BRACKET', {
          runId,
          bracket: startupBracket ?? { unavailable: true },
        });
      if (
        bad.length &&
        unsafe === 1 &&
        unsafe < policy.unsafeSamplesToStop &&
        !attributionPending
      ) {
        // The unsafe event is durable first. Diagnosis uses the existing
        // bounded command runner and never delays the watch/stop loop.
        attributionPending = processCpuAttribution(output)
          .then(
            (processes) => ({ processes }),
            () => ({ unavailable: true }),
          )
          .then((detail) => emit('RESOURCE_PROCESS_ATTRIBUTION', { runId, ...detail }));
        void attributionPending.catch(() => {});
      }
      if (unsafe >= policy.unsafeSamplesToStop) {
        const hold = {
          schema: 1,
          runId,
          reason: bad,
          at: new Date().toISOString(),
          healthySamples: 0,
        };
        await persistSafetyState(holdPath, hold);
        await persistSafetyState(join(root, `stop-${owner.nonce}.json`), hold);
        emit('RESOURCE_STOP_AT_SAFE_BOUNDARY', { runId, reasons: bad });
        resourceInvalid = true;
        process.exitCode = 3;
        unsafe = 0;
        if (mode === 'run') {
          if (groupId && !(await stopOwnedGroup(groupId, runId, 'watchdog')))
            throw new Error('RESOURCE_GROUP_UNCONFIRMED');
          break;
        }
        emit('RESOURCE_BROWSER_OPERATOR_STOP_REQUIRED', {
          runId,
          instruction: 'Stop manual browser work, then press Ctrl-C on this lease holder.',
        });
      }
      if (existsSync(holdPath) && healthy >= policy.healthySamplesToResume) {
        const hold = JSON.parse(await readFile(holdPath, 'utf8'));
        await persistSafetyState(holdPath, { ...hold, healthySamples: healthy });
        emit('RESOURCE_RECOVERY_SAMPLES_READY', { runId });
      }
    }
  } finally {
    // Once launch begins, no exception path may release before the all-session
    // census succeeds. Failed census/cleanup deliberately leaves durable ownership.
    let canRelease = true;
    if (owner.ownership && !(await stopOwnedProcesses(owner))) {
      emit('RESOURCE_OWNED_PROCESS_STILL_RUNNING', {
        runId,
        recovery: 'Rerun the same guarded command; stale ownership cleanup is automatic.',
      });
      process.exitCode = 3;
      canRelease = false;
    } else if (groupId && !(await groupGone(groupId))) {
      emit('RESOURCE_GROUP_STILL_RUNNING', { runId, groupId });
      process.exitCode = 3;
      canRelease = false;
    }
    if (attributionPending) await attributionPending;
    if (canRelease && !journalBroken && !safetyStateBroken) await release(owner);
  }
}

try {
  await main();
} catch (error) {
  if (admitted) resourceInvalid = true;
  if (journalBroken || safetyStateBroken) {
    // A later successful write cannot repair missing journal or safety state.
    // Keep the permit and invalid verdict instead of letting fail() downgrade to 2.
    process.exitCode = 3;
    if (safetyStateBroken && !journalBroken) {
      try {
        emit('RESOURCE_SAFETY_STATE_WRITE_FAILED', { runId: activeRunId });
      } catch {
        process.exitCode = 3;
      }
    }
  } else {
    const code = error.message.startsWith('RESOURCE_')
      ? error.message
      : 'RESOURCE_MEASUREMENT_FAILED';
    try {
      fail(code, {
        runId: activeRunId,
        detail: error.message,
        ...(error.processEvidence && { processEvidence: error.processEvidence }),
      });
    } catch {
      process.stderr.write(`RESOURCE_JOURNAL_WRITE_FAILED runId=${activeRunId ?? 'unavailable'}\n`);
      process.exitCode = 3;
    }
  }
} finally {
  if (journal) {
    try {
      const exitCode = process.exitCode ?? 0;
      emit('RESOURCE_FINAL_DECISION', {
        runId: activeRunId,
        admitted,
        resourceInvalid,
        exitCode,
        decision: resourceVerdict({
          admitted,
          resourceInvalid,
          exitCode,
          childFinished,
          operatorStopped,
        }),
      });
      const closed = journal.close();
      if (closed.pendingCleanupFailed)
        process.stderr.write(`RESOURCE_JOURNAL_PENDING_CLEANUP_FAILED runId=${activeRunId}\n`);
    } catch {
      process.stderr.write(`RESOURCE_JOURNAL_FINALIZE_FAILED runId=${activeRunId}\n`);
      process.exitCode = 3;
    }
  }
}
