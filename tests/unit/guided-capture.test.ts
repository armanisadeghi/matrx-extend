import { createAccumulator } from '@/lib/guided-capture/accumulator';
import {
  INITIAL_GUIDED_STATE,
  canCapture,
  reduceGuided,
} from '@/lib/guided-capture/job';
import {
  GUIDED_PLATFORMS,
  RECIPES,
  countSentence,
  parseWhatToDo,
  recipeForPlatform,
  recipeForUrl,
  stepsFor,
} from '@/lib/guided-capture/recipes';
import { describe, expect, it } from 'vitest';

describe('guided capture recipes', () => {
  it('has a recipe for every platform, keyed by its own name', () => {
    for (const p of GUIDED_PLATFORMS) expect(RECIPES[p].platform).toBe(p);
  });

  it('resolves a recipe from the page address', () => {
    expect(recipeForUrl('https://www.instagram.com/natgeo/')?.platform).toBe('instagram');
    expect(recipeForUrl('https://www.linkedin.com/in/someone/recent-activity/all/')?.platform).toBe('linkedin');
    expect(recipeForUrl('https://twitter.com/x')?.platform).toBe('x');
    expect(recipeForUrl('https://x.com/x')?.platform).toBe('x');
    expect(recipeForUrl('https://m.facebook.com/page')?.platform).toBe('facebook');
    expect(recipeForUrl('https://www.tiktok.com/@a')?.platform).toBe('tiktok');
    expect(recipeForUrl('https://example.com/')).toBeNull();
    expect(recipeForUrl('not a url')).toBeNull();
    expect(recipeForUrl(null)).toBeNull();
    // a look-alike host must not match
    expect(recipeForUrl('https://notinstagram.com/')).toBeNull();
  });

  it('looks a recipe up by platform name', () => {
    expect(recipeForPlatform('linkedin')?.label).toBe('LinkedIn');
    expect(recipeForPlatform('myspace')).toBeNull();
  });

  it('every recipe ends on Capture and reads like a person wrote it', () => {
    const banned = /\b(dom|selector|scrape|scraper|api|json|html|css|xpath|extension)\b/i;
    for (const r of Object.values(RECIPES)) {
      const all = [r.steps, ...Object.values(r.stepsByTarget ?? {})];
      for (const steps of all) {
        expect(steps!.length).toBeGreaterThanOrEqual(3);
        expect(steps![steps!.length - 1]).toBe('Press Capture');
        for (const s of steps!) {
          expect(s).not.toMatch(banned);
          expect(s.length).toBeLessThanOrEqual(60);
        }
      }
    }
  });

  it('LinkedIn activity skips the "open Activity" step', () => {
    const li = RECIPES.linkedin;
    expect(stepsFor(li, 'profile')).toContain('Open the Activity section');
    expect(stepsFor(li, 'activity')).not.toContain('Open the Activity section');
  });

  it('prefers the steps the capture row carries', () => {
    expect(stepsFor(RECIPES.instagram, 'profile', '1. Do A\n2) Do B\n- Press Capture')).toEqual([
      'Do A',
      'Do B',
      'Press Capture',
    ]);
    expect(parseWhatToDo('')).toEqual([]);
    expect(parseWhatToDo(null)).toEqual([]);
  });

  it('has generic steps for an unknown place', () => {
    expect(stepsFor(null, null).at(-1)).toBe('Press Capture');
  });

  it('counts in the platform noun', () => {
    expect(countSentence(RECIPES.instagram, 0)).toBe('No posts yet');
    expect(countSentence(RECIPES.instagram, 1)).toBe('1 post');
    expect(countSentence(RECIPES.tiktok, 12)).toBe('12 videos');
    expect(countSentence(null, 3)).toBe('3 items');
  });

  it('extracts stable item keys from item links', () => {
    const ig = RECIPES.instagram;
    expect(ig.itemKey('https://www.instagram.com/p/Cabc_12/')).toBe('Cabc_12');
    expect(ig.itemKey('https://www.instagram.com/reel/XyZ-9/')).toBe('XyZ-9');
    expect(ig.itemKey('https://www.instagram.com/natgeo/')).toBeNull();
    expect(RECIPES.x.itemKey('https://x.com/a/status/12345')).toBe('12345');
    expect(RECIPES.linkedin.itemKey('https://www.linkedin.com/feed/update/urn:li:activity:7001/')).toBe('urn:li:activity:7001');
    expect(RECIPES.linkedin.itemKey('https://www.linkedin.com/posts/acme_hello-123')).toBe('acme_hello-123');
    expect(RECIPES.tiktok.itemKey('https://www.tiktok.com/@a/video/777')).toBe('777');
  });
});

