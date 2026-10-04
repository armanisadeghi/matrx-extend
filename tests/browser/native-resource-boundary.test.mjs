import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  requireNativeResourceHealth,
  runNativeResourceAction,
} from './native-resource-boundary.mjs';

// Harbor Dental's native Scrape run may start another UI batch only while its
// own admitted guard has recent healthy evidence and no unsafe signal.
test('native Scrape resource boundary permits fresh own-run health and refuses unsafe, stale, and wrong-run evidence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'native-resource-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const leaseRoot = join(root, 'lease');
  const journalDir = join(repo, 'docs/stabilization/resource-journals');
  const policyDir = join(repo, 'docs/stabilization');
  const ownerDir = join(leaseRoot, 'heavy');
  await mkdir(journalDir, { recursive: true });
  await mkdir(ownerDir, { recursive: true });
  const runId = `scrape-${randomUUID()}`;
  const nonce = randomUUID();
  const stopFile = join(leaseRoot, `stop-${nonce}.json`);
  const env = {
    MATRX_RESOURCE_RUN_ID: runId,
    MATRX_RESOURCE_OWNER: nonce,
    MATRX_RESOURCE_STOP_FILE: stopFile,
  };
  const now = Date.parse('2026-10-04T09:14:22.000Z');
  const admitted = {
    schema: 1,
    runId,
    code: 'RESOURCE_ADMITTED',
    at: '2026-10-04T09:14:06.000Z',
    sample: { memoryAvailableGiB: 12 },
    reasons: [],
  };
  const healthy = {
    schema: 1,
    runId,
    code: 'RESOURCE_WATCH_HEALTHY',
    at: '2026-10-04T09:14:20.000Z',
    sample: { memoryAvailableGiB: 12 },
    reasons: [],
  };
  const journalPath = join(journalDir, `${runId}.pending.jsonl`);
  const writeEvents = (events) =>
    writeFile(journalPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  await writeFile(
    join(policyDir, 'resource-policy.json'),
    JSON.stringify({ watchIntervalSeconds: 15 }),
  );
  await writeFile(join(ownerDir, 'owner.json'), JSON.stringify({ runId, nonce, kind: 'run' }));
  const check = (at = now) => requireNativeResourceHealth({ repo, leaseRoot, env, now: at });

  await writeEvents([admitted, healthy]);
  assert.deepEqual(await check(), {
    runId,
    event: 'RESOURCE_WATCH_HEALTHY',
    at: healthy.at,
    ageMs: 2000,
  });
  await writeEvents([
    {
      schema: 1,
      code: 'RESOURCE_RECOVERY_SAMPLES_READY',
      at: '2026-10-04T09:14:05.000Z',
      previousRunId: 'prior-run',
    },
    admitted,
    healthy,
  ]);
  assert.equal((await check()).event, 'RESOURCE_WATCH_HEALTHY');
  await writeEvents([admitted, healthy]);
  let actions = 0;
  assert.equal(
    await runNativeResourceAction(
      () => check(),
      () => ++actions,
    ),
    1,
  );
  await writeEvents([
    admitted,
    healthy,
    { ...healthy, code: 'RESOURCE_WATCH_UNSAFE', at: '2026-10-04T09:14:21.000Z', reasons: ['cpu'] },
  ]);
  await assert.rejects(check(), /unsafe_sample/);
  await assert.rejects(
    runNativeResourceAction(
      () => check(),
      () => ++actions,
    ),
    /unsafe_sample/,
  );
  assert.equal(actions, 1, 'unsafe evidence must refuse the next native UI action');
  let reloadStarted = false;
  await assert.rejects(
    runNativeResourceAction(
      () => check(),
      () => {
        reloadStarted = true;
      },
    ),
    /unsafe_sample/,
  );
  assert.equal(reloadStarted, false, 'refused reload must not record a start');
  await writeEvents([admitted, healthy]);
  await assert.rejects(check(Date.parse('2026-10-04T09:14:36.000Z')), /stale_health/);
  await writeFile(
    join(ownerDir, 'owner.json'),
    JSON.stringify({ runId: 'other-run', nonce, kind: 'run' }),
  );
  await assert.rejects(check(), /wrong_run/);
  await writeFile(join(ownerDir, 'owner.json'), JSON.stringify({ runId, nonce, kind: 'run' }));
  await writeEvents([admitted, { ...healthy, runId: 'other-run' }]);
  await assert.rejects(check(), /wrong_run/);
  await writeEvents([{ ...admitted, runId: undefined }, healthy]);
  await assert.rejects(check(), /wrong_run/);
  await writeEvents([admitted, { ...healthy, runId: undefined }]);
  await assert.rejects(check(), /wrong_run/);
  await writeEvents([admitted, healthy]);
  await writeFile(stopFile, '{}');
  await assert.rejects(check(), /stop_requested/);
  await rm(stopFile);
  await rm(journalPath);
  await assert.rejects(check(), /evidence_missing/);
});
