import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clickReachableShowcaseCard } from './showcase-card-driver.mjs';

function cardFixture(hitAt) {
  const previous = {
    document: globalThis.document,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
  };
  const target = {
    getBoundingClientRect: () => ({
      left: 8,
      top: 80,
      right: 593,
      bottom: 146,
      width: 585,
      height: 66,
    }),
    contains: () => false,
  };
  globalThis.innerWidth = 601;
  globalThis.innerHeight = 498;
  globalThis.document = { elementFromPoint: (x, y) => (hitAt(x, y) ? target : {}) };
  const calls = [];
  const card = {
    scrollIntoViewIfNeeded: async () => calls.push('scroll'),
    evaluate: async (callback) => callback(target),
    click: async (options = {}) => {
      const position = options.position ?? { x: 292.5, y: 33 };
      if (!hitAt(8 + position.x, 80 + position.y)) throw new Error('browser_pointer_intercepted');
      calls.push(position);
    },
  };
  return { card, calls, restore: () => Object.assign(globalThis, previous) };
}

test('picker covering center still permits native card selection at a reachable interior point', async () => {
  const fixture = cardFixture((x) => x < 239);
  try {
    await clickReachableShowcaseCard(fixture.card);
    assert.deepEqual(fixture.calls, ['scroll', { x: 146.25, y: 33 }]);
  } finally {
    fixture.restore();
  }
});

test('fully obstructed card fails before any browser click', async () => {
  const fixture = cardFixture(() => false);
  try {
    await assert.rejects(
      clickReachableShowcaseCard(fixture.card),
      /showcase_card_no_reachable_pointer_point/,
    );
    assert.deepEqual(fixture.calls, ['scroll']);
  } finally {
    fixture.restore();
  }
});
