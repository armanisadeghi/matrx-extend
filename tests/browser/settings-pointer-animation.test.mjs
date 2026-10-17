import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { click } from './settings-panel-driver.mjs';

// Guest Scrape's 24px scroll-sync control must remain clickable during its
// transition-colors; the same oracle must refuse motion and occlusion.
function fixture({ frames, ancestor = false, occluded = false, moving = false, effect } = {}) {
  const window = new Window();
  window.document.body.innerHTML =
    '<main><button title="Sync scroll with the live page"></button></main><div role="dialog">Private capture content</div>';
  const target = window.document.querySelector('button');
  let sample = 0;
  for (const element of window.document.querySelectorAll('*')) {
    element.getBoundingClientRect = () => ({
      x: 324,
      y: 216,
      left: 324,
      top: 216,
      right: 348,
      bottom: 240,
      width: 24,
      height: 24,
    });
    element.scrollIntoView = () => {};
    element.getAnimations = () => [];
  }
  if (moving)
    target.getBoundingClientRect = () => {
      const x = 324 + ++sample;
      return { x, y: 216, left: x, top: 216, right: x + 24, bottom: 240, width: 24, height: 24 };
    };
  (ancestor ? target.parentElement : target).getAnimations = () => [
    {
      playState: 'running',
      effect: effect ?? (frames ? { getKeyframes: () => frames } : null),
    },
  ];
  window.document.elementFromPoint = () =>
    occluded ? window.document.querySelector('[role="dialog"]') : target;
  const events = [];
  const panel = {
    async send(method, args) {
      if (method === 'Runtime.evaluate') return { result: { value: window.eval(args.expression) } };
      if (method === 'Input.dispatchMouseEvent') events.push(args.type);
      return {};
    },
  };
  return { window, panel, events };
}

const colors = [
  {
    offset: 0,
    computedOffset: 0,
    easing: 'linear',
    composite: 'auto',
    color: 'rgb(0, 0, 0)',
    backgroundColor: 'rgb(255, 255, 255)',
  },
  {
    offset: 1,
    computedOffset: 1,
    easing: 'linear',
    composite: 'auto',
    color: 'rgb(255, 255, 255)',
    backgroundColor: 'rgb(0, 0, 0)',
  },
];

for (const ancestor of [false, true]) {
  test(`color-only ${ancestor ? 'ancestor' : 'target'} animation allows a stable native click`, async () => {
    const { window, panel, events } = fixture({ frames: colors, ancestor });
    try {
      await click(panel, 'title', 'Sync scroll with the live page');
      assert.deepEqual(events, ['mousePressed', 'mouseReleased']);
    } finally {
      window.happyDOM.abort();
    }
  });
}

for (const property of [
  'transform',
  'translate',
  'scale',
  'width',
  'opacity',
  'clipPath',
  'filter',
  'pointerEvents',
  '--private-animation',
]) {
  test(`${property} alongside color still refuses native input`, async (t) => {
    const { window, panel, events } = fixture({
      frames: colors.map((frame) => ({ ...frame, [property]: 'private-effect-value' })),
      ancestor: true,
    });
    let time = 0;
    t.mock.method(Date, 'now', () => {
      time += 1000;
      return time;
    });
    try {
      await assert.rejects(click(panel, 'title', 'Sync scroll with the live page'), (error) => {
        assert.equal(error.driverFailure.code, 'pointer_stable_hit_not_observed');
        assert.equal(error.driverFailure.animating, true);
        assert.equal(error.driverFailure.animationCategory, 'hit_affecting_or_unknown');
        assert.equal(error.driverFailure.clickTargetCategory, 'scrape_scroll_sync_enable');
        assert.equal(error.driverFailure.animationDiagnostic.effects[0].relation, 'ancestor');
        assert(!JSON.stringify(error.driverFailure).includes('private-effect-value'));
        assert(!JSON.stringify(error.driverFailure).includes('--private-animation'));
        return true;
      });
      assert.deepEqual(events, []);
    } finally {
      window.happyDOM.abort();
    }
  });
}

