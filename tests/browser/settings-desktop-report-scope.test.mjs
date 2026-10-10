import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDesktopPairForgetReportScope } from './settings-desktop-report-scope.mjs';

const passingOutcomes = [
  { name: 'Forget cancel preserves the owned guest pairing', status: 'pass' },
  { name: 'Forget refusal preserves pairing and shows retry', status: 'pass' },
  { name: 'Forget retry removes the owned pairing from browser storage', status: 'pass' },
];

test('pair-forget report contract accepts exactly the three passing native controls', () => {
  assert.doesNotThrow(() => assertDesktopPairForgetReportScope(passingOutcomes));
});

test('pair-forget report contract refuses omission of each native control', () => {
  for (let omittedIndex = 0; omittedIndex < passingOutcomes.length; omittedIndex++) {
    const incomplete = passingOutcomes.filter((_, index) => index !== omittedIndex);
    assert.throws(
      () => assertDesktopPairForgetReportScope(incomplete),
      /desktop_pair_forget_case_scope_mismatch/,
    );
  }
});

test('pair-forget report contract refuses unrelated results and failed controls', () => {
  assert.throws(
    () =>
      assertDesktopPairForgetReportScope([
        ...passingOutcomes,
        { name: 'Local engine connection', status: 'pass' },
      ]),
    /desktop_pair_forget_case_scope_mismatch/,
  );
  assert.throws(
    () =>
      assertDesktopPairForgetReportScope(
        passingOutcomes.map((item, index) => (index === 1 ? { ...item, status: 'fail' } : item)),
      ),
    /desktop_pair_forget_case_not_passed/,
  );
});
