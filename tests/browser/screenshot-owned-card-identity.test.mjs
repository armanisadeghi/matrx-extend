import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  discriminateRestoredScreenshotCard,
  ownedScreenshotCardMatches,
} from './screenshot-owned-card-identity.mjs';
import { waitFor } from './settings-panel-driver.mjs';

// Harbor Dental's captured fixture returns after its Files tab closes. A
// different row or a stale card must never authorize the next icon click.
const owned = { id: 'harbor-appointment-guide', file_id: 'harbor-file' };
const other = { id: 'harbor-insurance-guide', file_id: 'insurance-file' };
const matchingCard = { cardCount: 1, ordered: true, distinct: true };

test('restored card readiness waits for the exact owned response and rendered card', async () => {
  const states = [
    { rows: [owned], card: { cardCount: 1, ordered: false, distinct: true } },
    { rows: [owned], card: matchingCard },
  ];
  let reads = 0;
  const accepted = await waitFor(
    'owned_card',
    async () => states[Math.min(reads++, states.length - 1)],
    ({ rows, card }) => ownedScreenshotCardMatches(rows, owned, card),
    500,
  );
  assert.equal(reads, 2);
  assert.equal(accepted.card.ordered, true);
});

test('a permanent wrong row cannot satisfy an otherwise matching card', async () => {
  await assert.rejects(
    waitFor(
      'owned_card',
      async () => ({ rows: [other], card: matchingCard }),
      ({ rows, card }) => ownedScreenshotCardMatches(rows, owned, card),
      150,
    ),
    /owned_card_not_observed/,
  );
  assert.equal(
    ownedScreenshotCardMatches([owned], owned, { ...matchingCard, distinct: false }),
    false,
  );
});

test('Files-return discrimination clicks Refresh once before the fresh read and card check', async () => {
  const order = [];
  const result = await discriminateRestoredScreenshotCard({
    clickRefresh: async () => {
      order.push('refresh');
    },
    readRows: async () => {
      order.push('read');
      return { rows: [owned], startedAt: 10, completedAt: 25 };
    },
    cardForRows: async (rows) => {
      order.push('card');
      assert.equal(rows[0].id, owned.id);
      return matchingCard;
    },
    owned,
  });
  assert.deepEqual(order, ['refresh', 'read', 'card']);
  assert.equal(result.cardMatched, true);
  assert.equal(result.readElapsedMs, 15);
  assert.equal(result.readRowCount, 1);
  assert.equal(result.ownedRowCount, 1);
  assert.equal(result.cardCount, 1);
});

test('Files-return discrimination records a mismatched row without accepting its card', async () => {
  let clicks = 0;
  const result = await discriminateRestoredScreenshotCard({
    clickRefresh: async () => {
      clicks++;
    },
    readRows: async () => ({ rows: [other], startedAt: 0, completedAt: 8 }),
    cardForRows: async () => matchingCard,
    owned,
  });
  assert.equal(clicks, 1);
  assert.equal(result.ownedRow, false);
  assert.equal(result.cardMatched, false);
  assert.equal(result.readRowCount, 1);
  assert.equal(result.ownedRowCount, 0);
  assert.equal(result.cardCount, 1);
});

test('Files-return discrimination exposes zero rendered cards despite a completed owned read', async () => {
  const result = await discriminateRestoredScreenshotCard({
    clickRefresh: async () => {},
    readRows: async () => ({ rows: [owned], startedAt: 2, completedAt: 9 }),
    cardForRows: async () => ({ cardCount: 0, ordered: false, distinct: true }),
    owned,
  });
  assert.equal(result.completedRead, true);
  assert.equal(result.readRowCount, 1);
  assert.equal(result.ownedRowCount, 1);
  assert.equal(result.ownedRow, true);
  assert.equal(result.cardCount, 0);
  assert.equal(result.cardMatched, false);
});
