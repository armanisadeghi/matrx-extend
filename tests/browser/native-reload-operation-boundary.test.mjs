import assert from 'node:assert/strict';
import test from 'node:test';
import { reloadCase } from './native-reload-fixture.mjs';
import { safeReloadOperationFailure } from './native-reload-operation-boundary.mjs';
for (const [operation, exceptionClass] of [
  ['fixture_focus', 'TypeError'],
  ['fixture_reply_clear', 'ReferenceError'],
  ['fixture_open_click', 'TypeError'],
  ['panel_poll', 'TypeError'],
  ['management_recheck', 'TypeError'],
  ['panel_attach', 'ReferenceError'],
]) {
  for (const cleanupThrows of [false, true])
    test(`${operation} retains first exception with cleanup=${cleanupThrows}`, async () => {
      await assert.rejects(
        reloadCase({
          initiallyEnabled: true,
          failOperation: operation,
          cleanupThrows,
          expectFailure: true,
        }),
        (error) => {
          assert.equal(error.name, exceptionClass);
          assert.deepEqual(safeReloadOperationFailure(error.reloadOperationFailure), {
            operation,
            exceptionClass,
            cleanupFailures: cleanupThrows ? ['lifetime_close'] : [],
          });
          assert.equal(error.lifecycleEvidence.timeline.final_predicate, true);
          if (['management_recheck', 'panel_attach'].includes(operation))
            assert.equal(error.contextBoundary.exact_expected_appeared, true);
          return true;
        },
      );
    });
}
test('unknown diagnostic fields cannot escape safe serialization', () => {
  assert.deepEqual(
    safeReloadOperationFailure({
      operation: 'private URL',
      exceptionClass: 'private token',
      cleanupFailures: ['private target', 'lifetime_close'],
      stack: 'private',
    }),
    {
      operation: 'unavailable',
      exceptionClass: 'unknown',
      cleanupFailures: ['lifetime_close'],
    },
  );
});

test('cleanup-only failure refuses success and keeps prior lifecycle/context proof', async () => {
  await assert.rejects(
    reloadCase({ initiallyEnabled: true, cleanupThrows: true, expectFailure: true }),
    (error) => {
      assert.deepEqual(safeReloadOperationFailure(error.reloadOperationFailure), {
        operation: 'lifetime_close',
        exceptionClass: 'RangeError',
        cleanupFailures: ['lifetime_close'],
      });
      assert.equal(error.contextBoundary.exact_expected_appeared, true);
      assert.equal(error.lifecycleEvidence.timeline.final_predicate, true);
      return true;
    },
  );
});
