import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  assertNoLegacyLease,
  legacyLeaseRoots,
  resourceLeaseRoot,
} from './stabilization-resource-lease.mjs';

const moduleUrl = new URL('./stabilization-resource-lease.mjs', import.meta.url).href;
const scratch = await mkdtemp(join(tmpdir(), 'matrx-resource-lease-'));
after(() => rm(scratch, { recursive: true, force: true }));

test('different TMPDIR values resolve to the same host user lease', async () => {
  const firstTemp = join(scratch, 'default-profile');
  const secondTemp = join(scratch, 'external-profile');
  await mkdir(firstTemp);
  await mkdir(secondTemp);
  const script = `import { resourceLeaseRoot } from ${JSON.stringify(moduleUrl)}; console.log(resourceLeaseRoot())`;
  const roots = [firstTemp, secondTemp].map((directory) => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TMPDIR: directory },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  });
  assert.deepEqual(roots, [resourceLeaseRoot(), resourceLeaseRoot()]);
  assert.notEqual(firstTemp, secondTemp);
  const otherUid = userInfo().uid + 1;
  assert.equal(
    resourceLeaseRoot(otherUid),
    join('/var/tmp', `matrx-stabilization-resource-${otherUid}`),
  );
  assert.notEqual(resourceLeaseRoot(otherUid), resourceLeaseRoot());
});

test('the shared reservation refuses a second process across TMPDIR values', async () => {
  // This unique identity cannot be a real user's UID. The same production path
  // resolver and atomic reservation run in both children; only this probe root
  // is created and removed.
  const probeIdentity = `probe-${randomUUID()}`;
  const probeRoot = resourceLeaseRoot(probeIdentity);
  await mkdir(probeRoot, { mode: 0o700 });
  const childScript = `import { join } from 'node:path';
    import { resourceLeaseRoot, reserveHeavyDirectory } from ${JSON.stringify(moduleUrl)};
    const lock = join(resourceLeaseRoot(process.argv[1]), 'heavy');
    await reserveHeavyDirectory(lock); process.stdout.write('RESERVED ' + lock + '\\n'); process.stdin.resume();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', childScript, probeIdentity], {
    env: { ...process.env, TMPDIR: join(scratch, 'default-profile') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolveReady, reject) => {
      child.once('error', reject);
      child.stdout.once('data', (data) => {
        assert.match(data.toString(), /RESERVED/);
        assert.match(data.toString(), /\/var\/tmp\/matrx-stabilization-resource-probe-/);
        resolveReady();
      });
      child.once('exit', (code) => reject(new Error(`holder exited before reservation: ${code}`)));
    });
    const script = `import { join } from 'node:path';
      import { resourceLeaseRoot, reserveHeavyDirectory } from ${JSON.stringify(moduleUrl)};
      try { await reserveHeavyDirectory(join(resourceLeaseRoot(process.argv[1]), 'heavy')); process.exit(9); }
      catch (error) { if (error.code !== 'EEXIST') throw error; console.log('BUSY'); }`;
    const contender = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script, probeIdentity],
      {
        env: { ...process.env, TMPDIR: join(scratch, 'external-profile') },
        encoding: 'utf8',
      },
    );
    assert.equal(contender.status, 0, contender.stderr);
    assert.match(contender.stdout, /BUSY/);
  } finally {
    child.stdin.end();
    await new Promise((resolveExit) => child.once('exit', resolveExit));
    await rm(probeRoot, { recursive: true });
  }
});

test('an old holder and its unsafe hold remain blocking state', async () => {
  const oldRoot = join(scratch, `matrx-stabilization-resource-${userInfo().uid}`);
  await mkdir(join(oldRoot, 'heavy'), { recursive: true });
  await assert.rejects(assertNoLegacyLease([oldRoot]), /RESOURCE_LEGACY_HEAVY_BUSY/);
  await rm(join(oldRoot, 'heavy'), { recursive: true });
  await writeFile(join(oldRoot, 'unsafe-hold.json'), '{}');
  await assert.rejects(assertNoLegacyLease([oldRoot]), /RESOURCE_LEGACY_UNSAFE_HOLD/);
  assert.ok((await legacyLeaseRoots()).every((root) => root !== resourceLeaseRoot()));
});

test('default TMPDIR discovers a registered external legacy holder', async () => {
  const externalTemp = join(scratch, 'approved-external');
  await mkdir(externalTemp);
  const legacyRoot = join(
    await realpath(externalTemp),
    `matrx-stabilization-resource-${userInfo().uid}`,
  );
  await mkdir(join(legacyRoot, 'heavy'), { recursive: true });
  const roots = await legacyLeaseRoots(userInfo().uid, [externalTemp]);
  assert.ok(roots.includes(legacyRoot));
  await assert.rejects(assertNoLegacyLease(roots), /RESOURCE_LEGACY_HEAVY_BUSY/);
});
