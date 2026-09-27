import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownedScreenshotCardMatches } from './screenshot-owned-card-identity.mjs';
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
