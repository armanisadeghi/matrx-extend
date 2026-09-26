'use strict';

const assert = require('node:assert/strict');
const {
  cleanupReceiptOwnedFallback,
  isKnownLocalAdapterBootTypeError,
} = require('./vault-receipt-cleanup-fallback.cjs');

const northRouteId = '11111111-1111-4111-8111-111111111111';
const harborRouteId = '22222222-2222-4222-8222-222222222222';

async function run({ initial, deleted, final }) {
  const calls = [];
  const states = new Map([
    [northRouteId, { initial: initial[0], deleted: deleted[0], final: final[0] }],
    [harborRouteId, { initial: initial[1], deleted: deleted[1], final: final[1] }],
  ]);
  const result = await cleanupReceiptOwnedFallback({
    receiptIds: new Set([northRouteId, harborRouteId]),
    request: async (id, method) => {
      calls.push([id, method]);
      const state = states.get(id);
      const callCount = calls.filter(([called]) => called === id).length;
      return { status: method === 'DELETE' ? state.deleted : callCount === 1 ? state.initial : state.final };
    },
  });
  return { result, calls };
}

(async () => {
  const cleaned = await run({ initial: [200, 200], deleted: [204, 204], final: [404, 404] });
  assert.deepEqual(cleaned.calls, [
    [northRouteId, 'GET'], [northRouteId, 'DELETE'], [northRouteId, 'GET'],
    [harborRouteId, 'GET'], [harborRouteId, 'DELETE'], [harborRouteId, 'GET'],
  ]);
  assert.deepEqual(cleaned.result.attempts.map(({ terminal }) => terminal), [
    'deleted_and_missing', 'deleted_and_missing',
  ]);
  const alreadyCleaned = await run({ initial: [404, 200], deleted: [404, 204], final: [404, 404] });
  assert.equal(alreadyCleaned.result.attempts[0].terminal, 'already_cleaned');
  assert.equal(alreadyCleaned.result.attempts[1].terminal, 'deleted_and_missing');
  await assert.rejects(
    () => run({ initial: [200, 200], deleted: [204, 204], final: [200, 404] }),
    /distributed_cleanup_final_refused/,
  );
  await assert.rejects(
    () => cleanupReceiptOwnedFallback({ receiptIds: new Set(), request: async () => ({ status: 404 }) }),
    /distributed_cleanup_receipts_refused/,
  );
  assert.equal(isKnownLocalAdapterBootTypeError({ code: 'internal_refused', errorType: 'TypeError' }), true);
  assert.equal(isKnownLocalAdapterBootTypeError({ code: 'internal_refused', errorType: 'RuntimeError' }), false);
  assert.equal(isKnownLocalAdapterBootTypeError({ code: 'cleanup_incomplete', errorType: 'TypeError' }), false);
  process.stdout.write('PASS: receipt-owned distributed cleanup is exact, ordered, and fail-closed\n');
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
