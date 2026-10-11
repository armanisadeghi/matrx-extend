import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordApiReadinessMatches } from './settings-readiness-oracle.mjs';

test('T70 accepts the product availability label and rejects the retired Ready label', () => {
  assert.equal(passwordApiReadinessMatches({ passwordApis: true, readiness: 'Available' }), true);
  // This is the old runner's false-positive branch: the real SettingsView emits Available.
  assert.equal(passwordApiReadinessMatches({ passwordApis: true, readiness: 'Ready' }), false);
});

test('T70 unavailable APIs require the exact unavailable label and browser remedy', () => {
  assert.equal(
    passwordApiReadinessMatches({
      passwordApis: false,
      readiness: 'Unavailable',
      unavailableRemedy: true,
    }),
    true,
  );
  assert.equal(
    passwordApiReadinessMatches({
      passwordApis: false,
      readiness: 'Available',
      unavailableRemedy: true,
    }),
    false,
  );
  assert.equal(
    passwordApiReadinessMatches({
      passwordApis: false,
      readiness: 'Unavailable',
      unavailableRemedy: false,
    }),
    false,
  );
});
