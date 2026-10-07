import assert from 'node:assert/strict';

// Compare actual card DOM against sanitized native storage metadata. No key
// material, receipt signatures, or user identifiers leave the browser.
export function assertAuditDisplay(actual, expected, origin, label) {
  assert.equal(actual.keyId, expected.keyId, `${label}_key_id_mismatch`);
  assert.equal(actual.generated, expected.generated, `${label}_generated_mismatch`);
  assert.equal(
    actual.receiptCount,
    String(expected.receiptCount),
    `${label}_receipt_count_mismatch`,
  );
  assert.equal(actual.recent.filters[origin]?.selected, true, `${label}_filter_not_selected`);
  const recent = expected.recent.filter((row) => origin === 'all' || row.origin === origin);
  assert.deepEqual(actual.recent.rows, recent, `${label}_visible_rows_mismatch`);
  assert.equal(
    actual.recent.last,
    `last ${expected.recent.length}`,
    `${label}_recent_total_mismatch`,
  );
  for (const filter of ['all', 'agent', 'pilot', 'parallel', 'webmcp']) {
    assert.equal(
      actual.recent.filters[filter]?.count,
      expected.recent.filter((row) => filter === 'all' || row.origin === filter).length,
      `${label}_${filter}_count_mismatch`,
    );
  }
  assert.equal(
    actual.recent.empty,
    recent.length === 0
      ? origin === 'all'
        ? 'No receipts yet.'
        : `No receipts with origin=${origin}.`
      : null,
    `${label}_empty_state_mismatch`,
  );
}
