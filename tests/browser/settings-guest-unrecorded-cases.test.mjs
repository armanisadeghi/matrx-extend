import assert from 'node:assert/strict';
import test from 'node:test';
import { askAgainMatches } from './settings-guest-unrecorded-cases.mjs';

test('Ask again requires exactly the selected origin to disappear while the other remains', () => {
  const both = {
    guest: true,
    privacyOpen: true,
    rowCount: 2,
    storageCount: 2,
    firstRow: true,
    firstStored: true,
    secondRow: true,
    secondStored: true,
    headingVisible: true,
    otherStored: false,
  };
  const one = { ...both, rowCount: 1, storageCount: 1, firstRow: false, firstStored: false };
  const empty = {
    ...one,
    rowCount: 0,
    storageCount: 0,
    secondRow: false,
    secondStored: false,
    headingVisible: false,
  };
  const oneExpected = { count: 1, first: false, second: true };
  assert.equal(askAgainMatches(both, { count: 2, first: true, second: true }), true);
  assert.equal(askAgainMatches(one, oneExpected), true);
  assert.equal(askAgainMatches(empty, { count: 0, first: false, second: false }), true);
  assert.equal(askAgainMatches(both, oneExpected), false, 'no-op deletion must fail');
  assert.equal(
    askAgainMatches({ ...one, secondStored: false }, oneExpected),
    false,
    'deleting both origins must fail',
  );
  assert.equal(
    askAgainMatches({ ...one, secondRow: false }, oneExpected),
    false,
    'remaining origin must stay visible',
  );
  assert.equal(
    askAgainMatches({ ...empty, headingVisible: true }, { count: 0, first: false, second: false }),
    false,
    'empty heading must disappear',
  );
});