for (const options of [
  {},
  { frames: [] },
  {
    effect: {
      getKeyframes() {
        throw new Error('Private animation contents');
      },
    },
  },
  { frames: colors, occluded: true },
  { frames: colors, moving: true },
]) {
  test(`unclassified effect or unsafe hit still refuses: ${Object.keys(options).join(',') || 'no effect'}`, async (t) => {
    const { window, panel, events } = fixture(options);
    let time = 0;
    t.mock.method(Date, 'now', () => {
      time += 1000;
      return time;
    });
    try {
      await assert.rejects(click(panel, 'title', 'Sync scroll with the live page'), (error) => {
        assert.equal(error.driverFailure.code, 'pointer_stable_hit_not_observed');
        assert.equal(error.driverFailure.animating, !(options.occluded || options.moving));
        assert(!JSON.stringify(error.driverFailure).includes('Private animation contents'));
        return true;
      });
      assert.deepEqual(events, []);
    } finally {
      window.happyDOM.abort();
    }
  });
}

test('animation diagnostics bound effects and allowlist properties, timing and ownership', async (t) => {
  const { window, panel, events } = fixture();
  const target = window.document.querySelector('button');
  target.getAnimations = () =>
    Array.from({ length: 12 }, () => ({
      playState: 'running',
      effect: {
        getKeyframes: () => [{ transform: 'private transform', '--secret-url': 'private auth' }],
        getTiming: () => ({ duration: 500, delay: -50, easing: 'private timing' }),
      },
    }));
  let time = 0;
  t.mock.method(Date, 'now', () => {
    time += 1000;
    return time;
  });
  try {
    await assert.rejects(click(panel, 'title', 'Sync scroll with the live page'), (error) => {
      const diagnostic = error.driverFailure.animationDiagnostic;
      assert.equal(diagnostic.runningCount, 12);
      assert.equal(diagnostic.truncated, true);
      assert.equal(diagnostic.effects.length, 8);
      assert.deepEqual(JSON.parse(JSON.stringify(diagnostic.effects[0])), {
        relation: 'target',
        propertyCategories: ['other_or_custom', 'transform'],
        duration: 'up_to_1000ms',
        delay: 'negative',
        currentTime: null,
        startTime: null,
        playbackRate: null,
        pending: null,
        iterations: null,
        endTime: null,
        progress: null,
        elementState: 'other_or_none',
        elementSide: 'other_or_none',
      });
      assert(!JSON.stringify(error.driverFailure).includes('private'));
      assert(!JSON.stringify(error.driverFailure).includes('secret-url'));
      return true;
    });
    assert.deepEqual(events, []);
  } finally {
    window.happyDOM.abort();
  }
});

test('failed pointer retains first and last animation clocks without dispatching input', async (t) => {
  const { window, panel, events } = fixture();
  const target = window.document.querySelector('button');
  let currentTime = 0;
  target.setAttribute('data-state', 'open');
  target.setAttribute('data-side', 'bottom');
  target.getAnimations = () => {
    currentTime += 10;
    return [
      {
        playState: 'running',
        pending: false,
        startTime: 25,
        currentTime,
        playbackRate: 1,
        effect: {
          getKeyframes: () => [{ transform: 'private page content' }],
          getTiming: () => ({ duration: 150, delay: 0, iterations: 1 }),
          getComputedTiming: () => ({ endTime: 150, progress: 0.25 }),
        },
      },
    ];
  };
  let time = 0;
  t.mock.method(Date, 'now', () => {
    time += 1000;
    return time;
  });
  try {
    await assert.rejects(click(panel, 'title', 'Sync scroll with the live page'), (error) => {
      const first = error.driverFailure.animationInitialDiagnostic;
      const last = error.driverFailure.animationDiagnostic;
      assert.ok(first, 'missing initial animation clock at pointer failure');
      assert.equal(first.effects[0].currentTime, 10);
      assert.ok(last.effects[0].currentTime > first.effects[0].currentTime);
      assert.equal(last.effects[0].startTime, 25);
      assert.equal(last.effects[0].iterations, 1);
      assert.equal(last.effects[0].endTime, 150);
      assert.equal(last.effects[0].pending, false);
      assert.equal(last.effects[0].elementState, 'open');
      assert.equal(last.effects[0].elementSide, 'bottom');
      assert.ok(last.sampledAt >= first.sampledAt);
      assert.equal(typeof last.focused, 'boolean');
      assert.ok(['visible', 'hidden', 'prerender', 'other'].includes(last.documentVisibilityState));
      assert(!JSON.stringify(error.driverFailure).includes('private page content'));
      return true;
    });
    assert.deepEqual(events, []);
  } finally {
    window.happyDOM.abort();
  }
});
