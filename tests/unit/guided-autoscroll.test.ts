import { runAutoScroll, scrollSentence } from '@/lib/guided-capture/autoscroll';
import { describe, expect, it } from 'vitest';

/** A fake endless-then-finite feed: each scroll step loads `perStep` posts until `total`. */
function feed(total: number, perStep: number) {
  let count = 0;
  let height = 1000;
  const ticks: number[] = [];
  const pauses: number[] = [];
  const hooks = {
    count: () => count,
    scrollBy: () => {
      if (count < total) {
        count = Math.min(total, count + perStep);
        height += 800;
      }
    },
    viewportHeight: () => 900,
    pageHeight: () => height,
    onTick: (c: number) => ticks.push(c),
    sleep: async (ms: number) => {
      pauses.push(ms);
    },
    random: () => 0.5,
  };
  return {
    hooks,
    ticks,
    pauses,
    get count() {
      return count;
    },
  };
}

describe('runAutoScroll', () => {
  it('stops at the chosen count', async () => {
    const f = feed(500, 12);
    const end = await runAutoScroll(f.hooks, 50, new AbortController().signal);
    expect(end).toBe('target');
    expect(f.count).toBeGreaterThanOrEqual(50);
    expect(f.count).toBeLessThan(50 + 12);
  });

  it('stops at the end of the feed when no number is chosen', async () => {
    const f = feed(40, 12);
    const end = await runAutoScroll(f.hooks, null, new AbortController().signal);
    expect(end).toBe('end');
    expect(f.count).toBe(40);
  });

  it('is human paced: every step pauses within the configured window', async () => {
    const f = feed(40, 12);
    await runAutoScroll(f.hooks, null, new AbortController().signal);
    expect(f.pauses.length).toBeGreaterThan(3);
    for (const p of f.pauses) expect(p).toBeGreaterThanOrEqual(900);
  });

  it('cancels immediately and never scrolls again after cancel', async () => {
    const f = feed(500, 12);
    const ctl = new AbortController();
    let steps = 0;
    const hooks = {
      ...f.hooks,
      onTick: () => {
        if (++steps === 3) ctl.abort();
      },
    };
    const end = await runAutoScroll(hooks, null, ctl.signal);
    expect(end).toBe('cancelled');
    expect(steps).toBe(3);
  });

  it('has a safety ceiling', async () => {
    const f = feed(1_000_000, 1);
    expect(await runAutoScroll(f.hooks, null, new AbortController().signal, { maxSteps: 7 })).toBe(
      'ceiling',
    );
  });

  it('says plainly what is happening', () => {
    expect(scrollSentence(null, 142, 'posts')).toBe('142 posts · scrolling…');
    expect(scrollSentence('end', 0, 'posts')).toMatch(/No posts showed up/);
    expect(scrollSentence('end', 9, 'posts')).toContain('end of the feed');
  });
});
