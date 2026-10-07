import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAuditDisplay } from './audit-key-native-display.mjs';

// A real WebMCP call has start and completion rows; the other origins remain
// empty in the disposable admin profile until their own tools are exercised.
const expected = {
  keyId: '6e28d894dd49aa21',
  generated: '10/7/2026, 2:15:02 PM',
  receiptCount: 2,
  recent: [
    { origin: 'webmcp', toolName: 'read_page', status: 'ok', time: '2:15:04 PM' },
    { origin: 'webmcp', toolName: 'read_page', status: 'pending', time: '2:15:04 PM' },
  ],
};
function observed(origin) {
  const filters = Object.fromEntries(
    ['all', 'agent', 'pilot', 'parallel', 'webmcp'].map((name) => [
      name,
      { count: name === 'all' || name === 'webmcp' ? 2 : 0, selected: name === origin },
    ]),
  );
  const rows = origin === 'all' || origin === 'webmcp' ? structuredClone(expected.recent) : [];
  return {
    keyId: expected.keyId,
    generated: expected.generated,
    receiptCount: '2',
    recent: {
      filters,
      rows,
      last: 'last 2',
      empty: rows.length ? null : `No receipts with origin=${origin}.`,
    },
  };
}

test('display comparison detects missing receipt rows and wrong empty/count behavior', () => {
  assert.doesNotThrow(() => assertAuditDisplay(observed('all'), expected, 'all', 'warm'));
  assert.doesNotThrow(() => assertAuditDisplay(observed('pilot'), expected, 'pilot', 'empty'));
  const dropped = observed('all');
  dropped.recent.rows.pop();
  assert.throws(
    () => assertAuditDisplay(dropped, expected, 'all', 'mutant'),
    /visible_rows_mismatch/,
  );
  const falseEmpty = observed('pilot');
  falseEmpty.recent.empty = null;
  assert.throws(
    () => assertAuditDisplay(falseEmpty, expected, 'pilot', 'mutant'),
    /empty_state_mismatch/,
  );
  const badCount = observed('webmcp');
  badCount.recent.filters.webmcp.count = 0;
  assert.throws(
    () => assertAuditDisplay(badCount, expected, 'webmcp', 'mutant'),
    /webmcp_count_mismatch/,
  );
});
