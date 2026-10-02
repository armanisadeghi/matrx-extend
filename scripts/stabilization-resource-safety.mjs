import { statfs, writeFile } from 'node:fs/promises';

const GiB = 1024 ** 3;

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
