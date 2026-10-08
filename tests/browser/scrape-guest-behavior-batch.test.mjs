import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GUEST_COPY_MENUS,
  copyResultMatches,
  menuMatches,
  scrollSyncMatches,
} from './scrape-guest-behavior-batch.mjs';

test('copy verdict rejects stale clipboard, missing current content, and incomplete menu', () => {
  assert.equal(copyResultMatches({ read: true, hasCurrent: true, hasStale: false }), true);
  assert.equal(copyResultMatches({ read: true, hasCurrent: true, hasStale: true }), false);
  assert.equal(copyResultMatches({ read: true, hasCurrent: false, hasStale: false }), false);
  assert.equal(copyResultMatches({ read: false, hasCurrent: true, hasStale: false }), false);
  const labels = GUEST_COPY_MENUS[0][2];
  assert.equal(menuMatches(labels, labels), true);
  assert.equal(menuMatches(labels.slice(1), labels), false);
  assert.equal(menuMatches([...labels, 'Full capture (JSON)'], labels), false);
});

test('scroll verdict requires real movement while on and no movement after off', () => {
  const start = { selected: true, scrollerCount: 1, max: 300, off: true, top: 0 };
  const followed = { on: true, top: 150 };
  assert.equal(scrollSyncMatches(start, followed, { off: true, top: 150 }), true);
  assert.equal(scrollSyncMatches(start, { on: true, top: 0 }, { off: true, top: 0 }), false);
  assert.equal(scrollSyncMatches(start, followed, { off: true, top: 80 }), false);
  assert.equal(scrollSyncMatches({ ...start, max: 0 }, followed, { off: true, top: 150 }), false);
});
