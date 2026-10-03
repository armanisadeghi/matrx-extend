import { statfs, writeFile } from 'node:fs/promises';

const GiB = 1024 ** 3;

/** Sample interval CPU load through the guard's bounded command runner. */
export async function cpuBusyFraction(output) {
  const raw = await output('/usr/sbin/iostat', ['-c', '2', '-w', '1', '-n', '0']);
  // With disks suppressed, the two data rows each contain us, sy, id and
  // three load averages. The first row is the boot average; use only the
  // second row, which measures the one-second interval.
  const lines = raw.trim().split('\n');
  if (
    !/^\s*cpu\s+load average\s*$/.test(lines[0] ?? '') ||
    !/^\s*us\s+sy\s+id\s+1m\s+5m\s+15m\s*$/.test(lines[1] ?? '')
  )
    throw new Error('RESOURCE_MEASUREMENT_INVALID:cpu-busy');
  const readings = lines
    .slice(2)
    .map((line) =>
      line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s*$/),
    );
  if (readings.length !== 2) throw new Error('RESOURCE_MEASUREMENT_INVALID:cpu-busy');
  if (readings.some((reading) => !reading))
    throw new Error('RESOURCE_MEASUREMENT_INVALID:cpu-busy');
  const idle = Number(readings.at(-1)[3]);
  if (!Number.isFinite(idle) || idle < 0 || idle > 100)
    throw new Error('RESOURCE_MEASUREMENT_INVALID:cpu-idle');
  return (100 - idle) / 100;
}

function freeGiB(info, name) {
  const blocks = Number(info.bavail);
  const blockSize = Number(info.bsize);
  const free = (blocks * blockSize) / GiB;
  if (!Number.isFinite(free) || free < 0 || !Number.isFinite(blockSize) || blockSize <= 0)
    throw new Error(`RESOURCE_MEASUREMENT_INVALID:${name}`);
  return free;
}

/** The system volume is sampled independently of the lease location. */
export async function sampleDiskSpace(
  { repo, profileDir, leaseRoot, systemRoot = '/' },
  { statfsFn = statfs } = {},
) {
  const [repoDisk, profileDisk, safetyDisk, systemDisk] = await Promise.all([
    statfsFn(repo),
    statfsFn(profileDir),
    statfsFn(leaseRoot),
    statfsFn(systemRoot),
  ]);
  return {
    repoFreeGiB: freeGiB(repoDisk, 'repo-disk'),
    profileFreeGiB: freeGiB(profileDisk, 'profile-disk'),
    safetyFreeGiB: freeGiB(safetyDisk, 'safety-disk'),
    systemFreeGiB: freeGiB(systemDisk, 'system-disk'),
  };
}

export function diskIsLow(sample, minimumFreeDiskGiB) {
  return [
    sample.repoFreeGiB,
    sample.profileFreeGiB,
    sample.safetyFreeGiB,
    sample.systemFreeGiB,
  ].some((free) => !Number.isFinite(free) || free < minimumFreeDiskGiB);
}

/** Persist a stop/hold marker without exposing its path or contents in an error. */
export async function writeSafetyState(path, state, { writeFileFn = writeFile } = {}) {
  try {
    await writeFileFn(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  } catch (cause) {
    throw new Error('RESOURCE_SAFETY_STATE_WRITE_FAILED', { cause });
  }
}