describe('guided capture accumulator', () => {
  it('counts each item once and keeps its first thumbnail', () => {
    const acc = createAccumulator(RECIPES.instagram);
    expect(acc.add({ href: 'https://www.instagram.com/p/A1/', imgSrc: 'https://cdn/a1.jpg', width: 300, height: 300 })).toBe(true);
    expect(acc.add({ href: 'https://www.instagram.com/p/A1/', imgSrc: 'https://cdn/other.jpg' })).toBe(false);
    expect(acc.add({ href: 'https://www.instagram.com/p/B2/' })).toBe(true);
    expect(acc.add({ href: 'https://www.instagram.com/natgeo/' })).toBe(false);
    expect(acc.count()).toBe(2);
    expect(acc.images()).toEqual([
      { src: 'https://cdn/a1.jpg', post_ref: 'A1', width: 300, height: 300 },
    ]);
  });

  it('fills in a thumbnail that arrives after the link', () => {
    const acc = createAccumulator(RECIPES.instagram);
    acc.add({ href: 'https://www.instagram.com/p/A1/' });
    acc.add({ href: 'https://www.instagram.com/p/A1/', imgSrc: 'https://cdn/late.jpg' });
    expect(acc.count()).toBe(1);
    expect(acc.images()[0]?.src).toBe('https://cdn/late.jpg');
  });

  it('refuses non-web image sources and honours the cap', () => {
    const acc = createAccumulator(RECIPES.instagram);
    acc.add({ href: 'https://www.instagram.com/p/A1/', imgSrc: 'blob:xyz' });
    expect(acc.images()).toEqual([]);
    for (let i = 0; i < 5; i++) acc.add({ href: `https://www.instagram.com/p/K${i}/`, imgSrc: `https://cdn/${i}.jpg` });
    expect(acc.images(3)).toHaveLength(3);
  });
});

describe('guided capture job transitions', () => {
  const s0 = INITIAL_GUIDED_STATE;

  it('starts guiding with Capture live', () => {
    expect(s0.phase).toBe('guiding');
    expect(canCapture(s0)).toBe(true);
  });

  it('progress only ever grows', () => {
    let s = reduceGuided(s0, { type: 'items', count: 5 });
    s = reduceGuided(s, { type: 'items', count: 3 });
    expect(s.itemCount).toBe(5);
  });

  it('guiding -> filing -> done', () => {
    let s = reduceGuided(s0, { type: 'items', count: 12 });
    s = reduceGuided(s, { type: 'capture' });
    expect(s.phase).toBe('filing');
    expect(canCapture(s)).toBe(false);
    s = reduceGuided(s, { type: 'filed', chars: 900, items: 12 });
    expect(s.phase).toBe('done');
    expect(s.filed).toEqual({ chars: 900, items: 12, notice: null });
    // terminal: later progress and captures change nothing
    expect(reduceGuided(s, { type: 'items', count: 99 })).toBe(s);
    expect(reduceGuided(s, { type: 'capture' })).toBe(s);
  });

  it('filing -> failed -> retry -> guiding keeps the count', () => {
    let s = reduceGuided(s0, { type: 'items', count: 4 });
    s = reduceGuided(s, { type: 'capture' });
    s = reduceGuided(s, { type: 'failed', sentence: 'Could not save.' });
    expect(s.phase).toBe('failed');
    expect(s.error).toBe('Could not save.');
    s = reduceGuided(s, { type: 'retry' });
    expect(s.phase).toBe('guiding');
    expect(s.error).toBeNull();
    expect(s.itemCount).toBe(4);
  });

  it('ignores events that do not fit the phase', () => {
    expect(reduceGuided(s0, { type: 'filed', chars: 1, items: 1 })).toBe(s0);
    expect(reduceGuided(s0, { type: 'failed', sentence: 'x' })).toBe(s0);
    expect(reduceGuided(s0, { type: 'retry' })).toBe(s0);
  });
});
