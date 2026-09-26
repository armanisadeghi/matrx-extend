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
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { platform, tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repo = resolve(import.meta.dirname, '..');
const policy = JSON.parse(
  await readFile(join(repo, 'docs/stabilization/resource-policy.json'), 'utf8'),
);
const root = join(tmpdir(), `matrx-stabilization-resource-${userInfo().uid}`);
const lock = join(root, 'heavy');
const reclaimLock = join(root, 'reclaim');
const holdPath = join(root, 'unsafe-hold.json');
const [mode, ...raw] = process.argv.slice(2);
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
const emit = (code, extra = {}) =>
  console.log(JSON.stringify({ schema: 1, at: new Date().toISOString(), ...extra, code }));
const fail = (code, extra = {}) => {
  emit(code, extra);
  process.exitCode = 2;
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

async function cpuBusyFraction() {
  const raw = await output('/usr/bin/top', ['-l', '2', '-s', '1', '-n', '0']);
  const readings = [...raw.matchAll(/CPU usage:.*?([\d.]+)% idle/g)];
  if (readings.length < 2) throw new Error('RESOURCE_MEASUREMENT_INVALID:cpu-busy');
  const idle = number(readings.at(-1)[1], 'cpu-idle');
  if (idle > 100) throw new Error('RESOURCE_MEASUREMENT_INVALID:cpu-idle');
  return 1 - idle / 100;
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
  const testPrefix = ['pnpm', 'exec', 'vitest', 'run', '--maxWorkers=1', '--minWorkers=1'];
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

async function sample(profileDir) {
  if (platform() !== 'darwin') throw new Error('RESOURCE_UNSUPPORTED_PLATFORM');
  const [memory, pressure, total, cpus, load, swap, repoDisk, profileDisk, cpuBusy] =
    await Promise.all([
      output('/usr/bin/memory_pressure', ['-Q']),
      sysctl('kern.memorystatus_vm_pressure_level'),
      sysctl('hw.memsize'),
      sysctl('hw.logicalcpu'),
      sysctl('vm.loadavg'),
      sysctl('vm.swapusage'),
      statfs(repo),
      statfs(profileDir),
      cpuBusyFraction(),
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
    repoFreeGiB: number(Number(repoDisk.bavail) * Number(repoDisk.bsize), 'repo-disk') / GiB,
    profileFreeGiB:
      number(Number(profileDisk.bavail) * Number(profileDisk.bsize), 'profile-disk') / GiB,
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
  if (
    current.repoFreeGiB < policy.minimumFreeDiskGiB ||
    current.profileFreeGiB < policy.minimumFreeDiskGiB
  )
    bad.push('RESOURCE_DISK_LOW');
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
      await writeFile(
        holdPath,
        JSON.stringify({ ...hold, healthySamples: 0, reason: bad }) + '\n',
        { mode: 0o600 },
      );
      fail('RESOURCE_UNSAFE_HOLD', { reasons: bad, sample: current });
      return false;
    }
    hold = { ...hold, healthySamples: hold.healthySamples + 1 };
    await writeFile(holdPath, JSON.stringify(hold) + '\n', { mode: 0o600 });
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
    await mkdir(lock, { mode: 0o700 });
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
      await mkdir(lock, { mode: 0o700 });
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
    const processes = await output('/bin/ps', ['-axo', 'pid=,command=']);
    const anotherRunner = processes.split('\n').some((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      return (
        match &&
        Number(match[1]) !== process.pid &&
        /(?:^|\/)node\s/.test(match[2]) &&
        match[2].includes('stabilization-resource.mjs')
      );
    });
    if (anotherRunner) throw new Error('RESOURCE_OWNERLESS_NOT_PROVEN');
    await rmdir(lock);
    emit('RESOURCE_OWNERLESS_RETIRED', { root });
  } finally {
    await rmdir(reclaimLock);
  }
}

async function main() {
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
  const runId = flags.get('--run-id');
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
  let previous;
  let swapWindowAt = 0;
  let resourceInvalid = false;
  const stopSignal = (signal) => {
    stop = true;
    emit('RESOURCE_STOP_REQUESTED', { runId, signal });
    wakeStop({ stop: true, signal });
  };
  process.on('SIGINT', () => stopSignal('SIGINT'));
  process.on('SIGTERM', () => stopSignal('SIGTERM'));
  try {
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
      try {
        current = await sample(profileDir);
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
        await writeFile(holdPath, JSON.stringify({ ...hold, healthySamples: 0 }) + '\n', {
          mode: 0o600,
        });
      }
      emit(bad.length ? 'RESOURCE_WATCH_UNSAFE' : 'RESOURCE_WATCH_HEALTHY', {
        runId,
        reasons: bad,
        sample: current,
      });
      if (unsafe >= policy.unsafeSamplesToStop) {
        const hold = {
          schema: 1,
          runId,
          reason: bad,
          at: new Date().toISOString(),
          healthySamples: 0,
        };
        await writeFile(holdPath, JSON.stringify(hold) + '\n', { mode: 0o600 });
        await writeFile(join(root, `stop-${owner.nonce}.json`), JSON.stringify(hold) + '\n', {
          mode: 0o600,
        });
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
        await writeFile(holdPath, JSON.stringify({ ...hold, healthySamples: healthy }) + '\n', {
          mode: 0o600,
        });
        emit('RESOURCE_RECOVERY_SAMPLES_READY', { runId });
      }
    }
  } finally {
    // Once launch begins, no exception path may release before the all-session
    // census succeeds. Failed census/cleanup deliberately leaves durable ownership.
    if (owner.ownership && !(await stopOwnedProcesses(owner))) {
      emit('RESOURCE_OWNED_PROCESS_STILL_RUNNING', {
        runId,
        recovery: 'Rerun the same guarded command; stale ownership cleanup is automatic.',
      });
      process.exitCode = 3;
    } else if (groupId && !(await groupGone(groupId))) {
      emit('RESOURCE_GROUP_STILL_RUNNING', { runId, groupId });
      process.exitCode = 3;
    } else await release(owner);
  }
}

try {
  await main();
} catch (error) {
  fail(error.message.startsWith('RESOURCE_') ? error.message : 'RESOURCE_MEASUREMENT_FAILED', {
    detail: error.message,
  });
}
