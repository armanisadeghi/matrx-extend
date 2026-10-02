import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { diskIsLow, sampleDiskSpace, writeSafetyState } from './stabilization-resource-safety.mjs';

test('a full system volume refuses despite external repo, profile and lease volumes', async () => {
  const paths = {
    repo: '/Volumes/external/repo',
    profileDir: '/Volumes/external/profile',
    leaseRoot: '/Volumes/external/lease',
  };
  const measured = [];
  const sample = await sampleDiskSpace(paths, {
    statfsFn: async (path) => {
      measured.push(path);
      return { bavail: path === '/' ? 116 * 1024 : 1600 * 1024 * 1024, bsize: 1024 };
    },
  });

  assert.deepEqual(measured, [paths.repo, paths.profileDir, paths.leaseRoot, '/']);
  assert.equal(sample.repoFreeGiB, 1600);
  assert.equal(sample.profileFreeGiB, 1600);
  assert.equal(sample.safetyFreeGiB, 1600);
  assert.equal(sample.systemFreeGiB, 116 / 1024);
  assert.equal(diskIsLow(sample, 20), true);
  assert.equal(diskIsLow({ ...sample, systemFreeGiB: 20 }, 20), false);
  assert.equal(diskIsLow({ ...sample, safetyFreeGiB: 19.9, systemFreeGiB: 20 }, 20), true);
});

test('disk sampler reads actual mounted paths and refuses invalid measurements', async () => {
  const sample = await sampleDiskSpace({ repo: '/', profileDir: '/', leaseRoot: '/' });
  assert(
    [sample.repoFreeGiB, sample.profileFreeGiB, sample.safetyFreeGiB, sample.systemFreeGiB].every(
      (free) => Number.isFinite(free) && free >= 0,
    ),
  );
  await assert.rejects(
    sampleDiskSpace(
      { repo: '/', profileDir: '/', leaseRoot: '/' },
      { statfsFn: async () => ({ bavail: 1, bsize: 0 }) },
    ),
    /RESOURCE_MEASUREMENT_INVALID/,
  );
});

test('safety state is private and ENOSPC remains an explicit failure without payload reflection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'resource-safety-'));
  const path = join(dir, 'unsafe-hold.json');
  try {
    await writeSafetyState(path, { schema: 1, reason: 'disk-low' });
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
      schema: 1,
      reason: 'disk-low',
    });
    assert.equal((await stat(path)).mode & 0o777, 0o600);

    const enospc = Object.assign(new Error('private payload was rejected'), { code: 'ENOSPC' });
    await assert.rejects(
      writeSafetyState(
        path,
        { secret: 'synthetic-private-payload' },
        {
          writeFileFn: async () => {
            throw enospc;
          },
        },
      ),
      (error) => {
        assert.equal(error.message, 'RESOURCE_SAFETY_STATE_WRITE_FAILED');
        assert.equal(error.cause.code, 'ENOSPC');
        assert.doesNotMatch(String(error), /synthetic-private-payload|private payload/);
        return true;
      },
    );
    assert.doesNotMatch(await readFile(path, 'utf8'), /synthetic-private-payload/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
