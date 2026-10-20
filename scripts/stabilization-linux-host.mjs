import { readFile, readdir } from 'node:fs/promises';

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const PROC = '/proc';
const fail = (name) => new Error(`RESOURCE_MEASUREMENT_INVALID:linux-${name}`);

function nonnegativeInteger(value, name) {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value ?? '')) throw fail(name);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw fail(name);
  return parsed;
}

export function parseLinuxCpu(raw) {
  const lines = raw.split('\n');
  const fields = lines[0]?.match(/^cpu\s+((?:\d+\s+){7,9}\d+)\s*$/);
  if (!fields) throw fail('cpu');
  const times = fields[1]
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .map((value) => nonnegativeInteger(value, 'cpu'));
  const logicalCpus = lines.filter((line) => /^cpu\d+\s/.test(line)).length;
  if (logicalCpus === 0) throw fail('logical-cpus');
  const total = times.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw fail('cpu');
  return { counters: times, total, idle: times[3], logicalCpus };
}

export function parseLinuxPsi(raw) {
  const lines = raw.trim().split('\n');
  if (lines.length !== 2) throw fail('pressure');
  const rows = {};
  for (const line of lines) {
    const match = line.match(
      /^(some|full) avg10=(\d+\.\d{2}) avg60=(\d+\.\d{2}) avg300=(\d+\.\d{2}) total=(\d+)$/,
    );
    if (!match || Object.hasOwn(rows, match[1])) throw fail('pressure');
    for (const average of match.slice(2, 5))
      if (!Number.isFinite(Number(average)) || Number(average) < 0 || Number(average) > 100)
        throw fail('pressure');
    rows[match[1]] = nonnegativeInteger(match[5], 'pressure');
  }
  if (!Object.hasOwn(rows, 'some') || !Object.hasOwn(rows, 'full')) throw fail('pressure');
  return rows;
}

export function parseLinuxMemory(raw) {
  const values = new Map();
  const required = new Set(['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree']);
  for (const line of raw.trim().split('\n')) {
    const key = line.match(/^([^:]+):/)?.[1];
    if (!required.has(key)) continue;
    const match = line.match(/^([A-Za-z]+):\s+(\d+) kB$/);
    if (!match || values.has(match[1])) throw fail('memory');
    values.set(match[1], nonnegativeInteger(match[2], 'memory') * 1024);
  }
  for (const key of required) if (!values.has(key)) throw fail('memory');
  if (
    values.get('MemTotal') === 0 ||
    values.get('MemAvailable') > values.get('MemTotal') ||
    values.get('SwapFree') > values.get('SwapTotal')
  )
    throw fail('memory');
  return {
    physicalMemoryGiB: values.get('MemTotal') / GiB,
    availableMemoryGiB: values.get('MemAvailable') / GiB,
    swapUsedMiB: (values.get('SwapTotal') - values.get('SwapFree')) / MiB,
  };
}

export function parseLinuxLoad(raw) {
  const match = raw.trim().match(/^(\d+(?:\.\d+)?) \d+(?:\.\d+)? \d+(?:\.\d+)? \d+\/\d+ \d+$/);
  if (!match || !Number.isFinite(Number(match[1]))) throw fail('load');
  return Number(match[1]);
}

export function linuxPressureUnsafe(sample, maximumStallUs) {
  if (!Number.isSafeInteger(maximumStallUs) || maximumStallUs < 0) throw fail('pressure-policy');
  if (
    !Number.isSafeInteger(sample?.memoryPressureSomeStallUs) ||
    !Number.isSafeInteger(sample?.memoryPressureFullStallUs) ||
    sample.memoryPressureSomeStallUs < 0 ||
    sample.memoryPressureFullStallUs < 0
  )
    throw fail('pressure');
  return (
    sample.memoryPressureSomeStallUs > maximumStallUs ||
    sample.memoryPressureFullStallUs > maximumStallUs
  );
}

