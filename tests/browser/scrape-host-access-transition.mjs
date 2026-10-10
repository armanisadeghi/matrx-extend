import assert from 'node:assert/strict';

const HOST_ACCESS_VALUES = new Set(['ON_CLICK', 'ON_ALL_SITES']);

export async function updateHostAccessIfExpected(current, requested, expectedBefore, update) {
  if (expectedBefore !== null && current !== expectedBefore)
    throw new Error('scrape_recovery_host_access_precondition_failed');
  assert.ok(HOST_ACCESS_VALUES.has(requested), 'scrape_recovery_host_access_value_missing');
  return update(requested);
}
