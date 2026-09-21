import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

test('four incremental receipt reconciliations retain every owned item before MFA', async () => {
  const driverUrl = new URL('./read-only-auth-driver.mjs', import.meta.url);
  const source = await readFile(driverUrl, 'utf8');
  const start = source.indexOf('async function reconcileCaptureSaveReceipts(keys) {');
  const end = source.indexOf('async function canonicalCleanupCaptureSave', start);
  assert.ok(start > 0 && end > start, 'driver_reconciliation_boundary_missing');
  const body = source
    .slice(start, end)
    .replaceAll('import.meta.url', JSON.stringify(driverUrl.href));
  const ids = ['item-1', 'item-2', 'item-3', 'item-4'];
  const proof = {};
  const persistedCounts = [];
  const context = {
    assert,
    URL,
    fileURLToPath,
    proof,
    userId: 'admin-test',
    organizationId: 'org-test',
    baselineIds: [],
    persist: async () => {
      persistedCounts.push(proof.ownedFixtureIds.length);
    },
    execFileAsync: async (_python, args) => ({
      stdout: JSON.stringify({
        results: args.slice(3).map((key) => ({
          mutation_id: key,
          result_item_id: ids[Number(key) - 1],
          user_id: 'admin-test',
          organization_id: null,
          retired: false,
        })),
      }),
    }),
  };
  vm.createContext(context);
  vm.runInContext(`${body}\nglobalThis.reconcile = reconcileCaptureSaveReceipts;`, context);
  for (const key of ['1', '2', '3', '4']) await context.reconcile([key]);
  assert.deepEqual([...proof.ownedFixtureIds], ids);
  assert.deepEqual(persistedCounts, [1, 2, 3, 4]);
  await context.reconcile(['2']);
  assert.deepEqual(
    [...proof.ownedFixtureIds],
    ids,
    'repeat reconciliation must not duplicate ownership',
  );
});
