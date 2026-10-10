import assert from 'node:assert/strict';

const PAIR_FORGET_OUTCOMES = [
  'Forget cancel preserves the owned guest pairing',
  'Forget refusal preserves pairing and shows retry',
  'Forget retry removes the owned pairing from browser storage',
];

export function assertDesktopPairForgetReportScope(reportCases) {
  assert.deepEqual(
    reportCases.map((item) => item.name),
    PAIR_FORGET_OUTCOMES,
    'desktop_pair_forget_case_scope_mismatch',
  );
  assert.ok(
    reportCases.every((item) => item.status === 'pass'),
    'desktop_pair_forget_case_not_passed',
  );
}
