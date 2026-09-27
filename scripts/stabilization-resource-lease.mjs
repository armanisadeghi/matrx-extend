import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, realpath } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const leaseName = (uid) => `matrx-stabilization-resource-${uid}`;

// /var/tmp is a host path; Node's os.tmpdir() follows TMPDIR and can point at
// another volume for the same user. The sticky parent and private child keep
// unrelated users out without tying admission to a profile or checkout.
export function resourceLeaseRoot(uid = userInfo().uid) {
  return join('/var/tmp', leaseName(uid));
}

export async function reserveHeavyDirectory(lock) {
  await mkdir(lock, { mode: 0o700 });
}

export async function legacyLeaseRoots(uid = userInfo().uid, registeredTempDirectories = []) {
  const candidates = [tmpdir(), ...registeredTempDirectories];
  // macOS's per-user temporary directory remains stable when TMPDIR is changed.
  if (process.platform === 'darwin') {
    const { stdout } = await exec('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], {
      timeout: 5000,
    });
    candidates.push(stdout.trim());
  }
  const canonicalParent = await realpath('/var/tmp');
  const roots = await Promise.all(
    candidates
      .filter(Boolean)
      .filter(existsSync)
      .map(async (dir) => {
        const parent = await realpath(dir);
        return parent === canonicalParent ? null : resolve(parent, leaseName(uid));
      }),
  );
  return [...new Set(roots.filter(Boolean))];
}

export async function assertNoLegacyLease(roots) {
  for (const legacyRoot of roots) {
    if (existsSync(join(legacyRoot, 'heavy')))
      throw new Error(`RESOURCE_LEGACY_HEAVY_BUSY:${legacyRoot}`);
    if (existsSync(join(legacyRoot, 'unsafe-hold.json')))
      throw new Error(`RESOURCE_LEGACY_UNSAFE_HOLD:${legacyRoot}`);
  }
}