export async function sampleLinuxHost(
  policy,
  { read = readFile, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {},
) {
  if (
    !Number.isSafeInteger(policy?.linuxCpuMeasurementIntervalMs) ||
    policy.linuxCpuMeasurementIntervalMs <= 0 ||
    !Number.isSafeInteger(policy.maximumLinuxMemoryPressureStallUsPerSample) ||
    policy.maximumLinuxMemoryPressureStallUsPerSample < 0
  )
    throw fail('policy');
  const readText = (path) => read(path, 'utf8');
  const [cpuStart, psiStart] = await Promise.all([
    readText(`${PROC}/stat`),
    readText(`${PROC}/pressure/memory`),
  ]);
  await sleep(policy.linuxCpuMeasurementIntervalMs);
  const [cpuEnd, psiEnd, memoryRaw, loadRaw] = await Promise.all([
    readText(`${PROC}/stat`),
    readText(`${PROC}/pressure/memory`),
    readText(`${PROC}/meminfo`),
    readText(`${PROC}/loadavg`),
  ]);
  const before = parseLinuxCpu(cpuStart);
  const after = parseLinuxCpu(cpuEnd);
  const pressureBefore = parseLinuxPsi(psiStart);
  const pressureAfter = parseLinuxPsi(psiEnd);
  const total = after.total - before.total;
  const idle = after.idle - before.idle;
  if (
    before.logicalCpus !== after.logicalCpus ||
    after.counters.some((value, index) => value < before.counters[index]) ||
    total <= 0 ||
    idle < 0 ||
    idle > total
  )
    throw fail('cpu-interval');
  const memoryPressureSomeStallUs = pressureAfter.some - pressureBefore.some;
  const memoryPressureFullStallUs = pressureAfter.full - pressureBefore.full;
  if (memoryPressureSomeStallUs < 0 || memoryPressureFullStallUs < 0)
    throw fail('pressure-interval');
  const memory = parseLinuxMemory(memoryRaw);
  const sample = {
    platform: 'linux',
    memoryPressureSomeStallUs,
    memoryPressureFullStallUs,
    availableMemoryGiB: memory.availableMemoryGiB,
    requiredMemoryGiB: Math.max(
      policy.minimumAvailableMemoryGiB,
      memory.physicalMemoryGiB * policy.minimumAvailableMemoryFraction,
    ),
    oneMinuteLoad: parseLinuxLoad(loadRaw),
    logicalCpus: after.logicalCpus,
    cpuBusyFraction: (total - idle) / total,
    swapUsedMiB: memory.swapUsedMiB,
  };
  linuxPressureUnsafe(sample, policy.maximumLinuxMemoryPressureStallUsPerSample);
  return sample;
}

/** Preparation only: the hosted workflow continues to refuse Linux runners. */
export async function sampleLinuxReadiness(policy, dependencies) {
  const sample = await sampleLinuxHost(policy, dependencies);
  if (linuxPressureUnsafe(sample, policy.maximumLinuxMemoryPressureStallUsPerSample))
    throw new Error('RESOURCE_PRESSURE_UNSAFE');
  return { busy: sample.cpuBusyFraction, loadPerCpu: sample.oneMinuteLoad / sample.logicalCpus };
}

export function parseLinuxProcessStat(raw) {
  const match = raw.match(/^(\d+) \((.*)\) ([A-Z]) (\d+) (\d+) (\d+) (?:\S+ ){15}(\d+)\s/);
  if (!match) throw fail('process');
  return {
    pid: nonnegativeInteger(match[1], 'process'),
    state: match[3],
    parentPid: nonnegativeInteger(match[4], 'process'),
    groupId: nonnegativeInteger(match[5], 'process'),
    sessionId: nonnegativeInteger(match[6], 'process'),
    startTicks: nonnegativeInteger(match[7], 'process'),
  };
}

/** Read process identities only; no command arguments or environment values are recorded. */
export async function linuxProcessGroupMembers(groupId, { list = readdir, read = readFile } = {}) {
  if (!Number.isSafeInteger(groupId) || groupId <= 0) throw fail('process-group');
  const pids = (await list(PROC)).filter((name) => /^[1-9][0-9]*$/.test(name));
  const members = [];
  for (const name of pids) {
    let raw;
    try {
      raw = await read(`${PROC}/${name}/stat`, 'utf8');
    } catch (error) {
      if (['ENOENT', 'ESRCH'].includes(error.code)) continue;
      throw error;
    }
    const process = parseLinuxProcessStat(raw);
    if (process.groupId === groupId && process.state !== 'Z') members.push(process);
  }
  return members;
}

/** A preparation-only Linux stop primitive; the active guard still refuses Linux. */
export async function stopLinuxOwnedGroup(
  groupId,
  rootStartTicks,
  policy,
  {
    members = linuxProcessGroupMembers,
    send = process.kill,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => performance.now(),
  } = {},
) {
  if (
    !Number.isSafeInteger(groupId) ||
    groupId <= 0 ||
    !Number.isSafeInteger(rootStartTicks) ||
    rootStartTicks <= 0 ||
    !Number.isSafeInteger(policy?.linuxProcessPollMs) ||
    policy.linuxProcessPollMs <= 0 ||
    ![policy.ownedGroupGraceSeconds, policy.ownedGroupKillWaitSeconds].every(
      (seconds) =>
        Number.isFinite(seconds) && seconds > 0 && seconds * 1000 <= Number.MAX_SAFE_INTEGER,
    )
  )
    throw fail('process-owner');
  const census = async () => {
    const live = await members(groupId);
    if (live.length === 0) return false;
    if (
      !live.some(
        (member) =>
          member.pid === groupId &&
          member.groupId === groupId &&
          member.startTicks === rootStartTicks &&
          member.state !== 'Z',
      )
    )
      throw fail('process-owner');
    return true;
  };
  if (!(await census())) throw fail('process-owner');
  const waitGone = async (seconds) => {
    const deadline = now() + seconds * 1000;
    while (now() < deadline) {
      if (!(await census())) return true;
      await sleep(Math.min(policy.linuxProcessPollMs, deadline - now()));
    }
    return !(await census());
  };
  for (const [signal, seconds] of [
    ['SIGTERM', policy.ownedGroupGraceSeconds],
    ['SIGKILL', policy.ownedGroupKillWaitSeconds],
  ]) {
    if (!(await census())) return true;
    try {
      send(-groupId, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    if (await waitGone(seconds)) return true;
  }
  throw new Error('RESOURCE_GROUP_UNCONFIRMED');
}
