import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPublicReplay } from './showcase-d47-public-initial-load.mjs';

const captured = {
  exact_row: true,
  running: false,
  unavailable: false,
  last_run_exact: true,
  hits_rows: true,
  no_match_guidance: false,
  error: false,
};
const guidance = {
  exact_row: true,
  running: false,
  unavailable: false,
  last_run_exact: false,
  hits_rows: false,
  no_match_guidance: true,
  error: true,
};
const verdicts = (classify) => [
  classify(captured),
  classify(guidance),
  classify({ ...captured, exact_row: false }),
  classify({ ...captured, running: true }),
  classify({ ...captured, hits_rows: false }),
  classify({ ...captured, error: true }),
  classify({ ...guidance, no_match_guidance: false }),
  classify({ ...guidance, hits_rows: true }),
];
const expected = [
  'captured_initial_request',
  'honest_retrigger_guidance',
  'unverified',
  'unverified',
  'unverified',
  'unverified',
  'unverified',
  'unverified',
];

test('public saved replay requires exact terminal rows or exact no-match remedy', () => {
  assert.deepEqual(verdicts(classifyPublicReplay), expected);
});

test('constant success and permissive guidance mutants are rejected by the oracle cases', () => {
  assert.notDeepEqual(
    verdicts(() => 'captured_initial_request'),
    expected,
  );
  const permissive = (state) =>
    state.error ? 'honest_retrigger_guidance' : 'captured_initial_request';
  assert.notDeepEqual(verdicts(permissive), expected);
});
